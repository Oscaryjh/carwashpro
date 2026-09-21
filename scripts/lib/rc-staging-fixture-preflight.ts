import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, statSync, realpathSync, existsSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { STAGING_FIXTURE_TARGET as target, assertStagingFixtureIdentity } from "./rc-staging-fixture-contract";
import { verifyStagingDatabaseTransport, validateStagingRuntimeSecrets, validateStagingKeyrings } from "./rc-staging-fixture-transport";
import { databaseIdentityFingerprint } from "../../src/lib/release/production-contract.mjs";

const root = resolve(import.meta.dirname, "../..");
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const deny = (ok: unknown, code: string) => { if (!ok) throw new Error(code); };
const argument = (key: string) => { const i = process.argv.indexOf(key); return i > 0 ? process.argv[i + 1] : undefined; };
type DeniedIdentity = { environmentId: string; serviceIds: string[]; databaseNames: string[]; databaseFingerprints: string[]; secretFingerprints: string[] };
type Secrets = { password: string; runtime: Record<string, string>; mfa?: Record<string, string> };

function securePath(path: string, mustExist = true) {
  const actual = mustExist ? realpathSync(path) : resolve(realpathSync(dirname(path)), path.split(sep).at(-1)!);
  deny(!actual.startsWith(root + sep), "SECURE_FILE_MUST_BE_OUTSIDE_WORKTREE");
  if (mustExist) deny(statSync(actual).isFile() && (statSync(actual).mode & 0o777) === 0o600, "SECURE_FILE_MODE_REQUIRED");
  return actual;
}

