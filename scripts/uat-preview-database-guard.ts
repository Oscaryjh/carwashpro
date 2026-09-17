import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  runtimeEnvironment,
  type RuntimeEnvironmentMap,
} from "../src/lib/release/environment";

export const HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_NAME =
  "Tetamu HR Acceptance Test";
export const HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG =
  "tetamu-hr-uat-preview-synthetic-v1";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const RESTRICTED_FALSE_FLAGS = [
  "PRODUCTION_ELIGIBLE",
  "OFFICIAL_EXPORT_ELIGIBLE",
  "BANK_PAYMENT_EXECUTION_ENABLED",
  "GOVERNMENT_SUBMISSION_ENABLED",
  "PCB_PRODUCTION_ENABLED",
] as const;
const EXTERNAL_PROVIDER_CREDENTIALS = [
  "SMS123_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_VERIFY_SERVICE_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_AUTH_TOKEN",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "SMTP_PASSWORD",
] as const;
const SYNTHETIC_GROUP_USER_EMAILS = new Set([
  "uat.group-owner@tetamu.local",
  "uat.group-manager@tetamu.local",
]);

export type HrPayrollUatFixtureGuard = Readonly<{
  mode: "local-disposable" | "uat-preview";
  databaseName: string;
  databaseFingerprint: string | null;
  syntheticBusinessName: typeof HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_NAME;
  syntheticBusinessSlug: typeof HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG;
}>;

export type PreviewFixtureState = Readonly<{
  state: "local-unchecked" | "empty" | "synthetic-marker";
  businessId: string | null;
}>;

export type PreviewFixtureCounts = Readonly<{
  businesses: number;
  employeeAccounts: number;
  employeeMemberships: number;
  activeDevices: number;
  attendancePunches: number;
  attendanceTimesheets: number;
  attendanceCorrections: number;
  leaveRequests: number;
  leaveDays: number;
  leaveEvidence: number;
  payrollRuns: number;
  payrollEntries: number;
  payrollComponents: number;
  payslipPublications: number;
}>;

export function databaseConnectionFingerprint(
  databaseUrl: string,
  databaseServiceId: string,
  secret: string,
) {
  if (new TextEncoder().encode(secret).byteLength < 32) {
    guardError("HR_UAT_FIXTURE_FINGERPRINT_SECRET_REQUIRED");
  }
  const identity = readDatabaseIdentity(databaseUrl);
  const normalizedServiceId = databaseServiceId.trim();
  if (!normalizedServiceId) {
    guardError("HR_UAT_FIXTURE_DATABASE_SERVICE_ID_REQUIRED");
  }
  const canonical = [
    "postgresql",
    identity.hostname,
    identity.port,
    identity.databaseName,
    identity.username,
    normalizedServiceId,
  ].join("\0");
  return createHmac("sha256", secret)
    .update("tetamu:uat-preview-database-fingerprint:v1\0")
    .update(canonical)
    .digest("hex");
}

