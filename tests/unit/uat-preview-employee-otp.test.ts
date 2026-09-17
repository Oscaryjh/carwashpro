import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { getEmployeeAuthConfig } from "../../src/lib/attendance/employee-auth/config";
import { createEmployeeOtpProvider } from "../../src/lib/attendance/employee-auth/provider";
import * as previewOtpModule from "../../src/lib/attendance/employee-auth/uat-preview-otp";

const AUTH_SECRET = "employee-auth-secret-for-uat-preview-tests-v1";
const HMAC_SEED = "uat-preview-otp-seed-that-is-longer-than-thirty-two-bytes-v1";

function previewEnvironment(
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    APP_ENVIRONMENT: "uat-preview",
    RAILWAY_PROJECT_ID: "preview-project",
    RAILWAY_ENVIRONMENT_ID: "preview-environment",
    RAILWAY_SERVICE_ID: "preview-web",
    UAT_PREVIEW_EXPECTED_PROJECT_ID: "preview-project",
    UAT_PREVIEW_EXPECTED_ENVIRONMENT_ID: "preview-environment",
    UAT_PREVIEW_EXPECTED_WEB_SERVICE_ID: "preview-web",
    UAT_PREVIEW_ACCESS_ENABLED: "true",
    UAT_PREVIEW_ACCESS_USERNAME: "uat-reviewer",
    UAT_PREVIEW_ACCESS_PASSWORD: "preview-access-password-that-is-long-enough",
    UAT_PREVIEW_OTP_INTERCEPT_ENABLED: "true",
    UAT_PREVIEW_OTP_HMAC_SEED: HMAC_SEED,
    UAT_PREVIEW_SYNTHETIC_PHONE_ALLOWLIST: "+60119992001,+60119992002",
    PRODUCTION_ELIGIBLE: "false",
    OFFICIAL_EXPORT_ELIGIBLE: "false",
    BANK_PAYMENT_EXECUTION_ENABLED: "false",
    GOVERNMENT_SUBMISSION_ENABLED: "false",
    PCB_PRODUCTION_ENABLED: "false",
    EMPLOYEE_AUTH_SECRET: AUTH_SECRET,
    OTP_PROVIDER: "uat_preview_intercept",
    OTP_CHANNEL: "intercept",
    SMS123_API_KEY: "",
    TWILIO_ACCOUNT_SID: "",
    TWILIO_VERIFY_SERVICE_SID: "",
    TWILIO_API_KEY_SID: "",
    TWILIO_API_KEY_SECRET: "",
    TWILIO_AUTH_TOKEN: "",
    ...overrides,
  };
}

test("exact uat-preview identity selects only the isolated interceptor", () => {
  const config = getEmployeeAuthConfig(previewEnvironment());

  assert.equal(config.environment, "uat-preview");
  assert.equal(config.otp.provider, "uat_preview_intercept");
  assert.equal(config.otp.channel, "intercept");
  assert.equal(config.otp.sendMode, "provider");
  assert.equal(config.session.secureCookie, true);
});

test("interceptor is rejected outside uat-preview", () => {
  for (const [name, env] of [
    ["Production", { APP_ENVIRONMENT: "production" }],
    ["Testing", { APP_ENVIRONMENT: "testing" }],
    ["development", { APP_ENVIRONMENT: "development", NODE_ENV: "development" }],
  ] as const) {
    assert.throws(
      () => getEmployeeAuthConfig(previewEnvironment(env)),
      /UAT_PREVIEW_OTP_ENVIRONMENT_MISMATCH/,
      name,
    );
  }
});

test("interceptor rejects Railway identity mismatches independently", () => {
  for (const [variable, errorCode] of [
    ["RAILWAY_PROJECT_ID", "UAT_PREVIEW_PROJECT_ID_MISMATCH"],
    ["RAILWAY_ENVIRONMENT_ID", "UAT_PREVIEW_ENVIRONMENT_ID_MISMATCH"],
    ["RAILWAY_SERVICE_ID", "UAT_PREVIEW_WEB_SERVICE_ID_MISMATCH"],
  ] as const) {
    assert.throws(
      () =>
        getEmployeeAuthConfig(
          previewEnvironment({ [variable]: `wrong-${variable.toLowerCase()}` }),
        ),
      new RegExp(errorCode),
    );
  }
});

test("interceptor rejects incomplete secrets, access protection, and restricted flags", () => {
  for (const [overrides, errorCode] of [
    [{ UAT_PREVIEW_OTP_HMAC_SEED: "" }, "UAT_PREVIEW_OTP_HMAC_SEED_REQUIRED"],
    [{ UAT_PREVIEW_ACCESS_ENABLED: "false" }, "UAT_PREVIEW_ACCESS_REQUIRED"],
    [{ UAT_PREVIEW_ACCESS_PASSWORD: "short" }, "UAT_PREVIEW_ACCESS_CREDENTIALS_REQUIRED"],
    [{ BANK_PAYMENT_EXECUTION_ENABLED: "true" }, "UAT_PREVIEW_RESTRICTED_FEATURE_ENABLED"],
    [{ GOVERNMENT_SUBMISSION_ENABLED: "true" }, "UAT_PREVIEW_RESTRICTED_FEATURE_ENABLED"],
    [{ PCB_PRODUCTION_ENABLED: "true" }, "UAT_PREVIEW_RESTRICTED_FEATURE_ENABLED"],
    [{ PRODUCTION_ELIGIBLE: "true" }, "UAT_PREVIEW_RESTRICTED_FEATURE_ENABLED"],
    [{ OFFICIAL_EXPORT_ELIGIBLE: "true" }, "UAT_PREVIEW_RESTRICTED_FEATURE_ENABLED"],
  ] as const) {
    assert.throws(
      () => getEmployeeAuthConfig(previewEnvironment(overrides)),
      new RegExp(errorCode),
    );
  }
});

