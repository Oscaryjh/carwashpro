import type { Prisma } from "@prisma/client";

export type TeamMemberEmploymentStatus =
  | "ACTIVE"
  | "SUSPENDED"
  | "TERMINATED";

export async function synchronizeTeamMemberEmploymentState(
  transaction: Prisma.TransactionClient,
  input: {
    businessId: string;
    employeeAccountId: string;
    fullName: string;
    membershipId: string;
    phoneNumberNormalized: string;
    status: TeamMemberEmploymentStatus;
  },
) {
  const linkedUser = await transaction.user.findUnique({
    where: {
      employeeBusinessMembershipId: input.membershipId,
    },
    select: {
      id: true,
      role: true,
    },
  });

  if (linkedUser?.role === "STAFF") {
    await transaction.user.update({
      where: { id: linkedUser.id },
      data: {
        employeeAccountId: input.employeeAccountId,
        name: input.fullName,
        whatsappPhone: input.phoneNumberNormalized,
        ...(input.status === "ACTIVE"
          ? {}
          : {
              appointmentBookable: false,
              loginEnabled: false,
              status: "inactive",
            }),
      },
    });
  }

  if (input.status === "ACTIVE") {
    return {
      linkedStaffUpdated: Boolean(linkedUser?.role === "STAFF"),
      revokedEmployeeSessions: 0,
    };
  }

  const now = new Date();
  await transaction.employeeBusinessMembership.update({
    where: {
      id: input.membershipId,
      businessId: input.businessId,
    },
    data: {
      attendanceEnabled: false,
    },
  });

  await transaction.employeeBranchAssignment.updateMany({
    where: {
      businessId: input.businessId,
      membershipId: input.membershipId,
      status: "ACTIVE",
    },
    data:
      input.status === "TERMINATED"
        ? {
            canClockIn: false,
            effectiveUntil: now,
            isPrimary: false,
            status: "INACTIVE",
          }
        : {
            canClockIn: false,
          },
  });

  const revokedSessions = await transaction.employeeSession.updateMany({
    where: {
      businessId: input.businessId,
      membershipId: input.membershipId,
      revokedAt: null,
    },
    data: {
      revokedAt: now,
      revokeReason:
        input.status === "TERMINATED"
          ? "Employment terminated."
          : "Employment suspended.",
    },
  });

  return {
    linkedStaffUpdated: Boolean(linkedUser?.role === "STAFF"),
    revokedEmployeeSessions: revokedSessions.count,
  };
}