export function assertHrPayrollUatFixtureEnvironment(
  env: RuntimeEnvironmentMap = process.env,
): HrPayrollUatFixtureGuard {
  const identity = readDatabaseIdentity(env.DATABASE_URL);
  let environment;
  try {
    environment = runtimeEnvironment(env);
  } catch {
    guardError("HR_UAT_FIXTURE_RUNTIME_IDENTITY_REJECTED");
  }

  if (environment !== "uat-preview") {
    if (
      env.NODE_ENV?.trim().toLowerCase() === "production" ||
      !LOOPBACK_HOSTS.has(identity.hostname)
    ) {
      guardError("HR_UAT_FIXTURE_LOCAL_DATABASE_REQUIRED");
    }
    return {
      mode: "local-disposable",
      databaseName: identity.databaseName,
      databaseFingerprint: null,
      syntheticBusinessName: HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_NAME,
      syntheticBusinessSlug: HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG,
    };
  }

  if (env.NODE_ENV?.trim().toLowerCase() !== "production") {
    guardError("HR_UAT_FIXTURE_PREVIEW_PRODUCTION_BUILD_REQUIRED");
  }

  const localSimulation =
    env.UAT_PREVIEW_LOCAL_SIMULATION?.trim().toLowerCase() === "true";
  if (LOOPBACK_HOSTS.has(identity.hostname)) {
    if (normalized(env.RAILWAY_DEPLOYMENT_ID)) {
      guardError("HR_UAT_FIXTURE_DEPLOYED_LOOPBACK_FORBIDDEN");
    }
    if (!localSimulation) {
      guardError("HR_UAT_FIXTURE_LOCAL_SIMULATION_REQUIRED");
    }
  } else if (localSimulation) {
    guardError("HR_UAT_FIXTURE_REMOTE_LOCAL_SIMULATION_FORBIDDEN");
  }

  const environmentId = normalized(env.RAILWAY_ENVIRONMENT_ID);
  const webServiceId = normalized(env.RAILWAY_SERVICE_ID);
  const databaseServiceId = normalized(env.RAILWAY_DATABASE_SERVICE_ID);
  const forbiddenEnvironments = csvSet(
    env.UAT_PREVIEW_FORBIDDEN_ENVIRONMENT_IDS,
  );
  const forbiddenServices = csvSet(env.UAT_PREVIEW_FORBIDDEN_SERVICE_IDS);
  const forbiddenDatabaseNames = csvSet(
    env.UAT_PREVIEW_FORBIDDEN_DATABASE_NAMES,
  );
  const forbiddenFingerprints = csvSet(
    env.UAT_PREVIEW_FORBIDDEN_DATABASE_FINGERPRINTS,
  );

  // Evaluate every known Testing/Production identity before any expected
  // Preview value. An allowlist cannot override a denylist match.
  if (forbiddenEnvironments.has(environmentId)) {
    guardError("HR_UAT_FIXTURE_FORBIDDEN_ENVIRONMENT_ID");
  }
  if (
    forbiddenServices.has(webServiceId) ||
    forbiddenServices.has(databaseServiceId)
  ) {
    guardError("HR_UAT_FIXTURE_FORBIDDEN_SERVICE_ID");
  }
  if (forbiddenDatabaseNames.has(identity.databaseName)) {
    guardError("HR_UAT_FIXTURE_FORBIDDEN_DATABASE_NAME");
  }

  const fingerprintSecret = env.UAT_PREVIEW_DATABASE_FINGERPRINT_SECRET ?? "";
  if (new TextEncoder().encode(fingerprintSecret).byteLength < 32) {
    guardError("HR_UAT_FIXTURE_FINGERPRINT_SECRET_REQUIRED");
  }
  const databaseFingerprint = databaseConnectionFingerprint(
    env.DATABASE_URL ?? "",
    databaseServiceId,
    fingerprintSecret,
  );
  if (forbiddenFingerprints.has(databaseFingerprint)) {
    guardError("HR_UAT_FIXTURE_FORBIDDEN_DATABASE_FINGERPRINT");
  }
  if (
    forbiddenEnvironments.size === 0 ||
    forbiddenServices.size === 0 ||
    forbiddenDatabaseNames.size === 0 ||
    forbiddenFingerprints.size === 0 ||
    [...forbiddenFingerprints].some(
      (fingerprint) => !/^[a-f0-9]{64}$/.test(fingerprint),
    )
  ) {
    guardError("HR_UAT_FIXTURE_DENYLIST_REQUIRED");
  }

  requireIdentity(
    env.RAILWAY_PROJECT_ID,
    env.UAT_PREVIEW_EXPECTED_PROJECT_ID,
    "HR_UAT_FIXTURE_PROJECT_ID_MISMATCH",
  );
  requireIdentity(
    environmentId,
    env.UAT_PREVIEW_EXPECTED_ENVIRONMENT_ID,
    "HR_UAT_FIXTURE_ENVIRONMENT_ID_MISMATCH",
  );
  requireIdentity(
    webServiceId,
    env.UAT_PREVIEW_EXPECTED_WEB_SERVICE_ID,
    "HR_UAT_FIXTURE_WEB_SERVICE_ID_MISMATCH",
  );
  requireIdentity(
    databaseServiceId,
    env.UAT_PREVIEW_EXPECTED_DATABASE_SERVICE_ID,
    "HR_UAT_FIXTURE_DATABASE_SERVICE_ID_MISMATCH",
  );
  requireIdentity(
    identity.databaseName,
    env.UAT_PREVIEW_DATABASE_NAME,
    "HR_UAT_FIXTURE_DATABASE_NAME_MISMATCH",
  );

  const expectedFingerprint = normalized(
    env.UAT_PREVIEW_EXPECTED_DATABASE_FINGERPRINT,
  );
  if (
    !/^[a-f0-9]{64}$/.test(expectedFingerprint) ||
    !constantTimeHexEqual(databaseFingerprint, expectedFingerprint)
  ) {
    guardError("HR_UAT_FIXTURE_DATABASE_FINGERPRINT_MISMATCH");
  }

  if (
    new TextEncoder().encode(env.UAT_PREVIEW_GUARD_SECRET?.trim() ?? "")
      .byteLength < 32
  ) {
    guardError("HR_UAT_FIXTURE_GUARD_SECRET_REQUIRED");
  }
  if (
    env.UAT_PREVIEW_SYNTHETIC_FIXTURE_ENABLED?.trim().toLowerCase() !==
    "true"
  ) {
    guardError("HR_UAT_FIXTURE_SYNTHETIC_ENABLEMENT_REQUIRED");
  }
  if (
    env.UAT_PREVIEW_OTP_INTERCEPT_ENABLED?.trim().toLowerCase() !== "true" ||
    env.UAT_PREVIEW_ACCESS_ENABLED?.trim().toLowerCase() !== "true" ||
    env.OTP_PROVIDER?.trim().toLowerCase() !== "uat_preview_intercept"
  ) {
    guardError("HR_UAT_FIXTURE_PREVIEW_OTP_REQUIRED");
  }
  if (
    RESTRICTED_FALSE_FLAGS.some(
      (name) => env[name]?.trim().toLowerCase() !== "false",
    )
  ) {
    guardError("HR_UAT_FIXTURE_RESTRICTED_FEATURE_ENABLED");
  }
  if (EXTERNAL_PROVIDER_CREDENTIALS.some((name) => Boolean(env[name]?.trim()))) {
    guardError("HR_UAT_FIXTURE_EXTERNAL_PROVIDER_FORBIDDEN");
  }

  return {
    mode: "uat-preview",
    databaseName: identity.databaseName,
    databaseFingerprint,
    syntheticBusinessName: HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_NAME,
    syntheticBusinessSlug: HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG,
  };
}

