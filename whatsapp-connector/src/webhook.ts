import { logger } from "./logger.js";

const defaultIncomingWebhookUrl =
  "http://127.0.0.1:3000/api/whatsapp/incoming";
const defaultReceiptWebhookUrl =
  "http://127.0.0.1:3000/api/whatsapp/receipt";
const defaultHistoryWebhookUrl =
  "http://127.0.0.1:3000/api/whatsapp/history";

export type IncomingMessageWebhookPayload = {
  businessId?: string | null;
  instanceId: string;
  body: string;
  direction?: "INBOUND" | "OUTBOUND";
  from: string;
  messageId: string;
  messageType: "audio" | "image" | "text";
  mediaBase64?: string | null;
  mediaFileName?: string | null;
  mediaMimeType?: string | null;
  pushName?: string | null;
  remoteJid: string;
  rawMessageJson?: unknown;
  timestamp?: string | null;
};

export type DeliveryReceiptWebhookPayload = {
  instanceId?: string | null;
  messageId: string;
  remoteJid?: string | null;
  status: "DELIVERED" | "READ" | "FAILED";
  errorMessage?: string | null;
  timestamp?: string | null;
};

export type HistorySyncWebhookPayload = {
  businessId?: string | null;
  instanceId: string;
  syncType?: string | null;
  contacts: unknown[];
  chats: unknown[];
  messages: unknown[];
};

export async function postIncomingMessageWebhook(
  payload: IncomingMessageWebhookPayload
) {
  const webhookUrl =
    process.env.WASHFLOW_INCOMING_WEBHOOK_URL?.trim() ??
    process.env.WASHFLOW_WEBHOOK_URL?.trim() ??
    defaultIncomingWebhookUrl;

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET?.trim();

  if (secret) {
    headers["x-whatsapp-webhook-secret"] = secret;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Incoming webhook failed with HTTP ${response.status}: ${responseText}`
    );
  }

  logger.info(
    {
      messageId: payload.messageId,
      from: payload.from,
      status: response.status
    },
    "Incoming WhatsApp message forwarded"
  );
}

export async function postDeliveryReceiptWebhook(
  payload: DeliveryReceiptWebhookPayload
) {
  const webhookUrl =
    process.env.WASHFLOW_RECEIPT_WEBHOOK_URL?.trim() ??
    defaultReceiptWebhookUrl;

  const response = await postWebhook(webhookUrl, payload);

  logger.info(
    {
      messageId: payload.messageId,
      remoteJid: payload.remoteJid,
      status: payload.status,
      errorMessage: payload.errorMessage,
      httpStatus: response.status
    },
    "WhatsApp receipt forwarded"
  );
}

export async function postHistorySyncWebhook(payload: HistorySyncWebhookPayload) {
  const webhookUrl =
    process.env.WASHFLOW_HISTORY_WEBHOOK_URL?.trim() ??
    defaultHistoryWebhookUrl;
  const response = await postWebhook(webhookUrl, payload);

  logger.info(
    {
      instanceId: payload.instanceId,
      syncType: payload.syncType,
      contacts: payload.contacts.length,
      chats: payload.chats.length,
      messages: payload.messages.length,
      httpStatus: response.status
    },
    "WhatsApp history sync forwarded"
  );
}

async function postWebhook(webhookUrl: string, payload: unknown) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET?.trim();

  if (secret) {
    headers["x-whatsapp-webhook-secret"] = secret;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Webhook ${webhookUrl} failed with HTTP ${response.status}: ${responseText}`
    );
  }

  return response;
}
