export type RuntimeEnvironment = "development" | "testing" | "production";
export type RuntimeEnvironmentMap = Readonly<Record<string, string | undefined>>;

export function runtimeEnvironment(env: RuntimeEnvironmentMap = process.env): RuntimeEnvironment {
  const explicit = env.APP_ENVIRONMENT?.trim().toLowerCase();
  const railway = env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase();
  const value = explicit || railway || env.NODE_ENV?.trim().toLowerCase();

  if (value === "production") return "production";
  if (value === "testing" || value === "test") return "testing";
  return "development";
}

export function isProductionRuntime(env: RuntimeEnvironmentMap = process.env) {
  return runtimeEnvironment(env) === "production";
}

export function assertLocalDatabaseTarget(databaseUrl: string | undefined, purpose: string) {
  if (!databaseUrl) throw new Error(`${purpose} requires DATABASE_URL.`);

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error(`${purpose} requires a valid DATABASE_URL.`);
  }

  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname)) {
    throw new Error(`${purpose} is restricted to a Local database.`);
  }
}

export function releaseIdentity(env: RuntimeEnvironmentMap = process.env) {
  return {
    commitSha: env.APP_RELEASE_SHA?.trim() || env.RAILWAY_GIT_COMMIT_SHA?.trim() || "UNSET",
    deploymentId: env.RAILWAY_DEPLOYMENT_ID?.trim() || null,
    environment: runtimeEnvironment(env),
    sourceDigest: env.APP_RELEASE_SOURCE_DIGEST?.trim() || null,
    version: env.npm_package_version?.trim() || "0.1.0",
  };
}
