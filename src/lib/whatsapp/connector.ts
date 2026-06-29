import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadContentFromMessage,
  fetchLatestBaileysVersion,
  useMultiFileAuthState as createMultiFileAuthState,
  type Chat,
  type Contact,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { normalizeMalaysiaWhatsAppPhone } from "@/lib/whatsappDeepLink";
import { encodeWhatsAppStoredText } from "@/lib/whatsapp/message-codec";

type WhatsAppRuntimeSession = {
  businessId: string;
  socket?: WASocket;
  starting?: Promise<WhatsAppStartResult>;
  qrCodeText?: string;
  status: "DISCONNECTED" | "QR_REQUIRED" | "CONNECTED" | "ERROR";
};

type WhatsAppDownloadableMessage = Parameters<typeof downloadContentFromMessage>[0];

type WhatsAppAudioPayload = WhatsAppDownloadableMessage & {
  mimetype?: string | null;
  ptt?: boolean | null;
};

type WhatsAppStoredMedia = {
  mediaUrl: string;
  mediaMimeType: string;
  mediaFileName: string;
};

export type WhatsAppStartResult = {
  status: "DISCONNECTED" | "QR_REQUIRED" | "CONNECTED" | "ERROR";
  qrCodeText?: string;
  phoneNumber?: string;
  errorMessage?: string;
};

const globalForWhatsApp = globalThis as unknown as {
  washflowWhatsAppSessions?: Map<string, WhatsAppRuntimeSession>;
};

const sessions =
  globalForWhatsApp.washflowWhatsAppSessions ??
  new Map<string, WhatsAppRuntimeSession>();

if (!globalForWhatsApp.washflowWhatsAppSessions) {
  globalForWhatsApp.washflowWhatsAppSessions = sessions;
}

export async function startWhatsAppSession(businessId: string) {
  const existing = sessions.get(businessId);

  if (existing?.starting) {
    return existing.starting;
  }

  if (existing?.socket && existing.status === "CONNECTED") {
    return {
      status: "CONNECTED",
    } satisfies WhatsAppStartResult;
  }

  const session: WhatsAppRuntimeSession = existing ?? {
    businessId,
    status: "DISCONNECTED",
  };
  sessions.set(businessId, session);

  session.starting = startSession(session).finally(() => {
    session.starting = undefined;
  });

  return session.starting;
}

export async function disconnectWhatsAppSession(businessId: string) {
  const session = sessions.get(businessId);

  try {
    await session?.socket?.logout();
  } catch {
    session?.socket?.end(undefined);
  }

  sessions.delete(businessId);
  await rm(getSessionPath(businessId), { recursive: true, force: true });
}

export async function sendWhatsAppTextMessage(input: {
  businessId: string;
  conversationId: string;
  body: string;
  sentByUserId: string;
}) {
  const result = await startWhatsAppSession(input.businessId);
  const socket = await getReadySocket(input.businessId);

  if (!socket) {
    if (result.status === "QR_REQUIRED") {
      throw new Error("WhatsApp needs a new QR scan before sending.");
    }

    if (result.status === "ERROR") {
      throw new Error(result.errorMessage ?? "WhatsApp connection has an error.");
    }

    throw new Error("WhatsApp is reconnecting. Click Refresh and try again.");
  }

  const conversation = await prisma.whatsAppConversation.findFirstOrThrow({
    where: {
      id: input.conversationId,
      businessId: input.businessId,
    },
  });
  const jid = resolveConversationJid(conversation.remoteJid, conversation.phone);
  const sent = await sendWithReconnect(input.businessId, socket, jid, input.body);
  const externalMessageId = sent?.key?.id ?? null;
  const storedBody = toStoredMessageBody(input.body);

  await prisma.$transaction([
    prisma.whatsAppChatMessage.create({
      data: {
        businessId: input.businessId,
        conversationId: conversation.id,
        customerId: conversation.customerId,
        sentByUserId: input.sentByUserId,
        direction: "OUTBOUND",
        body: storedBody,
        status: "SENT",
        externalMessageId,
      },
    }),
    prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageBody: storedBody,
        lastMessageAt: new Date(),
      },
    }),
  ]);

  return { externalMessageId };
}

