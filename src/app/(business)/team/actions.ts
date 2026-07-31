"use server";

import type { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { z } from "zod";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import {
  assertStaffPermission,
  normalizeStaffPermissionsForIndustry,
} from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";
import {
  createTeamMember,
  linkExistingStaffToEmployee,
  updateLegacyStaffProfile,
  updateTeamMember,
} from "@/lib/team/people-service";
import {
  buildPeopleStaffScopeWhere,
  hasWholeBusinessPeopleScope,
  type PeopleScopeInput,
} from "@/lib/team/people-scope";
import { synchronizeTeamMemberEmploymentState } from "@/lib/team/people-status";

const employmentTypeSchema = z.enum([
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "DAILY",
  "HOURLY",
]);
const employmentStatusSchema = z.enum([
  "ACTIVE",
  "SUSPENDED",
  "TERMINATED",
]);
const payBasisSchema = z.enum(["MONTHLY", "DAILY", "HOURLY"]);
const optionalNonnegativeNumberSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() ? value : null),
  z.coerce.number().finite().min(0).nullable(),
);

const optionalUuidSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
  z.string().uuid().nullable(),
);
const teamMemberShape = {
  attendanceEnabled: z.boolean(),
  branchIds: z.array(z.string().uuid()).min(1, "Select at least one active branch."),
  canClockInBranchIds: z.array(z.string().uuid()),
  email: z.string().trim().email("Valid email is required.").toLowerCase().optional().or(z.literal("")),
  employeeCode: z.string().trim().min(1, "Employee code is required."),
  employmentType: employmentTypeSchema,
  payBasis: payBasisSchema,
  baseSalary: optionalNonnegativeNumberSchema,
  normalWorkMinutesPerDay: optionalNonnegativeNumberSchema,
  targetBreakMinutes: optionalNonnegativeNumberSchema,
  joinedAt: z.string().trim().min(1, "Joined date is required."),
  name: z.string().trim().min(1, "Name is required."),
  password: z.string().optional(),
  posAccess: z.boolean(),
  primaryBranchId: z.string().uuid("Select a primary branch."),
  providesServices: z.boolean(),
  serviceIds: z.array(z.string().uuid()),
  staffLevelId: optionalUuidSchema,
  staffRoleProfileId: optionalUuidSchema,
  whatsappPhone: z.string().trim().min(1, "Phone number is required."),
};

const createStaffSchema = z.object(teamMemberShape).superRefine((input, context) => {
  validateTeamMemberForm(input, context, true);
});

const updateStaffSchema = z
  .object({
    ...teamMemberShape,
    status: employmentStatusSchema,
    userId: z.string().uuid(),
  })
  .superRefine((input, context) => {
    validateTeamMemberForm(input, context, false);
  });

const updateLegacyStaffSchema = z
  .object({
    branchIds: teamMemberShape.branchIds,
    email: teamMemberShape.email,
    name: teamMemberShape.name,
    password: teamMemberShape.password,
    posAccess: teamMemberShape.posAccess,
    primaryBranchId: teamMemberShape.primaryBranchId,
    providesServices: teamMemberShape.providesServices,
    serviceIds: teamMemberShape.serviceIds,
    staffLevelId: teamMemberShape.staffLevelId,
    staffRoleProfileId: teamMemberShape.staffRoleProfileId,
    userId: z.string().uuid(),
    whatsappPhone: z.string().trim().max(32, "Phone number is too long."),
  })
  .superRefine((input, context) => {
    validateTeamMemberForm(input, context, false);
  });

const deleteStaffSchema = z.object({
  userId: z.string().uuid(),
});

const linkTeamMemberSchema = z.object({
  confirmLink: z.literal("confirmed"),
  membershipId: z.string().uuid(),
  userId: z.string().uuid(),
});

const staffScheduleSchema = z.object({
  userId: z.string().uuid(),
});

const ownerAppointmentAvailabilitySchema = z.object({
  userId: z.string().uuid(),
  appointmentBookable: z.enum(["true", "false"]).transform((value) => value === "true"),
});

