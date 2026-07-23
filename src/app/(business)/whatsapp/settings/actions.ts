"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  getAuditRequestContext,
  tryWriteAuditLog,
  writeAuditLog,
} from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { assertClosingWhatsAppPhone } from "@/lib/closing-whatsapp/phone";
import { prisma } from "@/lib/prisma";
import {
  getConnectorStatus,
  logoutConnectorSession,
  reconnectConnectorSession,
} from "@/lib/whatsapp/connector-client";

const appointmentReminderSettingsSchema = z.object({
  enabled: z.boolean(),
  leadTimeMinutes: z.coerce.number().int().min(5).max(10080),
});
const closingAutomationSettingsSchema = z.object({
  enabled: z.boolean(),
  language: z.enum(["EN", "ZH"]),
  sendClosingReport: z.boolean(),
  sendUnclosedReminder: z.boolean(),
  deadlineTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Daily closing deadline must use HH:mm."),
});

const recipientRoles = ["OWNER", "BRANCH_MANAGER", "FINANCE"] as const;

export async function saveAppointmentReminderSettingsAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "WHATSAPP_SESSION");
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

  revalidatePath("/whatsapp/settings");
  redirect(
    "/whatsapp/settings?type=success&message=Automation%20settings%20saved#automation",
  );
}

export async function saveClosingWhatsAppAutomationSettingsAction(
  formData: FormData,
) {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "WHATSAPP_SESSION");
  const auditRequest = await getAuditRequestContext();
  const input = closingAutomationSettingsSchema.parse({
    deadlineTime: formData.get("deadlineTime"),
    enabled: formData.get("closingEnabled") === "on",
    language: formData.get("language"),
    sendClosingReport: formData.get("sendClosingReport") === "on",
    sendUnclosedReminder: formData.get("sendUnclosedReminder") === "on",
  });
  const branchIds = formData
    .getAll("branchId")
    .map((value) => value.toString())
    .filter(Boolean);

  const businessRecipients = parseRecipientRows(formData, "businessRecipient");

  await prisma.$transaction(async (tx) => {
    const branches = await tx.branch.findMany({
      where: { businessId, id: { in: branchIds } },
      select: { id: true },
    });
    const allowedBranchIds = new Set(branches.map((branch) => branch.id));

    const setting = await tx.closingWhatsAppSetting.upsert({
      where: { businessId },
      create: {
        businessId,
        deadlineTime: input.deadlineTime,
        enabled: input.enabled,
        sendClosingReport: input.sendClosingReport,
        sendUnclosedReminder: input.sendUnclosedReminder,
      },
      update: {
        deadlineTime: input.deadlineTime,
        enabled: input.enabled,
        sendClosingReport: input.sendClosingReport,
        sendUnclosedReminder: input.sendUnclosedReminder,
      },
    });

    await tx.business.update({
      where: { id: businessId },
      data: { language: input.language },
    });

    await tx.closingWhatsAppRecipient.deleteMany({
      where: {
        businessId,
        scope: "BUSINESS",
        scopeKey: "BUSINESS",
      },
    });

    await createRecipients(tx, {
      branchId: null,
      businessId,
      recipients: businessRecipients,
      scope: "BUSINESS",
      scopeKey: "BUSINESS",
    });

    for (const branchId of branchIds) {
      if (!allowedBranchIds.has(branchId)) {
        continue;
      }

      const useBusinessRecipients =
        formData.get(`branchUseBusinessRecipients:${branchId}`) === "on";
      const deadlineTimeOverride =
        formData.get(`branchDeadlineTime:${branchId}`)?.toString().trim() ||
        null;

      await tx.closingWhatsAppBranchSetting.upsert({
        where: {
          businessId_branchId: {
            branchId,
            businessId,
          },
        },
        create: {
          branchId,
          businessId,
          deadlineTimeOverride,
          useBusinessRecipients,
        },
        update: {
          deadlineTimeOverride,
          useBusinessRecipients,
        },
      });

      if (!useBusinessRecipients) {
        const branchRecipients = parseRecipientRows(
          formData,
          `branchRecipient:${branchId}`,
        );

        await tx.closingWhatsAppRecipient.deleteMany({
          where: {
            branchId,
            businessId,
            scope: "BRANCH",
            scopeKey: branchId,
          },
        });
        await createRecipients(tx, {
          branchId,
          businessId,
          recipients: branchRecipients,
          scope: "BRANCH",
          scopeKey: branchId,
        });
      }
    }

    await writeAuditLog(
      {
        action: "CLOSING_WHATSAPP_AUTOMATION_UPDATED",
        actor: user,
        after: {
          businessRecipients: businessRecipients.length,
          deadlineTime: setting.deadlineTime,
          enabled: setting.enabled,
          language: input.language,
          sendClosingReport: setting.sendClosingReport,
          sendUnclosedReminder: setting.sendUnclosedReminder,
        },
        branchId: user.branchId,
        businessId,
        entityId: setting.id,
        entityType: "ClosingWhatsAppSetting",
        request: auditRequest,
        summary: "Updated daily closing WhatsApp automation settings",
      },
      tx,
    );
  });

  revalidatePath("/whatsapp/settings");
  redirect(
    "/whatsapp/settings?type=success&message=Closing%20WhatsApp%20automation%20saved#closing-automation",
  );
}

