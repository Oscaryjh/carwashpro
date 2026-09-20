import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after, before } from "node:test";
import { PrismaClient } from "@prisma/client";
import { getPayrollPeriodReadiness } from "../../src/lib/payroll/readiness";
import {
  assertCompletePreviewFixtureEvidence,
  assertHrPayrollUatFixtureEnvironment,
  assertPreviewDatabaseContents,
  capturePreviewFixtureCounts,
  capturePreviewFixtureEvidence,
  databaseConnectionFingerprint,
  HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG,
} from "../../scripts/uat-preview-database-guard";
import { HR_PAYROLL_EIGHT_ROLE_PERSONAS } from "../../scripts/hr-payroll-eight-role-uat-contract";

const BOUNDARY_BUSINESS_SLUG = "tetamu-hr-uat-preview-boundary-v1";

const ISOLATED_DATABASE_NAME =
  `tetamu_uat_preview_fixture_${process.pid}_${Date.now()}`;
const FINGERPRINT_SECRET =
  "preview-integration-fingerprint-secret-longer-than-thirty-two-bytes";
const ARTIFACT_DIRECTORIES: string[] = [];
let administration: PrismaClient | undefined;
let isolatedDatabaseUrl = "";
let prisma: PrismaClient;

before(async () => {
  const rootDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(rootDatabaseUrl, "disposable integration DATABASE_URL is required");
  assert.match(
    ISOLATED_DATABASE_NAME,
    /^tetamu_uat_preview_fixture_\d+_\d+$/,
  );
  const rootUrl = new URL(rootDatabaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      rootUrl.hostname.toLowerCase(),
    ),
    "Preview fixture integration requires local PostgreSQL.",
  );

  const administrationUrl = new URL(rootUrl);
  administrationUrl.pathname = "/postgres";
  administrationUrl.searchParams.set("schema", "public");
  const isolatedUrl = new URL(rootUrl);
  isolatedUrl.pathname = `/${ISOLATED_DATABASE_NAME}`;
  isolatedUrl.searchParams.set("schema", "public");
  isolatedDatabaseUrl = isolatedUrl.toString();

  administration = new PrismaClient({
    datasources: { db: { url: administrationUrl.toString() } },
  });
  await administration.$executeRawUnsafe(
    `CREATE DATABASE "${ISOLATED_DATABASE_NAME}"`,
  );
  const migration = spawnSync(
    process.execPath,
    [resolve("node_modules", "prisma", "build", "index.js"), "migrate", "deploy"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: isolatedDatabaseUrl },
      timeout: 120_000,
    },
  );
  assert.equal(migration.status, 0, migration.stderr);
  prisma = new PrismaClient({
    datasources: { db: { url: isolatedDatabaseUrl } },
  });
  await prisma.$connect();
});

