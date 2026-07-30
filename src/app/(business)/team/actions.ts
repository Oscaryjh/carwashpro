"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { normalizeAttendancePhone } from "@/lib/attendance/phone";
import { requireBusinessUser } from "@/lib/auth/business-user";
import {
  assertStaffPermission,
  normalizeStaffPermissionsForIndustry,
} from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";

const createStaffSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  email: z.string().trim().email("Valid email is required.").toLowerCase().optional().or(z.literal("")),
  branchIds: z.array(z.string().uuid()).min(1, "Select at least one active branch."),
  whatsappPhone: z.string().trim().optional(),
  password: z.string().optional(),
  accessType: z.enum(["LOGIN", "NO_LOGIN"]),
  appointmentBookable: z.boolean(),
}).superRefine((input, ctx) => {
  if (input.accessType === "LOGIN" && !input.email) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: "Login email is required." });
  }
  if (input.accessType === "LOGIN" && (!input.password || input.password.length < 8)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["password"], message: "Password must be at least 8 characters." });
  }
});

const updateStaffSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required."),
  email: z.string().trim().email("Valid email is required.").toLowerCase().optional().or(z.literal("")),
  branchIds: z.array(z.string().uuid()).min(1, "Select at least one active branch."),
  whatsappPhone: z.string().trim().optional(),
  password: z.string().optional(),
  status: z.enum(["active", "inactive"]),
  accessType: z.enum(["LOGIN", "NO_LOGIN"]),
  appointmentBookable: z.boolean(),
}).superRefine((input, ctx) => {
  if (input.accessType === "LOGIN" && !input.email) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: "Login email is required." });
  }
});

