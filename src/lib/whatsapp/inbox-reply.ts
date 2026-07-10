import { prisma } from "@/lib/prisma";
import { normalizeMalaysiaWhatsAppPhone } from "@/lib/whatsappDeepLink";
import { encodeWhatsAppStoredText } from "./message-codec";
import { enqueueWhatsAppLogMessage } from "./notification-queue";

type EnqueueInboxReplyInput = {
  audioBase64?: string | null;
  audioFileName?: string | null;
  audioMimeType?: string | null;
  businessId: string;
  body: string;
  conversationId: string;
  documentBase64?: string | null;
  documentFileName?: string | null;
  documentMimeType?: string | null;
  sentByUserId: string;
};

export async function enqueueInboxReply(input: EnqueueInboxReplyInput) {
  const conversation = await prisma.whatsAppConversation.findFirst({
    where: {
      id: input.conversationId,
      businessId: input.businessId,
    },
    select: {
      customerId: true,
      id: true,
      instanceId: true,
      phone: true,
      remoteJid: true,
    },
  });

  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  const recipientPhone = normalizeMalaysiaWhatsAppPhone(conversation.phone);
  const recipientAddress = resolveConversationRecipient(
    conversation.remoteJid,
    conversation.phone,
  );

  if (!recipientPhone || !recipientAddress) {
    throw new Error("Conversation has no valid WhatsApp recipient.");
  }

  const storedBody = encodeWhatsAppStoredText(input.body) ?? input.body;
  const now = new Date();
  const attachment = resolveReplyAttachment(input);
  const attachmentMediaUrl = await saveReplyAttachment({
    base64: attachment.base64,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    type: attachment.type,
  });
  const log = await prisma.$transaction(async (tx) => {
    const messageLog = await tx.whatsAppMessage.create({
      data: {
        businessId: input.businessId,
        customerId: conversation.customerId,
        sentByUserId: input.sentByUserId,
        phone: recipientPhone,
        recipientPhone,
        messageType: "INBOX_REPLY",
        messageBody: storedBody,
        status: "DRAFT",
        provider: "WHATSAPP_WEB_AUTO",
      },
    });

    await tx.whatsAppChatMessage.create({
      data: {
        businessId: input.businessId,
        instanceId: conversation.instanceId,
        conversationId: conversation.id,
        customerId: conversation.customerId,
        sentByUserId: input.sentByUserId,
        direction: "OUTBOUND",
        messageType:
          attachment.type === "audio"
            ? "AUDIO"
            : attachment.type === "image"
              ? "IMAGE"
            : attachment.type === "document"
              ? "DOCUMENT"
              : "TEXT",
        body: storedBody,
        mediaUrl: attachmentMediaUrl,
        mediaFileName: attachment.fileName,
        mediaMimeType: attachment.mimeType,
        status: "SENT",
      },
    });

    await tx.whatsAppConversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageBody: storedBody,
        lastMessageAt: now,
      },
    });

    return messageLog;
  });

  try {
    const queueItem = await enqueueWhatsAppLogMessage({
      businessId: input.businessId,
      documentBase64: attachment.base64,
      documentFileName: attachment.fileName,
      documentMimeType: attachment.mimeType,
      message: input.body,
      messageLogId: log.id,
      messageType: "INBOX_REPLY",
      phone: recipientAddress,
    });

    return { log, queueItem };
  } catch (error) {
    await prisma.whatsAppMessage.update({
      where: { id: log.id },
      data: {
        errorMessage:
          error instanceof Error ? error.message : "Unable to queue WhatsApp reply.",
      },
    });

    throw error;
  }
}

function resolveConversationRecipient(remoteJid: string | null, phone: string) {
  if (remoteJid?.endsWith("@lid")) {
    return remoteJid;
  }

  const rawPhone = remoteJid?.endsWith("@s.whatsapp.net")
    ? remoteJid.replace("@s.whatsapp.net", "")
    : phone;

  return normalizeMalaysiaWhatsAppPhone(rawPhone);
}

function resolveReplyAttachment(input: EnqueueInboxReplyInput) {
  if (input.audioBase64) {
    return {
      base64: input.audioBase64,
      fileName: input.audioFileName ?? "voice-message.webm",
      mimeType: input.audioMimeType ?? "audio/webm",
      type: "audio" as const,
    };
  }

  if (input.documentBase64) {
    return {
      base64: input.documentBase64,
      fileName: input.documentFileName ?? "attachment",
      mimeType: input.documentMimeType ?? "application/octet-stream",
      type: input.documentMimeType?.startsWith("image/")
        ? "image" as const
        : "document" as const,
    };
  }

  return {
    base64: null,
    fileName: null,
    mimeType: null,
    type: null,
  };
}

async function saveReplyAttachment(input: {
  base64: string | null;
  fileName: string | null;
  mimeType: string | null;
  type: "audio" | "document" | "image" | null;
}) {
  if (!input.base64 || !input.type) {
    return null;
  }

  const [{ promises: fs }, path] = await Promise.all([
    import("node:fs"),
    import("node:path"),
  ]);
  const uploadFolder =
    input.type === "audio"
      ? "whatsapp-audio"
      : input.type === "image"
        ? "whatsapp-images"
        : "whatsapp-documents";
  const uploadDir = path.join(process.cwd(), "public", "uploads", uploadFolder);
  await fs.mkdir(uploadDir, { recursive: true });

  const extension = getAttachmentExtension(input.fileName, input.mimeType, input.type);
  const baseName = sanitizeFileSegment(
    input.fileName?.replace(/\.[a-z0-9]+$/i, "") ?? "attachment",
  );
  const fileName = `outgoing-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}-${baseName}${extension}`;
  const filePath = path.join(uploadDir, fileName);

  await fs.writeFile(filePath, Buffer.from(input.base64, "base64"));

  return `/uploads/${uploadFolder}/${fileName}`;
}

function getAttachmentExtension(
  fileName: string | null,
  mimeType: string | null,
  type: "audio" | "document" | "image",
) {
  const extension = fileName?.match(/\.[a-z0-9]+$/i)?.[0];

  if (extension) {
    return extension.toLowerCase();
  }

  if (type === "audio") {
    return mimeType?.includes("ogg") ? ".ogg" : ".webm";
  }

  if (mimeType === "application/pdf") {
    return ".pdf";
  }

  if (mimeType?.includes("png")) {
    return ".png";
  }

  if (mimeType?.includes("jpeg") || mimeType?.includes("jpg")) {
    return ".jpg";
  }

  return ".bin";
}

function sanitizeFileSegment(value: string) {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "attachment";
}