after(async () => {
  await prisma?.$disconnect();
  await Promise.all(
    ARTIFACT_DIRECTORIES.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  if (administration) {
    await administration.$executeRawUnsafe(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      ISOLATED_DATABASE_NAME,
    );
    await administration.$executeRawUnsafe(
      `DROP DATABASE "${ISOLATED_DATABASE_NAME}"`,
    );
    await administration.$disconnect();
  }
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
    if (result.status !== 0) {
      const { diagnoseRun } = await import("../helpers/rc-readiness-diagnostics");
      const runs = await prisma.payrollRun.findMany({ where: { business: { slug: HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG } }, select: { id: true, businessId: true } });
      for (const run of runs) await diagnoseRun(run.businessId, run.id, prisma);
    }
    assert.equal(result.status, 0, result.stderr);
    assertSanitized(result, environment);
  }
  const marker = await prisma.business.findUniqueOrThrow({
    where: { slug: HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG },
    select: { id: true },
  });
  assert.deepEqual(await assertPreviewDatabaseContents(prisma, guard), {
    state: "synthetic-topology",
    businessId: marker.id,
    boundaryBusinessId: await prisma.business
      .findUniqueOrThrow({ where: { slug: BOUNDARY_BUSINESS_SLUG }, select: { id: true } })
      .then((business) => business.id),
  });
  const firstCounts = await capturePreviewFixtureCounts(prisma, marker.id);
  const firstEvidence = await capturePreviewFixtureEvidence(prisma, marker.id);

  const secondResults = runFixturePair(environment);
  for (const result of secondResults) {
    assert.equal(result.status, 0, result.stderr);
    assertSanitized(result, environment);
  }
  const secondCounts = await capturePreviewFixtureCounts(prisma, marker.id);
  const secondEvidence = await capturePreviewFixtureEvidence(prisma, marker.id);

  assert.deepEqual(secondCounts, firstCounts);
  assert.equal(secondEvidence.stableFixtureDigest, firstEvidence.stableFixtureDigest);
  assert.equal(secondEvidence.duplicateCount, 0);
  assert.equal(secondCounts.businesses, 2);
  assert.equal((secondCounts as { branches?: number }).branches, 3);
  assert.equal(secondCounts.employeeAccounts, 8);
  assert.equal(secondCounts.employeeMemberships, 8);
  assert.equal(secondCounts.activeDevices, 6);
  assert.equal(secondCounts.attendanceTimesheets, 2);
  assert.equal(secondCounts.attendanceExceptions, 1);
  assert.equal(secondCounts.attendanceP2Exceptions, 1);
  assert.equal(secondCounts.attendanceCorrections, 1);
  assert.equal(secondCounts.leaveRequests, 4);
  assert.equal(secondCounts.leaveDays, 4);
  assert.equal(secondCounts.leaveBalances, 1);
  assert.equal(secondCounts.leaveEntitlements, 1);
  assert.equal(secondCounts.leaveEntitlementBuckets, 1);
  assert.equal(secondCounts.leaveLedgerEntries, 2);
  assert.equal(secondCounts.leaveConsumptionAllocations, 1);
  assert.equal(secondCounts.payrollRuns, 3);
  assert.equal(secondCounts.payrollEntries, 8);
  assert.ok(secondCounts.payrollComponents > 0);
  assert.equal(secondCounts.payslipPublications, 8);

  const verification = runFixtureScript(
    "scripts/verify-hr-payroll-uat-preview-fixture.ts",
    environment,
  );
  assert.equal(verification.status, 0, verification.stderr);
  assert.match(verification.stdout, /"verified": true/);
  assert.match(verification.stdout, /"duplicateCount": 0/);
  assert.match(verification.stdout, /"stableFixtureDigest": "[a-f0-9]{64}"/);
  assertSanitized(verification, environment);
});

