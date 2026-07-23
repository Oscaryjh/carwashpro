import { normalizeMalaysiaWhatsAppPhone } from "@/lib/whatsappDeepLink";

const MIN_PHONE_LENGTH = 8;
const MAX_PHONE_LENGTH = 15;

export function normalizeClosingWhatsAppPhone(value: string) {
  const normalized = normalizeMalaysiaWhatsAppPhone(value);

  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  if (
    normalized.length < MIN_PHONE_LENGTH ||
    normalized.length > MAX_PHONE_LENGTH
  ) {
    return null;
  }

  return normalized;
}

export function assertClosingWhatsAppPhone(value: string) {
  const normalized = normalizeClosingWhatsAppPhone(value);

  if (!normalized) {
    throw new Error("Enter a valid WhatsApp phone number.");
  }

  return normalized;
}
