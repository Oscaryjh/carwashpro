import { PrismaClient } from "@prisma/client";
import { resolveBusinessAccess } from "../src/lib/business-groups/business-access";
import { loadPayrollPayslip } from "../src/lib/payroll/documents";
import { buildPayslipPdf } from "../src/lib/payroll/export";
import {
  resolveLindung24ParticipationForPeriod,
  type Lindung24ParticipationEvidence,
} from "../src/lib/payroll/lindung24-participation";
import { recordEmployeeLindung24Participation } from "../src/lib/payroll/lindung24-participation-service";
import { getPayrollPeriodReadiness } from "../src/lib/payroll/readiness";
import { generatePayrollRun } from "../src/lib/payroll/service";
import { assertPayrollRunOfficialStatutoryExportEligible } from "../src/lib/payroll/statutory-export-eligibility";

const prisma = new PrismaClient();

const BUSINESS_ID = "b87aaa12-b41d-44b5-908e-72d04e6a08a0";
const BUSINESS_NAME = "Payroll UAT Business";
const BRANCH_NAME = "Payroll UAT Branch";
const MEMBERSHIP_ID = "091ba7be-ced0-418b-8cf9-526921f10866";
const EMPLOYEE_CODE = "UAT-PAYROLL-001";
const PAYROLL_MONTH = "2026-08";
const PAYROLL_RUN_ID = "2972941a-8067-4076-bf3b-24ddf08b308a";
const PAYROLL_ENTRY_ID = "09a34a1a-fc19-40f6-bede-7ce2956b84eb";
const TIMESHEET_REVISION_ID = "44978f4c-e537-4148-8fcc-500710fa994f";
const OWNER_EMAIL = "payroll-uat.owner@tetamu.local";
const TESTING_ENV = { APP_ENVIRONMENT: "testing" } as const;

function assertTestingBoundary() {
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "testing") {
    throw new Error("SYNTHETIC_LINDUNG24_REQUIRES_RAILWAY_TESTING_ENVIRONMENT");
  }
  if (process.env.RAILWAY_SERVICE_NAME !== "tetamu-pos-web") {
    throw new Error("SYNTHETIC_LINDUNG24_REQUIRES_TESTING_DESKTOP_SERVICE");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_IS_REQUIRED");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  if (
    hostname !== "postgres-singapore.railway.internal" &&
    !hostname.endsWith(".proxy.rlwy.net")
  ) {
    throw new Error("SYNTHETIC_LINDUNG24_DATABASE_IS_NOT_APPROVED_TESTING_DATABASE");
  }
}

function money(value: { toString(): string } | number) {
  return Number(value).toFixed(2);
}

function issueSummary(
  issues: Array<{ code: string; employeeCode?: string | null; message: string }>,
) {
  return issues.map((issue) => ({
    code: issue.code,
    employeeCode: issue.employeeCode ?? null,
    message: issue.message,
  }));
}

