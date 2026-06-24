export function normalizeWhatsAppPhone(phone: string) {
  return phone.replace(/[^\d]/g, "");
}

export function createWhatsAppDeepLink(phone: string, message: string) {
  const normalizedPhone = normalizeWhatsAppPhone(phone);
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
}
