"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";

export async function requestWhatsAppQrAction() {
  const { businessId } = await requireBusinessUser();
  const { startWhatsAppSession } = await import("@/lib/whatsapp/connector");

  const result = await startWhatsAppSession(businessId);
  const connection = await prisma.whatsAppConnection.findUnique({
    where: { businessId },
    select: { status: true },
  });

  revalidatePath("/whatsapp/settings");

  if (result.status === "CONNECTED" || connection?.status === "CONNECTED") {
    redirect("/whatsapp/inbox?type=success&message=WhatsApp%20connected");
  }

  if (result.status === "ERROR") {
    redirect(
      `/whatsapp/settings?type=error&message=${encodeURIComponent(
        result.errorMessage ?? "Unable to start WhatsApp connection",
      )}`,
    );
  }

  redirect("/whatsapp/settings?type=success&message=WhatsApp%20QR%20is%20ready");
}

export async function disconnectWhatsAppAction() {
  const { businessId } = await requireBusinessUser();
  const { disconnectWhatsAppSession } = await import("@/lib/whatsapp/connector");

  await disconnectWhatsAppSession(businessId);

  await prisma.whatsAppConnection.upsert({
    where: { businessId },
    create: {
      businessId,
      status: "DISCONNECTED",
      phoneNumber: null,
      connectedAt: null,
      disconnectedAt: new Date(),
      lastSeenAt: null,
      qrCodeText: null,
      errorMessage: null,
    },
    update: {
      status: "DISCONNECTED",
      phoneNumber: null,
      connectedAt: null,
      disconnectedAt: new Date(),
      lastSeenAt: null,
      qrCodeText: null,
      errorMessage: null,
    },
  });

  revalidatePath("/whatsapp/settings");
  redirect("/whatsapp/settings?type=success&message=WhatsApp%20disconnected");
}

export async function refreshWhatsAppConnectionAction() {
  const { businessId } = await requireBusinessUser();
  const { startWhatsAppSession } = await import("@/lib/whatsapp/connector");

  const result = await startWhatsAppSession(businessId);
  const connection = await prisma.whatsAppConnection.findUnique({
    where: { businessId },
    select: { status: true },
  });

  revalidatePath("/whatsapp/settings");

  if (result.status === "CONNECTED" || connection?.status === "CONNECTED") {
    redirect("/whatsapp/inbox?type=success&message=WhatsApp%20connected");
  }

  if (result.status === "ERROR") {
    redirect(
      `/whatsapp/settings?type=error&message=${encodeURIComponent(
        result.errorMessage ?? "Unable to refresh WhatsApp connection",
      )}`,
    );
  }

  redirect("/whatsapp/settings?type=success&message=WhatsApp%20status%20refreshed");
}