test("formal fixture exposes real branch and tenant boundary objects without side effects", async () => {
  const primary = await prisma.business.findUniqueOrThrow({
    where: { slug: HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG },
    select: { id: true },
  });
  const boundary = await prisma.business.findUniqueOrThrow({
    where: { slug: BOUNDARY_BUSINESS_SLUG },
    select: { id: true },
  });
  const [primaryBranches, boundaryBranches, primaryBoundaryMember, tenantMember] =
    await Promise.all([
      prisma.branch.count({ where: { businessId: primary.id } }),
      prisma.branch.count({ where: { businessId: boundary.id } }),
      prisma.employeeBusinessMembership.findUnique({
        where: {
          businessId_employeeCode: {
            businessId: primary.id,
            employeeCode: "BOUNDARY-B",
          },
        },
      }),
      prisma.employeeBusinessMembership.findUnique({
        where: {
          businessId_employeeCode: {
            businessId: boundary.id,
            employeeCode: "TENANT-B",
          },
        },
      }),
    ]);

  assert.equal(primaryBranches, 2);
  assert.equal(boundaryBranches, 1);
  assert.ok(primaryBoundaryMember);
  assert.ok(tenantMember);

  for (const membership of [primaryBoundaryMember, tenantMember]) {
    assert.equal(
      await prisma.leaveRequest.count({
        where: { businessId: membership.businessId, membershipId: membership.id },
      }),
      1,
    );
    assert.equal(
      await prisma.attendanceTimesheetP2DaySnapshot.count({
        where: { businessId: membership.businessId, membershipId: membership.id },
      }),
      1,
    );
    assert.equal(
      await prisma.payrollPayslipPublication.count({
        where: { businessId: membership.businessId, membershipId: membership.id },
      }),
      1,
    );
  }

  const group = await prisma.businessGroup.findFirstOrThrow({
    where: { code: `hr-payroll-uat-${primary.id}` },
    select: {
      members: { where: { status: "ACTIVE" }, select: { businessId: true } },
      users: {
        where: { role: "GROUP_MANAGER", status: "ACTIVE" },
        select: {
          accessScope: true,
          businessAccesses: { select: { businessId: true } },
        },
      },
    },
  });
  assert.deepEqual(
    group.members.map((member) => member.businessId).sort(),
    [primary.id, boundary.id].sort(),
  );
  assert.equal(group.users[0]?.accessScope, "SELECTED_BUSINESSES");
  assert.deepEqual(group.users[0]?.businessAccesses, [{ businessId: primary.id }]);

  assert.equal(await prisma.authSession.count({ where: { revokedAt: null } }), 0);
  assert.equal(await prisma.employeeSession.count({ where: { revokedAt: null } }), 0);
  assert.equal(await prisma.employeeOtpChallenge.count(), 0);
  assert.equal(await prisma.payrollPaymentBatch.count(), 0);
  assert.equal(await prisma.payrollStatutorySubmission.count(), 0);
  assert.equal(await prisma.whatsAppMessage.count(), 0);
  assert.equal(await prisma.notificationQueue.count(), 0);

  const evidence = await capturePreviewFixtureEvidence(prisma, primary.id);
  const boundaryEvidence = (
    evidence.domains as typeof evidence.domains & {
      boundary?: { linksValid: boolean; topologyVersion: string };
    }
  ).boundary;
  assert.deepEqual(boundaryEvidence, {
    linksValid: true,
    payrollPeriodsValid: true,
    topologyVersion: "hr-payroll-uat-preview-r3-v1",
  });
});

test("Branch Manager fixture is assigned to the synthetic boundary branch", async () => {
  const branchManagerPersona = HR_PAYROLL_EIGHT_ROLE_PERSONAS.find(
    (persona) => persona.key === "BRANCH_MANAGER",
  );
  assert.ok(branchManagerPersona?.email);
  const [branchManager, boundaryBranch] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { email: branchManagerPersona.email },
      select: { branchId: true },
    }),
    prisma.branch.findFirstOrThrow({
      where: { name: "Synthetic Boundary Branch" },
      select: { id: true },
    }),
  ]);

  assert.equal(branchManager.branchId, boundaryBranch.id);
});

test("formal fixture creates the required Leave and Attendance domain evidence", async () => {
  const marker = await prisma.business.findUniqueOrThrow({
    where: { slug: HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG },
    select: { id: true },
  });

  const [
    leaveBalances,
    leaveEntitlements,
    leaveBuckets,
    leaveLedgerEntries,
    leaveConsumptionAllocations,
    attendanceExceptions,
    attendanceCorrections,
  ] = await Promise.all([
    prisma.employeeLeaveBalance.count({ where: { businessId: marker.id } }),
    prisma.employeeLeaveEntitlement.count({ where: { businessId: marker.id } }),
    prisma.leaveEntitlementBucket.count({ where: { businessId: marker.id } }),
    prisma.leaveBalanceLedgerEntry.count({ where: { businessId: marker.id } }),
    prisma.leaveConsumptionAllocation.count({ where: { businessId: marker.id } }),
    prisma.attendanceException.count({ where: { businessId: marker.id } }),
    prisma.attendanceCorrectionRequest.count({ where: { businessId: marker.id } }),
  ]);

  assert.deepEqual(
    {
      leaveBalances,
      leaveEntitlements,
      leaveBuckets,
      leaveLedgerEntries,
      leaveConsumptionAllocations,
      attendanceExceptions,
      attendanceCorrections,
    },
    {
      leaveBalances: 1,
      leaveEntitlements: 1,
      leaveBuckets: 1,
      leaveLedgerEntries: 2,
      leaveConsumptionAllocations: 1,
      attendanceExceptions: 1,
      attendanceCorrections: 1,
    },
  );

  const evidence = await capturePreviewFixtureEvidence(prisma, marker.id);
  assertCompletePreviewFixtureEvidence(evidence);
  assert.deepEqual(evidence.domains.leave.ledgerUnits, [-1, 12]);
  assert.equal(evidence.domains.leave.ledgerBalanceUnits, 11);
  assert.equal(evidence.domains.leave.availableUnits, 11);
  assert.equal(evidence.domains.leave.linksValid, true);
  assert.equal(evidence.domains.attendance.workDate, "2026-09-01T00:00:00.000Z");
  assert.equal(evidence.domains.attendance.linksValid, true);
});