const deleteStaffSchema = z.object({
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
  const { user, businessId, industryType } = await requireBusinessUser();
  assertStaffPermission(user, "TEAM");
  const auditRequest = await getAuditRequestContext();

  try {
    const input = createStaffSchema.parse({
      name: formData.get("name"),
      email: String(formData.get("email") ?? ""),
      branchIds: formData.getAll("branchIds").map(String),
      whatsappPhone: formData.get("whatsappPhone"),
      password: String(formData.get("password") ?? ""),
      accessType: formData.get("accessType"),
      appointmentBookable: formData.get("appointmentBookable") === "on",
    });
    const permissions = normalizeStaffPermissionsForIndustry(
      formData.getAll("permissions"),
      industryType,
    );
    const loginEnabled = input.accessType === "LOGIN";

    const existingUser = input.email
      ? await prisma.user.findUnique({
          where: { email: input.email },
          select: { id: true },
        })
      : null;

    if (existingUser) {
      redirectWithTeamMessage("Email is already used by another user.", "error");
    }

    await assertActiveBranches(businessId, input.branchIds);

    const passwordHash = loginEnabled ? await bcrypt.hash(input.password!, 12) : null;

    const whatsappPhone = normalizeOptionalStaffPhone(input.whatsappPhone);

    await assertUniqueStaffPhone(businessId, whatsappPhone);
    const primaryBranchId = input.branchIds[0];

    await prisma.$transaction(async (tx) => {
      const employeeAccount = whatsappPhone
        ? await syncEmployeeRegistration(tx, {
            businessId,
            name: input.name,
            membershipStatus: "ACTIVE",
            phoneNormalized: whatsappPhone,
            branchIds: input.branchIds,
          })
        : null;
      const created = await tx.user.create({
        data: {
          businessId,
          branchId: primaryBranchId,
          name: input.name,
          email: input.email || null,
          whatsappPhone,
          employeeAccountId: employeeAccount?.id ?? null,
          passwordHash,
          loginEnabled,
          appointmentBookable: input.appointmentBookable,
          role: "STAFF",
          status: "active",
          permissions,
        },
      });

      await writeAuditLog(
        {
          businessId,
          branchId: primaryBranchId,
          actor: user,
          action: "STAFF_CREATED",
          entityType: "User",
          entityId: created.id,
          summary: `Created staff ${created.name}`,
          after: {
            name: created.name,
            email: created.email,
            branchId: created.branchId,
            branchIds: input.branchIds,
            whatsappPhone: created.whatsappPhone,
            loginEnabled: created.loginEnabled,
            appointmentBookable: created.appointmentBookable,
            status: created.status,
            permissions: created.permissions,
          },
          request: auditRequest,
        },
        tx,
      );
    });

    revalidatePath("/team");
    redirectWithTeamMessage("Staff created successfully.", "success");
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    redirectWithTeamMessage(getErrorMessage(error, "Unable to create staff."), "error");
  }
}

export async function updateStaffAction(formData: FormData) {
  const { user, businessId, industryType } = await requireBusinessUser();
  assertStaffPermission(user, "TEAM");
  const auditRequest = await getAuditRequestContext();

  try {
    const input = updateStaffSchema.parse({
      userId: formData.get("userId"),
      name: formData.get("name"),
      email: String(formData.get("email") ?? ""),
      branchIds: formData.getAll("branchIds").map(String),
      whatsappPhone: formData.get("whatsappPhone"),
      password: String(formData.get("password") ?? ""),
      status: formData.get("status"),
      accessType: formData.get("accessType"),
      appointmentBookable: formData.get("appointmentBookable") === "on",
    });
    const permissions = normalizeStaffPermissionsForIndustry(
      formData.getAll("permissions"),
      industryType,
    );
    const loginEnabled = input.accessType === "LOGIN";

    const staff = await prisma.user.findFirst({
      where: {
        id: input.userId,
        businessId,
        role: "STAFF",
      },
      select: {
        id: true,
        branchId: true,
        employeeAccountId: true,
        name: true,
        email: true,
        whatsappPhone: true,
        loginEnabled: true,
        appointmentBookable: true,
        status: true,
        permissions: true,
      },
    });

    if (!staff) {
      redirectWithTeamMessage("Staff user not found.", "error");
    }

    const emailOwner = input.email
      ? await prisma.user.findUnique({
          where: { email: input.email },
          select: { id: true },
        })
      : null;

    if (emailOwner && emailOwner.id !== input.userId) {
      redirectWithTeamMessage("Email is already used by another user.", "error");
    }

    await assertActiveBranches(businessId, input.branchIds);

    const password = input.password?.trim();

    if (loginEnabled && password && password.length < 8) {
      redirectWithTeamMessage("Password must be at least 8 characters.", "error");
    }
    if (loginEnabled && !password && !staff.loginEnabled) {
      redirectWithTeamMessage("Set a password before enabling login.", "error");
    }

    const whatsappPhone = normalizeOptionalStaffPhone(input.whatsappPhone);
    await assertUniqueStaffPhone(businessId, whatsappPhone, input.userId);
    const primaryBranchId = input.branchIds[0];
    const passwordHash = password ? await bcrypt.hash(password, 12) : null;

    await prisma.$transaction(async (tx) => {
      const employeeAccount = whatsappPhone
        ? await syncEmployeeRegistration(tx, {
            businessId,
            name: input.name,
            membershipStatus:
              input.status === "active" ? "ACTIVE" : "SUSPENDED",
            phoneNormalized: whatsappPhone,
            branchIds: input.branchIds,
          })
        : null;

      if (
        staff.employeeAccountId &&
        staff.employeeAccountId !== employeeAccount?.id
      ) {
        await transitionEmployeeMembership(tx, {
          businessId,
          employeeAccountId: staff.employeeAccountId,
          status: "SUSPENDED",
        });
      }

      const updated = await tx.user.update({
        where: { id: input.userId },
        data: {
          branchId: primaryBranchId,
          name: input.name,
          email: input.email || null,
          whatsappPhone,
          employeeAccountId: employeeAccount?.id ?? null,
          loginEnabled,
          appointmentBookable: input.appointmentBookable,
          status: input.status,
          permissions,
          ...(passwordHash ? { passwordHash } : {}),
        },
      });

      await writeAuditLog(
        {
          businessId,
          branchId: updated.branchId,
          actor: user,
          action: "STAFF_UPDATED",
          entityType: "User",
          entityId: updated.id,
          summary: `Updated staff ${updated.name}`,
          before: staff,
          after: {
            name: updated.name,
            email: updated.email,
            branchId: updated.branchId,
            branchIds: input.branchIds,
            whatsappPhone: updated.whatsappPhone,
            loginEnabled: updated.loginEnabled,
            appointmentBookable: updated.appointmentBookable,
            status: updated.status,
            permissions: updated.permissions,
          },
          metadata: { passwordReset: Boolean(passwordHash) },
          request: auditRequest,
        },
        tx,
      );
    });

    revalidatePath("/team");
    redirectWithTeamMessage("Staff updated successfully.", "success");
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    redirectWithTeamMessage(getErrorMessage(error, "Unable to update staff."), "error");
  }
}

export async function updateOwnerAppointmentAvailabilityAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "TEAM");
  const auditRequest = await getAuditRequestContext();

  try {
    const input = ownerAppointmentAvailabilitySchema.parse({
      userId: formData.get("userId"),
      appointmentBookable: formData.get("appointmentBookable"),
    });

    const owner = await prisma.user.findFirst({
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
      redirectWithTeamMessage("Owner account not found.", "error");
    }

    await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
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
          summary: `${input.appointmentBookable ? "Enabled" : "Disabled"} appointment availability for ${owner.name}`,
          before: { appointmentBookable: owner.appointmentBookable },
          after: { appointmentBookable: updated.appointmentBookable },
          request: auditRequest,
        },
        tx,
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
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "TEAM");
  assertStaffPermission(user, "DELETE_STAFF");
  const auditRequest = await getAuditRequestContext();

  try {
    const input = deleteStaffSchema.parse({
      userId: formData.get("userId"),
    });

    if (input.userId === user.userId) {
      redirectWithTeamMessage("You cannot delete your own account.", "error");
    }

    const staff = await prisma.user.findFirst({
      where: {
        id: input.userId,
        businessId,
        role: "STAFF",
      },
      include: {
        _count: {
          select: {
            cashierPayments: true,
            cashierShifts: true,
            sentWhatsAppChatMessages: true,
            sentWhatsAppMessages: true,
          },
        },
      },
    });

    if (!staff) {
      redirectWithTeamMessage("Staff user not found.", "error");
    }

    const hasHistory =
      staff._count.cashierPayments > 0 ||
      staff._count.cashierShifts > 0 ||
      staff._count.sentWhatsAppChatMessages > 0 ||
      staff._count.sentWhatsAppMessages > 0;

    if (hasHistory) {
      redirectWithTeamMessage(
        "Cannot delete this staff because it has shift, payment, or message history. Set it to inactive instead.",
        "error",
      );
    }

    await prisma.$transaction(async (tx) => {
      await writeAuditLog(
        {
          businessId,
          branchId: staff.branchId,
          actor: user,
          action: "STAFF_DELETED",
          entityType: "User",
          entityId: staff.id,
          summary: `Deleted staff ${staff.name}`,
          before: {
            name: staff.name,
            email: staff.email,
            branchId: staff.branchId,
            whatsappPhone: staff.whatsappPhone,
            status: staff.status,
            permissions: staff.permissions,
          },
          request: auditRequest,
        },
        tx,
      );

      if (staff.employeeAccountId) {
        await transitionEmployeeMembership(tx, {
          businessId,
          employeeAccountId: staff.employeeAccountId,
          status: "TERMINATED",
        });
      }

      await tx.user.delete({
        where: { id: staff.id },
      });
    });

    revalidatePath("/team");
    redirectWithTeamMessage("Staff deleted successfully.", "success");
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    redirectWithTeamMessage(getErrorMessage(error, "Unable to delete staff."), "error");
  }
}