test("interceptor rejects real SMS credentials instead of falling back", () => {
  for (const overrides of [
    { SMS123_API_KEY: "real-sms123-key-must-not-be-used" },
    { TWILIO_AUTH_TOKEN: "real-twilio-token-must-not-be-used" },
  ]) {
    assert.throws(
      () => getEmployeeAuthConfig(previewEnvironment(overrides)),
      /UAT_PREVIEW_REAL_SMS_CONFIGURATION_FORBIDDEN/,
    );
  }
});

test("Preview OTP is deterministically bound to challenge, synthetic phone, and expiry", () => {
  const deriveUatPreviewOtp = Reflect.get(
    previewOtpModule,
    "deriveUatPreviewOtp",
  ) as
    | ((
        input: { challengeId: string; phoneNumber: string; expiresAt: Date },
        seed: string,
      ) => string)
    | undefined;
  assert.equal(typeof deriveUatPreviewOtp, "function");

  const input = {
    challengeId: "challenge-fixed",
    phoneNumber: "+60119992001",
    expiresAt: new Date(1_737_000_000 * 1_000),
  };
  const code = deriveUatPreviewOtp!(input, HMAC_SEED);

  assert.equal(code, "284940");
  assert.match(code, /^\d{6}$/);
  assert.notEqual(
    deriveUatPreviewOtp!({ ...input, challengeId: "challenge-other" }, HMAC_SEED),
    code,
  );
  assert.notEqual(
    deriveUatPreviewOtp!({ ...input, phoneNumber: "+60119992002" }, HMAC_SEED),
    code,
  );
  assert.notEqual(
    deriveUatPreviewOtp!(
      { ...input, expiresAt: new Date(input.expiresAt.getTime() + 1_000) },
      HMAC_SEED,
    ),
    code,
  );
});

test("Preview provider never calls a real transport and verifies only a live synthetic challenge", async () => {
  const originalFetch = globalThis.fetch;
  let outboundCalls = 0;
  globalThis.fetch = (async () => {
    outboundCalls += 1;
    throw new Error("OUTBOUND_TRANSPORT_MUST_NOT_RUN");
  }) as typeof fetch;

  try {
    const config = getEmployeeAuthConfig(previewEnvironment());
    const provider = createEmployeeOtpProvider(config);
    const expiresAt = new Date(Date.now() + 60_000);
    const accepted = await provider.sendVerification({
      challengeId: "challenge-live",
      phoneNumber: "+60119992001",
      purpose: "LOGIN",
      expiresAt,
      locale: "en-MY",
    });
    const deriveUatPreviewOtp = Reflect.get(
      previewOtpModule,
      "deriveUatPreviewOtp",
    ) as (
      input: { challengeId: string; phoneNumber: string; expiresAt: Date },
      seed: string,
    ) => string;
    const code = deriveUatPreviewOtp(
      { challengeId: "challenge-live", phoneNumber: "+60119992001", expiresAt },
      HMAC_SEED,
    );

    assert.equal(provider.name, "uat_preview_intercept");
    assert.equal(provider.channel, "intercept");
    assert.equal(accepted.providerReference.includes(code), false);
    assert.equal(accepted.providerReference.includes("60119992001"), false);
    assert.deepEqual(
      await provider.checkVerification({
        challengeId: "challenge-live",
        phoneNumber: "+60119992001",
        providerReference: accepted.providerReference,
        code,
      }),
      { status: "APPROVED" },
    );
    assert.deepEqual(
      await provider.checkVerification({
        challengeId: "challenge-live",
        phoneNumber: "+60119992001",
        providerReference: accepted.providerReference,
        code: "000000",
      }),
      { status: "REJECTED" },
    );
    assert.equal(outboundCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Preview provider rejects non-synthetic phones and expired challenges without disclosure", async () => {
  const provider = createEmployeeOtpProvider(
    getEmployeeAuthConfig(previewEnvironment()),
  );

  await assert.rejects(
    provider.sendVerification({
      challengeId: "challenge-real-phone",
      phoneNumber: "+60128889999",
      purpose: "LOGIN",
      expiresAt: new Date(Date.now() + 60_000),
      locale: "en-MY",
    }),
    (error: unknown) => {
      assert.equal(String(error).includes("+60128889999"), false);
      assert.match(String(error), /UAT_PREVIEW_SYNTHETIC_PHONE_REQUIRED/);
      return true;
    },
  );

  const expiresAt = new Date(Date.now() - 1_000);
  const accepted = await provider.sendVerification({
    challengeId: "challenge-expired",
    phoneNumber: "+60119992001",
    purpose: "LOGIN",
    expiresAt,
    locale: "en-MY",
  });
  assert.deepEqual(
    await provider.checkVerification({
      challengeId: "challenge-expired",
      phoneNumber: "+60119992001",
      providerReference: accepted.providerReference,
      code: "123456",
    }),
    { status: "EXPIRED" },
  );
});

test("Preview OTP CLI refuses every non-Preview runtime before database access", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/read-uat-preview-employee-otp.ts",
      "--challenge-id",
      "11111111-1111-4111-8111-111111111111",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: previewEnvironment({ APP_ENVIRONMENT: "production" }),
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /UAT_PREVIEW_OTP_ENVIRONMENT_MISMATCH/);
  assert.equal(result.stderr.includes(HMAC_SEED), false);
  assert.equal(result.stderr.includes("+60119992001"), false);
  assert.equal(result.stderr.includes("DATABASE_URL"), false);
});
