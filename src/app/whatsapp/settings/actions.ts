"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { normalizeMalaysiaWhatsAppPhone } from "@/lib/whatsappDeepLink";
import {
  enqueueWhatsAppDisconnect,
  enqueueWhatsAppStartSession,
} from "@/lib/whatsapp/worker-commands";

export async function requestWhatsAppQrAction() {
  const { businessId } = await requireBusinessUser();
  const existingConnection = await prisma.whatsAppConnection.findUnique({
    where: { businessId },
    select: { status: true, qrCodeText: true },
  });

  if (existingConnection?.status === "CONNECTED") {
    redirect("/whatsapp/inbox?type=success&message=WhatsApp%20connected");
  }

  await prisma.whatsAppConnection.upsert({
    where: { businessId },
    create: {
      businessId,
      status: "QR_REQUIRED",
      phoneNumber: null,
      connectedAt: null,
      disconnectedAt: null,
      lastSeenAt: new Date(),
      qrCodeText: null,
      pairingPhone: null,
      pairingCodeText: null,
      pairingRequestedAt: null,
      errorMessage: null,
    },
    update: {
      status: "QR_REQUIRED",
      phoneNumber: null,
      connectedAt: null,
      disconnectedAt: null,
      lastSeenAt: new Date(),
      qrCodeText: null,
      pairingPhone: null,
      pairingCodeText: null,
      pairingRequestedAt: null,
      errorMessage: null,
    },
  });
  await enqueueWhatsAppStartSession(businessId, {
    reset: true,
  });
  revalidatePath("/whatsapp/settings");

  redirect(
    `/whatsapp/settings?type=success&message=${encodeURIComponent(
      "WhatsApp QR is being prepared. This page will refresh automatically.",
    )}`,
  );
}

export async function requestWhatsAppPairingCodeAction(formData: FormData) {
  const { businessId } = await requireBusinessUser();
  const rawPhone = String(formData.get("pairingPhone") ?? "").trim();
  let pairingPhone = "";

  try {
    pairingPhone = normalizeMalaysiaWhatsAppPhone(rawPhone);
  } catch {
    redirect(
      `/whatsapp/settings?type=error&message=${encodeURIComponent(
        "Enter a valid WhatsApp phone number, for example 601112212259.",
      )}`,
    );
  }

  if (!pairingPhone) {
    redirect(
      `/whatsapp/settings?type=error&message=${encodeURIComponent(
        "Enter a valid WhatsApp phone number, for example 601112212259.",
      )}`,
    );
  }

  const existingConnection = await prisma.whatsAppConnection.findUnique({
    where: { businessId },
    select: { status: true },
  });

  if (existingConnection?.status === "CONNECTED") {
    redirect("/whatsapp/inbox?type=success&message=WhatsApp%20connected");
  }

  await prisma.whatsAppConnection.upsert({
    where: { businessId },
    create: {
      businessId,
      status: "QR_REQUIRED",
      phoneNumber: null,
      connectedAt: null,
      disconnectedAt: null,
      lastSeenAt: new Date(),
      qrCodeText: null,
      pairingPhone,
      pairingCodeText: null,
      pairingRequestedAt: new Date(),
      errorMessage: null,
    },
    update: {
      status: "QR_REQUIRED",
      phoneNumber: null,
      connectedAt: null,
      disconnectedAt: null,
      lastSeenAt: new Date(),
      qrCodeText: null,
      pairingPhone,
      pairingCodeText: null,
      pairingRequestedAt: new Date(),
      errorMessage: null,
    },
  });

  await enqueueWhatsAppStartSession(businessId, {
    reset: true,
    pairingPhone,
  });
  revalidatePath("/whatsapp/settings");

  redirect(
    `/whatsapp/settings?type=success&message=${encodeURIComponent(
      "WhatsApp pairing code is being prepared. This page will refresh automatically.",
    )}`,
  );
}

export async function disconnectWhatsAppAction() {
  const { businessId } = await requireBusinessUser();

  await enqueueWhatsAppDisconnect(businessId);

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
      pairingPhone: null,
      pairingCodeText: null,
      pairingRequestedAt: null,
      errorMessage: null,
    },
    update: {
      status: "DISCONNECTED",
      phoneNumber: null,
      connectedAt: null,
      disconnectedAt: new Date(),
      lastSeenAt: null,
      qrCodeText: null,
      pairingPhone: null,
      pairingCodeText: null,
      pairingRequestedAt: null,
      errorMessage: null,
    },
  });

  revalidatePath("/whatsapp/settings");
  redirect("/whatsapp/settings?type=success&message=WhatsApp%20disconnected");
}

export async function refreshWhatsAppConnectionAction() {
  const { businessId } = await requireBusinessUser();

  const connection = await prisma.whatsAppConnection.findUnique({
    where: { businessId },
    select: {
      status: true,
      qrCodeText: true,
      pairingCodeText: true,
      errorMessage: true,
    },
  });

  revalidatePath("/whatsapp/settings");

  if (connection?.status === "CONNECTED") {
    redirect("/whatsapp/inbox?type=success&message=WhatsApp%20connected");
  }

  if (connection?.status === "QR_REQUIRED" && connection.pairingCodeText) {
    redirect(
      "/whatsapp/settings?type=success&message=WhatsApp%20pairing%20code%20is%20ready.%20Enter%20it%20within%2060%20seconds",
    );
  }

  if (connection?.status === "QR_REQUIRED" && connection.qrCodeText) {
    redirect(
      "/whatsapp/settings?type=success&message=WhatsApp%20QR%20is%20ready.%20Scan%20within%2060%20seconds",
    );
  }

  if (connection?.status === "ERROR") {
    redirect(
      `/whatsapp/settings?type=error&message=${encodeURIComponent(
        connection.errorMessage ?? "Unable to refresh WhatsApp connection",
      )}`,
    );
  }

  redirect("/whatsapp/settings?type=success&message=WhatsApp%20status%20refreshed");
}
