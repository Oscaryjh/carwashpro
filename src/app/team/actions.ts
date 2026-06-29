"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertRole } from "@/lib/auth/permissions";
import { normalizeStaffPermissions } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";
import { normalizeMalaysiaWhatsAppPhone } from "@/lib/whatsappDeepLink";

const createStaffSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  email: z.string().trim().email("Valid email is required.").toLowerCase(),
  whatsappPhone: z.string().trim().optional(),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

const updateStaffSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required."),
  email: z.string().trim().email("Valid email is required.").toLowerCase(),
  whatsappPhone: z.string().trim().optional(),
  password: z.string().optional(),
  status: z.enum(["active", "inactive"]),
});

export async function createStaffAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser();
  assertRole(user, ["BUSINESS_OWNER"]);

  try {
    const input = createStaffSchema.parse({
      name: formData.get("name"),
      email: formData.get("email"),
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

    const passwordHash = await bcrypt.hash(input.password, 12);

    await prisma.user.create({
      data: {
        businessId,
        name: input.name,
        email: input.email,
        whatsappPhone: input.whatsappPhone
          ? normalizeMalaysiaWhatsAppPhone(input.whatsappPhone)
          : null,
        passwordHash,
        role: "STAFF",
        status: "active",
        permissions,
      },
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
  assertRole(user, ["BUSINESS_OWNER"]);

  try {
    const input = updateStaffSchema.parse({
      userId: formData.get("userId"),
      name: formData.get("name"),
      email: formData.get("email"),
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
      select: { id: true },
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

    const password = input.password?.trim();

    if (password && password.length < 8) {
      redirectWithTeamMessage("Password must be at least 8 characters.", "error");
    }

    await prisma.user.update({
      where: { id: input.userId },
      data: {
        name: input.name,
        email: input.email,
        whatsappPhone: input.whatsappPhone
          ? normalizeMalaysiaWhatsAppPhone(input.whatsappPhone)
          : null,
        status: input.status,
        permissions,
        ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}),
      },
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
