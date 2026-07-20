import {
  DisconnectReason,
  Browsers,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeWASocket,
  WAProto as proto,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket
} from "@whiskeysockets/baileys";
import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

import { logger } from "./logger.js";
import { getReconnectDelayMs } from "./reconnect.js";
import type { ConnectorState } from "./types.js";
import {
  postDeliveryReceiptWebhook,
  postHistorySyncWebhook,
  postIncomingMessageWebhook
} from "./webhook.js";

type QrWaiter = {
  resolve: (qr: string) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type SessionRuntime = {
  businessId: string;
  authInfoPath: string;
  socket: WASocket | null;
  connecting: Promise<WASocket> | null;
  reconnectTimer: NodeJS.Timeout | null;
  suppressReconnect: boolean;
  socketGeneration: number;
  lastDisconnectStatusCode?: number;
  state: ConnectorState;
  qrWaiters: Set<QrWaiter>;
};

const sessionStorage = new AsyncLocalStorage<SessionRuntime>();
const sessions = new Map<string, SessionRuntime>();

export function shouldForwardMessagesUpsert(type: unknown) {
  return type === "notify" || type === "append";
}

const clientName = "WashFlow Connector";
const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as {
  version?: string;
  dependencies?: Record<string, string>;
};
const connectorVersion = packageJson.version ?? "0.1.0";
const baileysVersion =
  packageJson.dependencies?.["@whiskeysockets/baileys"] ?? "unknown";

const connectorState = new Proxy({} as ConnectorState, {
  get: (_target, property) => getRuntime().state[property as keyof ConnectorState],
  set: (_target, property, value) => {
    (getRuntime().state as unknown as Record<PropertyKey, unknown>)[property] = value;
    return true;
  },
  ownKeys: () => Reflect.ownKeys(getRuntime().state),
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true })
});

function getRuntime() {
  const runtime = sessionStorage.getStore();

  if (!runtime) {
    throw new Error("WhatsApp session context is missing.");
  }

  return runtime;
}

function getOrCreateRuntime(businessId: string) {
  const existing = sessions.get(businessId);

  if (existing) {
    return existing;
  }

  const runtime: SessionRuntime = {
    businessId,
    authInfoPath: getBusinessAuthInfoPath(businessId),
    socket: null,
    connecting: null,
    reconnectTimer: null,
    suppressReconnect: false,
    socketGeneration: 0,
    state: {
      status: "starting",
      startedAt: new Date().toISOString(),
      reconnectAttempts: 0
    },
    qrWaiters: new Set()
  };

  sessions.set(businessId, runtime);
  return runtime;
}

function withSession<T>(businessId: string, callback: () => T) {
  return sessionStorage.run(getOrCreateRuntime(businessId), callback);
}

function bindCurrentSession<TArgs extends unknown[]>(
  callback: (...args: TArgs) => void
) {
  const runtime = getRuntime();
  return (...args: TArgs) => sessionStorage.run(runtime, () => callback(...args));
}

function getAuthInfoPath() {
  return getRuntime().authInfoPath;
}

function getBusinessAuthInfoPath(businessId: string) {
  const authInfoPath = process.env.AUTH_INFO_PATH;

  if (!authInfoPath) {
    throw new Error("AUTH_INFO_PATH is required.");
  }

  const root = path.resolve(authInfoPath);
  const legacyBusinessId =
    process.env.WHATSAPP_DEFAULT_BUSINESS_ID?.trim() ||
    process.env.WHATSAPP_INCOMING_BUSINESS_ID?.trim();

  return businessId === legacyBusinessId
    ? root
    : path.join(root, "sessions", businessId);
}

export function getSessionAuthInfoPath(businessId: string) {
  return getBusinessAuthInfoPath(businessId);
}

function getDisconnectStatusCode(error: unknown) {
  return (error as { output?: { statusCode?: number } } | undefined)?.output
    ?.statusCode;
}

function toSessionStatus() {
  if (
    connectorState.status === "connected" ||
    connectorState.status === "qr" ||
    connectorState.status === "session_expired"
  ) {
    return connectorState.status;
  }

  return "disconnected";
}

function markSessionHealthy() {
  connectorState.sessionHealth = {
    ok: true
  };
}

function markSessionIssue(
  issue: NonNullable<ConnectorState["sessionHealth"]>["issue"],
  message: string
) {
  connectorState.sessionHealth = {
    ok: false,
    issue,
    message,
    detectedAt: new Date().toISOString()
  };
}