export async function assertPreviewDatabaseContents(
  database: Pick<
    PrismaClient,
    "business" | "customer" | "employeeAccount" | "employeeBusinessMembership" | "user"
  >,
  guard: HrPayrollUatFixtureGuard,
): Promise<PreviewFixtureState> {
  if (guard.mode === "local-disposable") {
    return { state: "local-unchecked", businessId: null };
  }

  const businesses = await database.business.findMany({
    select: { id: true, name: true, slug: true },
    take: 2,
  });
  if (businesses.length === 0) {
    const [customers, employeeAccounts, users] = await Promise.all([
      database.customer.count(),
      database.employeeAccount.count(),
      database.user.count(),
    ]);
    if (customers !== 0 || employeeAccounts !== 0 || users !== 0) {
      guardError("HR_UAT_FIXTURE_NON_SYNTHETIC_DATA_PRESENT");
    }
    return { state: "empty", businessId: null };
  }

  const marker = businesses[0];
  if (
    businesses.length !== 1 ||
    marker.name !== guard.syntheticBusinessName ||
    marker.slug !== guard.syntheticBusinessSlug
  ) {
    guardError("HR_UAT_FIXTURE_NON_SYNTHETIC_DATA_PRESENT");
  }

  const [foreignCustomer, foreignMembership, orphanAccount, users] =
    await Promise.all([
      database.customer.findFirst({
        where: { businessId: { not: marker.id } },
        select: { id: true },
      }),
      database.employeeBusinessMembership.findFirst({
        where: { businessId: { not: marker.id } },
        select: { id: true },
      }),
      database.employeeAccount.findFirst({
        where: { memberships: { none: { businessId: marker.id } } },
        select: { id: true },
      }),
      database.user.findMany({
        select: { businessId: true, email: true },
      }),
    ]);
  const foreignUser = users.some(
    (user) =>
      user.businessId !== marker.id &&
      !(user.businessId === null && SYNTHETIC_GROUP_USER_EMAILS.has(user.email ?? "")),
  );
  if (foreignCustomer || foreignMembership || orphanAccount || foreignUser) {
    guardError("HR_UAT_FIXTURE_NON_SYNTHETIC_DATA_PRESENT");
  }
  return { state: "synthetic-marker", businessId: marker.id };
}

