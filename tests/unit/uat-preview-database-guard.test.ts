import assert from "node:assert/strict";
import test from "node:test";
import {
  assertHrPayrollUatFixtureEnvironment,
  databaseConnectionFingerprint,
} from "../../scripts/uat-preview-database-guard";

const DATABASE_URL =
  "postgresql://preview_user:preview-password@preview-db.internal:6543/tetamu_uat_preview";
const FINGERPRINT_SECRET =
  "preview-database-fingerprint-secret-longer-than-thirty-two-bytes";
const GUARD_SECRET = "preview-fixture-guard-secret-longer-than-thirty-two-bytes";

test("database guard preserves exact-loopback disposable mode", () => {
  assert.deepEqual(
    assertHrPayrollUatFixtureEnvironment({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://local:local@127.0.0.1:5432/disposable",
    }),
    {
      mode: "local-disposable",
      databaseName: "disposable",
      databaseFingerprint: null,
      syntheticBusinessName: "Tetamu HR Acceptance Test",
      syntheticBusinessSlug: "tetamu-hr-uat-preview-synthetic-v1",
    },
  );
  assert.throws(
    () =>
      assertHrPayrollUatFixtureEnvironment({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://local:local@db.example.test:5432/disposable",
      }),
    /HR_UAT_FIXTURE_LOCAL_DATABASE_REQUIRED/,
  );
});

test("database fingerprint is stable across equivalent normalized connection identities", () => {
  assert.equal(
    databaseConnectionFingerprint(
      "postgres://preview%5Fuser:one@PREVIEW-DB.INTERNAL/tetamu%5Fuat%5Fpreview",
      "preview-database",
      FINGERPRINT_SECRET,
    ),
    databaseConnectionFingerprint(
      "postgresql://preview_user:two@preview-db.internal:5432/tetamu_uat_preview",
      "preview-database",
      FINGERPRINT_SECRET,
    ),
    "password and protocol alias must not alter the canonical database identity",
  );
});

test("exact Preview identity and keyed database fingerprint are accepted", () => {
  const environment = previewEnvironment();
  assert.deepEqual(assertHrPayrollUatFixtureEnvironment(environment), {
    mode: "uat-preview",
    databaseName: "tetamu_uat_preview",
    databaseFingerprint: environment.UAT_PREVIEW_EXPECTED_DATABASE_FINGERPRINT,
    syntheticBusinessName: "Tetamu HR Acceptance Test",
    syntheticBusinessSlug: "tetamu-hr-uat-preview-synthetic-v1",
  });
});

test("denylist categories win before matching allowlist values", () => {
  const base = previewEnvironment();
  const fingerprint = base.UAT_PREVIEW_EXPECTED_DATABASE_FINGERPRINT!;
  for (const [overrides, code] of [
    [
      { UAT_PREVIEW_FORBIDDEN_ENVIRONMENT_IDS: "testing,preview-environment" },
      "HR_UAT_FIXTURE_FORBIDDEN_ENVIRONMENT_ID",
    ],
    [
      { UAT_PREVIEW_FORBIDDEN_SERVICE_IDS: "production-web,preview-web" },
      "HR_UAT_FIXTURE_FORBIDDEN_SERVICE_ID",
    ],
    [
      { UAT_PREVIEW_FORBIDDEN_SERVICE_IDS: "production-db,preview-database" },
      "HR_UAT_FIXTURE_FORBIDDEN_SERVICE_ID",
    ],
    [
      { UAT_PREVIEW_FORBIDDEN_DATABASE_NAMES: "production,tetamu_uat_preview" },
      "HR_UAT_FIXTURE_FORBIDDEN_DATABASE_NAME",
    ],
    [
      { UAT_PREVIEW_FORBIDDEN_DATABASE_FINGERPRINTS: `deadbeef,${fingerprint}` },
      "HR_UAT_FIXTURE_FORBIDDEN_DATABASE_FINGERPRINT",
    ],
  ] as const) {
    assert.throws(
      () =>
        assertHrPayrollUatFixtureEnvironment({
          ...base,
          ...overrides,
          UAT_PREVIEW_EXPECTED_PROJECT_ID: "intentionally-wrong-allowlist",
        }),
      new RegExp(code),
    );
  }
});

test("every Preview identity and fingerprint allowlist mismatch fails closed", () => {
  const mismatchCases = [
    ["UAT_PREVIEW_EXPECTED_PROJECT_ID", "HR_UAT_FIXTURE_PROJECT_ID_MISMATCH"],
    ["UAT_PREVIEW_EXPECTED_ENVIRONMENT_ID", "HR_UAT_FIXTURE_ENVIRONMENT_ID_MISMATCH"],
    ["UAT_PREVIEW_EXPECTED_WEB_SERVICE_ID", "HR_UAT_FIXTURE_WEB_SERVICE_ID_MISMATCH"],
    ["UAT_PREVIEW_EXPECTED_DATABASE_SERVICE_ID", "HR_UAT_FIXTURE_DATABASE_SERVICE_ID_MISMATCH"],
    ["UAT_PREVIEW_DATABASE_NAME", "HR_UAT_FIXTURE_DATABASE_NAME_MISMATCH"],
    ["UAT_PREVIEW_EXPECTED_DATABASE_FINGERPRINT", "HR_UAT_FIXTURE_DATABASE_FINGERPRINT_MISMATCH"],
  ] as const;
  for (const [variable, code] of mismatchCases) {
    assert.throws(
      () =>
        assertHrPayrollUatFixtureEnvironment(
          previewEnvironment({ [variable]: `wrong-${variable.toLowerCase()}` }),
        ),
      new RegExp(code),
      variable,
    );
  }
});

