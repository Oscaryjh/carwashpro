"use server";

import { revalidatePath } from "next/cache";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";

const terminalStatuses = ["READ", "FAILED"] as const;

export async function queueWhatsAppMessageAction(formData: FormData) {
  const { businessId } = await requireBusinessUser();
  const message = await getBusinessMessage(formData, businessId);

  if (!["DRAFT", "READY", "FAILED"].includes(message.status)) {
    throw new Error("Only draft, ready, or failed messages can be queued.");
  }

  await prisma.whatsAppMessage.update({
    where: { id: message.id },
    data: {
      status: "QUEUED",
      queuedAt: new Date(),
      failedAt: null,
      errorMessage: null,
    },
  });

  revalidateMessage(message.id);
}

export async function markWhatsAppMessageSentAction(formData: FormData) {
  const { businessId } = await requireBusinessUser();
  const message = await getBusinessMessage(formData, businessId);

  if (terminalStatuses.includes(message.status as (typeof terminalStatuses)[number])) {
    throw new Error("This message is already closed.");
  }

  const now = new Date();

  await prisma.whatsAppMessage.update({
    where: { id: message.id },
    data: {
      status: "SENT",
      queuedAt: message.queuedAt ?? now,
      sentAt: now,
      provider: message.provider ?? "MANUAL_DEEP_LINK",
    },
  });

  revalidateMessage(message.id);
}

export async function markWhatsAppMessageDeliveredAction(formData: FormData) {
  const { businessId } = await requireBusinessUser();
  const message = await getBusinessMessage(formData, businessId);

  if (!["SENT", "DELIVERED"].includes(message.status)) {
    throw new Error("Only sent messages can be marked delivered.");
  }

  const now = new Date();

  await prisma.whatsAppMessage.update({
    where: { id: message.id },
    data: {
      status: "DELIVERED",
      sentAt: message.sentAt ?? now,
      deliveredAt: now,
    },
  });

  revalidateMessage(message.id);
}

export async function markWhatsAppMessageReadAction(formData: FormData) {
  const { businessId } = await requireBusinessUser();
  const message = await getBusinessMessage(formData, businessId);

  if (!["SENT", "DELIVERED", "READ"].includes(message.status)) {
    throw new Error("Only sent or delivered messages can be marked read.");
  }

  const now = new Date();

  await prisma.whatsAppMessage.update({
    where: { id: message.id },
    data: {
      status: "READ",
      sentAt: message.sentAt ?? now,
      deliveredAt: message.deliveredAt ?? now,
      readAt: now,
    },
  });

  revalidateMessage(message.id);
}

export async function markWhatsAppMessageFailedAction(formData: FormData) {
  const { businessId } = await requireBusinessUser();
  const message = await getBusinessMessage(formData, businessId);
  const errorMessage =
    formData.get("errorMessage")?.toString().trim() || "Manual failure mark.";

  if (message.status === "READ") {
    throw new Error("Read messages cannot be marked failed.");
  }

  await prisma.whatsAppMessage.update({
    where: { id: message.id },
    data: {
      status: "FAILED",
      failedAt: new Date(),
      errorMessage,
    },
  });

  revalidateMessage(message.id);
}

async function getBusinessMessage(formData: FormData, businessId: string) {
  const messageId = formData.get("messageId")?.toString();

  if (!messageId) {
    throw new Error("Message id is required.");
  }

  return prisma.whatsAppMessage.findFirstOrThrow({
    where: {
      id: messageId,
      businessId,
    },
  });
}

function revalidateMessage(messageId: string) {
  revalidatePath("/whatsapp");
  revalidatePath(`/whatsapp/${messageId}`);
}
