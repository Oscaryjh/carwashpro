import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("MFA recovery hashing completes before the serializable enrollment transaction", async () => {
  const source = await readFile(new URL("../../src/lib/auth/mfa-service.ts", import.meta.url), "utf8");
  const enrollment = source.slice(source.indexOf("export async function completeMfaEnrollment"), source.indexOf("export async function getMfaSecurityState"));
  assert.ok(enrollment.indexOf("await hashRecoveryCodes") < enrollment.indexOf("database.$transaction"), "CPU-bound recovery hashing must not consume the interactive transaction deadline");
  assert.match(enrollment, /isolationLevel: Prisma.TransactionIsolationLevel.Serializable/);
  assert.ok(enrollment.indexOf("await checkMfaRateLimit") >= 0 && enrollment.indexOf("await checkMfaRateLimit") < enrollment.indexOf("await hashRecoveryCodes"), "Rate-limited enrollment must not perform recovery hashing");
  assert.ok(enrollment.indexOf("await usablePasswordSession") < enrollment.indexOf("await hashRecoveryCodes"));
});