const staffTimeOffSchema = z.object({
  userId: z.string().uuid(),
  startsAt: z.string().trim().min(1, "Leave start is required."),
  endsAt: z.string().trim().min(1, "Leave end is required."),
  reason: z.string().trim().optional(),
});

export async function createStaffAction(formData: FormData) {
  const { access, user, businessId, industryType } =
    await requireBusinessUser("MODIFY_ATTENDANCE_EMPLOYEES");
  if (access.source === "DIRECT_BUSINESS") {
    assertStaffPermission(user, "TEAM");
  }

  try {
    const input = parseTeamMemberForm(formData, false);
    const scope = await resolveAttendanceScope(access);
    const wholeBusinessScope = hasWholeBusinessPeopleScope(access);
    const auditRequest = await getAuditRequestContext();
    const permissions = input.posAccess
      ? normalizeStaffPermissionsForIndustry(
          formData.getAll("permissions"),
          industryType,
        )
      : [];
    const passwordHash = input.posAccess
      ? await bcrypt.hash(input.password!, 12)
      : null;

    const created = await createTeamMember({
      actor: user,
      allowedBranchIds: scope.allowedBranchIds,
      businessId,
      features: {
        appointmentBookable: input.providesServices,
        email: input.posAccess ? input.email || null : null,
        loginEnabled: input.posAccess,
        passwordHash,
        permissions,
        serviceIds: input.providesServices ? input.serviceIds : [],
        staffLevelId: input.providesServices ? input.staffLevelId : null,
        staffRoleProfileId:
          input.providesServices || input.posAccess
            ? input.staffRoleProfileId
            : null,
      },
      input: buildEmployeeInput(input, businessId, "ACTIVE"),
      request: auditRequest,
      wholeBusinessScope,
    });

    revalidatePeoplePaths(created.membership.id);
    redirectWithTeamMessage("Team member added successfully.", "success");
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    redirectWithTeamMessage(
      getErrorMessage(error, "Unable to add team member."),
      "error",
    );
  }
}

