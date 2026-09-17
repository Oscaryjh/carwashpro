import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  runtimeEnvironment,
  type RuntimeEnvironmentMap,
} from "../src/lib/release/environment";

export const HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_NAME =
  "Tetamu HR Acceptance Test";
export const HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG =
  "tetamu-hr-uat-preview-synthetic-v1";
export const HR_PAYROLL_UAT_BOUNDARY_BUSINESS_NAME =
  "Tetamu HR Boundary Test";
export const HR_PAYROLL_UAT_BOUNDARY_BUSINESS_SLUG =
  "tetamu-hr-uat-preview-boundary-v1";
export const HR_PAYROLL_UAT_SYNTHETIC_TOPOLOGY_VERSION =
  "hr-payroll-uat-preview-r3-v1";

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

export type PreviewFixtureState =
  | Readonly<{
      state: "local-unchecked" | "empty";
      businessId: null;
      boundaryBusinessId: null;
    }>
  | Readonly<{
      state: "synthetic-marker";
      businessId: string;
      boundaryBusinessId: null;
    }>
  | Readonly<{
      state: "synthetic-topology";
      businessId: string;
      boundaryBusinessId: string;
    }>;

export type PreviewFixtureCounts = Readonly<{
  businesses: number;
  branches: number;
  employeeAccounts: number;
  employeeMemberships: number;
  activeDevices: number;
  attendancePunches: number;
  attendanceTimesheets: number;
  attendanceExceptions: number;
  attendanceP2Exceptions: number;
  attendanceCorrections: number;
  leaveRequests: number;
  leaveDays: number;
  leaveEvidence: number;
  leaveBalances: number;
  leaveEntitlements: number;
  leaveEntitlementBuckets: number;
  leaveLedgerEntries: number;
  leaveConsumptionAllocations: number;
  payrollRuns: number;
  payrollEntries: number;
  payrollComponents: number;
  payslipPublications: number;
  activeEmployeeSessions: number;
  activeAppSessions: number;
  otpChallenges: number;
  historicalOtpChallenges: number;
  activeOtpChallenges: number;
  paymentBatches: number;
  statutorySubmissions: number;
  outboundWhatsApp: number;
  outboundNotifications: number;
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
    | "business"
    | "branch"
    | "businessGroupMember"
    | "customer"
    | "employeeAccount"
    | "employeeBusinessMembership"
    | "user"
  >,
  guard: HrPayrollUatFixtureGuard,
): Promise<PreviewFixtureState> {
  if (guard.mode === "local-disposable") {
    return {
      state: "local-unchecked",
      businessId: null,
      boundaryBusinessId: null,
    };
  }

  const businesses = await database.business.findMany({
    select: { id: true, name: true, slug: true },
    take: 3,
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
    return { state: "empty", businessId: null, boundaryBusinessId: null };
  }

  const marker = businesses.find(
    (business) =>
      business.name === guard.syntheticBusinessName &&
      business.slug === guard.syntheticBusinessSlug,
  );
  if (!marker) {
    guardError("HR_UAT_FIXTURE_NON_SYNTHETIC_DATA_PRESENT");
  }
  const boundary = businesses.find(
    (business) =>
      business.name === HR_PAYROLL_UAT_BOUNDARY_BUSINESS_NAME &&
      business.slug === HR_PAYROLL_UAT_BOUNDARY_BUSINESS_SLUG,
  );
  if (businesses.length !== 1 && !(businesses.length === 2 && boundary)) {
    guardError("HR_UAT_FIXTURE_NON_SYNTHETIC_DATA_PRESENT");
  }
  const allowedBusinessIds = boundary ? [marker.id, boundary.id] : [marker.id];

  const [foreignCustomer, foreignMembership, orphanAccount, users] =
    await Promise.all([
      database.customer.findFirst({
        where: { businessId: { notIn: allowedBusinessIds } },
        select: { id: true },
      }),
      database.employeeBusinessMembership.findFirst({
        where: { businessId: { notIn: allowedBusinessIds } },
        select: { id: true },
      }),
      database.employeeAccount.findFirst({
        where: { memberships: { none: { businessId: { in: allowedBusinessIds } } } },
        select: { id: true },
      }),
      database.user.findMany({
        select: { businessId: true, email: true },
      }),
    ]);
  const foreignUser = users.some(
    (user) =>
      !allowedBusinessIds.includes(user.businessId ?? "") &&
      !(user.businessId === null && SYNTHETIC_GROUP_USER_EMAILS.has(user.email ?? "")),
  );
  if (foreignCustomer || foreignMembership || orphanAccount || foreignUser) {
    guardError("HR_UAT_FIXTURE_NON_SYNTHETIC_DATA_PRESENT");
  }
  if (!boundary) {
    return {
      state: "synthetic-marker",
      businessId: marker.id,
      boundaryBusinessId: null,
    };
  }
  const [branchCount, boundaryMemberships, groupMemberships] = await Promise.all([
    database.branch.count({ where: { businessId: { in: allowedBusinessIds } } }),
    database.employeeBusinessMembership.findMany({
      where: {
        OR: [
          { businessId: marker.id, employeeCode: "BOUNDARY-B" },
          { businessId: boundary.id, employeeCode: "TENANT-B" },
        ],
      },
      select: { businessId: true, employeeCode: true },
    }),
    database.businessGroupMember.findMany({
      where: { businessId: { in: allowedBusinessIds }, status: "ACTIVE" },
      select: { businessId: true, groupId: true },
    }),
  ]);
  if (
    branchCount !== 3 ||
    boundaryMemberships.length !== 2 ||
    groupMemberships.length !== 2 ||
    groupMemberships[0]?.groupId !== groupMemberships[1]?.groupId
  ) {
    guardError("HR_UAT_FIXTURE_SYNTHETIC_TOPOLOGY_PARTIAL");
  }
  return {
    state: "synthetic-topology",
    businessId: marker.id,
    boundaryBusinessId: boundary.id,
  };
}

export async function capturePreviewFixtureCounts(
  database: Pick<
    PrismaClient,
    | "business"
    | "branch"
    | "employeeAccount"
    | "employeeBusinessMembership"
    | "employeeDevice"
    | "attendancePunch"
    | "attendanceMonthlyTimesheet"
    | "attendanceException"
    | "attendanceP2Exception"
    | "attendanceCorrectionRequest"
    | "leaveRequest"
    | "leaveRequestDay"
    | "leaveSupportingDocument"
    | "employeeLeaveBalance"
    | "employeeLeaveEntitlement"
    | "leaveEntitlementBucket"
    | "leaveBalanceLedgerEntry"
    | "leaveConsumptionAllocation"
    | "payrollRun"
    | "payrollEntry"
    | "payrollEntryComponent"
    | "payrollPayslipPublication"
    | "employeeSession"
    | "authSession"
    | "employeeOtpChallenge"
    | "payrollPaymentBatch"
    | "payrollStatutorySubmission"
    | "whatsAppMessage"
    | "notificationQueue"
  >,
  businessId: string,
): Promise<PreviewFixtureCounts> {
  const boundaryBusiness = await database.business.findUnique({
    where: { slug: HR_PAYROLL_UAT_BOUNDARY_BUSINESS_SLUG },
    select: { id: true },
  });
  const businessIds = boundaryBusiness
    ? [businessId, boundaryBusiness.id]
    : [businessId];
  const observedAt = new Date();
  const [
    businesses,
    branches,
    employeeAccounts,
    employeeMemberships,
    activeDevices,
    attendancePunches,
    attendanceTimesheets,
    attendanceExceptions,
    attendanceP2Exceptions,
    attendanceCorrections,
    leaveRequests,
    leaveDays,
    leaveEvidence,
    leaveBalances,
    leaveEntitlements,
    leaveEntitlementBuckets,
    leaveLedgerEntries,
    leaveConsumptionAllocations,
    payrollRuns,
    payrollEntries,
    payrollComponents,
    payslipPublications,
    activeEmployeeSessions,
    activeAppSessions,
    otpChallengeStates,
    paymentBatches,
    statutorySubmissions,
    outboundWhatsApp,
    outboundNotifications,
  ] = await Promise.all([
    database.business.count({ where: { id: { in: businessIds } } }),
    database.branch.count({ where: { businessId: { in: businessIds } } }),
    database.employeeAccount.count({
      where: { memberships: { some: { businessId: { in: businessIds } } } },
    }),
    database.employeeBusinessMembership.count({ where: { businessId: { in: businessIds } } }),
    database.employeeDevice.count({
      where: {
        status: "ACTIVE",
        employeeAccount: { memberships: { some: { businessId: { in: businessIds } } } },
      },
    }),
    database.attendancePunch.count({ where: { businessId: { in: businessIds } } }),
    database.attendanceMonthlyTimesheet.count({ where: { businessId: { in: businessIds } } }),
    database.attendanceException.count({ where: { businessId: { in: businessIds } } }),
    database.attendanceP2Exception.count({ where: { businessId: { in: businessIds } } }),
    database.attendanceCorrectionRequest.count({ where: { businessId: { in: businessIds } } }),
    database.leaveRequest.count({ where: { businessId: { in: businessIds } } }),
    database.leaveRequestDay.count({ where: { businessId: { in: businessIds } } }),
    database.leaveSupportingDocument.count({ where: { businessId: { in: businessIds } } }),
    database.employeeLeaveBalance.count({ where: { businessId: { in: businessIds } } }),
    database.employeeLeaveEntitlement.count({ where: { businessId: { in: businessIds } } }),
    database.leaveEntitlementBucket.count({ where: { businessId: { in: businessIds } } }),
    database.leaveBalanceLedgerEntry.count({ where: { businessId: { in: businessIds } } }),
    database.leaveConsumptionAllocation.count({ where: { businessId: { in: businessIds } } }),
    database.payrollRun.count({ where: { businessId: { in: businessIds } } }),
    database.payrollEntry.count({ where: { businessId: { in: businessIds } } }),
    database.payrollEntryComponent.count({ where: { businessId: { in: businessIds } } }),
    database.payrollPayslipPublication.count({ where: { businessId: { in: businessIds } } }),
    database.employeeSession.count({
      where: { businessId: { in: businessIds }, revokedAt: null },
    }),
    database.authSession.count({
      where: {
        revokedAt: null,
        user: {
          OR: [
            { businessId: { in: businessIds } },
            { email: { in: [...SYNTHETIC_GROUP_USER_EMAILS] } },
          ],
        },
      },
    }),
    database.employeeOtpChallenge.findMany({
      // Include unlinked challenges. Only terminal lifecycle state is read;
      // phone numbers, OTP hashes and provider references are not needed.
      select: { expiresAt: true, invalidatedAt: true },
    }),
    database.payrollPaymentBatch.count({ where: { businessId: { in: businessIds } } }),
    database.payrollStatutorySubmission.count({ where: { businessId: { in: businessIds } } }),
    database.whatsAppMessage.count({ where: { businessId: { in: businessIds } } }),
    database.notificationQueue.count({ where: { businessId: { in: businessIds } } }),
  ]);
  const otpAudit = { historicalOtpChallenges: 0, activeOtpChallenges: 0 };
  for (const challenge of otpChallengeStates) {
    if (challenge.invalidatedAt !== null || challenge.expiresAt <= observedAt) {
      otpAudit.historicalOtpChallenges += 1;
    } else {
      // Verified-but-unconsumed challenges can still complete membership
      // selection; exhausted attempts alone are not proof of terminal state.
      otpAudit.activeOtpChallenges += 1;
    }
  }
  return {
    businesses,
    branches,
    employeeAccounts,
    employeeMemberships,
    activeDevices,
    attendancePunches,
    attendanceTimesheets,
    attendanceExceptions,
    attendanceP2Exceptions,
    attendanceCorrections,
    leaveRequests,
    leaveDays,
    leaveEvidence,
    leaveBalances,
    leaveEntitlements,
    leaveEntitlementBuckets,
    leaveLedgerEntries,
    leaveConsumptionAllocations,
    payrollRuns,
    payrollEntries,
    payrollComponents,
    payslipPublications,
    activeEmployeeSessions,
    activeAppSessions,
    otpChallenges: otpChallengeStates.length,
    ...otpAudit,
    paymentBatches,
    statutorySubmissions,
    outboundWhatsApp,
    outboundNotifications,
  };
}

export type PreviewFixtureEvidence = Readonly<{
  counts: PreviewFixtureCounts;
  duplicateCount: number;
  stableFixtureDigest: string;
  domains: Readonly<{
    leave: Readonly<{
      employeeCode: string | null;
      requestStatus: string | null;
      requestUnits: number | null;
      balanceYear: number | null;
      balanceEntitlementUnits: number | null;
      entitlementUnits: number | null;
      bucketStatus: string | null;
      bucketGrantedUnits: number | null;
      allocationUnits: number | null;
      ledgerUnits: readonly number[];
      ledgerBalanceUnits: number;
      availableUnits: number | null;
      linksValid: boolean;
    }>;
    attendance: Readonly<{
      employeeCode: string | null;
      exceptionType: string | null;
      exceptionStatus: string | null;
      p2ExceptionType: string | null;
      p2ExceptionStatus: string | null;
      correctionStatus: string | null;
      workDate: string | null;
      linksValid: boolean;
    }>;
    boundary: Readonly<{
      linksValid: boolean;
      topologyVersion: typeof HR_PAYROLL_UAT_SYNTHETIC_TOPOLOGY_VERSION;
    }>;
    lockedTimesheets: number;
    approvedOtSnapshots: number;
    payrollRunStatus: string | null;
  }>;
}>;

export async function capturePreviewFixtureEvidence(
  database: PrismaClient,
  businessId: string,
): Promise<PreviewFixtureEvidence> {
  const counts = await capturePreviewFixtureCounts(database, businessId);
  const boundaryBusiness = await database.business.findUnique({
    where: { slug: HR_PAYROLL_UAT_BOUNDARY_BUSINESS_SLUG },
    select: { id: true, name: true, slug: true },
  });
  const businessIds = boundaryBusiness
    ? [businessId, boundaryBusiness.id]
    : [businessId];
  const [
    memberships,
    annualPolicy,
    paidLeave,
    leaveBalances,
    leaveEntitlements,
    leaveBuckets,
    leaveAllocations,
    leaveLedger,
    attendanceExceptions,
    attendanceP2Exceptions,
    attendanceCorrections,
    employeeSessions,
    lockedTimesheets,
    approvedOtSnapshots,
    payrollRuns,
    payrollEntries,
    payslips,
    users,
  ] = await Promise.all([
    database.employeeBusinessMembership.findMany({
      where: { businessId: { in: businessIds } },
      select: { id: true, employeeCode: true, fullName: true },
      orderBy: { employeeCode: "asc" },
    }),
    database.leavePolicy.findFirst({
      where: { businessId, code: "ANNUAL", balanceTracked: true },
      select: {
        id: true,
        code: true,
        defaultEntitlementDays: true,
        versions: {
          where: { status: "ACTIVE" },
          select: { id: true, revision: true },
          orderBy: { revision: "desc" },
          take: 1,
        },
      },
    }),
    database.leaveRequest.findFirst({
      where: {
        businessId,
        membership: { employeeCode: "CORE-C" },
        status: "APPROVED",
        balanceTrackedSnapshot: true,
      },
      select: {
        id: true,
        membershipId: true,
        policyId: true,
        policyVersionId: true,
        status: true,
        requestedDays: true,
        days: {
          select: { balanceConsumptionUnits: true },
          orderBy: { leaveDate: "asc" },
        },
      },
    }),
    database.employeeLeaveBalance.findMany({
      where: { businessId },
      orderBy: [{ membershipId: "asc" }, { policyId: "asc" }, { year: "asc" }],
    }),
    database.employeeLeaveEntitlement.findMany({
      where: { businessId },
      orderBy: [{ membershipId: "asc" }, { policyId: "asc" }, { leaveYearStart: "asc" }],
    }),
    database.leaveEntitlementBucket.findMany({
      where: { businessId },
      orderBy: [{ membershipId: "asc" }, { policyId: "asc" }, { periodStart: "asc" }],
    }),
    database.leaveConsumptionAllocation.findMany({
      where: { businessId },
      orderBy: { sourceKey: "asc" },
    }),
    database.leaveBalanceLedgerEntry.findMany({
      where: { businessId },
      orderBy: { sourceKey: "asc" },
    }),
    database.attendanceException.findMany({
      where: { businessId },
      orderBy: { id: "asc" },
    }),
    database.attendanceP2Exception.findMany({
      where: { businessId },
      orderBy: { stableKey: "asc" },
    }),
    database.attendanceCorrectionRequest.findMany({
      where: { businessId },
      orderBy: { requestKey: "asc" },
    }),
    database.employeeSession.findMany({
      where: { businessId },
      select: { id: true, businessId: true, membershipId: true },
      orderBy: { createdAt: "asc" },
    }),
    database.attendanceMonthlyTimesheet.count({
      where: { businessId, status: "LOCKED" },
    }),
    database.attendanceTimesheetP2DaySnapshot.count({
      where: {
        businessId,
        approvedOtMinutes: { gt: 0 },
        otApprovalStatus: "APPROVED",
      },
    }),
    database.payrollRun.findMany({
      where: { businessId: { in: businessIds } },
      select: { id: true, periodStart: true, status: true },
      orderBy: { periodStart: "asc" },
    }),
    database.payrollEntry.findMany({
      where: { businessId: { in: businessIds } },
      select: {
        id: true,
        employeeCodeSnapshot: true,
        fullNameSnapshot: true,
        grossPay: true,
        netPay: true,
        components: {
          select: {
            lineKey: true,
            amount: true,
            sourceType: true,
            sortOrder: true,
          },
          orderBy: [{ sortOrder: "asc" }, { lineKey: "asc" }],
        },
      },
      orderBy: { employeeCodeSnapshot: "asc" },
    }),
    database.payrollPayslipPublication.findMany({
      where: { businessId: { in: businessIds } },
      select: {
        id: true,
        payrollRunId: true,
        payrollEntryId: true,
        membershipId: true,
        documentSha256: true,
      },
      orderBy: { payrollEntryId: "asc" },
    }),
    database.user.findMany({
      where: {
        OR: [
          { businessId: { in: businessIds } },
          { email: { in: [...SYNTHETIC_GROUP_USER_EMAILS] } },
        ],
      },
      select: {
        id: true,
        businessId: true,
        email: true,
        role: true,
        permissions: true,
        status: true,
      },
      orderBy: { email: "asc" },
    }),
  ]);

  const [
    businesses,
    branches,
    boundaryMemberships,
    boundaryLeaveRequests,
    boundaryTimesheetDays,
    boundaryPayslips,
    groupMembers,
    groupManager,
  ] =
    await Promise.all([
      database.business.findMany({
        where: { id: { in: businessIds } },
        select: { id: true, name: true, slug: true },
        orderBy: { slug: "asc" },
      }),
      database.branch.findMany({
        where: { businessId: { in: businessIds } },
        select: { id: true, businessId: true, name: true },
        orderBy: [{ businessId: "asc" }, { name: "asc" }],
      }),
      database.employeeBusinessMembership.findMany({
        where: {
          OR: [
            { businessId, employeeCode: "BOUNDARY-B" },
            ...(boundaryBusiness
              ? [{ businessId: boundaryBusiness.id, employeeCode: "TENANT-B" }]
              : []),
          ],
        },
        select: {
          id: true,
          businessId: true,
          employeeCode: true,
          branchAssignments: {
            where: { status: "ACTIVE", isPrimary: true },
            select: { branchId: true },
          },
        },
        orderBy: { employeeCode: "asc" },
      }),
      database.leaveRequest.findMany({
        where: {
          status: "APPROVED",
          membership: { employeeCode: { in: ["BOUNDARY-B", "TENANT-B"] } },
        },
        select: { membershipId: true },
      }),
      database.attendanceTimesheetP2DaySnapshot.findMany({
        where: { businessId: { in: businessIds } },
        select: { membershipId: true },
      }),
      database.payrollPayslipPublication.findMany({
        where: { membership: { employeeCode: { in: ["BOUNDARY-B", "TENANT-B"] } } },
        select: { membershipId: true },
      }),
      database.businessGroupMember.findMany({
        where: { businessId: { in: businessIds }, status: "ACTIVE" },
        select: { businessId: true, groupId: true },
        orderBy: { businessId: "asc" },
      }),
      database.businessGroupUser.findFirst({
        where: {
          role: "GROUP_MANAGER",
          status: "ACTIVE",
          user: { email: "uat.group-manager@tetamu.local" },
        },
        select: {
          accessScope: true,
          groupId: true,
          businessAccesses: {
            select: { businessId: true },
            orderBy: { businessId: "asc" },
          },
        },
      }),
    ]);
  const boundaryLinksValid = Boolean(
    boundaryBusiness &&
      businesses.length === 2 &&
      branches.filter((branch) => branch.businessId === businessId).length === 2 &&
      branches.filter((branch) => branch.businessId === boundaryBusiness.id).length === 1 &&
      boundaryMemberships.length === 2 &&
      boundaryMemberships.every(
        (membership) =>
          membership.branchAssignments.length === 1 &&
          boundaryLeaveRequests.filter((row) => row.membershipId === membership.id).length === 1 &&
          boundaryTimesheetDays.filter((row) => row.membershipId === membership.id).length === 1 &&
          boundaryPayslips.filter((row) => row.membershipId === membership.id).length === 1,
      ) &&
      groupMembers.length === 2 &&
      groupMembers[0]?.groupId === groupMembers[1]?.groupId &&
      groupManager?.groupId === groupMembers[0]?.groupId &&
      groupManager.accessScope === "SELECTED_BUSINESSES" &&
      groupManager.businessAccesses.length === 1 &&
      groupManager.businessAccesses[0]?.businessId === businessId,
  );

  const membershipCodeById = new Map(
    memberships.map((membership) => [membership.id, membership.employeeCode]),
  );
  const policyVersion = annualPolicy?.versions[0] ?? null;
  const balance = leaveBalances[0] ?? null;
  const entitlement = leaveEntitlements[0] ?? null;
  const bucket = leaveBuckets[0] ?? null;
  const allocation = leaveAllocations[0] ?? null;
  const legacyException = attendanceExceptions[0] ?? null;
  const p2Exception = attendanceP2Exceptions[0] ?? null;
  const correction = attendanceCorrections[0] ?? null;
  const correctionSession = correction
    ? employeeSessions.find((session) => session.id === correction.employeeSessionId) ?? null
    : null;
  const requestUnits = paidLeave
    ? paidLeave.days.reduce(
        (sum, day) => sum + Number(day.balanceConsumptionUnits),
        0,
      )
    : null;
  const ledgerUnits = leaveLedger
    .map((entry) => Number(entry.units))
    .sort((left, right) => left - right);
  const ledgerBalanceUnits = ledgerUnits.reduce((sum, units) => sum + units, 0);
  const allocationUnits = allocation ? Number(allocation.units) : null;
  const bucketGrantedUnits = bucket ? Number(bucket.grantedUnits) : null;
  const availableUnits =
    bucketGrantedUnits === null || allocationUnits === null
      ? null
      : bucketGrantedUnits - allocationUnits;
  const leaveLinksValid = Boolean(
    paidLeave &&
      balance &&
      entitlement &&
      bucket &&
      allocation &&
      annualPolicy &&
      policyVersion &&
      balance.membershipId === paidLeave.membershipId &&
      balance.policyId === paidLeave.policyId &&
      entitlement.membershipId === paidLeave.membershipId &&
      entitlement.policyId === paidLeave.policyId &&
      entitlement.policyVersionId === paidLeave.policyVersionId &&
      entitlement.policyVersionId === policyVersion.id &&
      bucket.membershipId === paidLeave.membershipId &&
      bucket.policyId === paidLeave.policyId &&
      bucket.policyVersionId === paidLeave.policyVersionId &&
      bucket.entitlementId === entitlement.id &&
      allocation.leaveRequestId === paidLeave.id &&
      allocation.bucketId === bucket.id &&
      leaveLedger.some(
        (entry) =>
          entry.eventType === "ENTITLEMENT" &&
          entry.entitlementId === entitlement.id &&
          entry.bucketId === bucket.id,
      ) &&
      leaveLedger.some(
        (entry) =>
          entry.eventType === "APPROVED_CONSUMPTION" &&
          entry.leaveRequestId === paidLeave.id &&
          entry.bucketId === bucket.id &&
          entry.allocationId === allocation.id,
      ),
  );
  const attendanceLinksValid = Boolean(
    legacyException &&
      p2Exception &&
      correction &&
      correctionSession &&
      legacyException.employeeId === p2Exception.membershipId &&
      legacyException.branchId === p2Exception.branchId &&
      correction.exceptionId === p2Exception.id &&
      correction.membershipId === p2Exception.membershipId &&
      correctionSession.businessId === businessId &&
      correctionSession.membershipId === correction.membershipId,
  );
  const exactExpectedCounts: Partial<Record<keyof PreviewFixtureCounts, number>> = {
    businesses: 2,
    branches: 3,
    employeeAccounts: 8,
    employeeMemberships: 8,
    activeDevices: 6,
    attendanceTimesheets: 2,
    attendanceExceptions: 1,
    attendanceP2Exceptions: 1,
    attendanceCorrections: 1,
    leaveRequests: 4,
    leaveDays: 4,
    leaveBalances: 1,
    leaveEntitlements: 1,
    leaveEntitlementBuckets: 1,
    leaveLedgerEntries: 2,
    leaveConsumptionAllocations: 1,
    payrollRuns: 3,
    payrollEntries: 8,
    payslipPublications: 8,
    activeEmployeeSessions: 0,
    activeAppSessions: 0,
    paymentBatches: 0,
    statutorySubmissions: 0,
    outboundWhatsApp: 0,
    outboundNotifications: 0,
  };
  const duplicateCount = Object.entries(exactExpectedCounts).reduce(
    (sum, [name, expected]) =>
      sum + Math.max(0, counts[name as keyof PreviewFixtureCounts] - expected),
    0,
  );
  const stableProjection = {
    marker: HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG,
    topologyVersion: HR_PAYROLL_UAT_SYNTHETIC_TOPOLOGY_VERSION,
    businesses,
    branches,
    boundaryMemberships,
    groupMembers,
    groupManager,
    memberships,
    users: users.map((user) => ({
      ...user,
      permissions: [...user.permissions].sort(),
    })),
    annualPolicy: annualPolicy && {
      id: annualPolicy.id,
      code: annualPolicy.code,
      defaultEntitlementDays: annualPolicy.defaultEntitlementDays?.toString() ?? null,
      versions: annualPolicy.versions,
    },
    paidLeave: paidLeave && {
      id: paidLeave.id,
      membershipId: paidLeave.membershipId,
      policyId: paidLeave.policyId,
      policyVersionId: paidLeave.policyVersionId,
      status: paidLeave.status,
      requestedDays: paidLeave.requestedDays.toString(),
      dayUnits: paidLeave.days.map((day) => day.balanceConsumptionUnits.toString()),
    },
    leaveBalances: leaveBalances.map((row) => ({
      id: row.id,
      membershipId: row.membershipId,
      policyId: row.policyId,
      year: row.year,
      entitlementOverrideDays: row.entitlementOverrideDays?.toString() ?? null,
      carriedForwardDays: row.carriedForwardDays.toString(),
      adjustmentDays: row.adjustmentDays.toString(),
    })),
    leaveEntitlements: leaveEntitlements.map((row) => ({
      id: row.id,
      membershipId: row.membershipId,
      policyId: row.policyId,
      policyVersionId: row.policyVersionId,
      leaveYearStart: row.leaveYearStart.toISOString(),
      leaveYearEnd: row.leaveYearEnd.toISOString(),
      entitledUnits: row.entitledUnits.toString(),
      source: row.source,
      sourceDigest: row.sourceDigest,
    })),
    leaveBuckets: leaveBuckets.map((row) => ({
      id: row.id,
      membershipId: row.membershipId,
      policyId: row.policyId,
      policyVersionId: row.policyVersionId,
      periodStart: row.periodStart.toISOString(),
      periodEnd: row.periodEnd.toISOString(),
      grantedUnits: row.grantedUnits.toString(),
      status: row.status,
      entitlementId: row.entitlementId,
      sourceDigest: row.sourceDigest,
    })),
    leaveAllocations: leaveAllocations.map((row) => ({
      id: row.id,
      leaveRequestId: row.leaveRequestId,
      bucketId: row.bucketId,
      units: row.units.toString(),
      sourceKey: row.sourceKey,
    })),
    leaveLedger: leaveLedger.map((row) => ({
      id: row.id,
      membershipId: row.membershipId,
      policyId: row.policyId,
      policyVersionId: row.policyVersionId,
      eventType: row.eventType,
      units: row.units.toString(),
      sourceKey: row.sourceKey,
      leaveRequestId: row.leaveRequestId,
      entitlementId: row.entitlementId,
      bucketId: row.bucketId,
      allocationId: row.allocationId,
    })),
    attendanceExceptions: attendanceExceptions.map((row) => ({
      id: row.id,
      employeeId: row.employeeId,
      branchId: row.branchId,
      type: row.type,
      status: row.status,
      requestedClockInAt: row.requestedClockInAt?.toISOString() ?? null,
      requestedClockOutAt: row.requestedClockOutAt?.toISOString() ?? null,
    })),
    attendanceP2Exceptions: attendanceP2Exceptions.map((row) => ({
      id: row.id,
      branchId: row.branchId,
      membershipId: row.membershipId,
      workDate: row.workDate.toISOString(),
      type: row.type,
      status: row.status,
      stableKey: row.stableKey,
      sourceDigest: row.sourceDigest,
    })),
    attendanceCorrections: attendanceCorrections.map((row) => ({
      id: row.id,
      exceptionId: row.exceptionId,
      membershipId: row.membershipId,
      requestKey: row.requestKey,
      requestedClockInAt: row.requestedClockInAt?.toISOString() ?? null,
      requestedClockOutAt: row.requestedClockOutAt?.toISOString() ?? null,
      status: row.status,
    })),
    lockedTimesheets,
    approvedOtSnapshots,
    payrollRuns: payrollRuns.map((row) => ({
      ...row,
      periodStart: row.periodStart.toISOString(),
    })),
    payrollEntries: payrollEntries.map((entry) => ({
      ...entry,
      grossPay: entry.grossPay.toString(),
      netPay: entry.netPay.toString(),
      components: entry.components.map((component) => ({
        ...component,
        amount: component.amount.toString(),
      })),
    })),
    payslips,
  };
  const stableFixtureDigest = createHash("sha256")
    .update(JSON.stringify(stableProjection))
    .digest("hex");

  return {
    counts,
    duplicateCount,
    stableFixtureDigest,
    domains: {
      leave: {
        employeeCode: paidLeave
          ? membershipCodeById.get(paidLeave.membershipId) ?? null
          : null,
        requestStatus: paidLeave?.status ?? null,
        requestUnits,
        balanceYear: balance?.year ?? null,
        balanceEntitlementUnits:
          balance?.entitlementOverrideDays === null ||
          balance?.entitlementOverrideDays === undefined
            ? null
            : Number(balance.entitlementOverrideDays),
        entitlementUnits: entitlement ? Number(entitlement.entitledUnits) : null,
        bucketStatus: bucket?.status ?? null,
        bucketGrantedUnits,
        allocationUnits,
        ledgerUnits,
        ledgerBalanceUnits,
        availableUnits,
        linksValid: leaveLinksValid,
      },
      attendance: {
        employeeCode: p2Exception
          ? membershipCodeById.get(p2Exception.membershipId) ?? null
          : null,
        exceptionType: legacyException?.type ?? null,
        exceptionStatus: legacyException?.status ?? null,
        p2ExceptionType: p2Exception?.type ?? null,
        p2ExceptionStatus: p2Exception?.status ?? null,
        correctionStatus: correction?.status ?? null,
        workDate: p2Exception?.workDate.toISOString() ?? null,
        linksValid: attendanceLinksValid,
      },
      boundary: {
        linksValid: boundaryLinksValid,
        topologyVersion: HR_PAYROLL_UAT_SYNTHETIC_TOPOLOGY_VERSION,
      },
      lockedTimesheets,
      approvedOtSnapshots,
      payrollRunStatus: payrollRuns[0]?.status ?? null,
    },
  };
}

export function assertCompletePreviewFixtureEvidence(
  evidence: PreviewFixtureEvidence,
) {
  const { counts, domains } = evidence;
  const requiredCounts: ReadonlyArray<
    readonly [keyof PreviewFixtureCounts, number, string]
  > = [
    ["businesses", 2, "HR_UAT_FIXTURE_BUSINESS_COUNT_MISMATCH"],
    ["branches", 3, "HR_UAT_FIXTURE_BRANCH_COUNT_MISMATCH"],
    ["employeeAccounts", 8, "HR_UAT_FIXTURE_EMPLOYEE_ACCOUNT_COUNT_MISMATCH"],
    ["employeeMemberships", 8, "HR_UAT_FIXTURE_MEMBERSHIP_COUNT_MISMATCH"],
    ["activeDevices", 6, "HR_UAT_FIXTURE_DEVICE_COUNT_MISMATCH"],
    ["attendanceTimesheets", 2, "HR_UAT_FIXTURE_TIMESHEET_COUNT_MISMATCH"],
    ["attendanceExceptions", 1, "HR_UAT_FIXTURE_ATTENDANCE_EXCEPTION_MISSING"],
    ["attendanceP2Exceptions", 1, "HR_UAT_FIXTURE_ATTENDANCE_P2_EXCEPTION_MISSING"],
    ["attendanceCorrections", 1, "HR_UAT_FIXTURE_ATTENDANCE_CORRECTION_MISSING"],
    ["leaveRequests", 4, "HR_UAT_FIXTURE_LEAVE_REQUEST_COUNT_MISMATCH"],
    ["leaveDays", 4, "HR_UAT_FIXTURE_LEAVE_DAY_COUNT_MISMATCH"],
    ["leaveBalances", 1, "HR_UAT_FIXTURE_LEAVE_BALANCE_MISSING"],
    ["leaveEntitlements", 1, "HR_UAT_FIXTURE_LEAVE_ENTITLEMENT_MISSING"],
    ["leaveEntitlementBuckets", 1, "HR_UAT_FIXTURE_LEAVE_BUCKET_MISSING"],
    ["leaveLedgerEntries", 2, "HR_UAT_FIXTURE_LEAVE_LEDGER_MISSING"],
    ["leaveConsumptionAllocations", 1, "HR_UAT_FIXTURE_LEAVE_ALLOCATION_MISSING"],
    ["payrollRuns", 3, "HR_UAT_FIXTURE_PAYROLL_RUN_COUNT_MISMATCH"],
    ["payrollEntries", 8, "HR_UAT_FIXTURE_PAYROLL_ENTRY_COUNT_MISMATCH"],
    ["payslipPublications", 8, "HR_UAT_FIXTURE_PAYSLIP_COUNT_MISMATCH"],
    ["activeEmployeeSessions", 0, "HR_UAT_FIXTURE_ACTIVE_EMPLOYEE_SESSION_PRESENT"],
    ["activeAppSessions", 0, "HR_UAT_FIXTURE_ACTIVE_APP_SESSION_PRESENT"],
    ["activeOtpChallenges", 0, "HR_UAT_FIXTURE_OTP_CHALLENGE_PRESENT"],
    ["paymentBatches", 0, "HR_UAT_FIXTURE_PAYMENT_BATCH_PRESENT"],
    ["statutorySubmissions", 0, "HR_UAT_FIXTURE_STATUTORY_SUBMISSION_PRESENT"],
    ["outboundWhatsApp", 0, "HR_UAT_FIXTURE_WHATSAPP_OUTBOUND_PRESENT"],
    ["outboundNotifications", 0, "HR_UAT_FIXTURE_NOTIFICATION_OUTBOUND_PRESENT"],
  ];
  for (const [name, expected, error] of requiredCounts) {
    if (counts[name] !== expected) guardError(error);
  }
  if (counts.payrollComponents <= 0) {
    guardError("HR_UAT_FIXTURE_PAYROLL_COMPONENTS_MISSING");
  }
  if (evidence.duplicateCount !== 0) {
    guardError("HR_UAT_FIXTURE_DUPLICATES_PRESENT");
  }
  if (
    domains.leave.employeeCode !== "CORE-C" ||
    domains.leave.requestStatus !== "APPROVED" ||
    domains.leave.requestUnits !== 1 ||
    domains.leave.balanceYear !== 2026 ||
    domains.leave.balanceEntitlementUnits !== 12 ||
    domains.leave.entitlementUnits !== 12 ||
    domains.leave.bucketStatus !== "ACTIVE" ||
    domains.leave.bucketGrantedUnits !== 12 ||
    domains.leave.allocationUnits !== 1 ||
    JSON.stringify(domains.leave.ledgerUnits) !== JSON.stringify([-1, 12]) ||
    domains.leave.ledgerBalanceUnits !== 11 ||
    domains.leave.availableUnits !== 11 ||
    !domains.leave.linksValid
  ) {
    guardError("HR_UAT_FIXTURE_LEAVE_RELATION_MISMATCH");
  }
  if (
    domains.attendance.employeeCode !== "CORE-A" ||
    domains.attendance.exceptionType !== "FORGOT_CLOCK_OUT" ||
    domains.attendance.exceptionStatus !== "PENDING" ||
    domains.attendance.p2ExceptionType !== "MISSING_CLOCK_OUT" ||
    domains.attendance.p2ExceptionStatus !== "PENDING_MANAGER" ||
    domains.attendance.correctionStatus !== "PENDING" ||
    domains.attendance.workDate !== "2026-09-01T00:00:00.000Z" ||
    !domains.attendance.linksValid
  ) {
    guardError("HR_UAT_FIXTURE_ATTENDANCE_RELATION_MISMATCH");
  }
  if (domains.lockedTimesheets !== 1) {
    guardError("HR_UAT_FIXTURE_LOCKED_TIMESHEET_MISSING");
  }
  if (domains.approvedOtSnapshots !== 1) {
    guardError("HR_UAT_FIXTURE_APPROVED_OT_MISSING");
  }
  if (domains.payrollRunStatus !== "FINALIZED") {
    guardError("HR_UAT_FIXTURE_PAYROLL_RUN_NOT_FINALIZED");
  }
  if (
    !domains.boundary.linksValid ||
    domains.boundary.topologyVersion !== HR_PAYROLL_UAT_SYNTHETIC_TOPOLOGY_VERSION
  ) {
    guardError("HR_UAT_FIXTURE_BOUNDARY_RELATION_MISMATCH");
  }
  if (!/^[a-f0-9]{64}$/.test(evidence.stableFixtureDigest)) {
    guardError("HR_UAT_FIXTURE_STABLE_DIGEST_INVALID");
  }
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