test("formal verifier reports relational evidence and a stable digest", () => {
  const artifactDirectory = ARTIFACT_DIRECTORIES.at(-1);
  assert.ok(artifactDirectory);
  const environment = previewEnvironment({
    HR_PAYROLL_UAT_ARTIFACT_DIRECTORY: artifactDirectory,
  });

  const verification = runFixtureScript(
    "scripts/verify-hr-payroll-uat-preview-fixture.ts",
    environment,
  );

  assert.equal(verification.status, 0, verification.stderr);
  const output = JSON.parse(verification.stdout) as {
    duplicateCount: number;
    stableFixtureDigest: string;
    domains: { leave: { linksValid: boolean }; attendance: { linksValid: boolean } };
  };
  assert.equal(output.duplicateCount, 0);
  assert.match(output.stableFixtureDigest, /^[a-f0-9]{64}$/);
  assert.equal(output.domains.leave.linksValid, true);
  assert.equal(output.domains.attendance.linksValid, true);
  assertSanitized(verification, environment);
});

test("formal verifier rejects a Branch Manager outside the synthetic boundary branch", async () => {
  const branchManagerPersona = HR_PAYROLL_EIGHT_ROLE_PERSONAS.find(
    (persona) => persona.key === "BRANCH_MANAGER",
  );
  assert.ok(branchManagerPersona?.email);
  const branchManager = await prisma.user.findUniqueOrThrow({
    where: { email: branchManagerPersona.email },
    select: { branchId: true, id: true },
  });
  const mainBranch = await prisma.branch.findFirstOrThrow({
    where: { name: "Acceptance Main Branch" },
    select: { id: true },
  });
  try {
    await prisma.user.update({
      where: { id: branchManager.id },
      data: { branchId: mainBranch.id },
    });
    const verification = runFixtureScript(
      "scripts/verify-hr-payroll-uat-preview-fixture.ts",
      previewEnvironment(),
    );
    assert.notEqual(verification.status, 0);
    assert.match(verification.stderr, /HR_UAT_FIXTURE_BRANCH_MANAGER_SCOPE_MISMATCH/);
  } finally {
    await prisma.user.update({
      where: { id: branchManager.id },
      data: { branchId: branchManager.branchId },
    });
  }
});

test("formal verifier fails closed when any required Leave or Attendance domain is absent", async () => {
  const marker = await prisma.business.findUniqueOrThrow({
    where: { slug: HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG },
    select: { id: true },
  });
  const evidence = await capturePreviewFixtureEvidence(prisma, marker.id);
  const missingDomains = [
    ["leaveBalances", "HR_UAT_FIXTURE_LEAVE_BALANCE_MISSING"],
    ["leaveEntitlements", "HR_UAT_FIXTURE_LEAVE_ENTITLEMENT_MISSING"],
    ["leaveEntitlementBuckets", "HR_UAT_FIXTURE_LEAVE_BUCKET_MISSING"],
    ["leaveLedgerEntries", "HR_UAT_FIXTURE_LEAVE_LEDGER_MISSING"],
    ["leaveConsumptionAllocations", "HR_UAT_FIXTURE_LEAVE_ALLOCATION_MISSING"],
    ["attendanceExceptions", "HR_UAT_FIXTURE_ATTENDANCE_EXCEPTION_MISSING"],
    ["attendanceP2Exceptions", "HR_UAT_FIXTURE_ATTENDANCE_P2_EXCEPTION_MISSING"],
    ["attendanceCorrections", "HR_UAT_FIXTURE_ATTENDANCE_CORRECTION_MISSING"],
  ] as const;

  for (const [name, expectedError] of missingDomains) {
    assert.throws(
      () =>
        assertCompletePreviewFixtureEvidence({
          ...evidence,
          counts: { ...evidence.counts, [name]: 0 },
        }),
      (error: unknown) =>
        error instanceof Error && error.message === expectedError,
    );
  }
});

