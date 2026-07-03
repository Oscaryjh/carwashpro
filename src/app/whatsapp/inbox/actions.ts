"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { mergeDuplicateWhatsAppConversations } from "@/lib/whatsapp/conversation-merge";
import {
  enqueueWhatsAppStartSession,
  enqueueWhatsAppTextMessage,
} from "@/lib/whatsapp/worker-commands";
import { normalizeMalaysiaWhatsAppPhone } from "@/lib/whatsappDeepLink";

const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1, "Message is required."),
});

export async function recordWhatsAppReplyAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser();
  const parsed = sendMessageSchema.safeParse({
    conversationId: formData.get("conversationId"),
    body: formData.get("body"),
  });

  if (!parsed.success) {
    redirect("/whatsapp/inbox?type=error&message=Message%20is%20required");
  }

  const connection = await prisma.whatsAppConnection.findUnique({
    where: { businessId },
    select: { status: true },
  });

  if (connection?.status !== "CONNECTED") {
    redirect("/whatsapp/inbox?type=error&message=Connect%20WhatsApp%20before%20sending");
  }

  const conversation = await prisma.whatsAppConversation.findFirst({
    where: {
      id: parsed.data.conversationId,
      businessId,
    },
    select: { id: true },
  });

  if (!conversation) {
    redirect("/whatsapp/inbox?type=error&message=Conversation%20not%20found");
  }

  try {
    await enqueueWhatsAppTextMessage({
      businessId,
      conversationId: conversation.id,
      body: parsed.data.body,
      sentByUserId: user.userId,
    });
  } catch (error) {
    redirect(
      `/whatsapp/inbox?conversation=${conversation.id}&type=error&message=${encodeURIComponent(
        getErrorMessage(error) || "Unable to send WhatsApp message",
      )}`,
    );
  }

  revalidatePath("/whatsapp/inbox");
  redirect(`/whatsapp/inbox?conversation=${conversation.id}`);
}

export async function syncCrmCustomersToWhatsAppAction() {
  const { businessId } = await requireBusinessUser();
  const customers = await prisma.customer.findMany({
    where: { businessId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      phone: true,
    },
  });

  let syncedCount = 0;

  for (const customer of customers) {
    const phone = normalizeMalaysiaWhatsAppPhone(customer.phone);

    if (!phone) {
      continue;
    }

    await prisma.whatsAppConversation.upsert({
      where: {
        businessId_phone: {
          businessId,
          phone,
        },
      },
      create: {
        businessId,
        customerId: customer.id,
        phone,
        remoteJid: `${phone}@s.whatsapp.net`,
        displayName: customer.name,
        lastMessageBody: null,
        lastMessageAt: null,
        unreadCount: 0,
      },
      update: {
        customerId: customer.id,
        remoteJid: `${phone}@s.whatsapp.net`,
        displayName: customer.name,
      },
    });
    syncedCount += 1;
  }

  await mergeDuplicateWhatsAppConversations(businessId);

  revalidatePath("/whatsapp/inbox");
  redirect(
    `/whatsapp/inbox?type=success&message=${encodeURIComponent(
      `Synced ${syncedCount} CRM customers to WhatsApp inbox`,
    )}`,
  );
}

export async function refreshWhatsAppInboxConnectionAction(formData?: FormData) {
  const { businessId } = await requireBusinessUser();
  const conversationId = formData?.get("conversationId")?.toString();
  const basePath = conversationId
    ? `/whatsapp/inbox?conversation=${conversationId}`
    : "/whatsapp/inbox";

  await enqueueWhatsAppStartSession(businessId);

  revalidatePath("/whatsapp/inbox");

  redirect(
    `${basePath}${basePath.includes("?") ? "&" : "?"}type=success&message=WhatsApp%20refresh%20queued`,
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "";
  }
}
