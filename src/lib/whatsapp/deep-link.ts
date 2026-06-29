import {
  generateWhatsAppLink,
  normalizeMalaysiaWhatsAppPhone,
} from "@/lib/whatsappDeepLink";

export function createWhatsAppDeepLink(phone: string, message: string) {
  return generateWhatsAppLink(phone, message);
}

export const normalizeWhatsAppPhone = normalizeMalaysiaWhatsAppPhone;