test("historical OTP is immutable audit history, not duplicate fixture data", async () => {
  const marker = await prisma.business.findUniqueOrThrow({
    where: { slug: HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG },
  });
  const account = await prisma.employeeAccount.findFirstOrThrow();
  const baseline = await capturePreviewFixtureEvidence(prisma, marker.id);
  for (const historyCount of [1, 4, 9]) {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    const ids = await prisma.$transaction(async (transaction) => {
      const createdIds: string[] = [];
      for (let index = 0; index < historyCount; index += 1) {
        const row = await transaction.employeeOtpChallenge.create({ data: {
        employeeAccountId: account.id,
        phoneNumberNormalized: account.phoneNormalized,
        purpose: "LOGIN",
        provider: "mock",
        deliveryChannel: "local",
        expiresAt: index % 3 === 0 ? past : future,
        createdAt: new Date(past.getTime() - 60_000),
        resendAvailableAt: past,
        } });
        if (index % 3 !== 0) {
          await transaction.employeeOtpChallenge.update({
            where: { id: row.id },
            data: { invalidatedAt: past, verifiedAt: index % 3 === 2 ? past : null },
          });
        }
        createdIds.push(row.id);
      }
      return createdIds;
    });
    const rows = await prisma.employeeOtpChallenge.findMany({ where: { id: { in: ids } } });
    try {
      const evidence = await capturePreviewFixtureEvidence(prisma, marker.id);
      assert.equal(evidence.duplicateCount, 0, "OTP audit rows are not fixture duplicates");
      assert.equal(evidence.counts.otpChallenges, historyCount);
      assert.equal(evidence.counts.historicalOtpChallenges, historyCount);
      assert.equal(evidence.counts.activeOtpChallenges, 0);
      assert.equal(evidence.stableFixtureDigest, baseline.stableFixtureDigest);
      assertCompletePreviewFixtureEvidence(evidence);
      const verification = runFixtureScript(
        "scripts/verify-hr-payroll-uat-preview-fixture.ts", previewEnvironment(),
      );
      assert.equal(verification.status, 0, verification.stderr);
      assertSanitized(verification, previewEnvironment());
      const afterRows = await prisma.employeeOtpChallenge.findMany({ where: { id: { in: ids } } });
      assert.deepEqual(afterRows.sort((a, b) => a.id.localeCompare(b.id)),
        rows.sort((a, b) => a.id.localeCompare(b.id)), "verifier must not mutate OTP history");
    } finally {
      // This database is disposable and loopback-only; never a Preview cleanup.
      await prisma.employeeOtpChallenge.deleteMany({ where: { id: { in: ids } } });
    }
  }
});

