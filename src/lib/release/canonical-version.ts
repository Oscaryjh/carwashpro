type Env = Readonly<Record<string, string | undefined>>;

export function readCanonicalVersion(env: Env = {
  APP_BUILD_SHA: process.env.APP_BUILD_SHA,
  APP_BUILD_TIME: process.env.APP_BUILD_TIME,
  APP_ENVIRONMENT: process.env.APP_ENVIRONMENT,
  RAILWAY_ENVIRONMENT_NAME: process.env.RAILWAY_ENVIRONMENT_NAME,
  RAILWAY_GIT_COMMIT_SHA: process.env.RAILWAY_GIT_COMMIT_SHA,
}) {
  const commitSha = env.APP_BUILD_SHA?.trim() ?? "";
  const buildTime = env.APP_BUILD_TIME?.trim() ?? "";
  const environment = env.APP_ENVIRONMENT?.trim().toLowerCase() ?? "";
  const railwayEnvironment = env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() ?? "";
  const sourceSha = env.RAILWAY_GIT_COMMIT_SHA?.trim() ?? "";
  const ready = /^[a-f0-9]{40}$/i.test(commitSha) &&
    /^[a-f0-9]{40}$/i.test(sourceSha) && commitSha.toLowerCase() === sourceSha.toLowerCase() &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(buildTime) &&
    !Number.isNaN(Date.parse(buildTime)) &&
    environment === "testing" && railwayEnvironment === "testing";
  return { commitSha, buildTime, environment, migrationBaseline: 222 as const, ready };
}
