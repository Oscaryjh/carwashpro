import { getStatus, startSocket } from "./socket.js";

export class WhatsAppNotConnectedError extends Error {
  code = "WHATSAPP_NOT_CONNECTED";

  constructor() {
    super("WhatsApp is not connected. Check /status or reconnect.");
  }
}

export class WhatsAppSendFailedError extends Error {
  code = "WHATSAPP_SEND_FAILED";

  constructor(message: string) {
    super(message);
  }
}

export function normalizePhoneToJid(phone: string) {
  const digits = phone.replace(/\D/g, "");

  if (!digits) {
    throw new Error("phone is required.");
  }

  let normalizedPhone = digits;

  if (normalizedPhone.startsWith("0")) {
    normalizedPhone = `60${normalizedPhone.slice(1)}`;
  } else if (!normalizedPhone.startsWith("60")) {
    normalizedPhone = `60${normalizedPhone}`;
  }

  return `${normalizedPhone}@s.whatsapp.net`;
}

export async function sendTextMessage(phone: string, message: string) {
  const trimmedMessage = message.trim();

  if (!trimmedMessage) {
    throw new Error("message is required.");
  }

  const whatsappJid = normalizePhoneToJid(phone);
  const socket = await startSocket();
  const status = getStatus();

  if (status.status !== "connected") {
    throw new WhatsAppNotConnectedError();
  }

  try {
    const result = await socket.sendMessage(whatsappJid, {
      text: trimmedMessage
    });

    return {
      messageId: result?.key?.id ?? null,
      to: whatsappJid
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send WhatsApp message.";
    throw new WhatsAppSendFailedError(message);
  }
}