function resolveQrWaiters(qr: string) {
  const qrWaiters = getRuntime().qrWaiters;
  for (const waiter of qrWaiters) {
    clearTimeout(waiter.timeout);
    waiter.resolve(qr);
  }

  qrWaiters.clear();
}

function rejectQrWaiters(error: Error) {
  const qrWaiters = getRuntime().qrWaiters;
  for (const waiter of qrWaiters) {
    clearTimeout(waiter.timeout);
    waiter.reject(error);
  }

  qrWaiters.clear();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getMessageText(message: proto.IMessage | null | undefined) {
  const content = getMessageContent(message);

  return (
    content?.conversation ??
    content?.extendedTextMessage?.text ??
    content?.imageMessage?.caption ??
    content?.videoMessage?.caption ??
    content?.documentMessage?.caption ??
    ""
  ).trim();
}

function getMessageContent(message: proto.IMessage | null | undefined) {
  return (
    message?.ephemeralMessage?.message ??
    message?.viewOnceMessage?.message ??
    message?.viewOnceMessageV2?.message ??
    message?.documentWithCaptionMessage?.message ??
    message
  );
}

function getAudioMessage(message: proto.IMessage | null | undefined) {
  return getMessageContent(message)?.audioMessage ?? null;
}

function getImageMessage(message: proto.IMessage | null | undefined) {
  return getMessageContent(message)?.imageMessage ?? null;
}

function getDocumentMessage(message: proto.IMessage | null | undefined) {
  return getMessageContent(message)?.documentMessage ?? null;
}

async function downloadImageMessage(
  message: proto.IWebMessageInfo,
  activeSocket: WASocket
) {
  const imageMessage = getImageMessage(message.message);

  if (!imageMessage) {
    return null;
  }

  const mediaBuffer = await downloadMediaMessage(
    message as WAMessage,
    "buffer",
    {},
    {
      logger,
      reuploadRequest: activeSocket.updateMediaMessage
    }
  );
  const mimeType = imageMessage.mimetype ?? "image/jpeg";
  const extension = getImageExtension(mimeType);

  return {
    mediaBase64: Buffer.from(mediaBuffer).toString("base64"),
    mediaFileName: `${message.key?.id ?? "whatsapp-image"}${extension}`,
    mediaMimeType: mimeType
  };
}

async function downloadAudioMessage(
  message: proto.IWebMessageInfo,
  activeSocket: WASocket
) {
  const audioMessage = getAudioMessage(message.message);

  if (!audioMessage) {
    return null;
  }

  const mediaBuffer = await downloadMediaMessage(
    message as WAMessage,
    "buffer",
    {},
    {
      logger,
      reuploadRequest: activeSocket.updateMediaMessage
    }
  );
  const mimeType = audioMessage.mimetype ?? "audio/ogg";
  const extension = getAudioExtension(mimeType);

  return {
    mediaBase64: Buffer.from(mediaBuffer).toString("base64"),
    mediaFileName: `${message.key?.id ?? "voice-message"}${extension}`,
    mediaMimeType: mimeType
  };
}

async function downloadDocumentMessage(
  message: proto.IWebMessageInfo,
  activeSocket: WASocket
) {
  const documentMessage = getDocumentMessage(message.message);

  if (!documentMessage) {
    return null;
  }

  const mediaBuffer = await downloadMediaMessage(
    message as WAMessage,
    "buffer",
    {},
    {
      logger,
      reuploadRequest: activeSocket.updateMediaMessage
    }
  );
  const mimeType = documentMessage.mimetype ?? "application/octet-stream";
  const fileName = documentMessage.fileName?.trim();
  const extension = getDocumentExtension(fileName, mimeType);

  return {
    mediaBase64: Buffer.from(mediaBuffer).toString("base64"),
    mediaFileName: fileName || `${message.key?.id ?? "whatsapp-document"}${extension}`,
    mediaMimeType: mimeType
  };
}

function getAudioExtension(mimeType: string) {
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) {
    return ".mp3";
  }

  if (mimeType.includes("mp4")) {
    return ".m4a";
  }

  if (mimeType.includes("wav")) {
    return ".wav";
  }

  if (mimeType.includes("webm")) {
    return ".webm";
  }

  return ".ogg";
}

function getImageExtension(mimeType: string) {
  if (mimeType.includes("png")) {
    return ".png";
  }

  if (mimeType.includes("webp")) {
    return ".webp";
  }

  if (mimeType.includes("gif")) {
    return ".gif";
  }

  return ".jpg";
}