export async function updateStaffAction(formData: FormData) {
  const { access, user, businessId, industryType } =
    await requireBusinessUser("MODIFY_ATTENDANCE_EMPLOYEES");
  if (access.source === "DIRECT_BUSINESS") {
    assertStaffPermission(user, "TEAM");
  }

  try {
    const userId = z.string().uuid().parse(formData.get("userId"));
    const scope = await resolveAttendanceScope(access);
    const wholeBusinessScope = hasWholeBusinessPeopleScope(access);
    const staff = await prisma.user.findFirst({
      where: {
        ...buildPeopleStaffScopeWhere({
          allowedBranchIds: scope.allowedBranchIds,
          businessId,
          now: new Date(),
          wholeBusinessScope,
        }),
        id: userId,
        role: "STAFF",
      },
      select: {
        employeeBusinessMembership: {
          select: {
            id: true,
            terminatedAt: true,
            updatedAt: true,
          },
        },
        id: true,
        loginEnabled: true,
      },
    });

    if (!staff) {
      throw new Error("Staff user not found in the authorized branch scope.");
    }

    if (!staff.employeeBusinessMembership) {
      const input = parseLegacyStaffForm(formData);
      const password = input.password?.trim();
      if (input.posAccess && !password && !staff.loginEnabled) {
        throw new Error("Set a temporary password before enabling POS access.");
      }
      const permissions = input.posAccess
        ? normalizeStaffPermissionsForIndustry(
            formData.getAll("permissions"),
            industryType,
          )
        : [];
      const passwordHash = password
        ? await bcrypt.hash(password, 12)
        : undefined;
      const auditRequest = await getAuditRequestContext();

      await updateLegacyStaffProfile({
        actor: user,
        allowedBranchIds: scope.allowedBranchIds,
        branchId: input.primaryBranchId,
        businessId,
        features: {
          appointmentBookable: input.providesServices,
          email: input.posAccess ? input.email || null : null,
          loginEnabled: input.posAccess,
          ...(passwordHash ? { passwordHash } : {}),
          permissions,
          serviceIds: input.providesServices ? input.serviceIds : [],
          staffLevelId: input.providesServices ? input.staffLevelId : null,
          staffRoleProfileId:
            input.providesServices || input.posAccess
              ? input.staffRoleProfileId
              : null,
        },
        name: input.name,
        request: auditRequest,
        userId: input.userId,
        whatsappPhone: input.whatsappPhone || null,
        wholeBusinessScope,
      });

      revalidatePeoplePaths();
      redirectWithTeamMessage("Staff profile updated successfully.", "success");
    }

    const input = parseTeamMemberForm(formData, true);
    const password = input.password?.trim();
    if (input.posAccess && !password && !staff.loginEnabled) {
      throw new Error("Set a temporary password before enabling POS access.");
    }

    const permissions = input.posAccess
      ? normalizeStaffPermissionsForIndustry(
          formData.getAll("permissions"),
          industryType,
        )
      : [];
    const passwordHash = password
      ? await bcrypt.hash(password, 12)
      : undefined;
    const auditRequest = await getAuditRequestContext();
    const terminatedAt =
      input.status === "TERMINATED"
        ? staff.employeeBusinessMembership.terminatedAt ?? new Date()
        : null;
    const updated = await updateTeamMember({
      actor: user,
      allowedBranchIds: scope.allowedBranchIds,
      businessId,
      expectedUpdatedAt: staff.employeeBusinessMembership.updatedAt,
      features: {
        appointmentBookable:
          input.status === "ACTIVE" && input.providesServices,
        email:
          input.status === "ACTIVE" && input.posAccess
            ? input.email || null
            : null,
        loginEnabled: input.status === "ACTIVE" && input.posAccess,
        ...(passwordHash ? { passwordHash } : {}),
        permissions,
        serviceIds:
          input.status === "ACTIVE" && input.providesServices
            ? input.serviceIds
            : [],
        staffLevelId:
          input.status === "ACTIVE" && input.providesServices
            ? input.staffLevelId
            : null,
        staffRoleProfileId:
          input.status === "ACTIVE" &&
          (input.providesServices || input.posAccess)
            ? input.staffRoleProfileId
            : null,
      },
      input: {
        ...buildEmployeeInput(input, businessId, input.status, terminatedAt),
        employeeId: staff.employeeBusinessMembership.id,
      },
      request: auditRequest,
      userId: staff.id,
      wholeBusinessScope: hasWholeBusinessPeopleScope(access),
    });

    revalidatePeoplePaths(updated.membership.id);
    redirectWithTeamMessage("Team member updated successfully.", "success");
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    redirectWithTeamMessage(
      getErrorMessage(error, "Unable to update team member."),
      "error",
    );
  }
}

export async function linkTeamMemberAction(formData: FormData) {
  const { access, user, businessId } =
    await requireBusinessUser("MODIFY_ATTENDANCE_EMPLOYEES");
  if (access.source === "DIRECT_BUSINESS") {
    assertStaffPermission(user, "TEAM");
  }

  try {
    const input = linkTeamMemberSchema.parse({
      confirmLink: formData.get("confirmLink"),
      membershipId: formData.get("membershipId"),
      userId: formData.get("userId"),
    });
    const scope = await resolveAttendanceScope(access);
    const auditRequest = await getAuditRequestContext();
    await linkExistingStaffToEmployee({
      actor: user,
      allowedBranchIds: scope.allowedBranchIds,
      businessId,
      membershipId: input.membershipId,
      request: auditRequest,
      userId: input.userId,
      wholeBusinessScope: hasWholeBusinessPeopleScope(access),
    });

    revalidatePeoplePaths(input.membershipId);
    redirectWithTeamMessage(
      "Staff and employee linked successfully.",
      "success",
    );
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    redirectWithTeamMessage(
      getErrorMessage(error, "Unable to link team member."),
      "error",
    );
  }
}

