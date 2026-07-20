import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeMalaysiaWhatsAppPhone } from "@/lib/whatsappDeepLink";
import { normalizeWhatsAppInstanceId } from "./instance";
import { encodeWhatsAppStoredText } from "./message-codec";

type HistoryContactInput = {
  id?: string | null;
  name?: string | null;
  notify?: string | null;
  verifiedName?: string | null;
  rawJson?: unknown | null;
};

type HistoryChatInput = {
  id?: string | null;
  name?: string | null;
  conversationTimestamp?: unknown;
  unreadCount?: number | null;
  rawJson?: unknown | null;
};

type HistoryMessageInput = {
  key?: {
    id?: string | null;
    remoteJid?: string | null;
    fromMe?: boolean | null;
    participant?: string | null;
    senderPn?: string | null;
    participantPn?: string | null;
    remoteJidAlt?: string | null;
    participantAlt?: string | null;
  } | null;
  message?: unknown;
  messageTimestamp?: unknown;
  pushName?: string | null;
  rawJson?: unknown | null;
};

export type WhatsAppHistorySyncInput = {
  businessId: string;
  instanceId: string;
  syncType?: string | null;
  contacts?: HistoryContactInput[];
  chats?: HistoryChatInput[];
  messages?: HistoryMessageInput[];
};

export async function syncWhatsAppHistory(input: WhatsAppHistorySyncInput) {
  const businessId = input.businessId;
  const instanceId = normalizeWhatsAppInstanceId(input.instanceId);
  const contacts = input.contacts ?? [];
  const chats = input.chats ?? [];
  const messages = input.messages ?? [];

  return prisma.$transaction(async (tx) => {
    let contactCount = 0;
    let chatCount = 0;
    let messageCount = 0;
    let skippedContacts = 0;
    let skippedChats = 0;
    let skippedMessages = 0;

    for (const contact of contacts) {
      const remoteJid = contact.id?.trim();
      const phone = jidToPhone(remoteJid);

      if (!phone) {
        skippedContacts += 1;
        continue;
      }

      await upsertContact(tx, {
        businessId,
        instanceId,
        phone,
        remoteJid,
        displayName:
          contact.name?.trim() ||
          contact.verifiedName?.trim() ||
          contact.notify?.trim() ||
          phone,
        rawJson: contact.rawJson ?? contact,
      });
      contactCount += 1;
    }

    for (const chat of chats) {
      const remoteJid = chat.id?.trim();
      const phone = jidToPhone(remoteJid);

      if (!phone) {
        skippedChats += 1;
        continue;
      }

      await upsertContact(tx, {
        businessId,
        instanceId,
        phone,
        remoteJid,
        displayName: chat.name?.trim() || phone,
        rawJson: chat.rawJson ?? chat,
      });
      chatCount += 1;
    }

    for (const message of messages) {
      const result = await upsertHistoryMessage(tx, {
        businessId,
        instanceId,
        message,
      });

      if (result) {
        messageCount += 1;
      } else {
        skippedMessages += 1;
      }
    }

    return {
      contacts: contactCount,
      chats: chatCount,
      messages: messageCount,
      skippedContacts,
      skippedChats,
      skippedMessages,
      syncType: input.syncType ?? "unknown",
    };
  });
}

