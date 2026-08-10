"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";
import { getConnectorStatus } from "@/lib/whatsapp/connector-client";
import { mergeDuplicateWhatsAppConversations } from "@/lib/whatsapp/conversation-merge";
import { enqueueInboxReply } from "@/lib/whatsapp/inbox-reply";
import {
  getDefaultWhatsAppInstanceId,
  normalizeWhatsAppInstanceId,
} from "@/lib/whatsapp/instance";
import { normalizeMalaysiaWhatsAppPhone } from "@/lib/whatsappDeepLink";

const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1, "Message is required."),
});

const openCustomerChatSchema = z.object({
  customerId: z.string().uuid(),
});

const linkConversationToCustomerSchema = z.object({
  conversationId: z.string().uuid(),
  customerId: z.string().uuid(),
});

const unlinkConversationCustomerSchema = z.object({
  conversationId: z.string().uuid(),
});

export async function recordWhatsAppReplyAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUserForModule("WHATSAPP");
  assertStaffPermission(user, "WHATSAPP");
  const parsed = sendMessageSchema.safeParse({
    conversationId: formData.get("conversationId"),
    body: formData.get("body"),
  });

  if (!parsed.success) {
    redirect("/whatsapp/inbox?type=error&message=Message%20is%20required");
  }

  const connectorStatus = await readConnectorStatus(businessId);

  if (connectorStatus !== "connected") {
    redirect(
      `/whatsapp/inbox?type=error&message=${encodeURIComponent(
        getConnectionRequiredMessage(connectorStatus),
      )}`,
    );
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
    await enqueueInboxReply({
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

export async function openCrmCustomerWhatsAppAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUserForModule("WHATSAPP");
  assertStaffPermission(user, "WHATSAPP");
  const parsed = openCustomerChatSchema.safeParse({
    customerId: formData.get("customerId"),
  });

  if (!parsed.success) {
    redirect("/whatsapp/inbox?type=error&message=Customer%20not%20found");
  }

  const customer = await prisma.customer.findFirst({
    where: {
      id: parsed.data.customerId,
      businessId,
    },
    select: {
      id: true,
      name: true,
      phone: true,
    },
  });

  if (!customer) {
    redirect("/whatsapp/inbox?type=error&message=Customer%20not%20found");
  }

  const phone = normalizeMalaysiaWhatsAppPhone(customer.phone);

  if (!phone) {
    redirect(
      `/whatsapp/inbox?type=error&message=${encodeURIComponent(
        "Customer has no valid WhatsApp phone number.",
      )}`,
    );
  }
  const instanceId = await getCurrentWhatsAppInstanceId(businessId);

  const existingConversations = await prisma.whatsAppConversation.findMany({
    where: {
      businessId,
      instanceId,
      OR: [{ customerId: customer.id }, { phone }],
    },
    orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
    take: 10,
  });
  const existingConversation = pickBestConversationForCustomer(
    existingConversations,
    customer.id,
  );

  if (existingConversation) {
    await prisma.whatsAppConversation.update({
      where: { id: existingConversation.id },
      data: {
        customerId: customer.id,
        displayName: customer.name,
        ...(isPhoneConversation(existingConversation.remoteJid, existingConversation.phone)
          ? {
              phone,
              remoteJid: `${phone}@s.whatsapp.net`,
            }
          : {}),
      },
    });

    revalidatePath("/whatsapp/inbox");
    redirect(`/whatsapp/inbox?conversation=${existingConversation.id}`);
  }

  const conversation = await prisma.whatsAppConversation.create({
    data: {
      businessId,
      instanceId,
      customerId: customer.id,
      phone,
      remoteJid: `${phone}@s.whatsapp.net`,
      displayName: customer.name,
      lastMessageBody: null,
      lastMessageAt: null,
      unreadCount: 0,
    },
  });

  revalidatePath("/whatsapp/inbox");
  redirect(`/whatsapp/inbox?conversation=${conversation.id}`);
}

export async function linkWhatsAppConversationToCustomerAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUserForModule("WHATSAPP");
  assertStaffPermission(user, "WHATSAPP");
  const parsed = linkConversationToCustomerSchema.safeParse({
    conversationId: formData.get("conversationId"),
    customerId: formData.get("customerId"),
  });

  if (!parsed.success) {
    redirect("/whatsapp/inbox?type=error&message=Customer%20or%20chat%20not%20found");
  }

  const [conversation, customer] = await Promise.all([
    prisma.whatsAppConversation.findFirst({
      where: {
        id: parsed.data.conversationId,
        businessId,
      },
    }),
    prisma.customer.findFirst({
      where: {
        id: parsed.data.customerId,
        businessId,
      },
      select: {
        id: true,
        name: true,
        phone: true,
      },
    }),
  ]);

  if (!conversation || !customer) {
    redirect("/whatsapp/inbox?type=error&message=Customer%20or%20chat%20not%20found");
  }

  const phone = normalizeMalaysiaWhatsAppPhone(customer.phone);

  if (!phone) {
    redirect(
      `/whatsapp/inbox?conversation=${conversation.id}&type=error&message=${encodeURIComponent(
        "Customer has no valid WhatsApp phone number.",
      )}`,
    );
  }

  await prisma.whatsAppConversation.update({
    where: { id: conversation.id },
    data: {
      customerId: customer.id,
      displayName: customer.name,
      ...(isPhoneConversation(conversation.remoteJid, conversation.phone)
        ? {
            phone,
            remoteJid: `${phone}@s.whatsapp.net`,
          }
        : {}),
    },
  });

  await prisma.whatsAppChatMessage.updateMany({
    where: {
      businessId,
      conversationId: conversation.id,
      customerId: null,
    },
    data: {
      customerId: customer.id,
    },
  });

  revalidatePath("/whatsapp/inbox");
  redirect(
    `/whatsapp/inbox?conversation=${conversation.id}&type=success&message=${encodeURIComponent(
      "WhatsApp chat linked to CRM customer.",
    )}`,
  );
}

export async function unlinkWhatsAppConversationCustomerAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUserForModule("WHATSAPP");
  assertStaffPermission(user, "WHATSAPP");
  const parsed = unlinkConversationCustomerSchema.safeParse({
    conversationId: formData.get("conversationId"),
  });

  if (!parsed.success) {
    redirect("/whatsapp/inbox?type=error&message=WhatsApp%20chat%20not%20found");
  }

  const conversation = await prisma.whatsAppConversation.findFirst({
    where: {
      id: parsed.data.conversationId,
      businessId,
    },
    select: {
      id: true,
      phone: true,
    },
  });

  if (!conversation) {
    redirect("/whatsapp/inbox?type=error&message=WhatsApp%20chat%20not%20found");
  }

  await prisma.$transaction([
    prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: {
        customerId: null,
        displayName: conversation.phone,
      },
    }),
    prisma.whatsAppChatMessage.updateMany({
      where: {
        businessId,
        conversationId: conversation.id,
      },
      data: {
        customerId: null,
      },
    }),
  ]);

  revalidatePath("/whatsapp/inbox");
  redirect(
    `/whatsapp/inbox?conversation=${conversation.id}&type=success&message=${encodeURIComponent(
      "WhatsApp chat unlinked from CRM customer.",
    )}`,
  );
}