test("active OTP fails closed including unlinked and attempt-exhausted unexpired challenges", async () => {
  const marker = await prisma.business.findUniqueOrThrow({
    where: { slug: HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG },
  });
  const account = await prisma.employeeAccount.findFirstOrThrow();
  for (const scenario of ["usable", "unlinked", "attempt-exhausted", "verified-unconsumed"] as const) {
    const row = await prisma.employeeOtpChallenge.create({ data: {
      employeeAccountId: scenario === "unlinked" ? null : account.id,
      phoneNumberNormalized: account.phoneNormalized,
      purpose: "LOGIN", provider: "mock", deliveryChannel: "local",
      expiresAt: new Date(Date.now() + 60_000), resendAvailableAt: new Date(),
      createdAt: new Date(Date.now() - 60_000),
      maxAttempts: 5,
    } }).then((created) => prisma.employeeOtpChallenge.update({
      where: { id: created.id },
      data: {
        verifiedAt: scenario === "verified-unconsumed" ? new Date() : null,
        attempts: scenario === "attempt-exhausted" ? 5 : 0,
      },
    }));
    try {
      const evidence = await capturePreviewFixtureEvidence(prisma, marker.id);
      assert.throws(() => assertCompletePreviewFixtureEvidence(evidence),
        { message: "HR_UAT_FIXTURE_OTP_CHALLENGE_PRESENT" }, scenario);
      assert.equal(evidence.counts.activeOtpChallenges, 1, scenario);
      assert.equal(evidence.counts.historicalOtpChallenges, 0, scenario);
      assert.equal(evidence.duplicateCount, 0, "active OTP is a safety violation, not a duplicate");
      const verification = runFixtureScript(
        "scripts/verify-hr-payroll-uat-preview-fixture.ts", previewEnvironment(),
      );
      assert.notEqual(verification.status, 0, scenario);
      assert.match(verification.stderr, /HR_UAT_FIXTURE_OTP_CHALLENGE_PRESENT/);
      assert.deepEqual(await prisma.employeeOtpChallenge.findUniqueOrThrow({ where: { id: row.id } }), row);
    } finally {
      await prisma.employeeOtpChallenge.delete({ where: { id: row.id } });
    }
  }
});

test("genuine fixture duplicates remain detected alongside historical OTP", async () => {
  const marker = await prisma.business.findUniqueOrThrow({
    where: { slug: HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG },
  });
  const account = await prisma.employeeAccount.findFirstOrThrow();
  const history = await prisma.employeeOtpChallenge.create({ data: {
    employeeAccountId: account.id, phoneNumberNormalized: account.phoneNormalized,
    purpose: "LOGIN", provider: "mock", deliveryChannel: "local",
    createdAt: new Date(Date.now() - 120_000),
    expiresAt: new Date(Date.now() - 60_000), resendAvailableAt: new Date(),
  } });
  const branch = await prisma.branch.create({ data: { businessId: marker.id, name: "Duplicate synthetic branch" } });
  try {
    const evidence = await capturePreviewFixtureEvidence(prisma, marker.id);
    assert.equal(evidence.duplicateCount, 1, "only the excess fixture branch is a duplicate");
    assert.throws(() => assertCompletePreviewFixtureEvidence(evidence),
      { message: "HR_UAT_FIXTURE_BRANCH_COUNT_MISMATCH" });
  } finally {
    await prisma.branch.delete({ where: { id: branch.id } });
    await prisma.employeeOtpChallenge.delete({ where: { id: history.id } });
  }
});

const BOUNDARY_RUN_IDS = [
  "a5739bf1-bcc4-51ad-b24c-0aa9b64020da",
  "8698226d-a3a3-5b15-9fc1-c13f95f415a0",
];
const CANONICAL_SEPTEMBER_END = new Date("2026-10-01T00:00:00.000Z");
const LEGACY_BOUNDARY_END = new Date("2026-09-30T00:00:00.000Z");

test("boundary fixture produces September exclusive-end runs readable by canonical readiness", async () => {
  const runs = await boundaryRuns();
  assert.equal(runs.length, 2);
  for (const run of runs) {
    assert.equal(run.periodStart.toISOString(), "2026-09-01T00:00:00.000Z");
    assert.equal(run.periodEnd.toISOString(), "2026-10-01T00:00:00.000Z");
    const readiness = await getPayrollPeriodReadiness({
      businessId: run.businessId, month: "2026-09", runId: run.id,
    }, prisma);
    assert.equal(readiness.runId, run.id);
    assert.equal(readiness.month, "2026-09");
    assert.equal(readiness.businessId, run.businessId);
  }
});

test("formal verifier rejects an incorrect boundary period instead of accepting count-only evidence", async () => {
  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: BOUNDARY_RUN_IDS[0] } });
  try {
    await setDisposableBoundaryPeriod(run.id, LEGACY_BOUNDARY_END);
    const verification = runFixtureScript("scripts/verify-hr-payroll-uat-preview-fixture.ts", previewEnvironment());
    assert.notEqual(verification.status, 0, "wrong end must fail the formal verifier");
    assert.match(verification.stderr, /HR_UAT_FIXTURE_PAYROLL_PERIOD_MISMATCH/);
  } finally {
    await setDisposableBoundaryPeriod(run.id, run.periodEnd);
  }
});