async function upsertHistoryMessage(
  tx: Prisma.TransactionClient,
  input: {
    businessId: string;
    instanceId: string;
    message: HistoryMessageInput;
  },
) {
  const messageId = input.message.key?.id?.trim();
  const remoteJid = input.message.key?.remoteJid?.trim();

  if (!messageId || !remoteJid) {
    return false;
  }

  if (isGroupJid(remoteJid) || isLidJid(remoteJid)) {
    return false;
  }

  const phone =
    jidToPhone(remoteJid) ??
    jidToPhone(input.message.key?.senderPn) ??
    jidToPhone(input.message.key?.participantPn) ??
    jidToPhone(input.message.key?.participant) ??
    jidToPhone(input.message.key?.remoteJidAlt) ??
    jidToPhone(input.message.key?.participantAlt);

  if (!phone) {
    return false;
  }

  const customer = await findCustomerByPhone(tx, input.businessId, phone);
  const messageType = getHistoryMessageType(input.message.message);
  const body =
    getMessageText(input.message.message) ||
    getHistoryMessageFallback(input.message.message, messageType);
  const storedBody = encodeWhatsAppStoredText(body) ?? body;
  const messageDate = parseBaileysTimestamp(input.message.messageTimestamp) ?? new Date();

  if (!storedBody && !messageType) {
    return false;
  }

  const mediaFileName = getHistoryMediaFileName(input.message.message);
  const mediaMimeType = getHistoryMediaMimeType(input.message.message);

  await upsertContact(tx, {
    businessId: input.businessId,
    instanceId: input.instanceId,
    phone,
    remoteJid,
    displayName: customer?.name ?? input.message.pushName?.trim() ?? phone,
    rawJson: input.message.rawJson ?? input.message,
  });

  const conversation = await upsertConversation(tx, {
    businessId: input.businessId,
    instanceId: input.instanceId,
    phone,
    remoteJid,
    displayName: customer?.name ?? input.message.pushName?.trim() ?? phone,
    customerId: customer?.id ?? null,
    lastMessageAt: messageDate,
    lastMessageBody: storedBody,
  });

  await tx.whatsAppChatMessage.upsert({
    where: {
      businessId_instanceId_externalMessageId: {
        businessId: input.businessId,
        instanceId: input.instanceId,
        externalMessageId: messageId,
      },
    },
    create: {
      businessId: input.businessId,
      instanceId: input.instanceId,
      conversationId: conversation.id,
      customerId: customer?.id ?? null,
      direction: input.message.key?.fromMe ? "OUTBOUND" : "INBOUND",
      messageType: messageType ?? "TEXT",
      body: storedBody,
      mediaFileName,
      mediaMimeType,
      status: input.message.key?.fromMe ? "SENT" : "RECEIVED",
      externalMessageId: messageId,
      rawMessageJson: toPrismaJson(input.message.rawJson ?? input.message),
      createdAt: messageDate,
    },
    update: {
      conversationId: conversation.id,
      customerId: customer?.id ?? null,
      rawMessageJson: toPrismaJson(input.message.rawJson ?? input.message),
    },
  });

  await tx.whatsAppConversation.updateMany({
    where: {
      id: conversation.id,
      OR: [{ lastMessageAt: null }, { lastMessageAt: { lte: messageDate } }],
    },
    data: {
      lastMessageBody: storedBody,
      lastMessageAt: messageDate,
    },
  });

  return true;
}

async function upsertContact(
  tx: Prisma.TransactionClient,
  input: {
    businessId: string;
    instanceId: string;
    phone: string;
    remoteJid?: string | null;
    displayName: string;
    rawJson?: unknown | null;
  },
) {
  await tx.whatsAppContact.upsert({
    where: {
      businessId_instanceId_phone: {
        businessId: input.businessId,
        instanceId: input.instanceId,
        phone: input.phone,
      },
    },
    create: {
      businessId: input.businessId,
      instanceId: input.instanceId,
      phone: input.phone,
      remoteJid: input.remoteJid,
      displayName: input.displayName,
      rawJson: toPrismaJson(input.rawJson),
    },
    update: {
      remoteJid: input.remoteJid,
      displayName: input.displayName,
      rawJson: toPrismaJson(input.rawJson),
    },
  });
}

async function upsertConversation(
  tx: Prisma.TransactionClient,
  input: {
    businessId: string;
    instanceId: string;
    phone: string;
    remoteJid?: string | null;
    displayName: string;
    customerId?: string | null;
    unreadCount?: number;
    lastMessageBody?: string | null;
    lastMessageAt?: Date | null;
  },
) {
  return tx.whatsAppConversation.upsert({
    where: {
      businessId_instanceId_phone: {
        businessId: input.businessId,
        instanceId: input.instanceId,
        phone: input.phone,
      },
    },
    create: {
      businessId: input.businessId,
      instanceId: input.instanceId,
      customerId: input.customerId ?? null,
      phone: input.phone,
      remoteJid: input.remoteJid,
      displayName: input.displayName,
      lastMessageBody: input.lastMessageBody ?? null,
      lastMessageAt: input.lastMessageAt ?? null,
      unreadCount: input.unreadCount ?? 0,
    },
    update: {
      customerId: input.customerId ?? undefined,
      remoteJid: input.remoteJid,
      displayName: input.displayName,
      unreadCount: input.unreadCount ?? undefined,
    },
  });
}

async function findCustomerByPhone(
  tx: Prisma.TransactionClient,
  businessId: string,
  phone: string,
) {
  return tx.customer.findFirst({
    where: {
      businessId,
      phone: {
        in: getPhoneCandidates(phone),
        mode: "insensitive",
      },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
    },
  });
}