export async function syncCrmCustomersToWhatsAppAction(formData?: FormData) {
  const { businessId, user } = await requireBusinessUserForModule("WHATSAPP");
  assertStaffPermission(user, "WHATSAPP_SESSION");
  const returnTo = formData?.get("returnTo")?.toString();
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
  const instanceId = await getCurrentWhatsAppInstanceId(businessId);

  for (const customer of customers) {
    const phone = normalizeMalaysiaWhatsAppPhone(customer.phone);

    if (!phone) {
      continue;
    }

    await prisma.whatsAppConversation.upsert({
      where: {
        businessId_instanceId_phone: {
          businessId,
          instanceId,
          phone,
        },
      },
      create: {
        businessId,
        instanceId,
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
  if (returnTo === "/whatsapp/settings") {
    revalidatePath("/whatsapp/settings");
  }

  redirect(
    `${returnTo === "/whatsapp/settings" ? "/whatsapp/settings" : "/whatsapp/inbox"}?type=success&message=${encodeURIComponent(
      `Synced ${syncedCount} CRM customers to WhatsApp inbox`,
    )}`,
  );
}

export async function refreshWhatsAppInboxConnectionAction(formData?: FormData) {
  const { businessId, user } = await requireBusinessUserForModule("WHATSAPP");
  assertStaffPermission(user, "WHATSAPP");
  const conversationId = formData?.get("conversationId")?.toString();
  const basePath = conversationId
    ? `/whatsapp/inbox?conversation=${conversationId}`
    : "/whatsapp/inbox";

  await readConnectorStatus(businessId);

  revalidatePath("/whatsapp/inbox");

  redirect(
    `${basePath}${basePath.includes("?") ? "&" : "?"}type=success&message=WhatsApp%20status%20refreshed`,
  );
}

async function readConnectorStatus(businessId: string) {
  try {
    return (await getConnectorStatus(businessId)).status;
  } catch {
    return "disconnected";
  }
}

async function getCurrentWhatsAppInstanceId(businessId: string) {
  try {
    const status = await getConnectorStatus(businessId);
    return normalizeWhatsAppInstanceId(
      status.phoneNumber ?? getDefaultWhatsAppInstanceId(),
    );
  } catch {
    return getDefaultWhatsAppInstanceId();
  }
}

function getConnectionRequiredMessage(status: Awaited<ReturnType<typeof readConnectorStatus>>) {
  if (status === "qr") {
    return "Scan QR before sending WhatsApp messages.";
  }

  return "WhatsApp is disconnected.";
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

function isPhoneConversation(remoteJid: string | null, phone: string) {
  return !remoteJid?.endsWith("@lid") && !phone.includes("@lid");
}

function pickBestConversationForCustomer<
  T extends {
    customerId: string | null;
    remoteJid: string | null;
    phone: string;
    lastMessageAt: Date | null;
    updatedAt: Date;
  },
>(conversations: T[], customerId: string) {
  return [...conversations].sort(
    (a, b) => scoreCustomerConversation(b, customerId) - scoreCustomerConversation(a, customerId),
  )[0];
}

function scoreCustomerConversation(
  conversation: {
    customerId: string | null;
    remoteJid: string | null;
    phone: string;
    lastMessageAt: Date | null;
    updatedAt: Date;
  },
  customerId: string,
) {
  const activity = conversation.lastMessageAt ?? conversation.updatedAt;

  return (
    (conversation.customerId === customerId ? 1000 : 0) +
    (conversation.remoteJid?.endsWith("@lid") ? 800 : 0) +
    (isPhoneConversation(conversation.remoteJid, conversation.phone) ? 200 : 0) +
    Math.floor(activity.getTime() / 1_000_000_000)
  );
}