function getDocumentExtension(fileName: string | null | undefined, mimeType: string) {
  const existingExtension = fileName ? path.extname(fileName) : "";

  if (existingExtension) {
    return existingExtension;
  }

  if (mimeType.includes("pdf")) {
    return ".pdf";
  }

  if (mimeType.includes("word") || mimeType.includes("document")) {
    return ".docx";
  }

  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) {
    return ".xlsx";
  }

  return ".bin";
}

function isPhoneJid(jid: string) {
  return jid.endsWith("@s.whatsapp.net") || jid.endsWith("@c.us");
}

function isLidJid(jid: string) {
  return jid.endsWith("@lid");
}

function normalizePhoneJid(jid: string) {
  if (!isPhoneJid(jid)) {
    return null;
  }

  const user = jid.split("@")[0]?.split(":")[0] ?? "";
  const phone = user.replace(/\D/g, "");

  return phone || null;
}

function getInstanceId(activeSocket?: WASocket | null) {
  return (
    connectorState.phoneNumber ??
    activeSocket?.user?.id?.split(":")[0]?.replace(/\D/g, "") ??
    process.env.WHATSAPP_INSTANCE_ID?.replace(/\D/g, "") ??
    "default"
  );
}

function toRawJson(value: unknown) {
  return JSON.parse(
    JSON.stringify(value, (_key, nestedValue) =>
      typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue
    )
  ) as unknown;
}

async function getIncomingPhone(message: proto.IWebMessageInfo, activeSocket: WASocket) {
  const key = message.key as proto.IMessageKey & {
    senderPn?: string | null;
    participantPn?: string | null;
    remoteJidAlt?: string | null;
    participantAlt?: string | null;
  };
  const candidateJids = [
    key.senderPn,
    key.participantPn,
    key.remoteJidAlt,
    key.participantAlt,
    key.participant,
    key.remoteJid
  ].filter((jid): jid is string => Boolean(jid));

  for (const jid of candidateJids) {
    const phone = normalizePhoneJid(jid);

    if (phone) {
      return phone;
    }
  }

  const lidJid = candidateJids.find(isLidJid);

  if (!lidJid) {
    return null;
  }

  const mappedPnJid = await activeSocket.signalRepository.lidMapping.getPNForLID(
    lidJid
  );

  logger.info(
    {
      lidJid,
      mappedPnJid,
      messageId: message.key?.id
    },
    "Resolved incoming LID sender"
  );

  return mappedPnJid ? normalizePhoneJid(mappedPnJid) : null;
}

function messageTimestampToIso(timestamp: proto.IWebMessageInfo["messageTimestamp"]) {
  if (!timestamp) {
    return null;
  }

  const seconds =
    typeof timestamp === "number"
      ? timestamp
      : typeof timestamp === "string"
        ? Number(timestamp)
        : typeof timestamp === "object" && "toNumber" in timestamp
          ? timestamp.toNumber()
          : Number(timestamp);

  return Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : null;
}

function timestampSecondsToIso(timestamp: unknown) {
  if (!timestamp) {
    return new Date().toISOString();
  }

  const seconds =
    typeof timestamp === "number"
      ? timestamp
      : typeof timestamp === "string"
        ? Number(timestamp)
        : typeof timestamp === "object" && "toNumber" in timestamp
          ? (timestamp as { toNumber: () => number }).toNumber()
          : Number(timestamp);

  return Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : new Date().toISOString();
}

function toDeliveryStatus(status: unknown) {
  if (status === proto.WebMessageInfo.Status.ERROR) {
    return "FAILED" as const;
  }

  if (status === proto.WebMessageInfo.Status.READ) {
    return "READ" as const;
  }

  if (status === proto.WebMessageInfo.Status.DELIVERY_ACK) {
    return "DELIVERED" as const;
  }

  return null;
}

