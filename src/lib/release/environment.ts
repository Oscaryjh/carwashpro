import {
  isProductionGradeEnvironment,
  parseRuntimeEnvironment,
} from "./environment-contract.mjs";
import type {
  RuntimeEnvironment,
  RuntimeEnvironmentMap,
} from "./environment-contract.mjs";
import { validateProductionRuntime, type SourceAttestation } from "./production-contract.mjs";
import { readSourceAttestation } from "./source-attestation.mjs";

export type { RuntimeEnvironment, RuntimeEnvironmentMap } from "./environment-contract.mjs";

export function runtimeEnvironment(env: RuntimeEnvironmentMap = process.env): RuntimeEnvironment {
  return parseRuntimeEnvironment(env);
}

export function isProductionRuntime(env: RuntimeEnvironmentMap = process.env) {
  return runtimeEnvironment(env) === "production";
}

export function isProductionGradeRuntime(
  env: RuntimeEnvironmentMap = process.env,
) {
  return isProductionGradeEnvironment(runtimeEnvironment(env));
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

export function releaseIdentity(env: RuntimeEnvironmentMap = process.env, attestation?: SourceAttestation | null) {
  const environment = runtimeEnvironment(env);
  const productionIdentity = environment === "production"
    ? validateProductionRuntime(env, env.APP_SERVICE_SCOPE ?? "web", attestation === undefined ? readSourceAttestation() : attestation)
    : null;
  return {
    commitSha: productionIdentity?.commitSha || env.RAILWAY_GIT_COMMIT_SHA?.trim() || env.APP_RELEASE_SHA?.trim() || "UNSET",
    tree: productionIdentity?.tree || env.APP_RELEASE_TREE?.trim() || null,
    deploymentId: env.RAILWAY_DEPLOYMENT_ID?.trim() || null,
    environment,
    sourceDigest: productionIdentity?.sourceDigest || env.APP_RELEASE_SOURCE_DIGEST?.trim() || null,
    version: env.npm_package_version?.trim() || "0.1.0",
  };
}