async function sendWithReconnect(
  businessId: string,
  socket: WASocket,
  jid: string,
  body: string,
) {
  try {
    return await socket.sendMessage(jid, { text: body });
  } catch (error) {
    if (!isRecoverableSocketError(error)) {
      throw error;
    }

    await invalidateRuntimeSocket(businessId, error);
    const retrySocket = await getReadySocket(businessId);

    if (!retrySocket) {
      throw new Error("WhatsApp disconnected. Refresh the connection and try again.");
    }

    try {
      return await retrySocket.sendMessage(jid, { text: body });
    } catch (retryError) {
      await invalidateRuntimeSocket(businessId, retryError);
      throw new Error(
        getErrorMessage(retryError) || "WhatsApp disconnected. Refresh the connection and try again.",
      );
    }
  }
}

async function getReadySocket(businessId: string) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const socket = getConnectedSocket(businessId);

    if (socket) {
      return socket;
    }

    await sleep(500);
  }

  const session = sessions.get(businessId);

  if (session && !session.socket) {
    session.status = "DISCONNECTED";
  }

  await startWhatsAppSession(businessId);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const socket = getConnectedSocket(businessId);

    if (socket) {
      return socket;
    }

    await sleep(500);
  }

  return undefined;
}

function getConnectedSocket(businessId: string) {
  const session = sessions.get(businessId);
  const socket = session?.socket;

  if (session?.status === "CONNECTED" && socket) {
    return socket;
  }

  return undefined;
}

async function invalidateRuntimeSocket(businessId: string, error: unknown) {
  const session = sessions.get(businessId);

  try {
    session?.socket?.end(undefined);
  } catch {
    // The connection is already closing; the in-memory state below is enough.
  }

  if (session) {
    session.socket = undefined;
    session.status = "DISCONNECTED";
    session.qrCodeText = undefined;
  }

  await prisma.whatsAppConnection.updateMany({
    where: { businessId },
    data: {
      status: "DISCONNECTED",
      disconnectedAt: new Date(),
      qrCodeText: null,
      errorMessage: getErrorMessage(error),
    },
  });
}

function isRecoverableSocketError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();

  return (
    message.includes("connection closed") ||
    message.includes("connection lost") ||
    message.includes("socket") ||
    message.includes("1006") ||
    message.includes("timed out")
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "");
}