test("fixture refuses legacy published boundary periods without altering any related row", async () => {
  const original = await boundaryRuns();
  for (const id of BOUNDARY_RUN_IDS) {
    await setDisposableBoundaryPeriod(id, LEGACY_BOUNDARY_END);
  }
  const before = await boundaryRuns();
  const untouched = await prisma.payrollRun.findMany({ where: { id: { notIn: BOUNDARY_RUN_IDS } } });
  const environment = boundaryFixtureEnvironment();
  const first = runFixtureScript("scripts/prepare-hr-payroll-eight-role-uat.ts", environment);
  try {
    assert.notEqual(first.status, 0, "fixture is not the separately approved maintenance CLI");
    assert.match(first.stderr, /HR_UAT_FIXTURE_BOUNDARY_PERIOD_REPAIR_REJECTED/);
    assertSanitized(first, environment);
    assert.deepEqual(await boundaryRuns(), before);
    assert.deepEqual(await prisma.payrollRun.findMany({ where: { id: { notIn: BOUNDARY_RUN_IDS } } }), untouched);
  } finally {
    for (const run of original) await setDisposableBoundaryPeriod(run.id, run.periodEnd);
  }
});

test("period repair refuses a non-synthetic boundary employee before fixture upserts can relabel it", async () => {
  const run = (await boundaryRuns())[0];
  const memberId = run.entries[0].membershipId;
  await prisma.employeeBusinessMembership.update({ where: { id: memberId }, data: { isTestAccount: false } });
  try {
    const before = await boundaryRuns();
    const result = runFixtureScript("scripts/prepare-hr-payroll-eight-role-uat.ts", boundaryFixtureEnvironment());
    assert.notEqual(result.status, 0, "non-synthetic employee must not be silently relabelled");
    assert.match(result.stderr, /HR_UAT_FIXTURE_BOUNDARY_PERIOD_REPAIR_REJECTED/);
    assert.deepEqual(await boundaryRuns(), before);
    assert.equal((await prisma.employeeBusinessMembership.findUniqueOrThrow({ where: { id: memberId } })).isTestAccount, false);
  } finally {
    await prisma.employeeBusinessMembership.update({ where: { id: memberId }, data: { isTestAccount: true } });
  }
});

test("period repair refuses unexpected old period and rolls back both boundary runs", async () => {
  const before = await boundaryRuns();
  await setDisposableBoundaryPeriod(BOUNDARY_RUN_IDS[0], LEGACY_BOUNDARY_END);
  await setDisposableBoundaryPeriod(BOUNDARY_RUN_IDS[1], new Date("2026-09-29T00:00:00.000Z"));
  try {
    const tampered = await boundaryRuns();
    const result = runFixtureScript("scripts/prepare-hr-payroll-eight-role-uat.ts", boundaryFixtureEnvironment());
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /HR_UAT_FIXTURE_BOUNDARY_PERIOD_REPAIR_REJECTED/);
    assert.deepEqual(await boundaryRuns(), tampered, "all targets are checked before any correction commits");
  } finally {
    for (const run of before) await setDisposableBoundaryPeriod(run.id, run.periodEnd);
  }
});

test("period repair refuses an existing same-month canonical run and leaves original publications untouched", async () => {
  const before = await boundaryRuns();
  const scalar = await prisma.payrollRun.findUniqueOrThrow({ where: { id: BOUNDARY_RUN_IDS[0] } });
  await setDisposableBoundaryPeriod(scalar.id, LEGACY_BOUNDARY_END);
  const collision = await prisma.payrollRun.create({ data: {
    ...scalar, id: randomUUID(), periodEnd: CANONICAL_SEPTEMBER_END,
    status: "DRAFT", submittedAt: null, submittedById: null, finalizedAt: null, finalizedById: null,
  } });
  try {
    const oldRows = await boundaryRuns();
    const result = runFixtureScript("scripts/prepare-hr-payroll-eight-role-uat.ts", boundaryFixtureEnvironment());
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /HR_UAT_FIXTURE_BOUNDARY_PERIOD_REPAIR_REJECTED/);
    assert.deepEqual(await boundaryRuns(), oldRows);
    assert.deepEqual(await prisma.payrollRun.findUniqueOrThrow({ where: { id: collision.id } }), collision);
  } finally {
    // Only this loopback disposable test-created collision is removed.
    await prisma.payrollRun.delete({ where: { id: collision.id } });
    for (const run of before) await setDisposableBoundaryPeriod(run.id, run.periodEnd);
  }
});

