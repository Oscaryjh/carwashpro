import type { Prisma, PrismaClient } from "@prisma/client";
import { attendanceEmployeeCreateInputSchema } from "@/lib/attendance/employee";
import {
  createAttendanceEmployeeInTransaction,
  updateAttendanceEmployeeInTransaction,
  type AttendanceServiceActor,
} from "@/lib/attendance/employee-service";
import { normalizeAttendancePhone } from "@/lib/attendance/phone";
import type { AuditRequestContext } from "@/lib/audit";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  buildPeopleMembershipScopeWhere,
  buildPeopleStaffScopeWhere,
} from "@/lib/team/people-scope";
import { synchronizeTeamMemberEmploymentState } from "@/lib/team/people-status";

export type PeopleServiceDatabase = PrismaClient;

export type TeamMemberFeatures = {
  appointmentBookable: boolean;
  email: string | null;
  loginEnabled: boolean;
  permissions: string[];
  serviceIds: readonly string[];
  staffLevelId: string | null;
  staffRoleProfileId: string | null;
};

export type CreateTeamMemberArgs = {
  actor: AttendanceServiceActor;
  allowedBranchIds: readonly string[];
  businessId: string;
  features: TeamMemberFeatures & {
    passwordHash: string | null;
  };
  input: unknown;
  request?: AuditRequestContext;
  wholeBusinessScope?: boolean;
};

export type UpdateTeamMemberArgs = {
  actor: AttendanceServiceActor;
  allowedBranchIds: readonly string[];
  businessId: string;
  expectedUpdatedAt: string | Date;
  features: TeamMemberFeatures & {
    passwordHash?: string | null;
  };
  input: unknown;
  request?: AuditRequestContext;
  userId: string;
  wholeBusinessScope?: boolean;
};

