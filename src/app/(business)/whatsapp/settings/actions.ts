"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuditRequestContext, tryWriteAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import {
  getConnectorStatus,
  logoutConnectorSession,
  reconnectConnectorSession,
} from "@/lib/whatsapp/connector-client";

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