test("period repair rejects wrong tenant marker and canonical readiness still denies cross-tenant run IDs", async () => {
  const runs = await boundaryRuns();
  await assert.rejects(getPayrollPeriodReadiness({
    businessId: runs[0].businessId, month: "2026-09", runId: runs[1].id,
  }, prisma), { message: "Payroll run not found." });
  const business = await prisma.business.findUniqueOrThrow({ where: { slug: BOUNDARY_BUSINESS_SLUG } });
  await prisma.business.update({ where: { id: business.id }, data: { name: "Unrelated tenant" } });
  try {
    const result = runFixtureScript("scripts/prepare-hr-payroll-eight-role-uat.ts", boundaryFixtureEnvironment());
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /HR_UAT_FIXTURE_NON_SYNTHETIC_DATA_PRESENT/);
    assert.deepEqual(await boundaryRuns(), runs);
  } finally {
    await prisma.business.update({ where: { id: business.id }, data: { name: business.name } });
  }
});

// Test preparation only: these rows live in the loopback disposable DB created above.
// Exercise the existing trigger mechanism, never disable or replace protections.
async function setDisposableBoundaryPeriod(id: string, end: Date) {
  assert.ok(BOUNDARY_RUN_IDS.includes(id));
  assert.equal(new URL(isolatedDatabaseUrl).pathname, `/${ISOLATED_DATABASE_NAME}`);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(isolatedDatabaseUrl).hostname));
  await prisma.$transaction(async (tx) => {
    const run = await tx.payrollRun.findUniqueOrThrow({ where: { id } });
    if (run.periodEnd.getTime() === end.getTime()) return;
    await tx.$executeRaw`SELECT set_config('tetamu.payroll_reopen', ${id}, TRUE)`;
    await tx.payrollRun.update({ where: { id }, data: {
      status: "DRAFT", submittedAt: null, submittedById: null,
      finalizedAt: null, finalizedById: null, updatedAt: run.updatedAt,
    } });
    await tx.payrollRun.update({ where: { id }, data: {
      periodEnd: end, status: run.status, submittedAt: run.submittedAt,
      submittedById: run.submittedById, finalizedAt: run.finalizedAt,
      finalizedById: run.finalizedById, updatedAt: run.updatedAt,
    } });
  });
}

function boundaryRuns() {
  return prisma.payrollRun.findMany({
    where: { id: { in: BOUNDARY_RUN_IDS } }, orderBy: { id: "asc" },
    include: {
      entries: { orderBy: { id: "asc" } },
      components: { orderBy: { id: "asc" } },
      payslipPublications: { orderBy: { id: "asc" } },
    },
  });
}

function boundaryFixtureEnvironment() {
  const artifactDirectory = ARTIFACT_DIRECTORIES.at(-1);
  assert.ok(artifactDirectory);
  return previewEnvironment({ HR_PAYROLL_UAT_ARTIFACT_DIRECTORY: artifactDirectory });
}

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
  const databaseUrl = isolatedDatabaseUrl;
  assert.ok(databaseUrl, "isolated Preview fixture DATABASE_URL is required");
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  const databaseServiceId = "preview-database-service";
  const environment: NodeJS.ProcessEnv = {
    RC_DISPOSABLE_TEST: process.env.RC_DISPOSABLE_TEST,
    TETAMU_MFA_ENABLED: "true",
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
    UAT_PREVIEW_LOCAL_SIMULATION: "true",
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