export async function updateOwnerAppointmentAvailabilityAction(
  formData: FormData,
) {
  const { access, user, businessId } =
    await requireBusinessUser("MODIFY_ATTENDANCE_EMPLOYEES");
  if (access.source === "DIRECT_BUSINESS") {
    assertStaffPermission(user, "TEAM");
  }

  try {
    if (!hasWholeBusinessPeopleScope(access)) {
      throw new Error(
        "Owner appointment availability requires whole-business access.",
      );
    }
    const input = ownerAppointmentAvailabilitySchema.parse({
      userId: formData.get("userId"),
      appointmentBookable: formData.get("appointmentBookable"),
    });
    const auditRequest = await getAuditRequestContext();

    await prisma.$transaction(async (transaction) => {
      const owner = await transaction.user.findFirst({
        where: {
          id: input.userId,
          businessId,
          role: "BUSINESS_OWNER",
        },
        select: {
          id: true,
          branchId: true,
          name: true,
          appointmentBookable: true,
        },
      });
      if (!owner) {
        throw new Error("Owner account not found.");
      }

      const updated = await transaction.user.update({
        where: { id: owner.id },
        data: { appointmentBookable: input.appointmentBookable },
      });
      await writeAuditLog(
        {
          businessId,
          branchId: owner.branchId,
          actor: user,
          action: "STAFF_UPDATED",
          entityType: "User",
          entityId: owner.id,
          summary: `${
            input.appointmentBookable ? "Enabled" : "Disabled"
          } appointment availability for ${owner.name}`,
          before: { appointmentBookable: owner.appointmentBookable },
          after: { appointmentBookable: updated.appointmentBookable },
          request: auditRequest,
        },
        transaction,
      );
    });

    revalidatePath("/team");
    revalidatePath("/appointments");
    revalidatePath("/services");
    redirectWithTeamMessage(
      input.appointmentBookable
        ? "Owner is now available for appointments."
        : "Owner was removed from appointment scheduling.",
      "success",
    );
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    redirectWithTeamMessage(
      getErrorMessage(error, "Unable to update appointment availability."),
      "error",
    );
  }
}

