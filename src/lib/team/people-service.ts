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
import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { prisma } from "@/lib/prisma";
import {
  buildPeopleMembershipScopeWhere,
  buildPeopleStaffScopeWhere,
} from "@/lib/team/people-scope";
import { synchronizeTeamMemberEmploymentState } from "@/lib/team/people-status";

export type PeopleServiceDatabase = PrismaClient;

const canonicalTransactionOptions = {
  isolationLevel: "Serializable" as const,
  maxWait: 5_000,
  timeout: 20_000,
};

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
  legacyStaffUserId?: string;
  request?: AuditRequestContext;
  wholeBusinessScope?: boolean;
  compensationAccess?: ResolvedBusinessAccess;
};

export type CreateCoreStaffArgs = {
  actor: AttendanceServiceActor;
  allowedBranchIds: readonly string[];
  branchId: string;
  businessId: string;
  features: TeamMemberFeatures & { passwordHash: string | null };
  name: string;
  request?: AuditRequestContext;
  whatsappPhone: string | null;
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
  compensationAccess?: ResolvedBusinessAccess;
};

export type UpdateLegacyStaffProfileArgs = {
  actor: AttendanceServiceActor;
  allowedBranchIds: readonly string[];
  branchId: string;
  businessId: string;
  features: TeamMemberFeatures & {
    passwordHash?: string | null;
  };
  name: string;
  request?: AuditRequestContext;
  userId: string;
  whatsappPhone: string | null;
  wholeBusinessScope?: boolean;
};

export type EnableStaffAppForLegacyUserArgs = {
  actor: AttendanceServiceActor;
  allowedBranchIds: readonly string[];
  businessId: string;
  request?: AuditRequestContext;
  userId: string;
  wholeBusinessScope?: boolean;
};

