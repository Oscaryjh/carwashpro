import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  hashSensitiveActionToken,
  sensitiveActionCookieOptions,
  SensitiveActionError,
  verifySensitiveActionPassword,
} from "../../src/lib/auth/sensitive-action-service";
import {
  assertSensitiveActionAccessPreconditions,
  assuranceSatisfies,
  getSensitiveActionPolicy,
  SENSITIVE_ACTION_KEYS,
  TRUE_MFA_CAPABILITY,
} from "../../src/lib/auth/sensitive-actions";
import { assertServerActionSameOrigin } from "../../src/lib/auth/security";

test("sensitive action registry is centralized, bounded and resource scoped", () => {
  assert.equal(SENSITIVE_ACTION_KEYS.length, 16);
  for (const actionKey of SENSITIVE_ACTION_KEYS) {
    const policy = getSensitiveActionPolicy(actionKey);
    assert.equal(policy.actionKey, actionKey);
    assert.equal(policy.oneTime, true);
    assert.equal(policy.resourceBound, true);
    assert.ok(policy.resourceType.length > 0);
    assert.ok(policy.requiredCapability.length > 0);
    assert.ok(policy.ttlSeconds > 0);
    assert.ok(policy.ttlSeconds <= 5 * 60);
  }

  assert.equal(
    getSensitiveActionPolicy("STATUTORY_RULESET_SIGNOFF").requiredAssurance,
    "MFA",
  );
  assert.equal(
    getSensitiveActionPolicy("STATUTORY_RULESET_ACTIVATE").requiredAssurance,
    "MFA",
  );
  assert.equal(
    getSensitiveActionPolicy("PAYROLL_REOPEN").requiredAssurance,
    "MFA",
  );
  for (const actionKey of [
    "PAYROLL_FINALIZE",
    "PAYROLL_REOPEN",
    "PAYMENT_FILE_EXPORT",
    "BANK_ACCOUNT_EDIT",
    "STATUTORY_EXPORT",
    "STATUTORY_SUBMIT",
    "PAYROLL_PAYMENT_PROCESS",
    "SUPPLIER_PAYMENT_RECORD",
    "SUPPLIER_PAYMENT_REVERSE",
    "SUBSCRIPTION_PAYMENT_RECORD",
    "SUBSCRIPTION_PAYMENT_REVERSE",
    "SUBSCRIPTION_INVOICE_VOID",
  ] as const) {
    assert.equal(getSensitiveActionPolicy(actionKey).requiredAssurance, "MFA");
  }
  assert.equal(TRUE_MFA_CAPABILITY.status, "READY");
  assert.deepEqual(TRUE_MFA_CAPABILITY.methods, ["TOTP"]);
  assert.equal(
    getSensitiveActionPolicy("QA_SENSITIVE_ACTION").requiredAssurance,
    "MFA",
  );
  assert.equal(assuranceSatisfies("REAUTH", "MFA"), false);
  assert.equal(assuranceSatisfies("MFA", "REAUTH"), true);
});

test("capability and module entitlement are enforced before step-up", () => {
  assert.throws(
    () =>
      assertSensitiveActionAccessPreconditions({
        actionKey: "PAYROLL_REOPEN",
        capabilities: [],
        enabledModules: new Set(),
      }),
    /SENSITIVE_ACTION_PERMISSION_DENIED/,
  );
  assert.throws(
    () =>
      assertSensitiveActionAccessPreconditions({
        actionKey: "PAYROLL_REOPEN",
        capabilities: ["REOPEN_PAYROLL"],
        enabledModules: new Set(),
      }),
    /MODULE_NOT_ENABLED/,
  );
  assert.equal(
    assertSensitiveActionAccessPreconditions({
      actionKey: "PAYROLL_REOPEN",
      capabilities: ["REOPEN_PAYROLL"],
      enabledModules: new Set(["PAYROLL"]),
    }).actionKey,
    "PAYROLL_REOPEN",
  );
});

test("password re-auth cannot satisfy a true-MFA statutory policy", async () => {
  await assert.rejects(
    verifySensitiveActionPassword({
      userId: "00000000-0000-4000-8000-000000000010",
      sessionId: "00000000-0000-4000-8000-000000000011",
      actionKey: "STATUTORY_RULESET_SIGNOFF",
      resourceType: "STATUTORY_RULESET",
      resourceId: "00000000-0000-4000-8000-000000000012",
      businessId: null,
      password: "irrelevant",
      request: { ipAddress: null, userAgent: null },
    }),
    (error: unknown) =>
      error instanceof SensitiveActionError && error.code === "MFA_REQUIRED",
  );
});

test("opaque authorization tokens are hashed and browser storage is hardened", () => {
  const rawToken = "a-raw-token-that-must-never-be-persisted";
  const tokenHash = hashSensitiveActionToken(rawToken);
  assert.match(tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(tokenHash.includes(rawToken), false);

  const cookie = sensitiveActionCookieOptions(300, {
    ...process.env,
    NODE_ENV: "production",
  });
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "strict");
  assert.equal(cookie.secure, true);
  assert.equal(cookie.path, "/");
  assert.equal(cookie.maxAge, 300);
});

test("step-up server actions reject cross-site requests", () => {
  assert.throws(
    () =>
      assertServerActionSameOrigin(
        new Headers({
          host: "testing.example.test",
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        }),
      ),
    /AUTH_CROSS_SITE_REQUEST/,
  );
  assert.doesNotThrow(() =>
    assertServerActionSameOrigin(
      new Headers({
        host: "testing.example.test",
        origin: "https://testing.example.test",
        "sec-fetch-site": "same-origin",
      }),
    ),
  );
});

test("step-up migration stores only token hashes and enforces bounded identity fields", () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      "prisma/migrations/20260810190000_sensitive_action_step_up_foundation/migration.sql",
    ),
    "utf8",
  );
  assert.match(sql, /"token_hash" TEXT NOT NULL/);
  assert.doesNotMatch(sql, /"raw_token"|"password"|"otp_code"|"mfa_secret"/);
  assert.match(sql, /"expires_at" > "issued_at"/);
  assert.match(sql, /resource_pair_check/);
  assert.match(sql, /verification_method.*PASSWORD_REAUTH/s);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE TABLE/);
});

test("temporary MFA bypass migration preserves an auditable verification method", () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      "prisma/migrations/20260821090000_mfa_disabled_authorization/migration.sql",
    ),
    "utf8",
  );
  assert.match(sql, /MFA_TEMPORARILY_DISABLED/);
  assert.match(sql, /sensitive_action_authorizations_method_check/);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE TABLE/);
});