export async function createTeamMember(
  args: CreateTeamMemberArgs,
  database: PeopleServiceDatabase = prisma,
) {
  return database.$transaction(async (transaction) => {
    const employeeInput = attendanceEmployeeCreateInputSchema.parse({
      ...(isRecord(args.input) ? args.input : {}),
      businessId: args.businessId,
    });
    const matchingMemberships =
      await transaction.employeeBusinessMembership.findMany({
        where: {
          businessId: args.businessId,
          OR: [
            { employeeCode: employeeInput.employeeCode },
            {
              phoneNumberNormalized: employeeInput.phoneNumber,
            },
          ],
        },
        include: {
          staffUser: {
            select: {
              id: true,
              role: true,
            },
          },
        },
      });

    const exactMemberships = matchingMemberships.filter(
      (membership) =>
        membership.employeeCode === employeeInput.employeeCode &&
        membership.phoneNumberNormalized === employeeInput.phoneNumber,
    );
    if (
      matchingMemberships.length > 0 &&
      (matchingMemberships.length !== 1 || exactMemberships.length !== 1)
    ) {
      throw new Error(
        "Employee code and phone resolve to different employee records. Manual review is required.",
      );
    }
    if (exactMemberships[0]?.staffUser) {
      throw new Error(
        "This employee is already linked to a team member profile.",
      );
    }

    const membership = exactMemberships[0]
      ? await updateAttendanceEmployeeInTransaction(
          {
            actor: args.actor,
            allowedBranchIds: args.allowedBranchIds,
            businessId: args.businessId,
            expectedUpdatedAt: exactMemberships[0].updatedAt,
            input: {
              ...employeeInput,
              employeeId: exactMemberships[0].id,
            },
            request: args.request,
            wholeBusinessScope: args.wholeBusinessScope,
          },
          transaction,
        )
      : await createAttendanceEmployeeInTransaction(
          {
            actor: args.actor,
            allowedBranchIds: args.allowedBranchIds,
            businessId: args.businessId,
            input: employeeInput,
            request: args.request,
            wholeBusinessScope: args.wholeBusinessScope,
          },
          transaction,
        );

    const primaryAssignment = membership.branchAssignments.find(
      (assignment) =>
        assignment.status === "ACTIVE" && assignment.isPrimary,
    );
    let staffUser = null;
    const staffConfiguration = await resolveStaffConfiguration(
      transaction,
      args.businessId,
      args.features,
    );
    const unlinkedStaff = await transaction.user.findMany({
      where: {
        businessId: args.businessId,
        employeeBusinessMembershipId: null,
        role: "STAFF",
        whatsappPhone: { not: null },
      },
      select: {
        branchId: true,
        id: true,
        whatsappPhone: true,
      },
    });
    const exactStaffMatches = unlinkedStaff.filter(
      (candidate) =>
        normalizeAttendancePhone(candidate.whatsappPhone ?? "") ===
        membership.phoneNumberNormalized,
    );
    if (exactStaffMatches.length > 1) {
      throw new Error(
        "Multiple unlinked staff profiles use this phone. Manual review is required.",
      );
    }
    if (
      exactStaffMatches[0]?.branchId &&
      !args.wholeBusinessScope &&
      !args.allowedBranchIds.includes(exactStaffMatches[0].branchId)
    ) {
      throw new Error(
        "The matching legacy staff profile is outside the authorized branch scope.",
      );
    }

    const shouldHaveStaffUser =
      args.features.appointmentBookable ||
      args.features.loginEnabled ||
      exactStaffMatches.length === 1;
    if (shouldHaveStaffUser) {
      const staffData = {
        appointmentBookable: args.features.appointmentBookable,
        branchId: primaryAssignment?.branchId ?? null,
        email: args.features.loginEnabled ? args.features.email : null,
        employeeAccountId: membership.employeeAccountId,
        employeeBusinessMembershipId: membership.id,
        loginEnabled: args.features.loginEnabled,
        name: membership.fullName,
        passwordHash: args.features.loginEnabled
          ? args.features.passwordHash
          : null,
        permissions: args.features.loginEnabled
          ? args.features.permissions
          : [],
        staffLevelId: staffConfiguration.staffLevelId,
        staffRoleProfileId: staffConfiguration.staffRoleProfileId,
        status: "active" as const,
        teamMemberLinkReason: exactStaffMatches[0]
          ? "EXACT_PHONE_REUSE"
          : "UNIFIED_CREATION",
        teamMemberLinkedAt: new Date(),
        teamMemberLinkStatus: "LINKED" as const,
        whatsappPhone: membership.phoneNumberNormalized,
      };

      staffUser = exactStaffMatches[0]
        ? await transaction.user.update({
            where: { id: exactStaffMatches[0].id },
            data: staffData,
          })
        : await transaction.user.create({
            data: {
              ...staffData,
              businessId: args.businessId,
              role: "STAFF",
            },
          });

      await replaceServiceAssignments(transaction, {
        businessId: args.businessId,
        serviceIds: staffConfiguration.serviceIds,
        userId: staffUser.id,
      });

      await writeAuditLog(
        {
          action: "TEAM_MEMBER_PROFILE_CREATED",
          actor: args.actor,
          after: {
            appointmentBookable: staffUser.appointmentBookable,
            employeeBusinessMembershipId: membership.id,
            loginEnabled: staffUser.loginEnabled,
            serviceIds: staffConfiguration.serviceIds,
            staffLevelId: staffUser.staffLevelId,
            staffRoleProfileId: staffUser.staffRoleProfileId,
            userId: staffUser.id,
            reusedExistingStaff: Boolean(exactStaffMatches[0]),
          },
          branchId: primaryAssignment?.branchId ?? null,
          businessId: args.businessId,
          entityId: membership.id,
          entityType: "EmployeeBusinessMembership",
          request: args.request,
          summary: `Created unified team member ${membership.employeeCode}.`,
        },
        transaction,
      );
    }

    return {
      membership,
      staffUser,
    };
  });
}