export async function createTeamMember(
  args: CreateTeamMemberArgs,
  database: PeopleServiceDatabase = prisma,
) {
  return runCanonicalPeopleTransaction(database, async (transaction) => {
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
            compensationAuthorization: args.compensationAccess
              ? {
                  access: args.compensationAccess,
                  allowedBranchIds: args.allowedBranchIds,
                }
              : undefined,
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
            compensationAuthorization: args.compensationAccess
              ? {
                  access: args.compensationAccess,
                  allowedBranchIds: args.allowedBranchIds,
                }
              : undefined,
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
    const requestedLegacyStaff = args.legacyStaffUserId
      ? unlinkedStaff.find((candidate) => candidate.id === args.legacyStaffUserId)
      : null;
    if (args.legacyStaffUserId && !requestedLegacyStaff) {
      throw new Error(
        "The selected Staff profile is unavailable or already linked.",
      );
    }
    const conflictingPhoneMatches = exactStaffMatches.filter(
      (candidate) => candidate.id !== requestedLegacyStaff?.id,
    );
    if (
      (!requestedLegacyStaff && exactStaffMatches.length > 1) ||
      (requestedLegacyStaff && conflictingPhoneMatches.length > 0)
    ) {
      throw new Error(
        "Multiple unlinked staff profiles use this phone. Manual review is required.",
      );
    }
    const reusableStaff = requestedLegacyStaff ?? exactStaffMatches[0] ?? null;
    if (
      reusableStaff?.branchId &&
      !args.wholeBusinessScope &&
      !args.allowedBranchIds.includes(reusableStaff.branchId)
    ) {
      throw new Error(
        "The matching legacy staff profile is outside the authorized branch scope.",
      );
    }

    const shouldHaveStaffUser =
      args.features.appointmentBookable ||
      args.features.loginEnabled ||
      Boolean(reusableStaff);
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
        teamMemberLinkReason: reusableStaff
          ? requestedLegacyStaff
            ? "EDIT_EMPLOYMENT_UPGRADE"
            : "EXACT_PHONE_REUSE"
          : "UNIFIED_CREATION",
        teamMemberLinkedAt: new Date(),
        teamMemberLinkStatus: "LINKED" as const,
        whatsappPhone: membership.phoneNumberNormalized,
      };

      staffUser = reusableStaff
        ? await transaction.user.update({
            where: { id: reusableStaff.id },
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
            reusedExistingStaff: Boolean(reusableStaff),
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

export async function createCoreStaff(
  args: CreateCoreStaffArgs,
  database: PeopleServiceDatabase = prisma,
) {
  return runCanonicalPeopleTransaction(database, async (transaction) => {
    const targetBranch = await transaction.branch.findFirst({
      where: {
        businessId: args.businessId,
        id: args.wholeBusinessScope
          ? args.branchId
          : { equals: args.branchId, in: Array.from(args.allowedBranchIds) },
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (!targetBranch) {
      throw new Error("Select an active branch within your authorized branch scope.");
    }
    if (args.features.email) {
      const emailOwner = await transaction.user.findUnique({
        where: { email: args.features.email },
        select: { id: true },
      });
      if (emailOwner) throw new Error("Email is already used by another user.");
    }

    const staffConfiguration = await resolveStaffConfiguration(
      transaction,
      args.businessId,
      args.features,
    );
    const staffUser = await transaction.user.create({
      data: {
        appointmentBookable: args.features.appointmentBookable,
        branchId: targetBranch.id,
        businessId: args.businessId,
        email: args.features.loginEnabled ? args.features.email : null,
        loginEnabled: args.features.loginEnabled,
        name: args.name,
        passwordHash: args.features.loginEnabled ? args.features.passwordHash : null,
        permissions: args.features.loginEnabled ? args.features.permissions : [],
        role: "STAFF",
        staffLevelId: null,
        staffRoleProfileId:
          args.features.appointmentBookable || args.features.loginEnabled
            ? staffConfiguration.staffRoleProfileId
            : null,
        status: "active",
        teamMemberLinkStatus: "UNLINKED",
        whatsappPhone: args.whatsappPhone,
      },
    });
    await replaceServiceAssignments(transaction, {
      businessId: args.businessId,
      serviceIds: args.features.appointmentBookable
        ? staffConfiguration.serviceIds
        : [],
      userId: staffUser.id,
    });
    await writeAuditLog(
      {
        action: "CORE_STAFF_CREATED",
        actor: args.actor,
        after: {
          appointmentBookable: staffUser.appointmentBookable,
          branchId: staffUser.branchId,
          loginEnabled: staffUser.loginEnabled,
          name: staffUser.name,
          permissions: staffUser.permissions,
          serviceIds: staffConfiguration.serviceIds,
        },
        branchId: staffUser.branchId,
        businessId: args.businessId,
        entityId: staffUser.id,
        entityType: "User",
        metadata: { hrProfileCreated: false },
        request: args.request,
        summary: `Created People Core staff profile ${staffUser.name}.`,
      },
      transaction,
    );
    return staffUser;
  });
}

export async function updateTeamMember(
  args: UpdateTeamMemberArgs,
  database: PeopleServiceDatabase = prisma,
) {
  return runCanonicalPeopleTransaction(database, async (transaction) => {
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
        compensationAuthorization: args.compensationAccess
          ? {
              access: args.compensationAccess,
              allowedBranchIds: args.allowedBranchIds,
            }
          : undefined,
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

export async function updateLegacyStaffProfile(
  args: UpdateLegacyStaffProfileArgs,
  database: PeopleServiceDatabase = prisma,
) {
  return database.$transaction(async (transaction) => {
    const peopleScope = {
      allowedBranchIds: args.allowedBranchIds,
      businessId: args.businessId,
      now: new Date(),
      wholeBusinessScope: args.wholeBusinessScope === true,
    };
    const existingUser = await transaction.user.findFirst({
      where: {
        ...buildPeopleStaffScopeWhere(peopleScope),
        id: args.userId,
        role: "STAFF",
      },
      select: {
        appointmentBookable: true,
        branchId: true,
        email: true,
        employeeBusinessMembershipId: true,
        id: true,
        loginEnabled: true,
        name: true,
        permissions: true,
        staffLevelId: true,
        staffRoleProfileId: true,
        status: true,
        whatsappPhone: true,
      },
    });
    if (!existingUser) {
      throw new Error("Staff user not found in the authorized branch scope.");
    }
    const targetBranch = await transaction.branch.findFirst({
      where: {
        businessId: args.businessId,
        id: args.wholeBusinessScope
          ? args.branchId
          : { equals: args.branchId, in: Array.from(args.allowedBranchIds) },
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (!targetBranch) {
      throw new Error(
        "Select an active branch within your authorized branch scope.",
      );
    }

    if (args.features.email) {
      const emailOwner = await transaction.user.findUnique({
        where: { email: args.features.email },
        select: { id: true },
      });
      if (emailOwner && emailOwner.id !== existingUser.id) {
        throw new Error("Email is already used by another user.");
      }
    }

    const staffConfiguration = await resolveStaffConfiguration(
      transaction,
      args.businessId,
      args.features,
    );
    const updatedUser = await transaction.user.update({
      where: { id: existingUser.id },
      data: {
        appointmentBookable: args.features.appointmentBookable,
        branchId: targetBranch.id,
        email: args.features.loginEnabled ? args.features.email : null,
        loginEnabled: args.features.loginEnabled,
        name: args.name,
        passwordHash: args.features.loginEnabled
          ? args.features.passwordHash === undefined
            ? undefined
            : args.features.passwordHash
          : null,
        permissions: args.features.loginEnabled
          ? args.features.permissions
          : [],
        staffLevelId: args.features.appointmentBookable
          ? staffConfiguration.staffLevelId
          : null,
        staffRoleProfileId:
          args.features.appointmentBookable || args.features.loginEnabled
            ? staffConfiguration.staffRoleProfileId
            : null,
        whatsappPhone: args.whatsappPhone,
      },
    });

    await replaceServiceAssignments(transaction, {
      businessId: args.businessId,
      serviceIds: args.features.appointmentBookable
        ? staffConfiguration.serviceIds
        : [],
      userId: updatedUser.id,
    });

    await writeAuditLog(
      {
        action: "LEGACY_STAFF_UPDATED",
        actor: args.actor,
        after: {
          appointmentBookable: updatedUser.appointmentBookable,
          branchId: updatedUser.branchId,
          email: updatedUser.email,
          loginEnabled: updatedUser.loginEnabled,
          name: updatedUser.name,
          permissions: updatedUser.permissions,
          serviceIds: staffConfiguration.serviceIds,
          staffLevelId: updatedUser.staffLevelId,
          staffRoleProfileId: updatedUser.staffRoleProfileId,
          whatsappPhone: updatedUser.whatsappPhone,
        },
        before: existingUser,
        branchId: updatedUser.branchId,
        businessId: args.businessId,
        entityId: updatedUser.id,
        entityType: "User",
        metadata: {
          passwordReset: args.features.passwordHash !== undefined,
          employmentProfilePreserved: Boolean(existingUser.employeeBusinessMembershipId),
        },
        request: args.request,
        summary: `Updated unlinked staff profile ${updatedUser.name}.`,
      },
      transaction,
    );

    return updatedUser;
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

export async function enableStaffAppForLegacyUser(
  args: EnableStaffAppForLegacyUserArgs,
  database: PeopleServiceDatabase = prisma,
) {
  return runCanonicalPeopleTransaction(database, async (transaction) => {
    const now = new Date();
    const peopleScope = {
      allowedBranchIds: args.allowedBranchIds,
      businessId: args.businessId,
      now,
      wholeBusinessScope: args.wholeBusinessScope === true,
    };
    const staffUser = await transaction.user.findFirst({
      where: {
        ...buildPeopleStaffScopeWhere(peopleScope),
        id: args.userId,
        role: "STAFF",
      },
    });

    if (!staffUser) {
      throw new Error("Team member was not found in the authorized business scope.");
    }
    if (staffUser.status !== "active") {
      throw new Error("Reactivate this team member before enabling Staff App access.");
    }
    if (staffUser.teamMemberLinkStatus === "REVIEW_REQUIRED") {
      throw new Error(
        "This team member requires manual identity review before Staff App access can be enabled.",
      );
    }

    if (
      staffUser.employeeAccountId ||
      staffUser.employeeBusinessMembershipId ||
      staffUser.teamMemberLinkStatus === "LINKED"
    ) {
      if (
        !staffUser.employeeAccountId ||
        !staffUser.employeeBusinessMembershipId ||
        staffUser.teamMemberLinkStatus !== "LINKED"
      ) {
        throw new Error(
          "This team member has an incomplete employee identity link. Manual review is required.",
        );
      }
      const linkedMembership =
        await transaction.employeeBusinessMembership.findFirst({
          where: {
            ...buildPeopleMembershipScopeWhere(peopleScope),
            employeeAccountId: staffUser.employeeAccountId,
            id: staffUser.employeeBusinessMembershipId,
            status: "ACTIVE",
          },
          include: {
            branchAssignments: {
              where: { status: "ACTIVE" },
            },
          },
        });
      if (!linkedMembership) {
        throw new Error(
          "The linked employee identity is no longer active or available in this business.",
        );
      }
      return {
        createdMembership: false,
        membership: linkedMembership,
        staffUser,
      };
    }

    const phoneNumberNormalized = normalizeAttendancePhone(
      staffUser.whatsappPhone ?? "",
    );
    if (!phoneNumberNormalized) {
      throw new Error(
        "Add a valid Malaysia mobile number before enabling Staff App access.",
      );
    }
    if (!staffUser.branchId) {
      throw new Error(
        "Assign a primary branch before enabling Staff App access.",
      );
    }

    const branch = await transaction.branch.findFirst({
      where: {
        businessId: args.businessId,
        id: staffUser.branchId,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (
      !branch ||
      (!args.wholeBusinessScope &&
        !args.allowedBranchIds.includes(staffUser.branchId))
    ) {
      throw new Error(
        "The team member's primary branch is outside the authorized active branch scope.",
      );
    }

    const existingMembership =
      await transaction.employeeBusinessMembership.findFirst({
        where: {
          businessId: args.businessId,
          phoneNumberNormalized,
        },
        include: {
          branchAssignments: {
            where: { status: "ACTIVE" },
          },
          staffUser: { select: { id: true } },
        },
      });
    if (existingMembership) {
      throw new Error(
        existingMembership.staffUser
          ? "This phone is already linked to another team member."
          : "An employment profile already uses this phone. Link it explicitly after confirming the identity.",
      );
    }

    const employeeCode = `STAFF-${staffUser.id.replaceAll("-", "").toUpperCase()}`;
    const membership = await createAttendanceEmployeeInTransaction(
      {
        actor: args.actor,
        allowedBranchIds: args.allowedBranchIds,
        businessId: args.businessId,
        input: {
          assignments: [
            {
              branchId: staffUser.branchId,
              canClockIn: false,
              effectiveFrom: now,
              effectiveUntil: null,
              isPrimary: true,
              status: "ACTIVE",
            },
          ],
          attendanceEnabled: false,
          baseSalary: null,
          businessId: args.businessId,
          employeeCode,
          employmentType: "FULL_TIME",
          fullName: staffUser.name,
          joinedAt: now,
          normalWorkMinutesPerDay: null,
          payBasis: "MONTHLY",
          phoneNumber: phoneNumberNormalized,
          position: null,
          status: "ACTIVE",
          targetBreakMinutes: null,
          terminatedAt: null,
        },
        request: args.request,
        wholeBusinessScope: args.wholeBusinessScope,
      },
      transaction,
    );

    const linkedStaffUser = await transaction.user.update({
      where: { id: staffUser.id },
      data: {
        employeeAccountId: membership.employeeAccountId,
        employeeBusinessMembershipId: membership.id,
        teamMemberLinkedAt: now,
        teamMemberLinkReason: "STAFF_APP_ENABLEMENT",
        teamMemberLinkStatus: "LINKED",
        whatsappPhone: phoneNumberNormalized,
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
    const synchronizedStaffUser = await transaction.user.findUniqueOrThrow({
      where: { id: linkedStaffUser.id },
    });

    await writeAuditLog(
      {
        action: "STAFF_APP_ACCESS_ENABLED",
        actor: args.actor,
        after: {
          attendanceEnabled: false,
          employeeAccountId: membership.employeeAccountId,
          membershipId: membership.id,
          userId: synchronizedStaffUser.id,
        },
        before: {
          employeeAccountId: null,
          membershipId: null,
          userId: staffUser.id,
        },
        branchId: staffUser.branchId,
        businessId: args.businessId,
        entityId: membership.id,
        entityType: "EmployeeBusinessMembership",
        request: args.request,
        summary: `Enabled Staff App access for ${staffUser.name}.`,
      },
      transaction,
    );

    return {
      createdMembership: true,
      membership,
      staffUser: synchronizedStaffUser,
    };
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

async function runCanonicalPeopleTransaction<T>(
  database: PeopleServiceDatabase,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await database.$transaction(operation, canonicalTransactionOptions);
    } catch (error) {
      if (!isSerializableConflict(error) || attempt === 2) {
        throw error;
      }
    }
  }

  throw new Error("Canonical People transaction retry limit exceeded.");
}

function isSerializableConflict(error: unknown) {
  return isRecord(error) && error.code === "P2034";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}
