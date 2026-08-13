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
const hasVersion = /^MFA_ACTIVE_KEY_VERSION=/m.test(existing);
const hasKeyring = /^MFA_ENCRYPTION_KEYS=/m.test(existing);
if (hasVersion !== hasKeyring) {
  throw new Error("Incomplete MFA keyring configuration already exists in .env.local.");
}
if (hasVersion && hasKeyring) {
  console.log("Local MFA keyring is already configured.");
  process.exit(0);
}
const version = "local-v1";
const key = randomBytes(32).toString("base64");
const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
const addition = [
  "# Local-only TOTP secret encryption. Never commit .env.local.",
  `MFA_ACTIVE_KEY_VERSION=${version}`,
  `MFA_ENCRYPTION_KEYS='${JSON.stringify({ [version]: key })}'`,
  "",
].join("\n");
writeFileSync(envPath, `${existing}${separator}${addition}`, {
  encoding: "utf8",
  mode: 0o600,
});
console.log("Configured a local-only MFA AES-256-GCM keyring in ignored .env.local.");