test("Preview guard rejects missing secrets, disabled fixture, and restricted providers", () => {
  for (const [overrides, code] of [
    [{ UAT_PREVIEW_DATABASE_FINGERPRINT_SECRET: "" }, "HR_UAT_FIXTURE_FINGERPRINT_SECRET_REQUIRED"],
    [{ UAT_PREVIEW_GUARD_SECRET: "short" }, "HR_UAT_FIXTURE_GUARD_SECRET_REQUIRED"],
    [{ UAT_PREVIEW_FORBIDDEN_ENVIRONMENT_IDS: "" }, "HR_UAT_FIXTURE_DENYLIST_REQUIRED"],
    [{ UAT_PREVIEW_SYNTHETIC_FIXTURE_ENABLED: "false" }, "HR_UAT_FIXTURE_SYNTHETIC_ENABLEMENT_REQUIRED"],
    [{ BANK_PAYMENT_EXECUTION_ENABLED: "true" }, "HR_UAT_FIXTURE_RESTRICTED_FEATURE_ENABLED"],
    [{ GOVERNMENT_SUBMISSION_ENABLED: "true" }, "HR_UAT_FIXTURE_RESTRICTED_FEATURE_ENABLED"],
    [{ PCB_PRODUCTION_ENABLED: "true" }, "HR_UAT_FIXTURE_RESTRICTED_FEATURE_ENABLED"],
    [{ SMS123_API_KEY: "must-not-be-used" }, "HR_UAT_FIXTURE_EXTERNAL_PROVIDER_FORBIDDEN"],
    [{ OTP_PROVIDER: "sms123" }, "HR_UAT_FIXTURE_PREVIEW_OTP_REQUIRED"],
  ] as const) {
    assert.throws(
      () => assertHrPayrollUatFixtureEnvironment(previewEnvironment(overrides)),
      new RegExp(code),
    );
  }
});

test("guard failures never disclose connection identity or secrets", () => {
  const environment = previewEnvironment({
    UAT_PREVIEW_EXPECTED_PROJECT_ID: "wrong-project",
  });
  let message = "";
  try {
    assertHrPayrollUatFixtureEnvironment(environment);
    assert.fail("expected the guard to reject the mismatch");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  for (const sensitive of [
    DATABASE_URL,
    "preview-db.internal",
    "preview_user",
    "preview-password",
    FINGERPRINT_SECRET,
    GUARD_SECRET,
  ]) {
    assert.equal(message.includes(sensitive), false);
  }
});

function previewEnvironment(
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    APP_ENVIRONMENT: "uat-preview",
    DATABASE_URL,
    RAILWAY_PROJECT_ID: "preview-project",
    RAILWAY_ENVIRONMENT_ID: "preview-environment",
    RAILWAY_SERVICE_ID: "preview-web",
    RAILWAY_DATABASE_SERVICE_ID: "preview-database",
    UAT_PREVIEW_EXPECTED_PROJECT_ID: "preview-project",
    UAT_PREVIEW_EXPECTED_ENVIRONMENT_ID: "preview-environment",
    UAT_PREVIEW_EXPECTED_WEB_SERVICE_ID: "preview-web",
    UAT_PREVIEW_EXPECTED_DATABASE_SERVICE_ID: "preview-database",
    UAT_PREVIEW_DATABASE_NAME: "tetamu_uat_preview",
    UAT_PREVIEW_DATABASE_FINGERPRINT_SECRET: FINGERPRINT_SECRET,
    UAT_PREVIEW_GUARD_SECRET: GUARD_SECRET,
    UAT_PREVIEW_SYNTHETIC_FIXTURE_ENABLED: "true",
    UAT_PREVIEW_FORBIDDEN_ENVIRONMENT_IDS: "testing-environment,production-environment",
    UAT_PREVIEW_FORBIDDEN_SERVICE_IDS: "testing-web,production-web,testing-db,production-db",
    UAT_PREVIEW_FORBIDDEN_DATABASE_NAMES: "tetamu_testing,tetamu_production",
    UAT_PREVIEW_FORBIDDEN_DATABASE_FINGERPRINTS: "a".repeat(64) + "," + "b".repeat(64),
    OTP_PROVIDER: "uat_preview_intercept",
    UAT_PREVIEW_OTP_INTERCEPT_ENABLED: "true",
    UAT_PREVIEW_ACCESS_ENABLED: "true",
    PRODUCTION_ELIGIBLE: "false",
    OFFICIAL_EXPORT_ELIGIBLE: "false",
    BANK_PAYMENT_EXECUTION_ENABLED: "false",
    GOVERNMENT_SUBMISSION_ENABLED: "false",
    PCB_PRODUCTION_ENABLED: "false",
    SMS123_API_KEY: "",
    TWILIO_ACCOUNT_SID: "",
    TWILIO_AUTH_TOKEN: "",
  };
  base.UAT_PREVIEW_EXPECTED_DATABASE_FINGERPRINT =
    databaseConnectionFingerprint(
      base.DATABASE_URL!,
      base.RAILWAY_DATABASE_SERVICE_ID!,
      base.UAT_PREVIEW_DATABASE_FINGERPRINT_SECRET!,
    );
  return { ...base, ...overrides };
}
