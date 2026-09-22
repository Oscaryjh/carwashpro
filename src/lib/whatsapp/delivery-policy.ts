export const PRODUCTION_RAILWAY_ENVIRONMENT_ID =
  "bef43b86-32dc-486e-a1ef-bb9f9699e4f5";

type DeliveryEnvironment = Record<string, string | undefined>;

export class WhatsAppDeliveryPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppDeliveryPolicyError";
  }
}

export function assertWhatsAppLiveDeliveryAllowed(
  env: DeliveryEnvironment = process.env,
) {
  if (
    env.WHATSAPP_SEND_MODE?.trim() !== "live" ||
    env.APP_ENVIRONMENT?.trim().toLowerCase() !== "production" ||
    env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() !== "production" ||
    env.RAILWAY_ENVIRONMENT_ID?.trim() !== PRODUCTION_RAILWAY_ENVIRONMENT_ID
  ) {
    throw new WhatsAppDeliveryPolicyError(
      "Live WhatsApp delivery requires the source-pinned Production identity.",
    );
  }
}

