// @ts-check

/** @typedef {"development" | "testing" | "uat-preview" | "production"} RuntimeEnvironment */
/** @typedef {Readonly<Record<string, string | undefined>>} RuntimeEnvironmentMap */

/**
 * Parse the application business environment without silently downgrading an
 * unknown deployed value to development.
 *
 * @param {RuntimeEnvironmentMap} env
 * @returns {RuntimeEnvironment}
 */
export function parseRuntimeEnvironment(env = process.env) {
  const explicit = normalize(env.APP_ENVIRONMENT);
  const railway = normalize(env.RAILWAY_ENVIRONMENT_NAME);
  const node = normalize(env.NODE_ENV);
  const canonicalNames = new Set(["development", "test", "testing", "uat-preview", "production"]);
  if (explicit && canonicalNames.has(railway) && explicit !== railway && !(new Set(["test", "testing"]).has(explicit) && new Set(["test", "testing"]).has(railway))) {
    throw new Error("RUNTIME_ENVIRONMENT_CONFLICT");
  }
  const deployed = Boolean(
    normalize(env.RAILWAY_DEPLOYMENT_ID) ||
      normalize(env.RAILWAY_PROJECT_ID) ||
      normalize(env.RAILWAY_SERVICE_ID),
  );

  if (deployed && !explicit && !railway) {
    throw new Error("RUNTIME_ENVIRONMENT_REQUIRED_FOR_DEPLOYED_BUILD");
  }

  const selected = explicit || railway || node || "development";
  if (selected === "development") return "development";
  if (selected === "test" || selected === "testing") return "testing";
  if (selected === "uat-preview") return "uat-preview";
  if (selected === "production") return "production";
  throw new Error("UNKNOWN_RUNTIME_ENVIRONMENT");
}

/**
 * @param {RuntimeEnvironment} environment
 */
export function isProductionGradeEnvironment(environment) {
  return environment === "production" || environment === "uat-preview";
}

/** @param {string | undefined} value */
function normalize(value) {
  return value?.trim().toLowerCase() ?? "";
}
