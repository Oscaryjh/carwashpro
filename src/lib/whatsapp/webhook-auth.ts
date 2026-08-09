import { timingSafeEqual } from "node:crypto";

export type WhatsAppWebhookAuthorization =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; status: 401 | 503; error: string }>;

export function authorizeWhatsAppWebhook(
  headers: Pick<Headers, "get">,
  configuredSecret = process.env.WHATSAPP_WEBHOOK_SECRET,
): WhatsAppWebhookAuthorization {
  const expectedSecret = configuredSecret?.trim();
  if (!expectedSecret) {
    return {
      ok: false,
      status: 503,
      error: "WhatsApp webhook authentication is not configured.",
    };
  }

  const suppliedSecret = headers.get("x-whatsapp-webhook-secret") ?? "";
  const expectedBytes = Buffer.from(expectedSecret);
  const suppliedBytes = Buffer.from(suppliedSecret);
  const matches =
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes);

  return matches
    ? { ok: true }
    : { ok: false, status: 401, error: "Unauthorized" };
}