async function startSession(session: WhatsAppRuntimeSession) {
  await mkdir(getSessionPath(session.businessId), { recursive: true });
  session.qrCodeText = undefined;
  session.status = "DISCONNECTED";

  await prisma.whatsAppConnection.upsert({
    where: { businessId: session.businessId },
    create: {
      businessId: session.businessId,
      status: "DISCONNECTED",
      qrCodeText: null,
      sessionName: getSessionName(session.businessId),
      errorMessage: null,
    },
    update: {
      status: "DISCONNECTED",
      qrCodeText: null,
      errorMessage: null,
    },
  });

  const { state, saveCreds } = await createMultiFileAuthState(
    getSessionPath(session.businessId),
  );
  const { version } = await fetchLatestBaileysVersion();
  const socket = makeWASocket({
    auth: state,
    browser: Browsers.macOS("Desktop"),
    printQRInTerminal: false,
    shouldSyncHistoryMessage: () => true,
    syncFullHistory: true,
    version,
  });

  session.socket = socket;

  socket.ev.on("creds.update", saveCreds);
  socket.ev.on("messaging-history.set", async ({ contacts, chats, messages }) => {
    console.info("[whatsapp] history sync received", {
      businessId: session.businessId,
      contacts: contacts.length,
      chats: chats.length,
      messages: messages.length,
    });

    for (const contact of contacts) {
      await recordContactConversation({
        businessId: session.businessId,
        jid: contact.phoneNumber ?? contact.id,
        displayName: getContactDisplayName(contact),
      });
    }

    for (const chat of chats) {
      await recordChatConversation({
        businessId: session.businessId,
        chat,
      });
    }

    for (const message of messages) {
      await recordSocketMessage({
        businessId: session.businessId,
        message,
        incrementUnread: false,
      });
    }
  });
  socket.ev.on("contacts.upsert", async (contacts) => {
    for (const contact of contacts) {
      await recordContactConversation({
        businessId: session.businessId,
        jid: contact.phoneNumber ?? contact.id,
        displayName: getContactDisplayName(contact),
      });
    }
  });
  socket.ev.on("contacts.update", async (contacts) => {
    for (const contact of contacts) {
      if (!contact.id && !contact.phoneNumber) {
        continue;
      }

      await recordContactConversation({
        businessId: session.businessId,
        jid: contact.phoneNumber ?? contact.id ?? "",
        displayName: getContactDisplayName(contact),
      });
    }
  });
  socket.ev.on("chats.upsert", async (chats) => {
    for (const chat of chats) {
      await recordChatConversation({
        businessId: session.businessId,
        chat,
      });
    }
  });
  socket.ev.on("chats.update", async (chats) => {
    for (const chat of chats) {
      await recordChatConversation({
        businessId: session.businessId,
        chat,
      });
    }
  });
  socket.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") {
      return;
    }

    for (const message of messages) {
      await recordSocketMessage({
        businessId: session.businessId,
        message,
        incrementUnread: !message.key.fromMe,
      });
    }
  });

  return new Promise<WhatsAppStartResult>((resolve) => {
    const timeout = setTimeout(async () => {
      resolve({ status: session.status, qrCodeText: session.qrCodeText });
    }, 20_000);

    socket.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        session.qrCodeText = qr;
        session.status = "QR_REQUIRED";
        await prisma.whatsAppConnection.upsert({
          where: { businessId: session.businessId },
          create: {
            businessId: session.businessId,
            status: "QR_REQUIRED",
            qrCodeText: qr,
            sessionName: getSessionName(session.businessId),
            errorMessage: null,
          },
          update: {
            status: "QR_REQUIRED",
            qrCodeText: qr,
            disconnectedAt: null,
            errorMessage: null,
          },
        });
        clearTimeout(timeout);
        resolve({ status: "QR_REQUIRED", qrCodeText: qr });
      }

      if (connection === "open") {
        const phoneNumber = getConnectedPhoneNumber(socket);
        session.status = "CONNECTED";
        session.qrCodeText = undefined;
        await markConnectionConnected(session.businessId, phoneNumber);
        clearTimeout(timeout);
        resolve({ status: "CONNECTED", phoneNumber });
      }

      if (connection === "close") {
        const disconnectError = lastDisconnect?.error as
          | { output?: { statusCode?: number }; message?: string }
          | undefined;
        const statusCode = disconnectError?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        session.status = shouldReconnect ? "DISCONNECTED" : "ERROR";
        session.socket = undefined;

        await prisma.whatsAppConnection.upsert({
          where: { businessId: session.businessId },
          create: {
            businessId: session.businessId,
            status: shouldReconnect ? "DISCONNECTED" : "ERROR",
            sessionName: getSessionName(session.businessId),
            disconnectedAt: new Date(),
            qrCodeText: null,
            errorMessage: disconnectError?.message ?? null,
          },
          update: {
            status: shouldReconnect ? "DISCONNECTED" : "ERROR",
            disconnectedAt: new Date(),
            qrCodeText: null,
            errorMessage: disconnectError?.message ?? null,
          },
        });

        if (shouldReconnect) {
          setTimeout(() => {
            if (sessions.get(session.businessId)?.starting) {
              return;
            }

            void startWhatsAppSession(session.businessId).catch(async (error) => {
              await prisma.whatsAppConnection.update({
                where: { businessId: session.businessId },
                data: {
                  status: "ERROR",
                  errorMessage:
                    error instanceof Error
                      ? error.message
                      : "Unable to restart WhatsApp connection",
                },
              });
            });
          }, 1_500);
        }
      }
    });
  });
}