function getMessageText(message: unknown) {
  if (!message || typeof message !== "object") {
    return "";
  }

  const candidate = unwrapMessage(message as Record<string, unknown>);

  return (
    readNestedString(candidate, "conversation") ??
    readNestedString(candidate, "extendedTextMessage", "text") ??
    readNestedString(candidate, "imageMessage", "caption") ??
    readNestedString(candidate, "videoMessage", "caption") ??
    readNestedString(candidate, "documentMessage", "caption") ??
    ""
  ).trim();
}

function getHistoryMessageType(message: unknown) {
  const candidate = unwrapMessageObject(message);

  if (candidate?.imageMessage) {
    return "IMAGE" as const;
  }

  if (candidate?.audioMessage) {
    return "AUDIO" as const;
  }

  if (candidate?.documentMessage) {
    return "DOCUMENT" as const;
  }

  return null;
}

function getHistoryMessageFallback(
  message: unknown,
  messageType: ReturnType<typeof getHistoryMessageType>,
) {
  if (messageType === "IMAGE") {
    return "Image";
  }

  if (messageType === "AUDIO") {
    return "Voice message";
  }

  if (messageType === "DOCUMENT") {
    const fileName = getHistoryMediaFileName(message);
    return fileName ? `Document: ${fileName}` : "Document";
  }

  return "";
}

function getHistoryMediaFileName(message: unknown) {
  const candidate = unwrapMessageObject(message);

  return readNestedString(candidate ?? {}, "documentMessage", "fileName");
}

function getHistoryMediaMimeType(message: unknown) {
  const candidate = unwrapMessageObject(message);

  return (
    readNestedString(candidate ?? {}, "imageMessage", "mimetype") ??
    readNestedString(candidate ?? {}, "audioMessage", "mimetype") ??
    readNestedString(candidate ?? {}, "documentMessage", "mimetype")
  );
}

function unwrapMessage(message: Record<string, unknown>): Record<string, unknown> {
  const nested =
    readNestedObject(message, "ephemeralMessage", "message") ??
    readNestedObject(message, "viewOnceMessage", "message") ??
    readNestedObject(message, "viewOnceMessageV2", "message") ??
    readNestedObject(message, "documentWithCaptionMessage", "message");

  return nested ?? message;
}

function unwrapMessageObject(message: unknown) {
  return message && typeof message === "object"
    ? unwrapMessage(message as Record<string, unknown>)
    : null;
}

function jidToPhone(jid: string | null | undefined) {
  if (!jid) {
    return null;
  }

  if (isGroupJid(jid) || isLidJid(jid)) {
    return null;
  }

  const user = jid.split("@")[0]?.split(":")[0] ?? "";
  const numericPhone = normalizeMalaysiaWhatsAppPhone(user);

  if (numericPhone) {
    return numericPhone;
  }

  return /^\+?\d+$/.test(user) ? user : null;
}

function isGroupJid(jid: string | null | undefined) {
  return jid?.endsWith("@g.us") ?? false;
}

function isLidJid(jid: string | null | undefined) {
  return jid?.endsWith("@lid") ?? false;
}

function parseBaileysTimestamp(timestamp: unknown) {
  if (!timestamp) {
    return null;
  }

  const seconds =
    typeof timestamp === "number"
      ? timestamp
      : typeof timestamp === "string"
        ? Number(timestamp)
        : typeof timestamp === "object" &&
            timestamp !== null &&
            "toNumber" in timestamp &&
            typeof timestamp.toNumber === "function"
          ? timestamp.toNumber()
          : Number(timestamp);

  return Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
}

function getPhoneCandidates(phone: string) {
  const candidates = new Set<string>([phone, `+${phone}`]);

  if (phone.startsWith("60")) {
    candidates.add(`0${phone.slice(2)}`);
  }

  return [...candidates];
}

function readNestedObject(
  data: Record<string, unknown>,
  ...path: string[]
): Record<string, unknown> | null {
  let cursor: unknown = data;

  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || !(key in cursor)) {
      return null;
    }

    cursor = (cursor as Record<string, unknown>)[key];
  }

  return cursor && typeof cursor === "object"
    ? (cursor as Record<string, unknown>)
    : null;
}

function readNestedString(data: Record<string, unknown>, ...path: string[]) {
  let cursor: unknown = data;

  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || !(key in cursor)) {
      return null;
    }

    cursor = (cursor as Record<string, unknown>)[key];
  }

  return typeof cursor === "string" ? cursor : null;
}

function toPrismaJson(value: unknown) {
  if (value == null) {
    return undefined;
  }

  return value as Prisma.InputJsonValue;
}
