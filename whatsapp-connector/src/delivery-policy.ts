export const PRODUCTION_RAILWAY_ENVIRONMENT_ID =
  "bef43b86-32dc-486e-a1ef-bb9f9699e4f5";

type DeliveryEnvironment = Record<string, string | undefined>;

export function isConnectorLiveDeliveryAllowed(
  env: DeliveryEnvironment = process.env,
) {
  return (
    env.WHATSAPP_SEND_MODE?.trim() === "live" &&
    env.APP_ENVIRONMENT?.trim().toLowerCase() === "production" &&
    env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() === "production" &&
    env.RAILWAY_ENVIRONMENT_ID?.trim() === PRODUCTION_RAILWAY_ENVIRONMENT_ID
  );
}

export function assertConnectorLiveDeliveryAllowed(
  env: DeliveryEnvironment = process.env,
) {
  if (!isConnectorLiveDeliveryAllowed(env)) {
    throw new Error("CONNECTOR_LIVE_DELIVERY_DENIED");
  }
}