async function handleIncomingMessage(
  message: proto.IWebMessageInfo,
  activeSocket: WASocket
) {
  const key = message.key;
  const messageId = key?.id;
  const remoteJid = key?.remoteJid;

  if (!messageId || !remoteJid) {
    return;
  }

  if (
    !remoteJid.endsWith("@s.whatsapp.net") &&
    !remoteJid.endsWith("@lid")
  ) {
    return;
  }

  const imageAttachment = await downloadImageMessage(message, activeSocket);
  const audioAttachment = imageAttachment
    ? null
    : await downloadAudioMessage(message, activeSocket);
  const documentAttachment = imageAttachment || audioAttachment
    ? null
    : await downloadDocumentMessage(message, activeSocket);
  const mediaAttachment = imageAttachment ?? audioAttachment ?? documentAttachment;
  const messageType = imageAttachment
    ? "image"
    : audioAttachment
      ? "audio"
      : documentAttachment
        ? "document"
        : "text";
  const body =
    getMessageText(message.message) ||
    (imageAttachment
      ? "Image"
      : audioAttachment
        ? "Voice message"
        : documentAttachment
          ? `Document: ${documentAttachment.mediaFileName}`
          : "");

  if (!body) {
    return;
  }

  const from = await getIncomingPhone(message, activeSocket);

  logger.info(
    {
      messageId,
      remoteJid,
      from,
      key: message.key
    },
    "Incoming WhatsApp message accepted"
  );

  if (!from) {
    logger.warn(
      {
        messageId,
        remoteJid,
        key: message.key
      },
      "Incoming WhatsApp message missing phone mapping"
    );
    return;
  }

  await postIncomingMessageWebhook({
    businessId: getRuntime().businessId,
    instanceId: getInstanceId(activeSocket),
    body,
    direction: key.fromMe ? "OUTBOUND" : "INBOUND",
    from,
    messageId,
    messageType,
    mediaBase64: mediaAttachment?.mediaBase64 ?? null,
    mediaFileName: mediaAttachment?.mediaFileName ?? null,
    mediaMimeType: mediaAttachment?.mediaMimeType ?? null,
    pushName: message.pushName ?? null,
    remoteJid,
    rawMessageJson: toRawJson(message),
    timestamp: messageTimestampToIso(message.messageTimestamp)
  });
  connectorState.lastSuccessfulReceiveAt = new Date().toISOString();
}

async function handleMessageStatusUpdate(update: {
  key?: {
    id?: string | null;
    remoteJid?: string | null;
    fromMe?: boolean | null;
  } | null;
  update?: {
    status?: unknown;
    messageStubParameters?: string[] | null;
  } | null;
}) {
  const messageId = update.key?.id;
  const status = toDeliveryStatus(update.update?.status);
  const ackErrorCode =
    status === "FAILED" ? update.update?.messageStubParameters?.[0] : null;
  const errorMessage = ackErrorCode
    ? `WHATSAPP_ACK_ERROR_${ackErrorCode}`
    : status === "FAILED"
      ? "WHATSAPP_ACK_ERROR"
      : null;

  logger.info(
    {
      messageId,
      remoteJid: update.key?.remoteJid,
      fromMe: update.key?.fromMe,
      rawStatus: update.update?.status,
      mappedStatus: status,
      ackErrorCode,
      errorMessage
    },
    "messages.update received"
  );

  if (!messageId || !status) {
    return;
  }

  if (errorMessage) {
    connectorState.lastAckError = {
      code: errorMessage,
      messageId,
      remoteJid: update.key?.remoteJid ?? undefined,
      at: new Date().toISOString()
    };

    if (ackErrorCode === "463") {
      connectorState.status = "session_expired";
      connectorState.lastError =
        "Your WhatsApp session may have expired. Please reconnect your WhatsApp.";
      markSessionIssue(
        "ACK_463",
        "Your WhatsApp session may have expired. Please reconnect your WhatsApp."
      );
    }
  }

  await postDeliveryReceiptWebhook({
    businessId: getRuntime().businessId,
    instanceId: getInstanceId(),
    messageId,
    remoteJid: update.key?.remoteJid ?? null,
    status,
    errorMessage,
    timestamp: new Date().toISOString()
  });
}

async function handleMessageReceiptUpdate(update: {
  key?: {
    id?: string | null;
    remoteJid?: string | null;
  } | null;
  receipt?: {
    receiptTimestamp?: unknown;
    readTimestamp?: unknown;
  } | null;
}) {
  const messageId = update.key?.id;
  const status = update.receipt?.readTimestamp ? "READ" : "DELIVERED";
  const timestamp = timestampSecondsToIso(
    update.receipt?.readTimestamp ?? update.receipt?.receiptTimestamp
  );

  logger.info(
    {
      messageId,
      remoteJid: update.key?.remoteJid,
      receipt: update.receipt,
      mappedStatus: status
    },
    "message-receipt.update received"
  );

  if (!messageId) {
    return;
  }

  await postDeliveryReceiptWebhook({
    businessId: getRuntime().businessId,
    instanceId: getInstanceId(),
    messageId,
    remoteJid: update.key?.remoteJid ?? null,
    status,
    timestamp
  });
}

