import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  loadMfaKeyring,
} from "../../src/lib/auth/mfa-crypto";
import { MfaError } from "../../src/lib/auth/mfa-errors";
import {
  generateRecoveryCodes,
  hashRecoveryCodes,
  recoveryCodeMatches,
} from "../../src/lib/auth/mfa-recovery";
import {
  createTotpUri,
  generateTotpCode,
  generateTotpSecret,
  verifyTotp,
} from "../../src/lib/auth/mfa-totp";

const KEYRING = {
  MFA_ACTIVE_KEY_VERSION: "unit-v1",
  MFA_ENCRYPTION_KEYS: JSON.stringify({
    "unit-v1": Buffer.alloc(32, 7).toString("base64"),
  }),
};
const identity = {
  credentialId: "10000000-0000-4000-8000-000000000001",
  userId: "10000000-0000-4000-8000-000000000002",
  type: "TOTP" as const,
};

test("TOTP is RFC 6238 compatible with bounded skew and standard URI", () => {
  const secret = generateTotpSecret();
  assert.match(secret, /^[A-Z2-7]+$/);
  const timestamp = Date.UTC(2026, 7, 10, 12, 0, 0);
  const code = generateTotpCode({ secret, timestamp });
  assert.match(code, /^\d{6}$/);
  const counter = verifyTotp({ code, secret, timestamp });
  assert.equal(counter, BigInt(Math.floor(timestamp / 30_000)));
  assert.equal(verifyTotp({ code, secret, timestamp: timestamp + 30_000 }), counter);
  assert.equal(verifyTotp({ code, secret, timestamp: timestamp + 60_000 }), null);
  const uri = createTotpUri({ accountLabel: "reviewer@example.test", secret });
  assert.match(uri, /^otpauth:\/\/totp\/Tetamu:reviewer%40example\.test\?/);
  assert.match(uri, /issuer=Tetamu/);
  assert.match(uri, /algorithm=SHA1/);
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
});

test("TOTP secrets use versioned AES-256-GCM authenticated encryption", () => {
  const secret = "JBSWY3DPEHPK3PXP";
  const left = encryptMfaSecret(secret, identity, KEYRING);
  const right = encryptMfaSecret(secret, identity, KEYRING);
  assert.notDeepEqual(left.secretIv, right.secretIv);
  assert.equal(left.encryptedSecret.toString("utf8").includes(secret), false);
  assert.equal(
    decryptMfaSecret({ ...identity, ...left }, KEYRING),
    secret,
  );
  assert.throws(
    () =>
      decryptMfaSecret(
        {
          ...identity,
          ...left,
          encryptedSecret: Buffer.from(left.encryptedSecret).map((byte, index) =>
            index === 0 ? byte ^ 0x01 : byte,
          ),
        },
        KEYRING,
      ),
    (error: unknown) =>
      error instanceof MfaError && error.code === "MFA_VERIFICATION_FAILED",
  );
  assert.throws(
    () => loadMfaKeyring({}),
    (error: unknown) =>
      error instanceof MfaError &&
      error.code === "MFA_ENCRYPTION_NOT_CONFIGURED",
  );
});

test("recovery codes are unique, human-readable, bcrypt-hashed and verifiable", async () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const code of codes) assert.match(code, /^[2-9A-HJ-NP-Z]{4}(?:-[2-9A-HJ-NP-Z]{4}){2}$/);
  const hashes = await hashRecoveryCodes(codes);
  assert.equal(hashes.length, 10);
  assert.equal(hashes.some((item) => codes.includes(item.codeHash)), false);
  assert.equal(await recoveryCodeMatches(codes[0], hashes[0].codeHash), true);
  assert.equal(await recoveryCodeMatches(codes[1], hashes[0].codeHash), false);
});

test("MFA migration enforces encrypted credentials and single active/pending TOTP", () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      "prisma/migrations/20260810220000_true_mfa_totp_foundation/migration.sql",
    ),
    "utf8",
  );
  assert.match(sql, /"encrypted_secret" BYTEA NOT NULL/);
  assert.match(sql, /"secret_iv" BYTEA NOT NULL/);
  assert.match(sql, /"secret_auth_tag" BYTEA NOT NULL/);
  assert.match(sql, /one_active_totp_per_user/);
  assert.match(sql, /one_pending_totp_per_user/);
  assert.match(sql, /"code_hash" TEXT NOT NULL/);
  assert.doesNotMatch(sql, /plaintext_secret|raw_recovery_code|totp_code/);
  const lifecycleSql = readFileSync(
    resolve(
      process.cwd(),
      "prisma/migrations/20260810223000_true_mfa_enrollment_session_lifecycle/migration.sql",
    ),
    "utf8",
  );
  assert.match(lifecycleSql, /ON DELETE CASCADE/);
  assert.match(lifecycleSql, /"status" = 'ACTIVE' AND "enrollment_session_id" IS NULL/);
  assert.match(lifecycleSql, /WHERE "status" IN \('ACTIVE', 'REVOKED'\)/);
});