async function recordIncomingMessage(input: {
  businessId: string;
  remoteJid: string;
  body: string;
  externalMessageId: string | null;
  messageType?: "TEXT" | "AUDIO";
  media?: WhatsAppStoredMedia;
  displayName?: string;
  direction?: "INBOUND" | "OUTBOUND";
  createdAt?: Date;
  incrementUnread?: boolean;
}) {
  const phone = normalizeRemoteJid(input.remoteJid);

  if (!phone) {
    return;
  }
  const storedBody = toStoredMessageBody(input.body);

  if (input.externalMessageId) {
    const existingMessage = await prisma.whatsAppChatMessage.findFirst({
      where: {
        businessId: input.businessId,
        externalMessageId: input.externalMessageId,
      },
      select: { id: true },
    });

    if (existingMessage) {
      return;
    }
  }

  const customer = isLinkedIdentityJid(input.remoteJid)
    ? null
    : await findCustomerByWhatsAppPhone(input.businessId, phone);
  const fallbackDisplayName = phone;

  await prisma.$transaction(async (tx) => {
    const existingConversation = await tx.whatsAppConversation.findUnique({
      where: {
        businessId_phone: {
          businessId: input.businessId,
          phone,
        },
      },
      select: { displayName: true },
    });
    const isOutbound = input.direction === "OUTBOUND";
    const displayName = isOutbound
      ? (safeDatabaseText(existingConversation?.displayName) ?? fallbackDisplayName)
      : resolveConversationDisplayName({
          customerName: customer?.name,
          incomingName: input.displayName,
          existingName: existingConversation?.displayName,
          fallbackName: fallbackDisplayName,
          phone,
        });
    const displayNameUpdate =
      !isOutbound &&
      shouldUpdateConversationDisplayName({
        existingName: existingConversation?.displayName,
        nextName: displayName,
        phone,
      })
        ? { displayName }
        : {};

    const conversation = await tx.whatsAppConversation.upsert({
      where: {
        businessId_phone: {
          businessId: input.businessId,
          phone,
        },
      },
      create: {
        businessId: input.businessId,
        customerId: customer?.id,
        phone,
        remoteJid: input.remoteJid,
        displayName,
        lastMessageBody: storedBody,
        lastMessageAt: input.createdAt ?? new Date(),
        unreadCount: input.incrementUnread === false ? 0 : 1,
      },
      update: {
        customerId: customer?.id,
        remoteJid: input.remoteJid,
        ...displayNameUpdate,
        lastMessageBody: storedBody,
        lastMessageAt: input.createdAt ?? new Date(),
        unreadCount:
          input.incrementUnread === false ? undefined : { increment: 1 },
      },
    });

    await tx.whatsAppChatMessage.create({
      data: {
        businessId: input.businessId,
        conversationId: conversation.id,
        customerId: customer?.id,
        direction: input.direction ?? "INBOUND",
        messageType: input.messageType ?? "TEXT",
        body: storedBody,
        mediaUrl: input.media?.mediaUrl,
        mediaMimeType: input.media?.mediaMimeType,
        mediaFileName: input.media?.mediaFileName,
        status: input.direction === "OUTBOUND" ? "SENT" : "RECEIVED",
        externalMessageId: input.externalMessageId,
        createdAt: input.createdAt,
      },
    });
  });
}

async function recordSocketMessage(input: {
  businessId: string;
  message: WAMessage;
  incrementUnread: boolean;
}) {
  const remoteJid = input.message.key.remoteJid;
  const audioMessage = extractAudioMessage(input.message.message);
  let body = extractMessageText(input.message.message);

  if (!remoteJid || shouldSkipJid(remoteJid) || (!body && !audioMessage)) {
    return;
  }

  const externalMessageId = input.message.key.id ?? null;
  let messageType: "TEXT" | "AUDIO" = "TEXT";
  let media: WhatsAppStoredMedia | undefined;

  if (audioMessage) {
    messageType = "AUDIO";
    media = await downloadWhatsAppAudioMessage({
      businessId: input.businessId,
      externalMessageId,
      audioMessage,
    });
    body = media ? "Audio message" : "Audio message unavailable";
  }

  if (input.message.key.fromMe && externalMessageId) {
    const existingOutbound = await prisma.whatsAppChatMessage.findFirst({
      where: {
        businessId: input.businessId,
        externalMessageId,
        direction: "OUTBOUND",
      },
      select: { conversationId: true },
    });

    if (existingOutbound) {
      await prisma.whatsAppConversation.update({
        where: { id: existingOutbound.conversationId },
        data: {
          lastMessageBody: toStoredMessageBody(body),
          lastMessageAt: toMessageDate(input.message.messageTimestamp),
        },
      });
      return;
    }
  }

  await recordIncomingMessage({
    businessId: input.businessId,
    remoteJid,
    body,
    externalMessageId,
    messageType,
    media,
    displayName: input.message.key.fromMe
      ? undefined
      : input.message.pushName ?? undefined,
    direction: input.message.key.fromMe ? "OUTBOUND" : "INBOUND",
    createdAt: toMessageDate(input.message.messageTimestamp),
    incrementUnread: input.incrementUnread,
  });
}

