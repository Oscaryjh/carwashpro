import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  assertHrPayrollUatFixtureEnvironment,
  assertPreviewDatabaseContents,
  capturePreviewFixtureCounts,
  databaseConnectionFingerprint,
  HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG,
} from "../../scripts/uat-preview-database-guard";

const prisma = new PrismaClient();
const FINGERPRINT_SECRET =
  "preview-integration-fingerprint-secret-longer-than-thirty-two-bytes";
const ARTIFACT_DIRECTORIES: string[] = [];

after(async () => {
  await prisma.$disconnect();
  await Promise.all(
    ARTIFACT_DIRECTORIES.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

test("Preview fixture rejects unrelated data before writing the synthetic marker", async () => {
  const environment = previewEnvironment();
  const guard = assertHrPayrollUatFixtureEnvironment(environment);
  const unrelated = await prisma.business.create({
    data: { name: "Unrelated real-looking business", slug: "unrelated-business" },
  });
  try {
    await assert.rejects(
      assertPreviewDatabaseContents(prisma, guard),
      /HR_UAT_FIXTURE_NON_SYNTHETIC_DATA_PRESENT/,
    );
    assert.equal(
      await prisma.business.count({
        where: { slug: HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG },
      }),
      0,
    );
  } finally {
    await prisma.business.delete({ where: { id: unrelated.id } });
  }
});

test("identity failure causes zero fixture writes and never leaks connection material", async () => {
  const artifactDirectory = await fixtureArtifactDirectory();
  const environment = previewEnvironment({
    HR_PAYROLL_UAT_ARTIFACT_DIRECTORY: artifactDirectory,
    UAT_PREVIEW_EXPECTED_WEB_SERVICE_ID: "wrong-web-service",
  });
  const result = runFixtureScript(
    "scripts/prepare-hr-payroll-core-acceptance.ts",
    environment,
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /HR_UAT_FIXTURE_WEB_SERVICE_ID_MISMATCH/);
  assert.equal(await prisma.business.count(), 0);
  assertSanitized(result, environment);
});

test("Preview core and eight-role fixtures are idempotent across every required domain", async () => {
  const artifactDirectory = await fixtureArtifactDirectory();
  const environment = previewEnvironment({
    HR_PAYROLL_UAT_ARTIFACT_DIRECTORY: artifactDirectory,
  });
  const guard = assertHrPayrollUatFixtureEnvironment(environment);

  const firstResults = runFixturePair(environment);
  for (const result of firstResults) {
    assert.equal(result.status, 0, result.stderr);
    assertSanitized(result, environment);
  }
  const marker = await prisma.business.findUniqueOrThrow({
    where: { slug: HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG },
    select: { id: true },
  });
  assert.deepEqual(await assertPreviewDatabaseContents(prisma, guard), {
    state: "synthetic-marker",
    businessId: marker.id,
  });
  const firstCounts = await capturePreviewFixtureCounts(prisma, marker.id);

  const secondResults = runFixturePair(environment);
  for (const result of secondResults) {
    assert.equal(result.status, 0, result.stderr);
    assertSanitized(result, environment);
  }
  const secondCounts = await capturePreviewFixtureCounts(prisma, marker.id);

  assert.deepEqual(secondCounts, firstCounts);
  assert.equal(secondCounts.businesses, 1);
  assert.equal(secondCounts.employeeAccounts, 6);
  assert.equal(secondCounts.employeeMemberships, 6);
  assert.equal(secondCounts.activeDevices, 6);
  assert.equal(secondCounts.attendanceTimesheets, 1);
  assert.equal(secondCounts.leaveRequests, 2);
  assert.equal(secondCounts.leaveDays, 2);
  assert.equal(secondCounts.payrollRuns, 1);
  assert.equal(secondCounts.payrollEntries, 6);
  assert.ok(secondCounts.payrollComponents > 0);
  assert.equal(secondCounts.payslipPublications, 6);

  const verification = runFixtureScript(
    "scripts/verify-hr-payroll-uat-preview-fixture.ts",
    environment,
  );
  assert.equal(verification.status, 0, verification.stderr);
  assert.match(verification.stdout, /"verified": true/);
  assertSanitized(verification, environment);
});

function runFixturePair(environment: NodeJS.ProcessEnv) {
  return [
    runFixtureScript("scripts/prepare-hr-payroll-core-acceptance.ts", environment),
    runFixtureScript("scripts/prepare-hr-payroll-eight-role-uat.ts", environment),
  ];
}

function runFixtureScript(script: string, environment: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ["--import", "tsx", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...environment },
    timeout: 120_000,
  });
}

function assertSanitized(
  result: ReturnType<typeof spawnSync>,
  environment: NodeJS.ProcessEnv,
) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const databaseUrl = environment.DATABASE_URL!;
  const parsed = new URL(databaseUrl);
  for (const sensitive of [
    databaseUrl,
    parsed.hostname,
    decodeURIComponent(parsed.username),
    decodeURIComponent(parsed.password),
    environment.UAT_PREVIEW_DATABASE_FINGERPRINT_SECRET!,
    environment.UAT_PREVIEW_GUARD_SECRET!,
    environment.UAT_PREVIEW_OTP_HMAC_SEED!,
  ]) {
    assert.equal(output.includes(sensitive), false);
  }
}