export async function saveStaffScheduleAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "TEAM");

  try {
    const input = staffScheduleSchema.parse({
      userId: formData.get("userId"),
    });
    const staff = await findStaffForSchedule(businessId, input.userId);
    const days = Array.from({ length: 7 }, (_, dayOfWeek) => dayOfWeek);

    await prisma.$transaction(async (tx) => {
      for (const dayOfWeek of days) {
        const enabled = formData.get(`enabled-${dayOfWeek}`) === "on";
        const startTime = String(formData.get(`startTime-${dayOfWeek}`) ?? "").trim();
        const endTime = String(formData.get(`endTime-${dayOfWeek}`) ?? "").trim();
        const breakStart = String(formData.get(`breakStart-${dayOfWeek}`) ?? "").trim();
        const breakEnd = String(formData.get(`breakEnd-${dayOfWeek}`) ?? "").trim();

        await tx.staffAvailability.upsert({
          where: {
            businessId_userId_dayOfWeek: {
              businessId,
              userId: input.userId,
              dayOfWeek,
            },
          },
          create: { businessId, userId: input.userId, dayOfWeek, startTime, endTime, enabled },
          update: { startTime, endTime, enabled },
        });

        await tx.staffBreak.deleteMany({
          where: { businessId, userId: input.userId, dayOfWeek },
        });

        if (breakStart && breakEnd) {
          await tx.staffBreak.create({
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
          request: await getAuditRequestContext(),
        },
        tx,
      );
    });

    revalidatePath("/team");
    revalidatePath(`/team/${input.userId}`);
    redirectWithScheduleMessage(formData, input.userId, "Staff availability saved.", "success");
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
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "TEAM");

  try {
    const input = staffTimeOffSchema.parse({
      userId: formData.get("userId"),
      startsAt: formData.get("startsAt"),
      endsAt: formData.get("endsAt"),
      reason: formData.get("reason"),
    });
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);

    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      throw new Error("Leave end must be after leave start.");
    }

    const staff = await findStaffForSchedule(businessId, input.userId);
    await prisma.staffTimeOff.create({
      data: {
        businessId,
        userId: input.userId,
        startsAt,
        endsAt,
        reason: input.reason || null,
      },
    });

    await writeAuditLog({
      businessId,
      branchId: staff.branchId,
      actor: user,
      action: "STAFF_TIME_OFF_ADDED",
      entityType: "User",
      entityId: input.userId,
      summary: `Added time off for ${staff.name}`,
      metadata: { startsAt, endsAt, reason: input.reason || null },
      request: await getAuditRequestContext(),
    });

    revalidatePath("/team");
    revalidatePath(`/team/${input.userId}`);
    redirectWithScheduleMessage(formData, input.userId, "Staff leave added.", "success");
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
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "TEAM");

  const timeOffId = String(formData.get("timeOffId") ?? "");
  const staffId = String(formData.get("userId") ?? "");
  try {
    const staff = await findStaffForSchedule(businessId, staffId);
    await prisma.staffTimeOff.deleteMany({
      where: { id: timeOffId, businessId, userId: staffId },
    });
    await writeAuditLog({
      businessId,
      branchId: staff.branchId,
      actor: user,
      action: "STAFF_TIME_OFF_REMOVED",
      entityType: "User",
      entityId: staffId,
      summary: `Removed time off for ${staff.name}`,
      metadata: { timeOffId },
      request: await getAuditRequestContext(),
    });
    revalidatePath("/team");
    revalidatePath(`/team/${staffId}`);
    redirectWithScheduleMessage(formData, staffId, "Staff leave removed.", "success");
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

async function findStaffForSchedule(businessId: string, userId: string) {
  const staff = await prisma.user.findFirst({
    where: { id: userId, businessId, role: "STAFF" },
    select: { id: true, name: true, branchId: true },
  });
  if (!staff) {
    throw new Error("Staff user not found.");
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

async function assertActiveBranches(businessId: string, branchIds: string[]) {
  const activeBranches = await prisma.branch.findMany({
    where: {
      id: { in: branchIds },
      businessId,
      status: "ACTIVE",
    },
    select: { id: true },
  });

  if (activeBranches.length !== new Set(branchIds).size) {
    redirectWithTeamMessage("Select only active branches for this staff.", "error");
  }
}

async function assertUniqueStaffPhone(
  businessId: string,
  phoneNormalized: string | null,
  excludedUserId?: string,
) {
  if (!phoneNormalized) {
    return;
  }

  const staffUsers = await prisma.user.findMany({
    where: {
      businessId,
      role: "STAFF",
      whatsappPhone: { not: null },
      ...(excludedUserId ? { id: { not: excludedUserId } } : {}),
    },
    select: { whatsappPhone: true },
  });

  if (staffUsers.some((staff) => normalizeAttendancePhone(staff.whatsappPhone ?? "") === phoneNormalized)) {
    redirectWithTeamMessage("This phone number is already registered for another staff member.", "error");
  }
}

async function syncEmployeeRegistration(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  input: {
    businessId: string;
    branchIds: string[];
    membershipStatus: "ACTIVE" | "SUSPENDED";
    name: string;
    phoneNormalized: string;
  },
) {
  const now = new Date();
  const employeeAccount = await tx.employeeAccount.upsert({
    where: { phoneNormalized: input.phoneNormalized },
    create: {
      phoneNumber: input.phoneNormalized,
      phoneNormalized: input.phoneNormalized,
      name: input.name,
      status: "ACTIVE",
    },
    update: {
      phoneNumber: input.phoneNormalized,
      status: "ACTIVE",
    },
  });

  const membership = await tx.employeeBusinessMembership.upsert({
    where: {
      employeeAccountId_businessId: {
        employeeAccountId: employeeAccount.id,
        businessId: input.businessId,
      },
    },
    create: {
      attendanceEnabled: false,
      employeeAccountId: employeeAccount.id,
      businessId: input.businessId,
      employeeCode: buildStaffEmployeeCode(employeeAccount.id),
      employmentType: "FULL_TIME",
      fullName: input.name,
      joinedAt: now,
      phoneNumber: input.phoneNormalized,
      phoneNumberNormalized: input.phoneNormalized,
      status: input.membershipStatus,
      terminatedAt: null,
    },
    update: {
      fullName: input.name,
      phoneNumber: input.phoneNormalized,
      phoneNumberNormalized: input.phoneNormalized,
      status: input.membershipStatus,
      terminatedAt: null,
      ...(input.membershipStatus === "SUSPENDED"
        ? { attendanceEnabled: false }
        : {}),
    },
  });

  const existingAssignments = await tx.employeeBranchAssignment.findMany({
    where: {
      businessId: input.businessId,
      membershipId: membership.id,
    },
    select: {
      id: true,
      branchId: true,
      status: true,
    },
  });
  const activeByBranchId = new Map(
    existingAssignments.filter((assignment) => assignment.status === "ACTIVE").map((assignment) => [
      assignment.branchId,
      assignment,
    ]),
  );

  await tx.employeeBranchAssignment.updateMany({
    where: { membershipId: membership.id, status: "ACTIVE" },
    data: { isPrimary: false },
  });

  await tx.employeeBranchAssignment.updateMany({
    where: {
      membershipId: membership.id,
      branchId: { notIn: input.branchIds },
      status: "ACTIVE",
    },
    data: {
      canClockIn: false,
      effectiveUntil: now,
      isPrimary: false,
      status: "INACTIVE",
    },
  });

  for (const [index, branchId] of input.branchIds.entries()) {
    const existing = activeByBranchId.get(branchId);

    if (existing) {
      await tx.employeeBranchAssignment.update({
        where: { id: existing.id },
        data: {
          canClockIn: input.membershipStatus === "ACTIVE",
          effectiveUntil: null,
          isPrimary: index === 0,
        },
      });
    } else {
      await tx.employeeBranchAssignment.create({
        data: {
          branchId,
          businessId: input.businessId,
          canClockIn: input.membershipStatus === "ACTIVE",
          effectiveFrom: now,
          isPrimary: index === 0,
          membershipId: membership.id,
          status: "ACTIVE",
        },
      });
    }
  }

  return employeeAccount;
}

async function transitionEmployeeMembership(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  input: {
    businessId: string;
    employeeAccountId: string;
    status: "SUSPENDED" | "TERMINATED";
  },
) {
  const membership = await tx.employeeBusinessMembership.findUnique({
    where: {
      employeeAccountId_businessId: {
        businessId: input.businessId,
        employeeAccountId: input.employeeAccountId,
      },
    },
    select: { id: true },
  });

  if (!membership) {
    return;
  }

  const now = new Date();
  await tx.employeeBusinessMembership.update({
    where: { id: membership.id },
    data: {
      attendanceEnabled: false,
      status: input.status,
      terminatedAt: input.status === "TERMINATED" ? now : null,
    },
  });

  await tx.employeeBranchAssignment.updateMany({
    where: { membershipId: membership.id, status: "ACTIVE" },
    data:
      input.status === "TERMINATED"
        ? {
            canClockIn: false,
            effectiveUntil: now,
            isPrimary: false,
            status: "INACTIVE",
          }
        : { canClockIn: false },
  });
}

function normalizeOptionalStaffPhone(value?: string) {
  if (!value) {
    return null;
  }

  const normalized = normalizeAttendancePhone(value);
  if (!normalized) {
    throw new Error("Enter a valid employee phone number.");
  }

  return normalized;
}

function buildStaffEmployeeCode(employeeAccountId: string) {
  return `STAFF-${employeeAccountId.replace(/-/g, "").toUpperCase()}`;
}