export async function deleteStaffAction(formData: FormData) {
  const { access, user, businessId } =
    await requireBusinessUser("MODIFY_ATTENDANCE_EMPLOYEES");
  if (access.source === "DIRECT_BUSINESS") {
    assertStaffPermission(user, "TEAM");
    assertStaffPermission(user, "DELETE_STAFF");
  }

  try {
    const scope = await resolveAttendanceScope(access);
    const now = new Date();
    const input = deleteStaffSchema.parse({
      userId: formData.get("userId"),
    });
    if (input.userId === user.userId) {
      throw new Error("You cannot terminate your own account.");
    }
    const auditRequest = await getAuditRequestContext();
    const result = await prisma.$transaction(async (transaction) => {
      const staff = await transaction.user.findFirst({
        where: {
          ...buildPeopleStaffScopeWhere({
            allowedBranchIds: scope.allowedBranchIds,
            businessId,
            now,
            wholeBusinessScope: hasWholeBusinessPeopleScope(access),
          }),
          id: input.userId,
          role: "STAFF",
        },
        include: {
          employeeBusinessMembership: true,
        },
      });
      if (!staff) {
        throw new Error("Team member not found.");
      }

      if (staff.employeeBusinessMembership) {
        const membership =
          await transaction.employeeBusinessMembership.update({
            where: {
              id: staff.employeeBusinessMembership.id,
              businessId,
            },
            data: {
              attendanceEnabled: false,
              status: "TERMINATED",
              terminatedAt:
                staff.employeeBusinessMembership.terminatedAt ?? now,
            },
          });
        await synchronizeTeamMemberEmploymentState(transaction, {
          businessId,
          employeeAccountId: membership.employeeAccountId,
          fullName: membership.fullName,
          membershipId: membership.id,
          phoneNumberNormalized: membership.phoneNumberNormalized,
          status: "TERMINATED",
        });
      } else {
        await transaction.user.update({
          where: { id: staff.id },
          data: {
            appointmentBookable: false,
            loginEnabled: false,
            status: "inactive",
          },
        });
      }

      await writeAuditLog(
        {
          action: staff.employeeBusinessMembership
            ? "TEAM_MEMBER_TERMINATED"
            : "LEGACY_STAFF_DEACTIVATED",
          actor: user,
          after: {
            appointmentBookable: false,
            employmentStatus: staff.employeeBusinessMembership
              ? "TERMINATED"
              : null,
            loginEnabled: false,
            userStatus: "inactive",
          },
          before: {
            appointmentBookable: staff.appointmentBookable,
            employmentStatus:
              staff.employeeBusinessMembership?.status ?? null,
            loginEnabled: staff.loginEnabled,
            userStatus: staff.status,
          },
          branchId: staff.branchId,
          businessId,
          entityId:
            staff.employeeBusinessMembership?.id ?? staff.id,
          entityType: staff.employeeBusinessMembership
            ? "EmployeeBusinessMembership"
            : "User",
          request: auditRequest,
          summary: staff.employeeBusinessMembership
            ? `Terminated team member ${staff.name}.`
            : `Deactivated legacy staff ${staff.name}.`,
        },
        transaction,
      );

      return {
        membershipId: staff.employeeBusinessMembership?.id,
        wasEmploymentProfile: Boolean(staff.employeeBusinessMembership),
      };
    });

    revalidatePeoplePaths(result.membershipId);
    redirectWithTeamMessage(
      result.wasEmploymentProfile
        ? "Team member terminated. Historical records were retained."
        : "Legacy staff profile deactivated. Historical records were retained.",
      "success",
    );
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    redirectWithTeamMessage(
      getErrorMessage(error, "Unable to deactivate team member."),
      "error",
    );
  }
}

export async function saveStaffScheduleAction(formData: FormData) {
  const { access, user, businessId } =
    await requireBusinessUser("MODIFY_ATTENDANCE_EMPLOYEES");
  if (access.source === "DIRECT_BUSINESS") {
    assertStaffPermission(user, "TEAM");
  }

  try {
    const input = staffScheduleSchema.parse({
      userId: formData.get("userId"),
    });
    const peopleScope = await resolvePeopleMutationScope(
      access,
      businessId,
    );
    const days = Array.from({ length: 7 }, (_, dayOfWeek) => dayOfWeek);
    const auditRequest = await getAuditRequestContext();

    await prisma.$transaction(async (transaction) => {
      const staff = await findStaffForSchedule(
        transaction,
        peopleScope,
        input.userId,
      );
      for (const dayOfWeek of days) {
        const enabled = formData.get(`enabled-${dayOfWeek}`) === "on";
        const startTime = String(
          formData.get(`startTime-${dayOfWeek}`) ?? "",
        ).trim();
        const endTime = String(
          formData.get(`endTime-${dayOfWeek}`) ?? "",
        ).trim();
        const breakStart = String(
          formData.get(`breakStart-${dayOfWeek}`) ?? "",
        ).trim();
        const breakEnd = String(
          formData.get(`breakEnd-${dayOfWeek}`) ?? "",
        ).trim();

        await transaction.staffAvailability.upsert({
          where: {
            businessId_userId_dayOfWeek: {
              businessId,
              userId: input.userId,
              dayOfWeek,
            },
          },
          create: {
            businessId,
            userId: input.userId,
            dayOfWeek,
            startTime,
            endTime,
            enabled,
          },
          update: { startTime, endTime, enabled },
        });
        await transaction.staffBreak.deleteMany({
          where: { businessId, userId: input.userId, dayOfWeek },
        });
        if (breakStart && breakEnd) {
          await transaction.staffBreak.create({
            data: {
              businessId,
              userId: input.userId,
              dayOfWeek,
              startTime: breakStart,
              endTime: breakEnd,
              label: "Break",
            },
          });
        }
      }

      await writeAuditLog(
        {
          businessId,
          branchId: staff.branchId,
          actor: user,
          action: "STAFF_SCHEDULE_UPDATED",
          entityType: "User",
          entityId: input.userId,
          summary: `Updated availability for ${staff.name}`,
          request: auditRequest,
        },
        transaction,
      );
    });

    revalidatePath("/team");
    revalidatePath(`/team/${input.userId}`);
    redirectWithScheduleMessage(
      formData,
      input.userId,
      "Staff availability saved.",
      "success",
    );
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    redirectWithScheduleMessage(
      formData,
      String(formData.get("userId") ?? ""),
      getErrorMessage(error, "Unable to save staff availability."),
      "error",
    );
  }
}

