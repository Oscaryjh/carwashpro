export type ExternalDeliveryChannel =
  | "sms" | "whatsapp" | "email" | "payment-export" | "bank-execution" | "statutory-submission";

type Env = Readonly<Record<string, string | undefined>>;

/** Railway Testing is a separate release identity, not NODE_ENV=development. */
export function isTestingDeployment(env: Env = process.env) {
  return env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() === "testing" ||
    env.APP_ENVIRONMENT?.trim().toLowerCase() === "testing";
}

export function requireTestingOutboundProfile(env: Env = process.env) {
  if (env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() !== "testing" ||
      env.APP_ENVIRONMENT?.trim().toLowerCase() !== "testing" ||
      env.TETAMU_TESTING_OUTBOUND_MODE?.trim().toLowerCase() !== "intercept") {
    throw new Error("Testing outbound profile is missing or inconsistent; external delivery is blocked.");
  }
}

/** Invoke at the final transport/file/official-submission boundary, not only in the UI. */
export function assertTestingExternalDeliveryBlocked(
  channel: ExternalDeliveryChannel,
  env: Env = process.env,
) {
  if (isTestingDeployment(env)) {
    throw new Error(`Testing ${channel} external delivery is blocked.`);
  }
}
