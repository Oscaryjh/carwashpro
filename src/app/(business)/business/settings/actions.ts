"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { normalizeMalaysiaWhatsAppPhone } from "@/lib/whatsappDeepLink";

const profileSchema = z.object({
  whatsappPhone: z.string().trim().optional(),
});

const appointmentReminderSettingsSchema = z.object({
  enabled: z.boolean(),
  leadTimeMinutes: z.coerce.number().int().min(5).max(10080),
});

export async function updateOwnerProfileAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser();
  const auditRequest = await getAuditRequestContext();
  const input = profileSchema.parse({
    whatsappPhone: formData.get("whatsappPhone"),
  });
  const whatsappPhone = input.whatsappPhone
    ? normalizeMalaysiaWhatsAppPhone(input.whatsappPhone)
    : null;

  const current = await prisma.user.findFirstOrThrow({
    where: {
      id: user.userId,
      businessId,
    },
    select: { id: true, branchId: true, whatsappPhone: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: current.id },
      data: { whatsappPhone },
    });

    await writeAuditLog(
      {
        businessId,
        branchId: current.branchId,
        actor: user,
        action: "OWNER_PROFILE_UPDATED",
        entityType: "User",
        entityId: current.id,
        summary: "Updated owner profile",
        before: { whatsappPhone: current.whatsappPhone },
        after: { whatsappPhone },
        request: auditRequest,
      },
      tx,
    );
  });

  revalidatePath("/business/settings");
  redirect("/business/settings?saved=profile");
}

export async function saveAppointmentReminderSettingsAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser();
  const auditRequest = await getAuditRequestContext();
  const input = appointmentReminderSettingsSchema.parse({
    enabled: formData.get("enabled") === "on",
    leadTimeMinutes: formData.get("leadTimeMinutes"),
  });

  const current = await prisma.appointmentReminderSetting.findUnique({
    where: { businessId },
  });

  await prisma.$transaction(async (tx) => {
    const setting = await tx.appointmentReminderSetting.upsert({
      where: { businessId },
      create: {
        businessId,
        enabled: input.enabled,
        leadTimeMinutes: input.leadTimeMinutes,
      },
      update: {
        enabled: input.enabled,
        leadTimeMinutes: input.leadTimeMinutes,
      },
    });

    await writeAuditLog(
      {
        businessId,
        branchId: user.branchId,
        actor: user,
        action: "APPOINTMENT_REMINDER_SETTINGS_UPDATED",
        entityType: "AppointmentReminderSetting",
        entityId: setting.id,
        summary: "Updated appointment reminder settings",
        before: current
          ? {
              enabled: current.enabled,
              leadTimeMinutes: current.leadTimeMinutes,
            }
          : null,
        after: {
          enabled: setting.enabled,
          leadTimeMinutes: setting.leadTimeMinutes,
        },
        request: auditRequest,
      },
      tx,
    );
  });

  revalidatePath("/business/settings");
  redirect("/business/settings?saved=reminders");
}