export async function updateTeamMember(
  args: UpdateTeamMemberArgs,
  database: PeopleServiceDatabase = prisma,
) {
  return database.$transaction(async (transaction) => {
    const existingUser = await transaction.user.findFirst({
      where: {
        businessId: args.businessId,
        id: args.userId,
        role: "STAFF",
      },
      select: {
        employeeBusinessMembershipId: true,
        id: true,
      },
    });

    if (!existingUser?.employeeBusinessMembershipId) {
      throw new Error(
        "This legacy staff profile must be linked to an employee before unified editing.",
      );
    }

    const membership = await updateAttendanceEmployeeInTransaction(
      {
        actor: args.actor,
        allowedBranchIds: args.allowedBranchIds,
        businessId: args.businessId,
        expectedUpdatedAt: args.expectedUpdatedAt,
        input: args.input,
        request: args.request,
        wholeBusinessScope: args.wholeBusinessScope,
      },
      transaction,
    );

    if (membership.id !== existingUser.employeeBusinessMembershipId) {
      throw new Error("Team member employment link changed. Reload and try again.");
    }

    const primaryAssignment = membership.branchAssignments.find(
      (assignment) =>
        assignment.status === "ACTIVE" && assignment.isPrimary,
    );
    const active = membership.status === "ACTIVE";
    const staffConfiguration = await resolveStaffConfiguration(
      transaction,
      args.businessId,
      args.features,
    );
    const updatedUser = await transaction.user.update({
      where: { id: existingUser.id },
      data: {
        appointmentBookable:
          active && args.features.appointmentBookable,
        branchId: primaryAssignment?.branchId ?? null,
        email:
          active && args.features.loginEnabled
            ? args.features.email
            : null,
        employeeAccountId: membership.employeeAccountId,
        loginEnabled: active && args.features.loginEnabled,
        name: membership.fullName,
        passwordHash:
          active && args.features.loginEnabled
            ? args.features.passwordHash === undefined
              ? undefined
              : args.features.passwordHash
            : null,
        permissions:
          active && args.features.loginEnabled
            ? args.features.permissions
            : [],
        staffLevelId: staffConfiguration.staffLevelId,
        staffRoleProfileId: staffConfiguration.staffRoleProfileId,
        status: active ? "active" : "inactive",
        whatsappPhone: membership.phoneNumberNormalized,
      },
    });

    await replaceServiceAssignments(
      transaction,
      {
        businessId: args.businessId,
        serviceIds: active ? staffConfiguration.serviceIds : [],
        userId: updatedUser.id,
      },
    );

    await writeAuditLog(
      {
        action: "TEAM_MEMBER_PROFILE_UPDATED",
        actor: args.actor,
        after: {
          appointmentBookable: updatedUser.appointmentBookable,
          loginEnabled: updatedUser.loginEnabled,
          serviceIds: active ? staffConfiguration.serviceIds : [],
          staffLevelId: updatedUser.staffLevelId,
          staffRoleProfileId: updatedUser.staffRoleProfileId,
          status: updatedUser.status,
        },
        branchId: primaryAssignment?.branchId ?? null,
        businessId: args.businessId,
        entityId: membership.id,
        entityType: "EmployeeBusinessMembership",
        request: args.request,
        summary: `Updated unified team member ${membership.employeeCode}.`,
      },
      transaction,
    );

    return {
      membership,
      staffUser: updatedUser,
    };
  });
}