export async function refreshWhatsAppConnectionAction() {
  const { businessId, user } = await requireBusinessUser();
  assertStaffPermission(user, "WHATSAPP_SESSION");

  try {
    await getConnectorStatus(businessId);
  } catch (error) {
    redirectWithConnectorError(error, "Unable to refresh WhatsApp status.");
  }

  revalidatePath("/whatsapp/settings");
  redirect("/whatsapp/settings?type=success&message=WhatsApp%20status%20refreshed");
}

export async function reconnectWhatsAppAction() {
  const { businessId, user } = await requireBusinessUser();
  assertStaffPermission(user, "WHATSAPP_SESSION");

  try {
    await reconnectConnectorSession(businessId);
    await tryWriteAuditLog({
      businessId,
      branchId: user.branchId,
      actor: user,
      action: "WHATSAPP_RECONNECT_REQUESTED",
      entityType: "WhatsAppSession",
      entityId: businessId,
      summary: "Requested a fresh WhatsApp QR session",
      request: await getAuditRequestContext(),
    });
  } catch (error) {
    redirectWithConnectorError(error, "Unable to reconnect WhatsApp.");
  }

  revalidatePath("/whatsapp/settings");
  redirect("/whatsapp/settings?type=success&message=WhatsApp%20fresh%20QR%20requested");
}

export async function logoutWhatsAppAction() {
  const { businessId, user } = await requireBusinessUser();
  assertStaffPermission(user, "WHATSAPP_SESSION");

  try {
    await logoutConnectorSession(businessId);
    await tryWriteAuditLog({
      businessId,
      branchId: user.branchId,
      actor: user,
      action: "WHATSAPP_SESSION_CLEARED",
      entityType: "WhatsAppSession",
      entityId: businessId,
      summary: "Disconnected WhatsApp and cleared the session",
      request: await getAuditRequestContext(),
    });
  } catch (error) {
    redirectWithConnectorError(error, "Unable to logout WhatsApp.");
  }

  revalidatePath("/whatsapp/settings");
  redirect("/whatsapp/settings?type=success&message=WhatsApp%20session%20cleared");
}

function redirectWithConnectorError(error: unknown, fallbackMessage: string): never {
  const message = error instanceof Error ? error.message : fallbackMessage;

  redirect(
    `/whatsapp/settings?type=error&message=${encodeURIComponent(
      message || fallbackMessage,
    )}`,
  );
}

function parseRecipientRows(formData: FormData, prefix: string) {
  const labels = formData.getAll(`${prefix}Label`);
  const phones = formData.getAll(`${prefix}Phone`);
  const roles = formData.getAll(`${prefix}Role`);
  const seenPhones = new Set<string>();
  const recipients: Array<{
    label: string;
    normalizedPhone: string;
    phone: string;
    role: (typeof recipientRoles)[number];
  }> = [];

  for (let index = 0; index < phones.length; index += 1) {
    const phone = phones[index]?.toString().trim() ?? "";
    const label = labels[index]?.toString().trim() ?? "";

    if (!phone && !label) {
      continue;
    }

    const normalizedPhone = assertClosingWhatsAppPhone(phone);

    if (seenPhones.has(normalizedPhone)) {
      continue;
    }

    seenPhones.add(normalizedPhone);
    const roleValue = roles[index]?.toString();
    const role = recipientRoles.includes(
      roleValue as (typeof recipientRoles)[number],
    )
      ? (roleValue as (typeof recipientRoles)[number])
      : "OWNER";

    recipients.push({
      label: label || phone,
      normalizedPhone,
      phone,
      role,
    });
  }

  return recipients;
}

async function createRecipients(
  tx: Prisma.TransactionClient,
  input: {
    branchId: string | null;
    businessId: string;
    recipients: ReturnType<typeof parseRecipientRows>;
    scope: "BUSINESS" | "BRANCH";
    scopeKey: string;
  },
) {
  if (!input.recipients.length) {
    return;
  }

  await tx.closingWhatsAppRecipient.createMany({
    data: input.recipients.map((recipient, index) => ({
      branchId: input.branchId,
      businessId: input.businessId,
      label: recipient.label,
      normalizedPhone: recipient.normalizedPhone,
      phone: recipient.phone,
      role: recipient.role,
      scope: input.scope,
      scopeKey: input.scopeKey,
      sortOrder: index,
    })),
  });
}
