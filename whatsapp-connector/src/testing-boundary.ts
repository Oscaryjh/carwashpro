type Env = Readonly<Record<string, string | undefined>>;

function isTesting(env: Env) {
  return env.APP_ENVIRONMENT?.trim().toLowerCase() === "testing" ||
    env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() === "testing";
}

export function assertConnectorReleaseProfile(env: Env = process.env) {
  if (!isTesting(env)) return;
  if (env.APP_ENVIRONMENT?.trim().toLowerCase() !== "testing" ||
      env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() !== "testing" ||
      env.TETAMU_TESTING_OUTBOUND_MODE?.trim().toLowerCase() !== "intercept" ||
      env.WHATSAPP_SEND_MODE?.trim().toLowerCase() !== "mock" ||
      !/^[a-f0-9]{40}$/i.test(env.RAILWAY_GIT_COMMIT_SHA?.trim() ?? "")) {
    throw new Error("Testing WhatsApp connector requires the Git-source intercept profile.");
  }
}

/** Final provider boundary: no Testing request may open a socket or send. */
export function assertWhatsAppProviderAvailable(env: Env = process.env) {
  if (isTesting(env)) throw new Error("Testing WhatsApp provider access is blocked.");
}