async function recordContactConversation(input: {
  businessId: string;
  jid: string;
  displayName?: string;
}) {
  if (shouldSkipJid(input.jid)) {
    return;
  }

  const phone = normalizeRemoteJid(input.jid);

  if (!phone) {
    return;
  }

  const customer = isLinkedIdentityJid(input.jid)
    ? null
    : await findCustomerByWhatsAppPhone(input.businessId, phone);
  const fallbackDisplayName = phone;
  const existingConversation = await prisma.whatsAppConversation.findUnique({
    where: {
      businessId_phone: {
        businessId: input.businessId,
        phone,
      },
    },
    select: { displayName: true },
  });
  const displayName = resolveConversationDisplayName({
    customerName: customer?.name,
    incomingName: input.displayName,
    existingName: existingConversation?.displayName,
    fallbackName: fallbackDisplayName,
    phone,
  });
  const displayNameUpdate = shouldUpdateConversationDisplayName({
    existingName: existingConversation?.displayName,
    nextName: displayName,
    phone,
  })
    ? { displayName }
    : {};

  await prisma.whatsAppConversation.upsert({
    where: {
      businessId_phone: {
        businessId: input.businessId,
        phone,
      },
    },
    create: {
      businessId: input.businessId,
      customerId: customer?.id,
      phone,
      remoteJid: input.jid,
      displayName,
      lastMessageBody: null,
      lastMessageAt: null,
      unreadCount: 0,
    },
    update: {
      customerId: customer?.id,
      remoteJid: input.jid,
      ...displayNameUpdate,
    },
  });
}

async function recordChatConversation(input: {
  businessId: string;
  chat: Partial<Chat>;
}) {
  const jid = input.chat.id;

  if (!jid || shouldSkipJid(jid)) {
    return;
  }

  const phone = normalizeRemoteJid(jid);

  if (!phone) {
    return;
  }

  const customer = isLinkedIdentityJid(jid)
    ? null
    : await findCustomerByWhatsAppPhone(input.businessId, phone);
  const fallbackDisplayName = phone;
  const existingConversation = await prisma.whatsAppConversation.findUnique({
    where: {
      businessId_phone: {
        businessId: input.businessId,
        phone,
      },
    },
    select: { displayName: true },
  });
  const displayName = resolveConversationDisplayName({
    customerName: customer?.name,
    incomingName: input.chat.name,
    existingName: existingConversation?.displayName,
    fallbackName: fallbackDisplayName,
    phone,
  });
  const displayNameUpdate = shouldUpdateConversationDisplayName({
    existingName: existingConversation?.displayName,
    nextName: displayName,
    phone,
  })
    ? { displayName }
    : {};
  const lastMessageAt = input.chat.conversationTimestamp
    ? toMessageDate(input.chat.conversationTimestamp)
    : input.chat.lastMessageRecvTimestamp
      ? toMessageDate(input.chat.lastMessageRecvTimestamp)
      : undefined;

  await prisma.whatsAppConversation.upsert({
    where: {
      businessId_phone: {
        businessId: input.businessId,
        phone,
      },
    },
    create: {
      businessId: input.businessId,
      customerId: customer?.id,
      phone,
      remoteJid: jid,
      displayName,
      lastMessageBody: null,
      lastMessageAt,
      unreadCount: 0,
    },
    update: {
      customerId: customer?.id,
      remoteJid: jid,
      ...displayNameUpdate,
      lastMessageAt,
    },
  });
}

