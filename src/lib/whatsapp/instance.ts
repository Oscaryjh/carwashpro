export const DEFAULT_WHATSAPP_INSTANCE_ID = "default";

export function normalizeWhatsAppInstanceId(value: string | null | undefined) {
  const normalized = value?.replace(/\D/g, "").trim();

  return normalized || DEFAULT_WHATSAPP_INSTANCE_ID;
}

export function getDefaultWhatsAppInstanceId() {
  return normalizeWhatsAppInstanceId(
    process.env.WHATSAPP_INSTANCE_ID ?? process.env.WHATSAPP_PHONE_NUMBER,
  );
}