export async function addStaffTimeOffAction(formData: FormData) {
  const { access, user, businessId } =
    await requireBusinessUser("MODIFY_ATTENDANCE_EMPLOYEES");
  if (access.source === "DIRECT_BUSINESS") {
    assertStaffPermission(user, "TEAM");
  }

  try {
    const input = staffTimeOffSchema.parse({
      userId: formData.get("userId"),
      startsAt: formData.get("startsAt"),
      endsAt: formData.get("endsAt"),
      reason: formData.get("reason"),
    });
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (
      Number.isNaN(startsAt.getTime()) ||
      Number.isNaN(endsAt.getTime()) ||
      endsAt <= startsAt
    ) {
      throw new Error("Leave end must be after leave start.");
    }
    const peopleScope = await resolvePeopleMutationScope(
      access,
      businessId,
    );
    const auditRequest = await getAuditRequestContext();

    await prisma.$transaction(async (transaction) => {
      const staff = await findStaffForSchedule(
        transaction,
        peopleScope,
        input.userId,
      );
      await transaction.staffTimeOff.create({
        data: {
          businessId,
          userId: input.userId,
          startsAt,
          endsAt,
          reason: input.reason || null,
        },
      });
      await writeAuditLog(
        {
          businessId,
          branchId: staff.branchId,
          actor: user,
          action: "STAFF_TIME_OFF_ADDED",
          entityType: "User",
          entityId: input.userId,
          summary: `Added time off for ${staff.name}`,
          metadata: { startsAt, endsAt, reason: input.reason || null },
          request: auditRequest,
        },
        transaction,
      );
    });

    revalidatePath("/team");
    revalidatePath(`/team/${input.userId}`);
    redirectWithScheduleMessage(
      formData,
      input.userId,
      "Staff leave added.",
      "success",
    );
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    redirectWithScheduleMessage(
      formData,
      String(formData.get("userId") ?? ""),
      getErrorMessage(error, "Unable to add staff leave."),
      "error",
    );
  }
}

export async function deleteStaffTimeOffAction(formData: FormData) {
  const { access, user, businessId } =
    await requireBusinessUser("MODIFY_ATTENDANCE_EMPLOYEES");
  if (access.source === "DIRECT_BUSINESS") {
    assertStaffPermission(user, "TEAM");
  }

  const timeOffId = String(formData.get("timeOffId") ?? "");
  const staffId = String(formData.get("userId") ?? "");
  try {
    const peopleScope = await resolvePeopleMutationScope(
      access,
      businessId,
    );
    const auditRequest = await getAuditRequestContext();
    await prisma.$transaction(async (transaction) => {
      const staff = await findStaffForSchedule(
        transaction,
        peopleScope,
        staffId,
      );
      await transaction.staffTimeOff.deleteMany({
        where: { id: timeOffId, businessId, userId: staffId },
      });
      await writeAuditLog(
        {
          businessId,
          branchId: staff.branchId,
          actor: user,
          action: "STAFF_TIME_OFF_REMOVED",
          entityType: "User",
          entityId: staffId,
          summary: `Removed time off for ${staff.name}`,
          metadata: { timeOffId },
          request: auditRequest,
        },
        transaction,
      );
    });
    revalidatePath("/team");
    revalidatePath(`/team/${staffId}`);
    redirectWithScheduleMessage(
      formData,
      staffId,
      "Staff leave removed.",
      "success",
    );
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }
    redirectWithScheduleMessage(
      formData,
      staffId,
      getErrorMessage(error, "Unable to remove staff leave."),
      "error",
    );
  }
}