export async function linkExistingStaffToEmployee(
  args: {
    actor: AttendanceServiceActor;
    allowedBranchIds: readonly string[];
    businessId: string;
    membershipId: string;
    request?: AuditRequestContext;
    userId: string;
    wholeBusinessScope?: boolean;
  },
  database: PeopleServiceDatabase = prisma,
) {
  return database.$transaction(async (transaction) => {
    const peopleScope = {
      allowedBranchIds: args.allowedBranchIds,
      businessId: args.businessId,
      now: new Date(),
      wholeBusinessScope: args.wholeBusinessScope === true,
    };
    const [staffUser, membership] = await Promise.all([
      transaction.user.findFirst({
        where: {
          ...buildPeopleStaffScopeWhere(peopleScope),
          id: args.userId,
          role: "STAFF",
        },
      }),
      transaction.employeeBusinessMembership.findFirst({
        where: {
          ...buildPeopleMembershipScopeWhere(peopleScope),
          id: args.membershipId,
        },
      }),
    ]);

    if (!staffUser || !membership) {
      throw new Error("Staff and employee must belong to the selected business.");
    }
    if (
      staffUser.employeeBusinessMembershipId &&
      staffUser.employeeBusinessMembershipId !== membership.id
    ) {
      throw new Error("Staff is already linked to another employee.");
    }

    const occupied = await transaction.user.findUnique({
      where: {
        employeeBusinessMembershipId: membership.id,
      },
      select: { id: true },
    });
    if (occupied && occupied.id !== staffUser.id) {
      throw new Error("Employee is already linked to another staff profile.");
    }

    const linked = await transaction.user.update({
      where: { id: staffUser.id },
      data: {
        employeeAccountId: membership.employeeAccountId,
        employeeBusinessMembershipId: membership.id,
        teamMemberLinkedAt: new Date(),
        teamMemberLinkReason: "MANUAL_ADMIN_LINK",
        teamMemberLinkStatus: "LINKED",
      },
    });

    await synchronizeTeamMemberEmploymentState(transaction, {
      businessId: args.businessId,
      employeeAccountId: membership.employeeAccountId,
      fullName: membership.fullName,
      membershipId: membership.id,
      phoneNumberNormalized: membership.phoneNumberNormalized,
      status: membership.status,
    });
    const synchronizedLinked = await transaction.user.findUniqueOrThrow({
      where: {
        id: linked.id,
      },
    });

    await writeAuditLog(
      {
        action: "TEAM_MEMBER_LINKED",
        actor: args.actor,
        after: {
          membershipId: membership.id,
          status: membership.status,
          userId: synchronizedLinked.id,
        },
        branchId: synchronizedLinked.branchId,
        businessId: args.businessId,
        entityId: membership.id,
        entityType: "EmployeeBusinessMembership",
        request: args.request,
        summary: `Linked staff profile to employee ${membership.employeeCode}.`,
      },
      transaction,
    );

    return synchronizedLinked;
  });
}

async function resolveStaffConfiguration(
  transaction: Prisma.TransactionClient,
  businessId: string,
  features: TeamMemberFeatures,
) {
  const serviceIds = features.appointmentBookable
    ? Array.from(new Set(features.serviceIds))
    : [];

  const [roleProfile, staffLevel, services] = await Promise.all([
    features.staffRoleProfileId
      ? transaction.staffRoleProfile.findFirst({
          where: {
            active: true,
            businessId,
            id: features.staffRoleProfileId,
          },
          select: { id: true },
        })
      : null,
    features.staffLevelId
      ? transaction.staffLevel.findFirst({
          where: {
            active: true,
            businessId,
            id: features.staffLevelId,
          },
          select: { id: true },
        })
      : null,
    serviceIds.length > 0
      ? transaction.service.findMany({
          where: {
            businessId,
            id: { in: serviceIds },
            status: "ACTIVE",
          },
          select: { id: true },
        })
      : [],
  ]);

  if (features.staffRoleProfileId && !roleProfile) {
    throw new Error(
      "Selected staff role is inactive or belongs to another business.",
    );
  }
  if (features.staffLevelId && !staffLevel) {
    throw new Error(
      "Selected staff level is inactive or belongs to another business.",
    );
  }
  if (services.length !== serviceIds.length) {
    throw new Error(
      "Select only active services from the selected business.",
    );
  }

  return {
    serviceIds,
    staffLevelId: staffLevel?.id ?? null,
    staffRoleProfileId: roleProfile?.id ?? null,
  };
}

async function replaceServiceAssignments(
  transaction: Prisma.TransactionClient,
  input: {
    businessId: string;
    serviceIds: readonly string[];
    userId: string;
  },
) {
  await transaction.serviceStaffAssignment.deleteMany({
    where: {
      businessId: input.businessId,
      userId: input.userId,
    },
  });

  if (input.serviceIds.length === 0) {
    return;
  }

  await transaction.serviceStaffAssignment.createMany({
    data: input.serviceIds.map((serviceId) => ({
      businessId: input.businessId,
      serviceId,
      userId: input.userId,
    })),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}