export async function prepareStagingFixtureConnection() {
  deny(process.env.APP_ENVIRONMENT === "production" && process.env.NODE_ENV === "production", "PRODUCTION_SECURITY_PROFILE_REQUIRED");
  const inventoryFile = argument("--inventory-file"), secretsPath = argument("--secrets-file");
  deny(inventoryFile && secretsPath, "SECURE_FILE_ARGUMENTS_REQUIRED");
  const inventoryBytes = readFileSync(securePath(inventoryFile!));
  deny(hash(inventoryBytes) === target.inventoryDigest, "PROTECTED_INVENTORY_DIGEST_MISMATCH");
  const inventory = JSON.parse(inventoryBytes.toString()) as { complete: boolean; projectId: string; protected: Record<string, DeniedIdentity> };
  deny(inventory.complete === true && inventory.projectId === target.projectId, "PROTECTED_INVENTORY_INCOMPLETE");
  const protectedIdentities = Object.values(inventory.protected);
  deny(protectedIdentities.length === 3, "PROTECTED_INVENTORY_INCOMPLETE");

  // An administrative run uses the committed checkout, not forged Railway
  // deployment variables or a dirty build masquerading as an application.
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
  deny(!git("status", "--porcelain", "--untracked-files=all").toString().trim(), "DIRTY_SOURCE_REJECTED");
  const attestation = JSON.parse(readFileSync(resolve(root, ".release/source-attestation.json"), "utf8"));
  deny(attestation.commitSha === git("rev-parse", "HEAD").toString().trim() && attestation.tree === git("rev-parse", "HEAD^{tree}").toString().trim() &&
    attestation.sourceDigest === hash(git("archive", "--format=tar", "HEAD")) && attestation.lockfileHash === hash(readFileSync(resolve(root, "package-lock.json"))), "SOURCE_ATTESTATION_REJECTED");

  const railway = JSON.parse(readFileSync(resolve(process.env.HOME!, ".railway/config.json"), "utf8"));
  const token = railway.user?.accessToken ?? railway.user?.token;
  deny(typeof token === "string" && token.length > 10, "RAILWAY_AUTH_REQUIRED");
  async function query<T>(query: string, variables: Record<string, string>): Promise<T> {
    deny(/^query\b/.test(query.trim()), "READ_ONLY_METADATA_REQUIRED");
    const response = await fetch("https://backboard.railway.com/graphql/v2", { method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ query, variables }) });
    deny(response.ok, "RAILWAY_METADATA_HTTP_FAILURE");
    const body = await response.json();
    deny(!body.errors && body.data, "RAILWAY_METADATA_QUERY_FAILURE");
    return body.data;
  }
  type Edges<T> = { pageInfo: { hasNextPage: boolean }; edges: { node: T }[] };
  type Instance = { serviceId: string; environmentId: string };
  type Environment = { id: string; name: string; projectId: string; sourceEnvironment: unknown; config: { services: Record<string, { deploy: { multiRegionConfig: Record<string, { numReplicas: number }> } }> }; serviceInstances: Edges<Instance>; volumeInstances: Edges<{ volumeId: string; serviceId: string; environmentId: string; region: string }> };
  const meta = await query<{ project: { id: string; environments: Edges<{ id: string; serviceInstances: Edges<Instance> }> }; environment: Environment; variables: Record<string, string> }>(
    "query StagingFixturePreflight($p:String!,$e:String!,$s:String!){project(id:$p){id environments(first:100){pageInfo{hasNextPage} edges{node{id serviceInstances(first:100){pageInfo{hasNextPage} edges{node{serviceId environmentId}}}}}}} environment(id:$e,projectId:$p){id name projectId sourceEnvironment{id} config(decryptVariables:false) serviceInstances(first:100){pageInfo{hasNextPage} edges{node{serviceId environmentId}}} volumeInstances(first:100){pageInfo{hasNextPage} edges{node{volumeId serviceId environmentId region}}}} variables(projectId:$p,environmentId:$e,serviceId:$s,unrendered:false)}",
    { p: target.projectId, e: target.environmentId, s: target.databaseServiceId });
  const env = meta.environment, variables = meta.variables;
  deny(!meta.project.environments.pageInfo.hasNextPage && !env.serviceInstances.pageInfo.hasNextPage && !env.volumeInstances.pageInfo.hasNextPage && !env.sourceEnvironment, "METADATA_INCOMPLETE");
  for (const saved of protectedIdentities) {
    const actual = meta.project.environments.edges.find(e => e.node.id === saved.environmentId)?.node;
    deny(actual && !actual.serviceInstances.pageInfo.hasNextPage && JSON.stringify(actual.serviceInstances.edges.map(e => e.node.serviceId).sort()) === JSON.stringify([...saved.serviceIds].sort()), "PROTECTED_INVENTORY_DRIFT");
  }
  deny(env.serviceInstances.edges.some(e => e.node.serviceId === target.serviceId && e.node.environmentId === env.id) && env.serviceInstances.edges.some(e => e.node.serviceId === target.databaseServiceId && e.node.environmentId === env.id), "SERVICE_IDENTITY_MISMATCH");
  const volume = env.volumeInstances.edges.find(e => e.node.volumeId === target.volumeId)?.node;
  deny(volume?.serviceId === target.databaseServiceId && volume.environmentId === env.id, "VOLUME_IDENTITY_MISMATCH");
  const region = env.config.services[target.databaseServiceId]?.deploy.multiRegionConfig;
  deny(region && Object.keys(region).length === 1 && region[target.region]?.numReplicas === 1, "DATABASE_REGION_MISMATCH");
  const fingerprint = databaseIdentityFingerprint({ DATABASE_URL: variables.DATABASE_URL, RAILWAY_DATABASE_SERVICE_ID: target.databaseServiceId });
  const internal = new URL(variables.DATABASE_URL);
  const publicUrl = verifyStagingDatabaseTransport(variables.DATABASE_URL, variables.DATABASE_PUBLIC_URL, { domain: variables.RAILWAY_TCP_PROXY_DOMAIN, port: variables.RAILWAY_TCP_PROXY_PORT });
  const dbName = decodeURIComponent(internal.pathname.slice(1));
  const proof = { ...target, projectId: meta.project.id === env.projectId ? env.projectId : "", environmentId: env.id, environmentName: env.name,
    volumeRegion: volume!.region, databaseFingerprint: fingerprint, protectedCollision: protectedIdentities.some(p => p.environmentId === env.id || p.serviceIds.includes(target.databaseServiceId) || p.serviceIds.includes(target.serviceId) || p.databaseNames.includes(dbName) || p.databaseFingerprints.includes(fingerprint)),
    appEnvironment: process.env.APP_ENVIRONMENT, nodeEnvironment: process.env.NODE_ENV };
  assertStagingFixtureIdentity(proof);

  const secretsFile = securePath(secretsPath!, existsSync(secretsPath!));
  if (!existsSync(secretsFile)) {
    deny(!process.argv.includes("--verify"), "RC_STAGING_FIXTURE_CREDENTIALS_REQUIRED");
    const random = () => randomBytes(48).toString("base64url");
    const secrets: Secrets = { password: random(), runtime: { SESSION_SECRET: random(), EMPLOYEE_AUTH_SECRET: random(),
      MFA_ACTIVE_KEY_VERSION: "rc-staging-v1", MFA_ENCRYPTION_KEYS: JSON.stringify({ "rc-staging-v1": randomBytes(32).toString("base64") }),
      PAYROLL_PAYMENT_ACTIVE_KEY_VERSION: "rc-staging-v1", PAYROLL_PAYMENT_ENCRYPTION_KEYS: JSON.stringify({ "rc-staging-v1": randomBytes(32).toString("base64") }),
      PAYROLL_PAYMENT_FINGERPRINT_KEY: random(), RC_STAGING_OTP_HMAC_SEED: random(), OPS_ALERT_WEBHOOK_BEARER_TOKEN: random() } };
    writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600, flag: "wx" });
  }
  const secrets = JSON.parse(readFileSync(securePath(secretsFile), "utf8")) as Secrets;
  validateStagingRuntimeSecrets(secrets.runtime);
  deny(typeof secrets.password === "string" && secrets.password.length >= 32, "FIXTURE_PASSWORD_REQUIRED");
  const deniedSecrets = protectedIdentities.flatMap(p => p.secretFingerprints);
  const decodedFingerprints = validateStagingKeyrings(secrets.runtime, deniedSecrets);
  const rawSecrets = [secrets.password, decodeURIComponent(internal.password), ...["SESSION_SECRET", "EMPLOYEE_AUTH_SECRET", "PAYROLL_PAYMENT_FINGERPRINT_KEY", "RC_STAGING_OTP_HMAC_SEED", "OPS_ALERT_WEBHOOK_BEARER_TOKEN"].map(key => secrets.runtime[key])];
  for (const prefix of ["MFA", "PAYROLL_PAYMENT"]) {
    const keys = JSON.parse(secrets.runtime[`${prefix}_ENCRYPTION_KEYS`]);
    const encoded = keys[secrets.runtime[`${prefix}_ACTIVE_KEY_VERSION`]];
    deny(typeof encoded === "string" && Buffer.from(encoded, "base64").length === 32 && !deniedSecrets.includes(hash(Buffer.from(encoded, "base64"))), "FIXTURE_ENCRYPTION_KEY_REJECTED");
    rawSecrets.push(encoded);
  }
  deny(rawSecrets.every(s => typeof s === "string" && s.length >= 32 && !deniedSecrets.includes(hash(s))) && new Set([...rawSecrets.map(hash), ...decodedFingerprints]).size === rawSecrets.length + decodedFingerprints.length, "SECRET_REUSE_OR_INCOMPLETE");
  const childEnv: Record<string, string> = { PATH: process.env.PATH!, HOME: process.env.HOME!, NODE_ENV: "production", APP_ENVIRONMENT: "production", APP_DEPLOYMENT_PROFILE: "rc-staging", DATABASE_URL: publicUrl,
    TETAMU_MFA_ENABLED: "true", AI_GLOBAL_ENABLED: "false", WHATSAPP_SEND_MODE: "disabled", EMAIL_SEND_MODE: "disabled", ...secrets.runtime, RC_STAGING_FIXTURE_SECRET_FILE: secretsFile };
  for (const key of ["PAYMENT_EXECUTION_ENABLED", "BANK_PAYMENT_EXECUTION_ENABLED", "PAYMENT_EXPORT_ENABLED", "GOVERNMENT_SUBMISSION_ENABLED", "PCB_PRODUCTION_ENABLED", "OFFICIAL_EXPORT_ELIGIBLE", "PRODUCTION_ELIGIBLE"]) childEnv[key] = "false";
  return { environment: childEnv, password: secrets.password, verifyOnly: process.argv.includes("--verify"), databaseName: dbName, databaseUser: decodeURIComponent(internal.username) };
}