async function resolvePeopleMutationScope(
  access: Awaited<ReturnType<typeof requireBusinessUser>>["access"],
  businessId: string,
): Promise<PeopleScopeInput> {
  const scope = await resolveAttendanceScope(access);
  return {
    allowedBranchIds: scope.allowedBranchIds,
    businessId,
    now: new Date(),
    wholeBusinessScope: hasWholeBusinessPeopleScope(access),
  };
}

async function findStaffForSchedule(
  transaction: Prisma.TransactionClient,
  peopleScope: PeopleScopeInput,
  userId: string,
) {
  const staff = await transaction.user.findFirst({
    where: {
      ...buildPeopleStaffScopeWhere(peopleScope),
      id: userId,
      role: "STAFF",
    },
    select: { id: true, name: true, branchId: true },
  });
  if (!staff) {
    throw new Error("Staff user not found in the authorized branch scope.");
  }
  return staff;
}

function redirectWithTeamMessage(message: string, type: "success" | "error"): never {
  redirect(`/team?type=${type}&message=${encodeURIComponent(message)}`);
}

function redirectWithStaffMessage(
  userId: string,
  message: string,
  type: "success" | "error",
): never {
  redirect(`/team/${userId}?type=${type}&message=${encodeURIComponent(message)}`);
}

function redirectWithScheduleMessage(
  formData: FormData,
  userId: string,
  message: string,
  type: "success" | "error",
): never {
  const returnTo = String(formData.get("returnTo") ?? "");
  if (returnTo === "/team?section=schedule") {
    redirect(`${returnTo}&type=${type}&message=${encodeURIComponent(message)}`);
  }
  redirectWithStaffMessage(userId, message, type);
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    return error.errors[0]?.message ?? fallback;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}

function validateTeamMemberForm(
  input: {
    branchIds: string[];
    email?: string;
    password?: string;
    posAccess: boolean;
    primaryBranchId: string;
  },
  context: z.RefinementCtx,
  creating: boolean,
) {
  if (!input.branchIds.includes(input.primaryBranchId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Primary branch must be one of the selected work branches.",
      path: ["primaryBranchId"],
    });
  }
  if (input.posAccess && !input.email) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Login email is required when POS access is enabled.",
      path: ["email"],
    });
  }
  const password = input.password?.trim() ?? "";
  if (input.posAccess && ((creating && !password) || (password && password.length < 8))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Password must be at least 8 characters.",
      path: ["password"],
    });
  }
}

function parseTeamMemberForm(formData: FormData, editing: false): z.infer<typeof createStaffSchema>;
function parseTeamMemberForm(formData: FormData, editing: true): z.infer<typeof updateStaffSchema>;
function parseTeamMemberForm(formData: FormData, editing: boolean) {
  const values = {
    attendanceEnabled: formData.get("attendanceEnabled") === "on",
    branchIds: uniqueStrings(formData.getAll("branchIds")),
    canClockInBranchIds: uniqueStrings(
      formData.getAll("canClockInBranchIds"),
    ),
    email: String(formData.get("email") ?? ""),
    employeeCode: formData.get("employeeCode"),
    employmentType: formData.get("employmentType"),
    joinedAt: formData.get("joinedAt"),
    payBasis: formData.get("payBasis"),
    baseSalary: formData.get("baseSalary"),
    normalWorkMinutesPerDay: formData.get("normalWorkMinutesPerDay"),
    targetBreakMinutes: formData.get("targetBreakMinutes"),
    name: formData.get("name"),
    password: String(formData.get("password") ?? ""),
    posAccess:
      formData.get("posAccess") === "on" ||
      formData.get("accessType") === "LOGIN",
    primaryBranchId: formData.get("primaryBranchId"),
    providesServices:
      formData.get("providesServices") === "on" ||
      formData.get("appointmentBookable") === "on",
    serviceIds: uniqueStrings(formData.getAll("serviceIds")),
    staffLevelId: formData.get("staffLevelId"),
    staffRoleProfileId: formData.get("staffRoleProfileId"),
    whatsappPhone: formData.get("whatsappPhone"),
    ...(editing
      ? {
          status: formData.get("status"),
          userId: formData.get("userId"),
        }
      : {}),
  };

  return editing
    ? updateStaffSchema.parse(values)
    : createStaffSchema.parse(values);
}