export async function capturePreviewFixtureCounts(
  database: Pick<
    PrismaClient,
    | "business"
    | "employeeAccount"
    | "employeeBusinessMembership"
    | "employeeDevice"
    | "attendancePunch"
    | "attendanceMonthlyTimesheet"
    | "attendanceCorrectionRequest"
    | "leaveRequest"
    | "leaveRequestDay"
    | "leaveSupportingDocument"
    | "payrollRun"
    | "payrollEntry"
    | "payrollEntryComponent"
    | "payrollPayslipPublication"
  >,
  businessId: string,
): Promise<PreviewFixtureCounts> {
  const [
    businesses,
    employeeAccounts,
    employeeMemberships,
    activeDevices,
    attendancePunches,
    attendanceTimesheets,
    attendanceCorrections,
    leaveRequests,
    leaveDays,
    leaveEvidence,
    payrollRuns,
    payrollEntries,
    payrollComponents,
    payslipPublications,
  ] = await Promise.all([
    database.business.count({ where: { id: businessId } }),
    database.employeeAccount.count({
      where: { memberships: { some: { businessId } } },
    }),
    database.employeeBusinessMembership.count({ where: { businessId } }),
    database.employeeDevice.count({
      where: {
        status: "ACTIVE",
        employeeAccount: { memberships: { some: { businessId } } },
      },
    }),
    database.attendancePunch.count({ where: { businessId } }),
    database.attendanceMonthlyTimesheet.count({ where: { businessId } }),
    database.attendanceCorrectionRequest.count({ where: { businessId } }),
    database.leaveRequest.count({ where: { businessId } }),
    database.leaveRequestDay.count({ where: { businessId } }),
    database.leaveSupportingDocument.count({ where: { businessId } }),
    database.payrollRun.count({ where: { businessId } }),
    database.payrollEntry.count({ where: { businessId } }),
    database.payrollEntryComponent.count({ where: { businessId } }),
    database.payrollPayslipPublication.count({ where: { businessId } }),
  ]);
  return {
    businesses,
    employeeAccounts,
    employeeMemberships,
    activeDevices,
    attendancePunches,
    attendanceTimesheets,
    attendanceCorrections,
    leaveRequests,
    leaveDays,
    leaveEvidence,
    payrollRuns,
    payrollEntries,
    payrollComponents,
    payslipPublications,
  };
}

function readDatabaseIdentity(databaseUrl: string | undefined) {
  if (!databaseUrl) guardError("HR_UAT_FIXTURE_DATABASE_URL_REQUIRED");
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    guardError("HR_UAT_FIXTURE_DATABASE_URL_INVALID");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    guardError("HR_UAT_FIXTURE_DATABASE_URL_INVALID");
  }
  let databaseName: string;
  let username: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    username = decodeURIComponent(parsed.username);
  } catch {
    guardError("HR_UAT_FIXTURE_DATABASE_URL_INVALID");
  }
  if (!databaseName || !username || !parsed.hostname) {
    guardError("HR_UAT_FIXTURE_DATABASE_URL_INVALID");
  }
  return {
    hostname: parsed.hostname.toLowerCase(),
    port: parsed.port || "5432",
    databaseName,
    username,
  };
}

function requireIdentity(
  actual: string | undefined,
  expected: string | undefined,
  code: string,
) {
  if (!normalized(actual) || normalized(actual) !== normalized(expected)) {
    guardError(code);
  }
}

function normalized(value: string | undefined) {
  return value?.trim() ?? "";
}

function csvSet(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function constantTimeHexEqual(actual: string, expected: string) {
  const actualBytes = Buffer.from(actual, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function guardError(code: string): never {
  throw new Error(code);
}
