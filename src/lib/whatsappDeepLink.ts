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

export function generateWhatsAppLink(recipientPhone: string, message: string) {
  const normalizedPhone = normalizeMalaysiaWhatsAppPhone(recipientPhone);

  if (!normalizedPhone) {
    throw new Error("Recipient WhatsApp number is required.");
  }

  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
}