async function fixtureArtifactDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "tetamu-uat-preview-fixture-"));
  ARTIFACT_DIRECTORIES.push(directory);
  return directory;
}

function previewEnvironment(
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "disposable integration DATABASE_URL is required");
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  const databaseServiceId = "preview-database-service";
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    APP_ENVIRONMENT: "uat-preview",
    DATABASE_URL: databaseUrl,
    RAILWAY_PROJECT_ID: "preview-project",
    RAILWAY_ENVIRONMENT_ID: "preview-environment",
    RAILWAY_SERVICE_ID: "preview-web-service",
    RAILWAY_DATABASE_SERVICE_ID: databaseServiceId,
    UAT_PREVIEW_EXPECTED_PROJECT_ID: "preview-project",
    UAT_PREVIEW_EXPECTED_ENVIRONMENT_ID: "preview-environment",
    UAT_PREVIEW_EXPECTED_WEB_SERVICE_ID: "preview-web-service",
    UAT_PREVIEW_EXPECTED_DATABASE_SERVICE_ID: databaseServiceId,
    UAT_PREVIEW_DATABASE_NAME: databaseName,
    UAT_PREVIEW_DATABASE_FINGERPRINT_SECRET: FINGERPRINT_SECRET,
    UAT_PREVIEW_GUARD_SECRET:
      "preview-integration-guard-secret-longer-than-thirty-two-bytes",
    UAT_PREVIEW_SYNTHETIC_FIXTURE_ENABLED: "true",
    UAT_PREVIEW_FORBIDDEN_ENVIRONMENT_IDS:
      "testing-environment,production-environment",
    UAT_PREVIEW_FORBIDDEN_SERVICE_IDS:
      "testing-web,production-web,testing-database,production-database",
    UAT_PREVIEW_FORBIDDEN_DATABASE_NAMES: "tetamu_testing,tetamu_production",
    UAT_PREVIEW_FORBIDDEN_DATABASE_FINGERPRINTS:
      "a".repeat(64) + "," + "b".repeat(64),
    UAT_PREVIEW_ACCESS_ENABLED: "true",
    UAT_PREVIEW_ACCESS_USERNAME: "preview-reviewer",
    UAT_PREVIEW_ACCESS_PASSWORD:
      "preview-integration-access-password-long-enough",
    UAT_PREVIEW_OTP_INTERCEPT_ENABLED: "true",
    UAT_PREVIEW_OTP_HMAC_SEED:
      "preview-integration-otp-seed-longer-than-thirty-two-bytes",
    UAT_PREVIEW_SYNTHETIC_PHONE_ALLOWLIST:
      "+60119992001,+60119992002,+60119992003,+60119992004,+60119992005,+60119992006",
    OTP_PROVIDER: "uat_preview_intercept",
    OTP_CHANNEL: "intercept",
    EMPLOYEE_AUTH_SECRET:
      "preview-integration-employee-auth-secret-long-enough",
    SESSION_SECRET: "preview-integration-session-secret-long-enough",
    HR_CORE_ACCEPTANCE_PASSWORD: "preview-core-password-123",
    HR_EIGHT_ROLE_UAT_PASSWORD: "preview-eight-role-password-123",
    PRODUCTION_ELIGIBLE: "false",
    OFFICIAL_EXPORT_ELIGIBLE: "false",
    BANK_PAYMENT_EXECUTION_ENABLED: "false",
    GOVERNMENT_SUBMISSION_ENABLED: "false",
    PCB_PRODUCTION_ENABLED: "false",
    SMS123_API_KEY: "",
    TWILIO_ACCOUNT_SID: "",
    TWILIO_VERIFY_SERVICE_SID: "",
    TWILIO_API_KEY_SID: "",
    TWILIO_API_KEY_SECRET: "",
    TWILIO_AUTH_TOKEN: "",
    WHATSAPP_ACCESS_TOKEN: "",
    WHATSAPP_WEBHOOK_SECRET: "",
    RESEND_API_KEY: "",
    SMTP_PASSWORD: "",
  };
  environment.UAT_PREVIEW_EXPECTED_DATABASE_FINGERPRINT =
    databaseConnectionFingerprint(databaseUrl, databaseServiceId, FINGERPRINT_SECRET);
  return { ...environment, ...overrides };
}