async function handleMessagingHistorySet(
  event: {
    chats?: unknown[] | null;
    contacts?: unknown[] | null;
    messages?: unknown[] | null;
    syncType?: unknown;
  },
  activeSocket: WASocket
) {
  const contacts = sanitizeHistoryItems(event.contacts);
  const chats = sanitizeHistoryItems(event.chats);
  const messages = sanitizeHistoryItems(event.messages);
  const syncType =
    typeof event.syncType === "string" || typeof event.syncType === "number"
      ? String(event.syncType)
      : "unknown";

  logger.info(
    {
      instanceId: getInstanceId(activeSocket),
      syncType,
      contacts: contacts.length,
      chats: chats.length,
      messages: messages.length
    },
    "messaging-history.set received"
  );

  await postHistorySyncWebhook({
    businessId: getRuntime().businessId,
    instanceId: getInstanceId(activeSocket),
    syncType,
    contacts,
    chats,
    messages
  });
}

function sanitizeHistoryItems(items: unknown[] | null | undefined) {
  return (items ?? []).map((item) => {
    const rawJson = toRawJson(item);

    return rawJson && typeof rawJson === "object"
      ? { ...(rawJson as Record<string, unknown>), rawJson }
      : { rawJson };
  });
}

async function handleAckError(attrs: {
  id?: string;
  from?: string;
  error?: string;
  t?: string;
}) {
  if (!attrs.id) {
    return;
  }

  const errorMessage = attrs.error
    ? `WHATSAPP_ACK_ERROR_${attrs.error}`
    : "WHATSAPP_ACK_ERROR";

  logger.warn(
    {
      messageId: attrs.id,
      remoteJid: attrs.from,
      errorCode: attrs.error,
      errorMessage
    },
    "WhatsApp ack error captured"
  );

  connectorState.lastAckError = {
    code: errorMessage,
    messageId: attrs.id,
    remoteJid: attrs.from,
    at: timestampSecondsToIso(attrs.t)
  };

  if (attrs.error === "463") {
    connectorState.status = "session_expired";
    connectorState.lastError =
      "Your WhatsApp session may have expired. Please reconnect your WhatsApp.";
    markSessionIssue(
      "ACK_463",
      "Your WhatsApp session may have expired. Please reconnect your WhatsApp."
    );
  }

  await postDeliveryReceiptWebhook({
    businessId: getRuntime().businessId,
    instanceId: getInstanceId(),
    messageId: attrs.id,
    remoteJid: attrs.from ?? null,
    status: "FAILED",
    errorMessage,
    timestamp: timestampSecondsToIso(attrs.t)
  });
}

function createBaileysLogger() {
  const baileysLogger = logger.child({ module: "baileys" });

  return {
    level: baileysLogger.level,
    child: (bindings: Record<string, unknown>) =>
      baileysLogger.child(bindings) as never,
    trace: baileysLogger.trace.bind(baileysLogger),
    debug: baileysLogger.debug.bind(baileysLogger),
    info: baileysLogger.info.bind(baileysLogger),
    warn: (obj: unknown, msg?: string) => {
      baileysLogger.warn(obj, msg);

      if (msg !== "received error in ack") {
        return;
      }

      const attrs = (obj as { attrs?: unknown } | null)?.attrs;

      if (!attrs || typeof attrs !== "object") {
        return;
      }

      void handleAckError(
        attrs as {
          id?: string;
          from?: string;
          error?: string;
          t?: string;
        }
      ).catch((error: unknown) => {
        logger.error({ error, attrs }, "Failed to forward WhatsApp ack error");
      });
    },
    error: baileysLogger.error.bind(baileysLogger)
  };
}

async function waitForStatus(
  statuses: ConnectorState["status"][],
  timeoutMs: number
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (statuses.includes(connectorState.status)) {
      return connectorState.status;
    }

    await sleep(250);
  }

  return connectorState.status;
}

