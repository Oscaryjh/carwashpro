export function normalizeMalaysiaWhatsAppPhone(phone: string) {
  const digits = phone.replace(/[^\d]/g, "");

  if (!digits) {
    return "";
  }

  if (digits.startsWith("60")) {
    return digits;
  }

  if (digits.startsWith("0")) {
    return `6${digits}`;
  }

  if (digits.startsWith("1")) {
    return `60${digits}`;
  }

  return digits;
}

export function normalizeValidWhatsAppPhone(phone: string) {
  const normalized = normalizeMalaysiaWhatsAppPhone(phone);
  return /^\d{8,15}$/.test(normalized) ? normalized : null;
}

export function assertValidWhatsAppPhone(phone: string) {
  const normalized = normalizeValidWhatsAppPhone(phone);
  if (!normalized) {
    throw new Error("Enter a valid WhatsApp phone number.");
  }
  return normalized;
}

export function normalizeWhatsAppQueueRecipient(value: string) {
  const trimmed = value.trim();
  if (/^[A-Za-z0-9._:-]{5,80}@(lid|s\.whatsapp\.net)$/.test(trimmed)) {
    return trimmed;
  }
  return normalizeValidWhatsAppPhone(trimmed);
}

export function generateWhatsAppLink(recipientPhone: string, message: string) {
  const normalizedPhone = normalizeMalaysiaWhatsAppPhone(recipientPhone);

  if (!normalizedPhone) {
    throw new Error("Recipient WhatsApp number is required.");
  }

  return `https://web.whatsapp.com/send?phone=${normalizedPhone}&text=${encodeURIComponent(
    message,
  )}`;
}

export function generateWhatsAppAppLink(recipientPhone: string, message: string) {
  const normalizedPhone = normalizeMalaysiaWhatsAppPhone(recipientPhone);

  if (!normalizedPhone) {
    throw new Error("Recipient WhatsApp number is required.");
  }

  return `whatsapp://send?phone=${normalizedPhone}&text=${encodeURIComponent(
    message,
  )}`;
}
