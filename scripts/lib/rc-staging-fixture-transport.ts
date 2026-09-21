import { createHash } from "node:crypto";

export function validateStagingKeyrings(runtime: Record<string, string>, denied: string[]): string[] {
  try {
    const hashes: string[] = [];
    for (const prefix of ["MFA", "PAYROLL_PAYMENT"]) {
      const version = runtime[`${prefix}_ACTIVE_KEY_VERSION`];
      const ring = JSON.parse(runtime[`${prefix}_ENCRYPTION_KEYS`]);
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(version) || !ring || typeof ring !== "object" || Array.isArray(ring) || Object.keys(ring).length !== 1) throw new Error();
      const encoded = ring[version];
      if (typeof encoded !== "string") throw new Error();
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.length !== 32 || bytes.toString("base64") !== encoded) throw new Error();
      const decodedHash = createHash("sha256").update(bytes).digest("hex");
      const encodedHash = createHash("sha256").update(encoded).digest("hex");
      if (denied.includes(decodedHash) || denied.includes(encodedHash) || hashes.includes(decodedHash)) throw new Error();
      hashes.push(decodedHash);
    }
    return hashes;
  } catch { throw new Error("RC_STAGING_FIXTURE_KEYRING_REJECTED"); }
}

const STAGING_SECRET_KEYS = ["SESSION_SECRET", "EMPLOYEE_AUTH_SECRET", "MFA_ACTIVE_KEY_VERSION", "MFA_ENCRYPTION_KEYS", "PAYROLL_PAYMENT_ACTIVE_KEY_VERSION", "PAYROLL_PAYMENT_ENCRYPTION_KEYS", "PAYROLL_PAYMENT_FINGERPRINT_KEY", "RC_STAGING_OTP_HMAC_SEED", "OPS_ALERT_WEBHOOK_BEARER_TOKEN"];
export function validateStagingRuntimeSecrets(value: unknown): asserts value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).length !== STAGING_SECRET_KEYS.length ||
    !Object.entries(value).every(([key, secret]) => STAGING_SECRET_KEYS.includes(key) && typeof secret === "string" && secret.length > 0))
    throw new Error("RC_STAGING_FIXTURE_RUNTIME_REJECTED");
}

export function verifyStagingDatabaseTransport(internal: string, external: string, proxy: { domain: string; port: string }): string {
  try {
    const a = new URL(internal), b = new URL(external);
    if (![a, b].every(u => ["postgresql:", "postgres:"].includes(u.protocol) && u.username && u.password && u.pathname.length > 1 && !u.search && !u.hash) ||
      !proxy.domain || !/^\d+$/.test(proxy.port) || b.hostname !== proxy.domain || b.port !== proxy.port ||
      ["pathname", "username", "password"].some(key => decodeURIComponent(a[key as "pathname"]) !== decodeURIComponent(b[key as "pathname"]))) throw new Error();
    b.searchParams.set("sslmode", "require");
    return b.href;
  } catch { throw new Error("RC_STAGING_FIXTURE_TRANSPORT_REJECTED"); }
}