function parseLegacyStaffForm(formData: FormData) {
  return updateLegacyStaffSchema.parse({
    branchIds: uniqueStrings(formData.getAll("branchIds")),
    email: String(formData.get("email") ?? ""),
    name: formData.get("name"),
    password: String(formData.get("password") ?? ""),
    posAccess:
      formData.get("posAccess") === "on" ||
      formData.get("accessType") === "LOGIN",
    primaryBranchId: formData.get("primaryBranchId"),
    providesServices:
      formData.get("providesServices") === "on" ||
      formData.get("appointmentBookable") === "on",
    serviceIds: uniqueStrings(formData.getAll("serviceIds")),
    staffLevelId: formData.get("staffLevelId"),
    staffRoleProfileId: formData.get("staffRoleProfileId"),
    userId: formData.get("userId"),
    whatsappPhone: String(formData.get("whatsappPhone") ?? ""),
  });
}

function buildEmployeeInput(
  input: {
    attendanceEnabled: boolean;
    branchIds: string[];
    canClockInBranchIds: string[];
    employeeCode: string;
    employmentType:
      | "FULL_TIME"
      | "PART_TIME"
      | "CONTRACT"
      | "DAILY"
      | "HOURLY";
    joinedAt: string;
    name: string;
    payBasis: "MONTHLY" | "DAILY" | "HOURLY";
    baseSalary: number | null;
    normalWorkMinutesPerDay: number | null;
    targetBreakMinutes: number | null;
    primaryBranchId: string;
    whatsappPhone: string;
  },
  businessId: string,
  status: "ACTIVE" | "SUSPENDED" | "TERMINATED",
  terminatedAt: Date | null = null,
) {
  const canClockInBranchIds = new Set(input.canClockInBranchIds);
  const attendanceEnabled =
    status === "ACTIVE" && input.attendanceEnabled;

  return {
    assignments:
      status === "TERMINATED"
        ? []
        : input.branchIds.map((branchId) => ({
            branchId,
            canClockIn:
              attendanceEnabled && canClockInBranchIds.has(branchId),
            effectiveUntil: null,
            isPrimary: branchId === input.primaryBranchId,
            status: "ACTIVE" as const,
          })),
    attendanceEnabled,
    businessId,
    employeeCode: input.employeeCode,
    employmentType: input.employmentType,
    fullName: input.name,
    joinedAt: input.joinedAt,
    payBasis: input.payBasis,
    baseSalary: input.baseSalary,
    normalWorkMinutesPerDay: input.normalWorkMinutesPerDay,
    targetBreakMinutes: input.targetBreakMinutes,
    phoneNumber: input.whatsappPhone,
    position: null,
    status,
    terminatedAt,
  };
}

function uniqueStrings(values: FormDataEntryValue[]) {
  return Array.from(
    new Set(
      values
        .map(String)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function revalidatePeoplePaths(membershipId?: string) {
  revalidatePath("/team");
  revalidatePath("/team/employees");
  revalidatePath("/appointments");
  revalidatePath("/services");
  if (membershipId) {
    revalidatePath(`/team/employees/${membershipId}`);
  }
}
