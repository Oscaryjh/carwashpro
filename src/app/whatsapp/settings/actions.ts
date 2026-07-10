"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";
import {
  getConnectorStatus,
  logoutConnectorSession,
  reconnectConnectorSession,
} from "@/lib/whatsapp/connector-client";

export async function refreshWhatsAppConnectionAction() {
  await requireBusinessUser();

  try {
    await getConnectorStatus();
  } catch (error) {
    redirectWithConnectorError(error, "Unable to refresh WhatsApp status.");
  }

  revalidatePath("/whatsapp/settings");
  redirect("/whatsapp/settings?type=success&message=WhatsApp%20status%20refreshed");
}

export async function reconnectWhatsAppAction() {
  await requireBusinessUser();

  try {
    await reconnectConnectorSession();
  } catch (error) {
    redirectWithConnectorError(error, "Unable to reconnect WhatsApp.");
  }

  revalidatePath("/whatsapp/settings");
  redirect("/whatsapp/settings?type=success&message=WhatsApp%20fresh%20QR%20requested");
}

export async function logoutWhatsAppAction() {
  await requireBusinessUser();

  try {
    await logoutConnectorSession();
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
