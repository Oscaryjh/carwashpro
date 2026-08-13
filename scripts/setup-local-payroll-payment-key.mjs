import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const packagePath = resolve(root, "package.json");
const envPath = resolve(root, ".env.local");
if (!existsSync(packagePath)) {
  throw new Error("Run this helper from the canonical Tetamu workspace.");
}
const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const names = [
  "PAYROLL_PAYMENT_ACTIVE_KEY_VERSION",
  "PAYROLL_PAYMENT_ENCRYPTION_KEYS",
  "PAYROLL_PAYMENT_FINGERPRINT_KEY",
];
const present = names.map((name) => new RegExp(`^${name}=`, "m").test(existing));
if (present.some(Boolean) && !present.every(Boolean)) {
  throw new Error("Incomplete Local payroll payment keyring configuration already exists in .env.local.");
}
if (present.every(Boolean)) {
  console.log("Local payroll payment keyring is already configured.");
  process.exit(0);
}
const version = "local-payment-v1";
const encryptionKey = randomBytes(32).toString("base64");
const fingerprintKey = randomBytes(32).toString("hex");
const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
const addition = [
  "# Local-only Payroll payment encryption. Never commit .env.local.",
  `PAYROLL_PAYMENT_ACTIVE_KEY_VERSION=${version}`,
  `PAYROLL_PAYMENT_ENCRYPTION_KEYS='${JSON.stringify({ [version]: encryptionKey })}'`,
  `PAYROLL_PAYMENT_FINGERPRINT_KEY=${fingerprintKey}`,
  "",
].join("\n");
writeFileSync(envPath, `${existing}${separator}${addition}`, {
  encoding: "utf8",
  mode: 0o600,
});
console.log("Configured a Local-only Payroll payment AES-256-GCM keyring and HMAC key.");
