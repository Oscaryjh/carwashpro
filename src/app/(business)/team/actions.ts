"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import {
  assertStaffPermission,
  normalizeStaffPermissions,
} from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";
import { normalizeMalaysiaWhatsAppPhone } from "@/lib/whatsappDeepLink";

const createStaffSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  email: z.string().trim().email("Valid email is required.").toLowerCase().optional().or(z.literal("")),
  branchIds: z.array(z.string().uuid()).min(1, "Select at least one active branch."),
  whatsappPhone: z.string().trim().optional(),
  password: z.string().optional(),
  accessType: z.enum(["LOGIN", "NO_LOGIN"]),
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

const staffTimeOffSchema = z.object({
  userId: z.string().uuid(),
  startsAt: z.string().trim().min(1, "Leave start is required."),
  endsAt: z.string().trim().min(1, "Leave end is required."),
  reason: z.string().trim().optional(),
});

export async function createStaffAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser();
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
    });
    const permissions = normalizeStaffPermissions(formData.getAll("permissions"));
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

    const whatsappPhone = input.whatsappPhone
      ? normalizeMalaysiaWhatsAppPhone(input.whatsappPhone)
      : null;

    await assertUniqueStaffPhone(businessId, whatsappPhone);
    const primaryBranchId = input.branchIds[0];

    await prisma.$transaction(async (tx) => {
      const employeeAccount = whatsappPhone
        ? await syncEmployeeRegistration(tx, {
            businessId,
            name: input.name,
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
  const { user, businessId } = await requireBusinessUser();
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
    });
    const permissions = normalizeStaffPermissions(formData.getAll("permissions"));
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

    const whatsappPhone = input.whatsappPhone
      ? normalizeMalaysiaWhatsAppPhone(input.whatsappPhone)
      : null;
    await assertUniqueStaffPhone(businessId, whatsappPhone, input.userId);
    const primaryBranchId = input.branchIds[0];
    const passwordHash = password ? await bcrypt.hash(password, 12) : null;

    await prisma.$transaction(async (tx) => {
      const employeeAccount = whatsappPhone
        ? await syncEmployeeRegistration(tx, {
            businessId,
            name: input.name,
            phoneNormalized: whatsappPhone,
            branchIds: input.branchIds,
          })
        : null;

      if (!whatsappPhone && staff.employeeAccountId) {
        await tx.employeeBusinessMembership.updateMany({
          where: { businessId, employeeAccountId: staff.employeeAccountId },
          data: { status: "INACTIVE" },
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

    revalidatePath(`/team/${input.userId}`);
    redirectWithStaffMessage(input.userId, "Staff availability saved.", "success");
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    redirectWithStaffMessage(
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

    revalidatePath(`/team/${input.userId}`);
    redirectWithStaffMessage(input.userId, "Staff leave added.", "success");
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    redirectWithStaffMessage(
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
    revalidatePath(`/team/${staffId}`);
    redirectWithStaffMessage(staffId, "Staff leave removed.", "success");
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }
    redirectWithStaffMessage(staffId, getErrorMessage(error, "Unable to remove staff leave."), "error");
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

  if (staffUsers.some((staff) => normalizeMalaysiaWhatsAppPhone(staff.whatsappPhone ?? "") === phoneNormalized)) {
    redirectWithTeamMessage("This phone number is already registered for another staff member.", "error");
  }
}

async function syncEmployeeRegistration(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  input: {
    businessId: string;
    name: string;
    phoneNormalized: string;
    branchIds: string[];
  },
) {
  const employeeAccount = await tx.employeeAccount.upsert({
    where: { phoneNormalized: input.phoneNormalized },
    create: {
      phoneNormalized: input.phoneNormalized,
      name: input.name,
      status: "ACTIVE",
    },
    update: {
      name: input.name,
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
      employeeAccountId: employeeAccount.id,
      businessId: input.businessId,
      status: "ACTIVE",
    },
    update: { status: "ACTIVE" },
  });

  await tx.employeeBranchAssignment.deleteMany({
    where: { membershipId: membership.id, businessId: input.businessId },
  });
  await tx.employeeBranchAssignment.createMany({
    data: input.branchIds.map((branchId) => ({
      membershipId: membership.id,
      businessId: input.businessId,
      branchId,
    })),
  });

  return employeeAccount;
}