async function hasAuthSession() {
  try {
    const entries = await fs.readdir(getAuthInfoPath());
    return entries.length > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function clearAuthSession() {
  const authInfoPath = path.resolve(getAuthInfoPath());
  await fs.mkdir(authInfoPath, { recursive: true });

  const entries = await fs.readdir(authInfoPath);
  const isLegacyRoot = authInfoPath === path.resolve(process.env.AUTH_INFO_PATH ?? "");
  await Promise.all(
    entries.filter((entry) => !(isLegacyRoot && entry === "sessions")).map((entry) =>
      fs.rm(path.join(authInfoPath, entry), {
        force: true,
        recursive: true
      })
    )
  );
}

function waitForQr(timeoutMs = 45000) {
  if (connectorState.status === "qr" && connectorState.qr) {
    return Promise.resolve(connectorState.qr);
  }

  return new Promise<string>((resolve, reject) => {
    const qrWaiters = getRuntime().qrWaiters;
    const waiter = {
      resolve,
      reject,
      timeout: setTimeout(() => {
        qrWaiters.delete(waiter);
        reject(new Error("Timed out waiting for WhatsApp QR."));
      }, timeoutMs)
    };

    qrWaiters.add(waiter);
  });
}

function scheduleReconnect() {
  const runtime = getRuntime();
  if (runtime.reconnectTimer) {
    return;
  }

  connectorState.status = "reconnecting";
  connectorState.reconnectAttempts += 1;

  const delayMs = getReconnectDelayMs(connectorState.reconnectAttempts);

  logger.warn(
    { delayMs, reconnectAttempts: connectorState.reconnectAttempts },
    "WhatsApp reconnect scheduled"
  );

  runtime.reconnectTimer = setTimeout(bindCurrentSession(() => {
    runtime.reconnectTimer = null;

    void startSocketInternal(true).catch((error: unknown) => {
      connectorState.status = "error";
      connectorState.lastError =
        error instanceof Error ? error.stack ?? error.message : String(error);
      logger.error({ error }, "WhatsApp reconnect failed");
      scheduleReconnect();
    });
  }), delayMs);
}

async function connectSocket(generation: number) {
  logger.info({ authInfoPath: getAuthInfoPath() }, "before useMultiFileAuthState");
  const { state, saveCreds } = await useMultiFileAuthState(getAuthInfoPath());
  logger.info("after useMultiFileAuthState");
  const { version } = await fetchLatestBaileysVersion();
  logger.info({ version }, "after fetchLatestBaileysVersion");
  let hasConnected = false;

  logger.info("before makeWASocket");
  const nextSocket = makeWASocket({
    auth: state,
    browser: Browsers.macOS("Chrome"),
    logger: createBaileysLogger() as never,
    printQRInTerminal: true,
    version
  });
  logger.info("after makeWASocket");

  const runtime = getRuntime();
  runtime.socket = nextSocket;

  nextSocket.ev.on("creds.update", bindCurrentSession(saveCreds));

  nextSocket.ev.on("messages.upsert", bindCurrentSession((event) => {
    if (generation !== runtime.socketGeneration) {
      logger.info(
        { generation, activeGeneration: runtime.socketGeneration },
        "Ignoring stale messages.upsert"
      );
      return;
    }

    logger.info(
      {
        type: event.type,
        count: event.messages.length,
        messageIds: event.messages.map((message) => message.key.id)
      },
      "messages.upsert received"
    );

    if (!shouldForwardMessagesUpsert(event.type)) {
      return;
    }

    for (const message of event.messages) {
      void handleIncomingMessage(message, nextSocket).catch((error: unknown) => {
        logger.error(
          {
            error,
            messageId: message.key.id,
            remoteJid: message.key.remoteJid
          },
          "Failed to forward incoming WhatsApp message"
        );
      });
    }
  }));

  nextSocket.ev.on("messages.update", bindCurrentSession((updates) => {
    for (const update of updates) {
      void handleMessageStatusUpdate(update).catch((error: unknown) => {
        logger.error({ error, update }, "Failed to forward WhatsApp message update");
      });
    }
  }));

  nextSocket.ev.on("message-receipt.update", bindCurrentSession((updates) => {
    for (const update of updates) {
      void handleMessageReceiptUpdate(update).catch((error: unknown) => {
        logger.error({ error, update }, "Failed to forward WhatsApp receipt update");
      });
    }
  }));

  nextSocket.ev.on("messaging-history.set", bindCurrentSession((event) => {
    void handleMessagingHistorySet(event, nextSocket).catch((error: unknown) => {
      logger.error({ error }, "Failed to forward WhatsApp messaging history");
    });
  }));

  nextSocket.ev.on("connection.update", bindCurrentSession((update) => {
    if (generation !== runtime.socketGeneration) {
      logger.info(
        { generation, activeGeneration: runtime.socketGeneration },
        "Ignoring stale connection.update"
      );
      return;
    }

    logger.info(
      {
        connection: update.connection,
        hasQr: Boolean(update.qr),
        receivedPendingNotifications: update.receivedPendingNotifications,
        lastDisconnect: update.lastDisconnect
          ? {
              error: update.lastDisconnect.error instanceof Error
                ? update.lastDisconnect.error.stack ??
                  update.lastDisconnect.error.message
                : update.lastDisconnect.error
                  ? String(update.lastDisconnect.error)
                  : undefined,
              statusCode: getDisconnectStatusCode(update.lastDisconnect.error)
            }
          : undefined
      },
      "connection.update"
    );

    if (update.qr) {
      const hadQr = Boolean(connectorState.qr);
      connectorState.status = "qr";
      connectorState.qr = update.qr;
      resolveQrWaiters(update.qr);
      logger.info(hadQr ? "QR refreshed" : "QR generated");
    }

    if (update.connection === "open") {
      hasConnected = true;
      runtime.lastDisconnectStatusCode = undefined;
      connectorState.status = "connected";
      connectorState.qr = null;
      connectorState.lastError = undefined;
      connectorState.lastAckError = undefined;
      connectorState.lastConnectedAt = new Date().toISOString();
      connectorState.reconnectAttempts = 0;
      connectorState.phoneNumber = nextSocket.user?.id
        ?.split(":")[0]
        ?.replace(/\D/g, "");
      markSessionHealthy();

      logger.info(
        { phoneNumber: connectorState.phoneNumber },
        "Connected"
      );
    }

    if (update.connection === "close") {
      const statusCode = getDisconnectStatusCode(update.lastDisconnect?.error);
      runtime.lastDisconnectStatusCode = statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      const qrExpired = !hasConnected && Boolean(connectorState.qr);

      connectorState.status = "disconnected";
      if (statusCode === DisconnectReason.loggedOut) {
        connectorState.status = "session_expired";
        markSessionIssue(
          "LOGGED_OUT",
          "WhatsApp logged out this linked device. Please reconnect your WhatsApp."
        );
      } else if (hasConnected) {
        markSessionIssue(
          "CONNECTION_LOST",
          "WhatsApp connection was lost. Reconnect if it does not recover."
        );
      } else {
        markSessionIssue(
          "SESSION_INVALID",
          "WhatsApp session is not valid yet. Please scan a fresh QR code."
        );
      }
      if (qrExpired) {
        connectorState.qr = null;
        logger.info("QR expired");
      }
      connectorState.lastDisconnectedAt = new Date().toISOString();
      connectorState.lastError =
        update.lastDisconnect?.error instanceof Error
          ? update.lastDisconnect.error.stack ??
            update.lastDisconnect.error.message
          : update.lastDisconnect?.error
            ? String(update.lastDisconnect.error)
            : undefined;
      runtime.socket = null;

      logger.warn(
        {
          shouldReconnect,
          statusCode,
          error: connectorState.lastError
        },
        "WhatsApp connection closed"
      );

      if (shouldReconnect && !runtime.suppressReconnect) {
        scheduleReconnect();
      }
    }
  }));

  return nextSocket;
}

export function getSocket(businessId: string) {
  return withSession(businessId, () => getRuntime().socket);
}

export function getStatus(businessId: string) {
  return withSession(businessId, () => ({
    ...connectorState,
    businessId,
    hasSocket: Boolean(getRuntime().socket)
  }));
}

export async function getDiagnostics(businessId: string) {
  return withSession(businessId, async () => ({
    ok: true,
    data: {
      businessId,
      whatsappNumber: connectorState.phoneNumber ?? null,
      connectionState: connectorState.status,
      linkedDeviceStatus: await hasAuthSession()
        ? connectorState.status === "connected"
          ? "active"
          : "session_present"
        : "no_session",
      hasSocket: Boolean(getRuntime().socket),
      hasSession: await hasAuthSession(),
      lastSuccessfulSend: connectorState.lastSuccessfulSendAt ?? null,
      lastSuccessfulReceive: connectorState.lastSuccessfulReceiveAt ?? null,
      lastAckError: connectorState.lastAckError ?? null,
      sessionHealth: connectorState.sessionHealth ?? { ok: true },
      connectorVersion,
      baileysVersion,
      nodeVersion: process.version,
      startedAt: connectorState.startedAt,
      lastConnectedAt: connectorState.lastConnectedAt ?? null,
      lastDisconnectedAt: connectorState.lastDisconnectedAt ?? null,
      reconnectAttempts: connectorState.reconnectAttempts
    }
  }));
}

export function recordSuccessfulSend(businessId: string) {
  return withSession(businessId, () => {
    connectorState.lastSuccessfulSendAt = new Date().toISOString();
  });
}

export async function getSession(businessId: string) {
  return withSession(businessId, async () => ({
    ok: true,
    businessId,
    status: toSessionStatus(),
    hasSession: await hasAuthSession(),
    hasSocket: Boolean(getRuntime().socket),
    phone: connectorState.phoneNumber ?? null,
    clientName,
    startedAt: connectorState.startedAt,
    reconnectAttempts: connectorState.reconnectAttempts
  }));
}

export function getQr(businessId: string) {
  return withSession(businessId, () => connectorState.qr ?? null);
}

export async function startSocket(businessId: string, force = false) {
  return withSession(businessId, () => startSocketInternal(force));
}

async function startSocketInternal(force = false) {
  const runtime = getRuntime();
  logger.info(
    {
      businessId: runtime.businessId,
      force,
      hasSocket: Boolean(runtime.socket),
      hasConnecting: Boolean(runtime.connecting),
      hasReconnectTimer: Boolean(runtime.reconnectTimer),
      status: connectorState.status
    },
    "startSocket called"
  );

  if (runtime.socket && !force) {
    logger.info("startSocket returning existing socket");
    return runtime.socket;
  }

  if (runtime.connecting && !force) {
    logger.info("startSocket returning existing connecting promise");
    return runtime.connecting;
  }

  if (force) {
    runtime.socketGeneration += 1;

    if (runtime.reconnectTimer) {
      clearTimeout(runtime.reconnectTimer);
      runtime.reconnectTimer = null;
    }

    try {
      (runtime.socket as { end?: (error?: Error) => void } | null)?.end?.();
    } catch (error) {
      logger.warn({ error }, "Failed to close existing socket");
    }

    runtime.socket = null;
  } else if (!runtime.socket && !runtime.connecting) {
    runtime.socketGeneration += 1;
  }

  connectorState.status = "connecting";
  logger.info("startSocket creating new socket connection");
  const generation = runtime.socketGeneration;
  runtime.connecting = connectSocket(generation).finally(bindCurrentSession(() => {
    logger.info("startSocket connectSocket finished");
    runtime.connecting = null;
  }));

  return runtime.connecting;
}

export async function reconnectSocket(businessId: string) {
  return withSession(businessId, reconnectSocketInternal);
}

async function reconnectSocketInternal() {
  const runtime = getRuntime();
  connectorState.lastError = undefined;
  connectorState.qr = null;
  runtime.lastDisconnectStatusCode = undefined;

  await startSocketInternal(true);

  const firstOutcome = await waitForStatus(["connected", "qr"], 12000);

  if (firstOutcome === "connected" || firstOutcome === "qr") {
    return { ...connectorState, businessId: runtime.businessId, hasSocket: Boolean(runtime.socket) };
  }

  if (runtime.lastDisconnectStatusCode === DisconnectReason.loggedOut) {
    logger.warn("Reconnect detected logged out session. Clearing auth session.");
    await clearAuthSession();
    connectorState.reconnectAttempts = 0;
    connectorState.lastError = undefined;
    connectorState.qr = null;

    await startSocketInternal(true);
    await waitForStatus(["connected", "qr"], 15000);
  }

  return { ...connectorState, businessId: runtime.businessId, hasSocket: Boolean(runtime.socket) };
}

export async function logoutSession(businessId: string) {
  return withSession(businessId, logoutSessionInternal);
}

async function logoutSessionInternal() {
  const runtime = getRuntime();
  if (runtime.reconnectTimer) {
    clearTimeout(runtime.reconnectTimer);
    runtime.reconnectTimer = null;
  }

  runtime.suppressReconnect = true;

  try {
    if (runtime.socket) {
      try {
        await runtime.socket.logout("Session reset requested.");
      } catch (error) {
        logger.warn({ error }, "Failed to logout WhatsApp socket cleanly");
        runtime.socket.end(new Error("Session reset requested."));
      }
    }

    runtime.socket = null;
    runtime.connecting = null;
    connectorState.status = "disconnected";
    connectorState.qr = null;
    connectorState.phoneNumber = undefined;
    connectorState.lastConnectedAt = undefined;
    connectorState.lastDisconnectedAt = new Date().toISOString();
    connectorState.lastError = undefined;
    connectorState.reconnectAttempts = 0;
    rejectQrWaiters(new Error("Session reset requested."));

    await clearAuthSession();
  } finally {
    runtime.suppressReconnect = false;
  }

  await startSocketInternal(true);
  await waitForQr();
}

export function getActiveSessionCount() {
  return sessions.size;
}