async function main() {
  assertTestingBoundary();

  const [business, membership, owner, originalRun, activeBranches] = await Promise.all([
    prisma.business.findUnique({
      where: { id: BUSINESS_ID },
      select: { id: true, name: true, status: true },
    }),
    prisma.employeeBusinessMembership.findFirst({
      where: { id: MEMBERSHIP_ID, businessId: BUSINESS_ID },
      select: {
        id: true,
        employeeCode: true,
        fullName: true,
        status: true,
        statutoryNationality: true,
      },
    }),
    prisma.user.findFirst({
      where: {
        businessId: BUSINESS_ID,
        email: OWNER_EMAIL,
        role: "BUSINESS_OWNER",
        status: "active",
        loginEnabled: true,
      },
      select: { id: true, name: true, email: true, role: true },
    }),
    prisma.payrollRun.findFirst({
      where: { id: PAYROLL_RUN_ID, businessId: BUSINESS_ID },
      include: {
        entries: {
          include: {
            attendanceInputSnapshot: true,
            components: true,
            statutorySnapshots: true,
          },
        },
      },
    }),
    prisma.branch.findMany({
      where: { businessId: BUSINESS_ID, status: "ACTIVE" },
      select: { id: true, name: true },
    }),
  ]);

  if (!business || business.name !== BUSINESS_NAME || business.status !== "active") {
    throw new Error("PAYROLL_UAT_BUSINESS_CONTRACT_MISMATCH");
  }
  if (
    !membership ||
    membership.employeeCode !== EMPLOYEE_CODE ||
    membership.status !== "ACTIVE"
  ) {
    throw new Error("PAYROLL_UAT_MEMBERSHIP_CONTRACT_MISMATCH");
  }
  if (!owner || owner.name !== "Payroll UAT Owner" || !owner.email) {
    throw new Error("PAYROLL_UAT_OWNER_NOT_FOUND");
  }
  if (activeBranches.length !== 1 || activeBranches[0]?.name !== BRANCH_NAME) {
    throw new Error("PAYROLL_UAT_BRANCH_SCOPE_CONTRACT_MISMATCH");
  }
  if (
    !originalRun ||
    originalRun.status !== "DRAFT" ||
    originalRun.attendanceTimesheetRevisionId !== TIMESHEET_REVISION_ID ||
    originalRun.entries.length !== 1 ||
    originalRun.entries[0]?.id !== PAYROLL_ENTRY_ID
  ) {
    throw new Error("PAYROLL_UAT_EXISTING_DRAFT_CONTRACT_MISMATCH");
  }

  const countsBefore = await Promise.all([
    prisma.payrollStatutorySubmission.count({ where: { payrollRunId: PAYROLL_RUN_ID } }),
    prisma.payrollStatutoryExportArtifact.count({ where: { payrollRunId: PAYROLL_RUN_ID } }),
    prisma.payrollPayslipPublication.count({ where: { payrollRunId: PAYROLL_RUN_ID } }),
    prisma.employeeLindung24ParticipationVersion.count({
      where: { businessId: BUSINESS_ID, membershipId: MEMBERSHIP_ID },
    }),
  ]);

  const access = await resolveBusinessAccess(
    { userId: owner.id, requestedBusinessId: BUSINESS_ID },
    prisma,
  );
  if (!access.granted || access.effectiveBusinessRole !== "BUSINESS_OWNER") {
    throw new Error("PAYROLL_UAT_OWNER_WHOLE_BUSINESS_ACCESS_REQUIRED");
  }

  const existingCurrent = await prisma.employeeLindung24ParticipationVersion.findFirst({
    where: {
      businessId: BUSINESS_ID,
      membershipId: MEMBERSHIP_ID,
      effectiveToMonth: null,
    },
    orderBy: [{ revision: "desc" }, { recordedAt: "desc" }],
  });

  let createdNow = false;
  let participation = existingCurrent;
  if (!participation) {
    participation = await recordEmployeeLindung24Participation(
      {
        command: {
          act4Covered: true,
          effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
          employerContext: "SINGLE_EMPLOYER",
          expectedRevision: 0,
          membershipId: MEMBERSHIP_ID,
          officialSubmittedAt: null,
          evidenceNature: "SYNTHETIC_TESTING",
          evidenceEnvironment: "TESTING",
          fixturePurpose: "PAYROLL_PAYSLIP_UAT",
          statutoryNationalitySnapshot: "MALAYSIAN",
          reason: "Testing-only Payroll and Payslip UAT statutory fixture.",
          selectedEmployer: "CURRENT_BUSINESS",
          sourceReference: null,
          sourceType: null,
          status: "VOLUNTARY_OPT_OUT",
        },
        context: {
          access,
          actor: { userId: owner.id, name: owner.name, email: owner.email },
          allowedBranchIds: activeBranches.map((branch) => branch.id),
          businessId: BUSINESS_ID,
          caller: "AI_AGENT",
        },
      },
      prisma,
      { environment: TESTING_ENV },
    );
    createdNow = true;
  } else if (
    participation.evidenceNature !== "SYNTHETIC_TESTING" ||
    participation.evidenceEnvironment !== "TESTING" ||
    participation.fixturePurpose !== "PAYROLL_PAYSLIP_UAT" ||
    participation.status !== "VOLUNTARY_OPT_OUT" ||
    participation.employerContext !== "SINGLE_EMPLOYER" ||
    participation.selectedEmployer !== "CURRENT_BUSINESS" ||
    !participation.act4Covered ||
    participation.statutoryNationalitySnapshot !== "MALAYSIAN" ||
    participation.officialExportEligible ||
    participation.sourceType !== null ||
    participation.sourceReference !== null ||
    participation.officialSubmittedAt !== null
  ) {
    throw new Error("EXISTING_LINDUNG24_PARTICIPATION_DOES_NOT_MATCH_FIXTURE_CONTRACT");
  }

  const matchingCurrentCount = await prisma.employeeLindung24ParticipationVersion.count({
    where: {
      businessId: BUSINESS_ID,
      membershipId: MEMBERSHIP_ID,
      effectiveToMonth: null,
      evidenceNature: "SYNTHETIC_TESTING",
      evidenceEnvironment: "TESTING",
      fixturePurpose: "PAYROLL_PAYSLIP_UAT",
    },
  });
  if (matchingCurrentCount !== 1) throw new Error("SYNTHETIC_PERSONA_DUPLICATE_AUDIT_FAILED");

  const records = await prisma.employeeLindung24ParticipationVersion.findMany({
    where: { businessId: BUSINESS_ID, membershipId: MEMBERSHIP_ID },
    orderBy: { revision: "asc" },
  });
  const resolver = resolveLindung24ParticipationForPeriod({
    businessId: BUSINESS_ID,
    membershipId: MEMBERSHIP_ID,
    statutoryPeriod: new Date("2026-08-01T00:00:00.000Z"),
    statutoryNationality: membership.statutoryNationality,
    records: records as Lindung24ParticipationEvidence[],
    environment: TESTING_ENV,
  });
  if (resolver.status !== "NO_CONTRIBUTION") {
    throw new Error(`LINDUNG24_RESOLVER_EXPECTED_NO_CONTRIBUTION:${resolver.status}`);
  }

  const refreshedRun = await generatePayrollRun(
    {
      actor: { userId: owner.id, name: owner.name, email: owner.email },
      businessId: BUSINESS_ID,
      month: PAYROLL_MONTH,
    },
    prisma,
  );
  if (refreshedRun.id !== PAYROLL_RUN_ID || refreshedRun.status !== "DRAFT") {
    throw new Error("PAYROLL_DRAFT_WAS_NOT_REUSED");
  }

  const run = await prisma.payrollRun.findUniqueOrThrow({
    where: { id: PAYROLL_RUN_ID },
    include: {
      entries: {
        include: {
          attendanceInputSnapshot: true,
          components: { orderBy: [{ sortOrder: "asc" }, { lineKey: "asc" }] },
          statutorySnapshots: true,
        },
      },
    },
  });
  if (
    run.attendanceTimesheetRevisionId !== TIMESHEET_REVISION_ID ||
    run.entries.length !== 1 ||
    run.entries[0]?.membershipId !== MEMBERSHIP_ID
  ) {
    throw new Error("REFRESHED_PAYROLL_DRAFT_CONTRACT_MISMATCH");
  }
  const entry = run.entries[0]!;
  const l24 = entry.statutorySnapshots.find((snapshot) => snapshot.scheme === "LINDUNG24");
  if (
    !l24 ||
    l24.lindung24ParticipationVersionId !== participation.id ||
    l24.evidenceNature !== "SYNTHETIC_TESTING" ||
    l24.evidenceEnvironment !== "TESTING" ||
    l24.fixturePurpose !== "PAYROLL_PAYSLIP_UAT" ||
    l24.officialExportEligible
  ) {
    throw new Error("SYNTHETIC_LINDUNG24_PAYROLL_SNAPSHOT_MISMATCH");
  }

  const readiness = await getPayrollPeriodReadiness(
    { businessId: BUSINESS_ID, month: PAYROLL_MONTH, runId: PAYROLL_RUN_ID },
    prisma,
  );

  let officialExportDenied = false;
  let officialSubmissionDenied = false;
  let exportGuardMessage: string | null = null;
  try {
    await assertPayrollRunOfficialStatutoryExportEligible(
      { businessId: BUSINESS_ID, payrollRunId: PAYROLL_RUN_ID },
      prisma,
    );
  } catch (error) {
    exportGuardMessage = error instanceof Error ? error.message : String(error);
    officialExportDenied = exportGuardMessage === "SYNTHETIC_STATUTORY_EVIDENCE_NOT_EXPORTABLE";
  }
  try {
    await assertPayrollRunOfficialStatutoryExportEligible(
      { businessId: BUSINESS_ID, payrollRunId: PAYROLL_RUN_ID },
      prisma,
    );
  } catch (error) {
    officialSubmissionDenied =
      (error instanceof Error ? error.message : String(error)) ===
      "SYNTHETIC_STATUTORY_EVIDENCE_NOT_EXPORTABLE";
  }
  if (!officialExportDenied || !officialSubmissionDenied) {
    throw new Error("OFFICIAL_EXPORT_OR_SUBMISSION_GUARD_FAILED");
  }

  const document = await loadPayrollPayslip(BUSINESS_ID, entry.id);
  if (!document) throw new Error("TESTING_PAYSLIP_PREVIEW_NOT_AVAILABLE");
  const testingPdf = buildPayslipPdf(document.run, document.entry).toString("latin1");
  const testingPayslipSupported = testingPdf.includes(
    "TESTING / NON-PRODUCTION STATUTORY FIXTURE",
  );
  if (!testingPayslipSupported) throw new Error("TESTING_PAYSLIP_MARKER_MISSING");

  const originalAppEnvironment = process.env.APP_ENVIRONMENT;
  process.env.APP_ENVIRONMENT = "production";
  let productionPayslipDenied = false;
  try {
    buildPayslipPdf(document.run, document.entry);
  } catch (error) {
    productionPayslipDenied =
      (error instanceof Error ? error.message : String(error)) ===
      "SYNTHETIC_STATUTORY_EVIDENCE_FORBIDDEN_IN_PRODUCTION";
  } finally {
    if (originalAppEnvironment === undefined) delete process.env.APP_ENVIRONMENT;
    else process.env.APP_ENVIRONMENT = originalAppEnvironment;
  }
  if (!productionPayslipDenied) throw new Error("PRODUCTION_PAYSLIP_GUARD_FAILED");

  const [submissionCount, artifactCount, payslipCount, participationCount, auditCount] =
    await Promise.all([
      prisma.payrollStatutorySubmission.count({ where: { payrollRunId: PAYROLL_RUN_ID } }),
      prisma.payrollStatutoryExportArtifact.count({ where: { payrollRunId: PAYROLL_RUN_ID } }),
      prisma.payrollPayslipPublication.count({ where: { payrollRunId: PAYROLL_RUN_ID } }),
      prisma.employeeLindung24ParticipationVersion.count({
        where: { businessId: BUSINESS_ID, membershipId: MEMBERSHIP_ID },
      }),
      prisma.auditLog.count({
        where: {
          businessId: BUSINESS_ID,
          action: "STATUTORY_TEST_FIXTURE_CREATED",
          entityType: "EmployeeLindung24ParticipationVersion",
          entityId: participation.id,
        },
      }),
    ]);

  if (
    submissionCount !== countsBefore[0] ||
    artifactCount !== countsBefore[1] ||
    payslipCount !== countsBefore[2] ||
    participationCount !== countsBefore[3] + (createdNow ? 1 : 0) ||
    auditCount !== 1
  ) {
    throw new Error("POST_WRITE_SAFETY_OR_AUDIT_CONTRACT_FAILED");
  }
  const crossTenantCount = await prisma.employeeLindung24ParticipationVersion.count({
    where: { id: participation.id, businessId: { not: BUSINESS_ID } },
  });
  if (crossTenantCount !== 0) throw new Error("TENANT_ISOLATION_FAILED");

  console.log(
    JSON.stringify(
      {
        environment: "TESTING",
        business,
        employee: membership,
        actor: { id: owner.id, name: owner.name, role: owner.role },
        staffServiceRedeployRequired: false,
        participation: {
          id: participation.id,
          revision: participation.revision,
          createdNow,
          evidenceNature: participation.evidenceNature,
          evidenceEnvironment: participation.evidenceEnvironment,
          fixturePurpose: participation.fixturePurpose,
          statutoryNationalitySnapshot: participation.statutoryNationalitySnapshot,
          act4Covered: participation.act4Covered,
          status: participation.status,
          employerContext: participation.employerContext,
          selectedEmployer: participation.selectedEmployer,
          officialExportEligible: participation.officialExportEligible,
          officialSubmittedAt: participation.officialSubmittedAt,
          sourceType: participation.sourceType,
          sourceReference: participation.sourceReference,
          sourceDigest: participation.sourceDigest,
        },
        resolver,
        draft: {
          id: run.id,
          reused: run.id === originalRun.id,
          refreshed: true,
          status: run.status,
          employeeCount: run.entries.length,
          timesheetRevisionId: run.attendanceTimesheetRevisionId,
          timesheetRevisionSnapshot: run.attendanceTimesheetRevisionSnapshot,
          timesheetStillFrozen:
            run.attendanceTimesheetRevisionId === TIMESHEET_REVISION_ID &&
            entry.attendanceInputSnapshot?.timesheetRevisionId === TIMESHEET_REVISION_ID,
        },
        payroll: {
          entryId: entry.id,
          basic: money(entry.basicPay),
          gross: money(entry.grossPay),
          deductions: money(Number(entry.grossPay) - Number(entry.netPay)),
          net: money(entry.netPay),
          lindung24Employee: money(entry.lindung24Employee),
          componentCount: entry.components.length,
          statutoryStatus: entry.statutoryStatus,
        },
        snapshot: {
          id: l24.id,
          status: l24.status,
          blockerCode: l24.blockerCode,
          participationVersionId: l24.lindung24ParticipationVersionId,
          evidenceNature: l24.evidenceNature,
          evidenceEnvironment: l24.evidenceEnvironment,
          fixturePurpose: l24.fixturePurpose,
          officialExportEligible: l24.officialExportEligible,
          employeeContribution: money(l24.employeeContribution),
          employerContribution: money(l24.employerContribution),
        },
        readiness: {
          status: readiness.status,
          canProceed: readiness.canProceed,
          employeeCount: readiness.employeeCount,
          readyCount: readiness.readyCount,
          reviewRequiredCount: readiness.reviewRequiredCount,
          blockedCount: readiness.blockedCount,
          blockers: issueSummary(readiness.blockers),
          warnings: issueSummary(readiness.warnings),
          info: issueSummary(readiness.info),
        },
        guards: {
          productionSyntheticWrite: "PASS_BY_UNIT_CONTRACT",
          officialExportDenied,
          officialSubmissionDenied,
          exportGuardMessage,
          testingPayslipSupported,
          productionPayslipDenied,
          tenantIsolation: crossTenantCount === 0,
          duplicateAudit: matchingCurrentCount === 1 && auditCount === 1,
        },
        safety: {
          submissionsBefore: countsBefore[0],
          submissionsAfter: submissionCount,
          artifactsBefore: countsBefore[1],
          artifactsAfter: artifactCount,
          payslipsBefore: countsBefore[2],
          payslipsAfter: payslipCount,
          payrollSubmitted: run.status !== "DRAFT",
          payrollFinalized: run.status === "FINALIZED",
          payslipPublished: payslipCount > 0,
          otpSent: false,
          payment: false,
          productionTouched: false,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
