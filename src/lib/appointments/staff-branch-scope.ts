import type { Prisma } from "@prisma/client";

export const NO_APPOINTMENT_BRANCH_ID =
  "00000000-0000-0000-0000-000000000000";

type AppointmentStaffWhereInput = {
  at?: Date;
  branchId: string | null;
  businessId: string;
  includeUserId?: string | null;
  staffId?: string | null;
};

export function buildAppointmentStaffWhere({
  at = new Date(),
  branchId,
  businessId,
  includeUserId,
  staffId,
}: AppointmentStaffWhereInput): Prisma.UserWhereInput {
  const baseWhere: Prisma.UserWhereInput = {
    appointmentBookable: true,
    businessId,
    ...(staffId ? { id: staffId } : {}),
    status: "active",
  };

  if (!branchId) {
    return baseWhere;
  }

  return {
    ...baseWhere,
    OR: [
      ...(includeUserId ? [{ id: includeUserId }] : []),
      { role: "BUSINESS_OWNER" },
      {
        branchId,
        employeeBusinessMembershipId: null,
        role: "STAFF",
      },
      {
        role: "STAFF",
        employeeBusinessMembership: {
          is: {
            branchAssignments: {
              some: {
                branchId,
                businessId,
                effectiveFrom: { lte: at },
                OR: [
                  { effectiveUntil: null },
                  { effectiveUntil: { gte: at } },
                ],
                status: "ACTIVE",
              },
            },
            businessId,
            status: "ACTIVE",
          },
        },
      },
    ],
  };
}
