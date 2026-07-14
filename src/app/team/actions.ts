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
  email: z.string().trim().email("Valid email is required.").toLowerCase(),
  branchId: z.string().uuid("Branch is required."),
  whatsappPhone: z.string().trim().optional(),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

const updateStaffSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required."),
  email: z.string().trim().email("Valid email is required.").toLowerCase(),
  branchId: z.string().uuid("Branch is required."),
  whatsappPhone: z.string().trim().optional(),
  password: z.string().optional(),
  status: z.enum(["active", "inactive"]),
});

const deleteStaffSchema = z.object({
  userId: z.string().uuid(),
});

export async function createStaffAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "TEAM");
  const auditRequest = await getAuditRequestContext();

  try {
    const input = createStaffSchema.parse({
      name: formData.get("name"),
      email: formData.get("email"),
      branchId: formData.get("branchId"),
      whatsappPhone: formData.get("whatsappPhone"),
      password: formData.get("password"),
    });
    const permissions = normalizeStaffPermissions(formData.getAll("permissions"));

    const existingUser = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    if (existingUser) {
      redirectWithTeamMessage("Email is already used by another user.", "error");
    }

    await assertActiveBranch(businessId, input.branchId);

    const passwordHash = await bcrypt.hash(input.password, 12);

    const whatsappPhone = input.whatsappPhone
      ? normalizeMalaysiaWhatsAppPhone(input.whatsappPhone)
      : null;

    await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          businessId,
          branchId: input.branchId,
          name: input.name,
          email: input.email,
          whatsappPhone,
          passwordHash,
          role: "STAFF",
          status: "active",
          permissions,
        },
      });

      await writeAuditLog(
        {
          businessId,
          branchId: input.branchId,
          actor: user,
          action: "STAFF_CREATED",
          entityType: "User",
          entityId: created.id,
          summary: `Created staff ${created.name}`,
          after: {
            name: created.name,
            email: created.email,
            branchId: created.branchId,
            whatsappPhone: created.whatsappPhone,
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
      email: formData.get("email"),
      branchId: formData.get("branchId"),
      whatsappPhone: formData.get("whatsappPhone"),
      password: String(formData.get("password") ?? ""),
      status: formData.get("status"),
    });
    const permissions = normalizeStaffPermissions(formData.getAll("permissions"));

    const staff = await prisma.user.findFirst({
      where: {
        id: input.userId,
        businessId,
        role: "STAFF",
      },
      select: {
        id: true,
        branchId: true,
        name: true,
        email: true,
        whatsappPhone: true,
        status: true,
        permissions: true,
      },
    });

    if (!staff) {
      redirectWithTeamMessage("Staff user not found.", "error");
    }

    const emailOwner = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    if (emailOwner && emailOwner.id !== input.userId) {
      redirectWithTeamMessage("Email is already used by another user.", "error");
    }

    await assertActiveBranch(businessId, input.branchId);

    const password = input.password?.trim();

    if (password && password.length < 8) {
      redirectWithTeamMessage("Password must be at least 8 characters.", "error");
    }

    const whatsappPhone = input.whatsappPhone
      ? normalizeMalaysiaWhatsAppPhone(input.whatsappPhone)
      : null;
    const passwordHash = password ? await bcrypt.hash(password, 12) : null;

    await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: input.userId },
        data: {
          branchId: input.branchId,
          name: input.name,
          email: input.email,
          whatsappPhone,
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
            whatsappPhone: updated.whatsappPhone,
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

function redirectWithTeamMessage(message: string, type: "success" | "error"): never {
  redirect(`/team?type=${type}&message=${encodeURIComponent(message)}`);
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

async function assertActiveBranch(businessId: string, branchId: string) {
  const branch = await prisma.branch.findFirst({
    where: {
      id: branchId,
      businessId,
      status: "ACTIVE",
    },
    select: { id: true },
  });

  if (!branch) {
    redirectWithTeamMessage("Select an active branch for this staff.", "error");
  }
}