async function findCustomerByWhatsAppPhone(businessId: string, phone: string) {
  const localPhone = toLocalMalaysiaPhone(phone);

  return prisma.customer.findFirst({
    where: {
      businessId,
      OR: [{ phone }, { phone: localPhone }],
    },
    select: { id: true, name: true },
  });
}

async function markConnectionConnected(
  businessId: string,
  phoneNumber: string | undefined,
) {
  await prisma.whatsAppConnection.upsert({
    where: { businessId },
    create: {
      businessId,
      phoneNumber,
      status: "CONNECTED",
      sessionName: getSessionName(businessId),
      connectedAt: new Date(),
      lastSeenAt: new Date(),
      qrCodeText: null,
      errorMessage: null,
    },
    update: {
      phoneNumber,
      status: "CONNECTED",
      connectedAt: new Date(),
      lastSeenAt: new Date(),
      disconnectedAt: null,
      qrCodeText: null,
      errorMessage: null,
    },
  });
}

function extractMessageText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }

  const payload = message as {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    ephemeralMessage?: { message?: unknown };
    imageMessage?: { caption?: string };
    protocolMessage?: { editedMessage?: unknown };
    viewOnceMessage?: { message?: unknown };
    viewOnceMessageV2?: { message?: unknown };
    videoMessage?: { caption?: string };
    documentMessage?: { caption?: string; fileName?: string };
  };

  const candidates = [
    payload.conversation,
    payload.extendedTextMessage?.text,
    extractMessageText(payload.ephemeralMessage?.message),
    extractMessageText(payload.viewOnceMessage?.message),
    extractMessageText(payload.viewOnceMessageV2?.message),
    extractMessageText(payload.protocolMessage?.editedMessage),
    payload.imageMessage?.caption,
    payload.videoMessage?.caption,
    payload.documentMessage?.caption,
    payload.documentMessage?.fileName,
  ];

  return candidates.find((candidate) => candidate?.trim())?.trim() ?? "";
}

function extractAudioMessage(message: unknown): WhatsAppAudioPayload | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  const payload = message as {
    audioMessage?: WhatsAppAudioPayload | null;
    ephemeralMessage?: { message?: unknown };
    protocolMessage?: { editedMessage?: unknown };
    viewOnceMessage?: { message?: unknown };
    viewOnceMessageV2?: { message?: unknown };
  };

  return (
    payload.audioMessage ??
    extractAudioMessage(payload.ephemeralMessage?.message) ??
    extractAudioMessage(payload.viewOnceMessage?.message) ??
    extractAudioMessage(payload.viewOnceMessageV2?.message) ??
    extractAudioMessage(payload.protocolMessage?.editedMessage)
  );
}

async function downloadWhatsAppAudioMessage(input: {
  businessId: string;
  externalMessageId: string | null;
  audioMessage: WhatsAppAudioPayload;
}): Promise<WhatsAppStoredMedia | undefined> {
  try {
    const stream = await downloadContentFromMessage(
      input.audioMessage,
      input.audioMessage.ptt ? "ptt" : "audio",
    );
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const audioBuffer = Buffer.concat(chunks);

    if (!audioBuffer.length) {
      return undefined;
    }

    const mediaMimeType = input.audioMessage.mimetype ?? "audio/ogg; codecs=opus";
    const mediaFileName = `${sanitizeMediaFileName(
      input.externalMessageId ?? `${Date.now()}`,
    )}.${getAudioFileExtension(mediaMimeType)}`;
    const uploadDir = path.join(
      process.cwd(),
      "public",
      "uploads",
      "whatsapp-audio",
      input.businessId,
    );

    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, mediaFileName), audioBuffer);

    return {
      mediaUrl: `/uploads/whatsapp-audio/${input.businessId}/${mediaFileName}`,
      mediaMimeType,
      mediaFileName,
    };
  } catch (error) {
    console.warn("[whatsapp] unable to download audio message", error);
    return undefined;
  }
}

function getAudioFileExtension(mimeType: string) {
  const cleanMimeType = mimeType.split(";")[0]?.trim().toLowerCase();

  if (cleanMimeType === "audio/mpeg") {
    return "mp3";
  }

  if (cleanMimeType === "audio/mp4" || cleanMimeType === "audio/aac") {
    return "m4a";
  }

  if (cleanMimeType === "audio/webm") {
    return "webm";
  }

  return "ogg";
}

function sanitizeMediaFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || `${Date.now()}`;
}

function getContactDisplayName(contact: Partial<Contact>) {
  return contact.name ?? contact.notify ?? contact.verifiedName ?? contact.username;
}

function getConnectedPhoneNumber(socket: WASocket) {
  const userId = socket.user?.id;

  if (!userId) {
    return undefined;
  }

  return normalizeRemoteJid(userId);
}

function normalizeRemoteJid(jid: string) {
  const rawPhone = jid.split("@")[0]?.split(":")[0] ?? "";

  if (isLinkedIdentityJid(jid)) {
    return rawPhone;
  }

  return normalizeMalaysiaWhatsAppPhone(rawPhone);
}

function isLinkedIdentityJid(jid: string) {
  return jid.endsWith("@lid");
}

function resolveConversationJid(remoteJid: string | null, phone: string) {
  if (remoteJid?.includes("@")) {
    return remoteJid;
  }

  const normalizedPhone = normalizeMalaysiaWhatsAppPhone(phone);

  if (!normalizedPhone) {
    throw new Error("Conversation phone is missing.");
  }

  return `${normalizedPhone}@s.whatsapp.net`;
}

function shouldSkipJid(jid: string) {
  return (
    jid.endsWith("@g.us") ||
    jid.includes("status@broadcast") ||
    jid.includes("@newsletter")
  );
}

function toMessageDate(timestamp: unknown) {
  let value: number | undefined;

  if (typeof timestamp === "number") {
    value = timestamp;
  } else if (typeof timestamp === "bigint") {
    value = Number(timestamp);
  } else if (typeof timestamp === "string") {
    value = Number(timestamp);
  } else if (
    timestamp &&
    typeof timestamp === "object" &&
    "toNumber" in timestamp &&
    typeof timestamp.toNumber === "function"
  ) {
    value = timestamp.toNumber();
  }

  if (!value || Number.isNaN(value)) {
    return new Date();
  }

  return new Date(value > 1_000_000_000_000 ? value : value * 1000);
}

function toLocalMalaysiaPhone(phone: string) {
  return phone.startsWith("60") ? `0${phone.slice(2)}` : phone;
}

function safeDatabaseText(value: string | null | undefined) {
  const cleaned = value
    ?.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || undefined;
}

function safeMessageBody(value: string | null | undefined) {
  const cleaned = value
    ?.normalize("NFC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || undefined;
}

function toStoredMessageBody(value: string | null | undefined) {
  return encodeWhatsAppStoredText(safeMessageBody(value) ?? "[Message]") ?? "[Message]";
}

function resolveConversationDisplayName(input: {
  customerName?: string | null;
  incomingName?: string | null;
  existingName?: string | null;
  fallbackName: string;
  phone: string;
}) {
  const customerName = safeDatabaseText(input.customerName);

  if (customerName) {
    return customerName;
  }

  const incomingName = safeDatabaseText(input.incomingName);

  if (incomingName && !isWeakConversationName(incomingName, input.phone)) {
    return incomingName;
  }

  const existingName = safeDatabaseText(input.existingName);

  if (existingName && !isWeakConversationName(existingName, input.phone)) {
    return existingName;
  }

  return incomingName ?? existingName ?? input.fallbackName;
}

function isWeakConversationName(name: string, phone: string) {
  const normalizedName = name.trim();

  return (
    normalizedName === phone ||
    normalizedName === "WhatsApp contact" ||
    /^\d{10,}$/.test(normalizedName)
  );
}

function shouldUpdateConversationDisplayName(input: {
  existingName?: string | null;
  nextName: string;
  phone: string;
}) {
  const existingName = safeDatabaseText(input.existingName);

  if (!existingName || isWeakConversationName(existingName, input.phone)) {
    return true;
  }

  return !isWeakConversationName(input.nextName, input.phone);
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getSessionName(businessId: string) {
  return `business-${businessId}`;
}

function getSessionPath(businessId: string) {
  return path.join(process.cwd(), ".whatsapp-sessions", getSessionName(businessId));
}
