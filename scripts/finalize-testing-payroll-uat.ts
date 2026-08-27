import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { authenticatePasswordLogin } from "../src/lib/auth/password-login";
import {
  persistSessionContext,
  SESSION_CONTEXT_VERSION,
} from "../src/lib/auth/session";
import { issuePayrollHighRiskAuthorization } from "../src/lib/payroll/high-risk-mfa";
import {
  hasBusinessCapability,
  resolveBusinessAccess,
} from "../src/lib/business-groups/business-access";
import { loadBusinessModuleContext } from "../src/lib/modules/entitlements";
import { loadPayrollPayslip } from "../src/lib/payroll/documents";
import { buildPayslipPdf } from "../src/lib/payroll/export";
import {
  loadOwnPublishedPayslip,
  loadPublishedPayslipsForEmployee,
  publishPayrollPayslips,
} from "../src/lib/payroll/payslip-publication";
import { getPayrollPeriodReadiness } from "../src/lib/payroll/readiness";
import {
  finalizePayrollRun,
  submitPayrollRunForReview,
} from "../src/lib/payroll/service";
import { assertPayrollRunOfficialStatutoryExportEligible } from "../src/lib/payroll/statutory-export-eligibility";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const RESUME = process.argv.includes("--resume");
const VERIFY_FINAL = process.argv.includes("--verify-final");
const BUSINESS_ID = "b87aaa12-b41d-44b5-908e-72d04e6a08a0";
const BUSINESS_NAME = "Payroll UAT Business";
const RUN_ID = "2972941a-8067-4076-bf3b-24ddf08b308a";
const ENTRY_ID = "09a34a1a-fc19-40f6-bede-7ce2956b84eb";
const MEMBERSHIP_ID = "091ba7be-ced0-418b-8cf9-526921f10866";
const EMPLOYEE_CODE = "UAT-PAYROLL-001";
const PHONE = "+60128793848";
const TIMESHEET_REVISION_ID = "44978f4c-e537-4148-8fcc-500710fa994f";
const OWNER_EMAIL = "payroll-uat.owner@tetamu.local";
const MONTH = "2026-08";
const OVERRIDE_REASON =
  "Testing-only Payroll/Payslip Real Device UAT. No payment or statutory submission will be executed.";
const request = {
  ipAddress: null,
  userAgent: "Codex Testing Payroll UAT canonical execution",
};

function assertTestingBoundary() {
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "testing") {
    throw new Error("TESTING_ENVIRONMENT_REQUIRED");
  }
  if (process.env.RAILWAY_SERVICE_NAME !== "tetamu-pos-web") {
    throw new Error("TESTING_DESKTOP_SERVICE_REQUIRED");
  }
  if (process.env.APP_ENVIRONMENT?.toLowerCase() !== "testing") {
    throw new Error("TESTING_APP_ENVIRONMENT_REQUIRED");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  if (
    hostname !== "postgres-singapore.railway.internal" &&
    !hostname.endsWith(".proxy.rlwy.net")
  ) {
    throw new Error("APPROVED_TESTING_DATABASE_REQUIRED");
  }
}

function money(value: { toString(): string } | number) {
  return Number(value).toFixed(2);
}

async function exportGuard() {
  try {
    await assertPayrollRunOfficialStatutoryExportEligible(
      { businessId: BUSINESS_ID, payrollRunId: RUN_ID },
      prisma,
    );
    return "ALLOW";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function loadState() {
  const run = await prisma.payrollRun.findFirst({
    where: { businessId: BUSINESS_ID, id: RUN_ID },
    include: {
      business: { select: { id: true, name: true, status: true } },
      submittedBy: { select: { id: true, name: true, email: true, role: true } },
      finalizedBy: { select: { id: true, name: true, email: true, role: true } },
      attendanceTimesheetRevision: {
        include: {
          timesheet: { select: { id: true, status: true, currentRevisionId: true } },
        },
      },
      entries: {
        include: {
          attendanceInputSnapshot: true,
          components: { orderBy: [{ sortOrder: "asc" }, { lineKey: "asc" }] },
          statutorySnapshots: {
            include: { lindung24ParticipationVersion: true },
            orderBy: { scheme: "asc" },
          },
          payslipPublication: true,
          paymentInstructions: true,
        },
      },
    },
  });
  if (!run) throw new Error("PAYROLL_RUN_NOT_FOUND");
  const readiness = await getPayrollPeriodReadiness(
    { businessId: BUSINESS_ID, month: MONTH, runId: RUN_ID },
    prisma,
  );
  return { run, readiness };
}

function assertCoreFacts(state: Awaited<ReturnType<typeof loadState>>) {
  const { run, readiness } = state;
  const entry = run.entries[0];
  if (run.business.name !== BUSINESS_NAME || run.business.status !== "active") {
    throw new Error("BUSINESS_CONTRACT_CHANGED");
  }
  const expectedStatus = RESUME ? "REVIEW" : "DRAFT";
  if (run.status !== expectedStatus) throw new Error(`RUN_STATUS_CHANGED:${run.status}`);
  if (run.entries.length !== 1 || !entry || entry.id !== ENTRY_ID) {
    throw new Error("PAYROLL_POPULATION_CHANGED");
  }
  if (entry.employeeCodeSnapshot !== EMPLOYEE_CODE || entry.membershipId !== MEMBERSHIP_ID) {
    throw new Error("PAYROLL_EMPLOYEE_CHANGED");
  }
  if (
    money(entry.basicPay) !== "3000.00" ||
    money(entry.grossPay) !== "3000.00" ||
    money(entry.netPay) !== "3000.00"
  ) {
    throw new Error("PAYROLL_AMOUNTS_CHANGED");
  }
  if (run.attendanceTimesheetRevisionId !== TIMESHEET_REVISION_ID) {
    throw new Error("TIMESHEET_REVISION_CHANGED");
  }
  if (
    run.attendanceTimesheetRevision?.timesheet.status !== "LOCKED" ||
    run.attendanceTimesheetRevision.timesheet.currentRevisionId !== TIMESHEET_REVISION_ID
  ) {
    throw new Error("TIMESHEET_NOT_CURRENT_AND_LOCKED");
  }
  if (!readiness.canProceed || readiness.blockers.length !== 0) {
    throw new Error("PAYROLL_READINESS_BLOCKED");
  }
  const l24 = entry.statutorySnapshots.find((item) => item.scheme === "LINDUNG24");
  if (
    !l24 ||
    l24.evidenceNature !== "SYNTHETIC_TESTING" ||
    l24.evidenceEnvironment !== "TESTING" ||
    l24.fixturePurpose !== "PAYROLL_PAYSLIP_UAT" ||
    l24.officialExportEligible ||
    money(l24.employeeContribution) !== "0.00" ||
    l24.lindung24ParticipationVersion?.status !== "VOLUNTARY_OPT_OUT"
  ) {
    throw new Error("SYNTHETIC_LINDUNG24_SNAPSHOT_CHANGED");
  }
  return { entry, l24 };
}

async function safetyCounts() {
  return {
    artifacts: await prisma.payrollStatutoryExportArtifact.count({ where: { payrollRunId: RUN_ID } }),
    batches: await prisma.payrollPaymentBatch.count({ where: { payrollRunId: RUN_ID } }),
    entries: await prisma.payrollEntry.count({ where: { payrollRunId: RUN_ID } }),
    payments: await prisma.payrollPaymentInstruction.count({
      where: { payrollEntry: { payrollRunId: RUN_ID } },
    }),
    publications: await prisma.payrollPayslipPublication.count({ where: { payrollRunId: RUN_ID } }),
    runs: await prisma.payrollRun.count({
      where: {
        businessId: BUSINESS_ID,
        periodStart: new Date("2026-08-01T00:00:00.000Z"),
      },
    }),
    submissions: await prisma.payrollStatutorySubmission.count({ where: { payrollRunId: RUN_ID } }),
  };
}

async function actorContext() {
  const owner = await prisma.user.findFirst({
    where: {
      businessId: BUSINESS_ID,
      email: OWNER_EMAIL,
      loginEnabled: true,
      role: "BUSINESS_OWNER",
      status: "active",
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      permissions: true,
      status: true,
      branchId: true,
      business: { select: { industryType: true } },
    },
  });
  if (!owner?.email || owner.name !== "Payroll UAT Owner") {
    throw new Error("PAYROLL_UAT_OWNER_NOT_FOUND");
  }
  const access = await resolveBusinessAccess(
    { userId: owner.id, requestedBusinessId: BUSINESS_ID },
    prisma,
  );
  if (!access.granted || access.effectiveBusinessRole !== "BUSINESS_OWNER") {
    throw new Error("BUSINESS_OWNER_ACCESS_REQUIRED");
  }
  for (const capability of [
    "SUBMIT_PAYROLL_REVIEW",
    "APPROVE_PAYROLL",
    "PUBLISH_PAYSLIP",
  ] as const) {
    if (!hasBusinessCapability(access, capability)) {
      throw new Error(`OWNER_CAPABILITY_REQUIRED:${capability}`);
    }
  }
  const modules = await loadBusinessModuleContext(BUSINESS_ID, { database: prisma });
  if (!modules.enabledModules.has("PAYROLL")) throw new Error("PAYROLL_MODULE_NOT_ENABLED");
  const session = await prisma.authSession.findFirst({
    where: {
      absoluteExpiresAt: { gt: new Date() },
      activeBusinessId: BUSINESS_ID,
      idleExpiresAt: { gt: new Date() },
      revokedAt: null,
      userId: owner.id,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return {
    access,
    modules,
    owner: { ...owner, email: owner.email },
    session,
  };
}

async function ensureCanonicalOwnerSession(
  actor: Awaited<ReturnType<typeof actorContext>>,
) {
  if (actor.session) return actor.session;
  const password = process.env.PAYROLL_UAT_OWNER_PASSWORD;
  if (!password) throw new Error("CANONICAL_OWNER_LOGIN_PASSWORD_REQUIRED");
  const authenticated = await authenticatePasswordLogin({
    email: OWNER_EMAIL,
    password,
    request,
  });
  if (!authenticated.ok || authenticated.user.id !== actor.owner.id) {
    throw new Error("CANONICAL_OWNER_LOGIN_FAILED");
  }
  const sessionId = randomUUID();
  const stored = await persistSessionContext({
    userId: actor.owner.id,
    sessionId,
    homeBusinessId: BUSINESS_ID,
    activeBusinessId: BUSINESS_ID,
    contextVersion: SESSION_CONTEXT_VERSION,
    industryType: actor.owner.business?.industryType ?? null,
    branchId: actor.owner.branchId,
    name: actor.owner.name,
    email: actor.owner.email,
    role: actor.owner.role,
    permissions: actor.owner.permissions,
    status: actor.owner.status,
  }, { request });
  return { id: stored.id };
}

async function previewMarker() {
  const document = await loadPayrollPayslip(BUSINESS_ID, ENTRY_ID);
  if (!document) throw new Error("PAYSLIP_PREVIEW_NOT_AVAILABLE");
  const bytes = buildPayslipPdf(document.run, document.entry);
  return {
    bytes: bytes.length,
    marker: bytes
      .toString("latin1")
      .includes("TESTING / NON-PRODUCTION STATUTORY FIXTURE"),
  };
}

async function verifyFinalState() {
  const state = await loadState();
  const entry = state.run.entries[0];
  const publication = entry?.payslipPublication;
  if (
    state.run.status !== "FINALIZED" ||
    !entry ||
    entry.id !== ENTRY_ID ||
    !publication
  ) {
    throw new Error("FINALIZED_PAYSLIP_STATE_NOT_FOUND");
  }
  if (
    state.run.attendanceTimesheetRevisionId !== TIMESHEET_REVISION_ID ||
    state.run.attendanceTimesheetRevision?.timesheet.status !== "LOCKED" ||
    state.run.attendanceTimesheetRevision.timesheet.currentRevisionId !== TIMESHEET_REVISION_ID
  ) {
    throw new Error("FINALIZED_TIMESHEET_NOT_FROZEN");
  }
  const l24 = entry.statutorySnapshots.find((item) => item.scheme === "LINDUNG24");
  if (
    !l24 ||
    l24.evidenceNature !== "SYNTHETIC_TESTING" ||
    l24.evidenceEnvironment !== "TESTING" ||
    l24.fixturePurpose !== "PAYROLL_PAYSLIP_UAT" ||
    l24.officialExportEligible ||
    money(l24.employeeContribution) !== "0.00" ||
    l24.lindung24ParticipationVersion?.status !== "VOLUNTARY_OPT_OUT"
  ) {
    throw new Error("FINALIZED_SYNTHETIC_SNAPSHOT_CHANGED");
  }
  const [counts, guard, document, targetList] = await Promise.all([
    safetyCounts(),
    exportGuard(),
    loadPayrollPayslip(BUSINESS_ID, ENTRY_ID),
    loadPublishedPayslipsForEmployee({
      businessId: BUSINESS_ID,
      membershipId: MEMBERSHIP_ID,
    }, prisma),
  ]);
  if (!document) throw new Error("FINALIZED_PAYSLIP_DOCUMENT_SOURCE_NOT_FOUND");
  const own = await loadOwnPublishedPayslip({
    businessId: BUSINESS_ID,
    membershipId: MEMBERSHIP_ID,
    publicationId: publication.id,
  }, prisma);
  const account = await prisma.employeeAccount.findUniqueOrThrow({
    where: { phoneNormalized: PHONE },
    include: { memberships: { select: { id: true, businessId: true } } },
  });
  const otherBusinessMembership = account.memberships.find(
    (item) => item.businessId !== BUSINESS_ID,
  );
  const otherBusiness = otherBusinessMembership
    ? await loadOwnPublishedPayslip({
        businessId: otherBusinessMembership.businessId,
        membershipId: otherBusinessMembership.id,
        publicationId: publication.id,
      }, prisma)
    : null;
  const wrongMembership = await loadOwnPublishedPayslip({
    businessId: BUSINESS_ID,
    membershipId: "00000000-0000-0000-0000-000000000001",
    publicationId: publication.id,
  }, prisma);
  const bytes = Buffer.from(publication.documentBytes);
  const text = bytes.toString("latin1");
  const pdfLines = Array.from(text.matchAll(/\((.*?)\) Tj/g), (match) => match[1]);
  const content = {
    business: text.includes(BUSINESS_NAME.toUpperCase()),
    employeeCode: text.includes(EMPLOYEE_CODE),
    employeeName: text.includes(document.entry.fullName),
    marker: text.includes("TESTING / NON-PRODUCTION STATUTORY FIXTURE"),
    period: text.includes("Pay period: August 2026"),
    basic:
      (text.includes("Basic pay") || text.includes("Basic Salary")) &&
      text.includes("3000.00"),
    gross: text.includes("Gross pay") && text.includes("3000.00"),
    deductions: text.includes("Total deductions") && text.includes("0.00"),
    net: text.includes("NET PAY") && text.includes("3000.00"),
    zeroLindung24CanonicalLine:
      text.includes("LINDUNG 24 \\(employee deduction\\)") && text.includes("0.00"),
  };
  console.log(JSON.stringify({
    phase: "FINAL_VERIFICATION_PASS",
    run: {
      id: state.run.id,
      status: state.run.status,
      submittedAt: state.run.submittedAt,
      finalizedAt: state.run.finalizedAt,
    },
    entry: {
      id: entry.id,
      basic: money(entry.basicPay),
      gross: money(entry.grossPay),
      deductions: money(Number(entry.grossPay) - Number(entry.netPay)),
      net: money(entry.netPay),
    },
    publication: {
      id: publication.id,
      publishedAt: publication.publishedAt,
      bytes: bytes.length,
      sha256Matches:
        createHash("sha256").update(bytes).digest("hex") === publication.documentSha256,
    },
    canonicalSource: {
      business: document.run.business.name,
      employeeCode: document.entry.employeeCode,
      employeeName: document.entry.fullName,
      periodStart: document.run.periodStart,
      periodEnd: document.run.periodEnd,
      status: document.run.status,
      basic: document.entry.basicPay,
      gross: document.entry.grossPay,
      lindung24: document.entry.lindung24Employee,
      net: document.entry.netPay,
    },
    content,
    pdfLines,
    projection: {
      targetCount: targetList.length,
      ownAllowed: Boolean(own),
      otherBusinessDenied: otherBusiness === null,
      wrongMembershipDenied: wrongMembership === null,
    },
    counts,
    exportGuard: guard,
    syntheticSnapshot: {
      evidenceNature: l24.evidenceNature,
      evidenceEnvironment: l24.evidenceEnvironment,
      fixturePurpose: l24.fixturePurpose,
      officialExportEligible: l24.officialExportEligible,
      participation: l24.lindung24ParticipationVersion?.status,
      contribution: money(l24.employeeContribution),
    },
  }, null, 2));
}

async function preflight() {
  const state = await loadState();
  const { entry, l24 } = assertCoreFacts(state);
  const [guard, counts, actor, preview] = await Promise.all([
    exportGuard(),
    safetyCounts(),
    actorContext(),
    previewMarker(),
  ]);
  if (guard !== "SYNTHETIC_STATUTORY_EVIDENCE_NOT_EXPORTABLE") {
    throw new Error(`OFFICIAL_EXPORT_GUARD_FAILED:${guard}`);
  }
  if (
    counts.runs !== 1 ||
    counts.entries !== 1 ||
    counts.publications !== 0 ||
    counts.payments !== 0 ||
    counts.batches !== 0 ||
    counts.artifacts !== 0 ||
    counts.submissions !== 0
  ) {
    throw new Error("STARTING_DUPLICATE_OR_SAFETY_COUNTS_CHANGED");
  }
  if (!preview.marker || preview.bytes === 0) throw new Error("TESTING_PAYSLIP_MARKER_MISSING");
  return {
    actor,
    counts,
    entry,
    guard,
    l24,
    preview,
    state,
  };
}

async function main() {
  assertTestingBoundary();
  if (VERIFY_FINAL) {
    await verifyFinalState();
    return;
  }
  const before = await preflight();
  console.log(JSON.stringify({
    phase: "PREFLIGHT_PASS",
    apply: APPLY,
    resume: RESUME,
    runStatus: before.state.run.status,
    entryStatus: before.entry.statutoryStatus,
    readiness: {
      status: before.state.readiness.status,
      canProceed: before.state.readiness.canProceed,
      blockers: before.state.readiness.blockers.map((item) => item.code),
      warnings: before.state.readiness.warnings.map((item) => item.code),
    },
    owner: { id: before.actor.owner.id, name: before.actor.owner.name, role: before.actor.owner.role },
    activeOwnerSession: Boolean(before.actor.session),
    exportGuard: before.guard,
    counts: before.counts,
    testingMarker: before.preview,
    syntheticSnapshot: {
      evidenceNature: before.l24.evidenceNature,
      evidenceEnvironment: before.l24.evidenceEnvironment,
      fixturePurpose: before.l24.fixturePurpose,
      officialExportEligible: before.l24.officialExportEligible,
      participation: before.l24.lindung24ParticipationVersion?.status,
      contribution: money(before.l24.employeeContribution),
    },
  }, null, 2));
  if (!APPLY) return;
  const ownerSession = await ensureCanonicalOwnerSession(before.actor);

  const actor = {
    userId: before.actor.owner.id,
    name: before.actor.owner.name,
    email: before.actor.owner.email,
  };
  if (before.state.run.status === "DRAFT") {
    const submitted = await submitPayrollRunForReview(
      { actor, businessId: BUSINESS_ID, request, runId: RUN_ID },
      prisma,
    );
    if (submitted.status !== "REVIEW") throw new Error("SUBMIT_DID_NOT_ENTER_REVIEW");
  } else if (before.state.run.status !== "REVIEW") {
    throw new Error(`RUN_CANNOT_RESUME_FROM:${before.state.run.status}`);
  }
  const afterSubmit = await loadState();
  if (
    afterSubmit.run.status !== "REVIEW" ||
    !afterSubmit.readiness.canProceed ||
    afterSubmit.readiness.blockers.length !== 0 ||
    afterSubmit.run.attendanceTimesheetRevisionId !== TIMESHEET_REVISION_ID
  ) {
    throw new Error("POST_SUBMIT_CONTRACT_FAILED");
  }
  const submittedL24 = afterSubmit.run.entries[0]?.statutorySnapshots.find(
    (item) => item.scheme === "LINDUNG24",
  );
  if (
    !submittedL24 ||
    submittedL24.evidenceNature !== "SYNTHETIC_TESTING" ||
    submittedL24.fixturePurpose !== "PAYROLL_PAYSLIP_UAT"
  ) {
    throw new Error("POST_SUBMIT_SYNTHETIC_PROVENANCE_CHANGED");
  }

  const stepUp = await issuePayrollHighRiskAuthorization({
    access: before.actor.access,
    actionKey: "PAYROLL_FINALIZE",
    businessId: BUSINESS_ID,
    enabledModules: before.actor.modules.enabledModules,
    factor: { factorType: "TOTP", code: "MFA_TEMPORARILY_DISABLED" },
    password: "MFA_TEMPORARILY_DISABLED",
    request,
    resourceId: RUN_ID,
    user: { sessionId: ownerSession.id, userId: before.actor.owner.id },
  });
  const finalized = await finalizePayrollRun(
    {
      actor,
      allowSelfApprovalOverride: true,
      businessId: BUSINESS_ID,
      overrideReason: OVERRIDE_REASON,
      request,
      runId: RUN_ID,
      stepUp,
    },
    prisma,
  );
  if (finalized.status !== "FINALIZED") throw new Error("FINALIZE_DID_NOT_COMPLETE");

  const publicationResult = await publishPayrollPayslips(
    { actor, businessId: BUSINESS_ID, request, runId: RUN_ID },
    prisma,
  );
  if (publicationResult.publishedCount !== 1 || publicationResult.alreadyPublishedCount !== 0) {
    throw new Error("PAYSLIP_PUBLICATION_COUNT_MISMATCH");
  }

  const after = await loadState();
  const afterEntry = after.run.entries[0];
  const publication = afterEntry?.payslipPublication;
  if (!afterEntry || after.run.status !== "FINALIZED" || !publication) {
    throw new Error("FINALIZED_PUBLICATION_NOT_FOUND");
  }
  const finalCounts = await safetyCounts();
  const finalGuard = await exportGuard();
  const targetList = await loadPublishedPayslipsForEmployee({
    businessId: BUSINESS_ID,
    membershipId: MEMBERSHIP_ID,
  }, prisma);
  const own = await loadOwnPublishedPayslip({
    businessId: BUSINESS_ID,
    membershipId: MEMBERSHIP_ID,
    publicationId: publication.id,
  }, prisma);
  const account = await prisma.employeeAccount.findUniqueOrThrow({
    where: { phoneNormalized: PHONE },
    include: { memberships: { select: { id: true, businessId: true } } },
  });
  const royalMembership = account.memberships.find((item) => item.businessId !== BUSINESS_ID);
  const wrongBusiness = royalMembership
    ? await loadOwnPublishedPayslip({
        businessId: royalMembership.businessId,
        membershipId: royalMembership.id,
        publicationId: publication.id,
      }, prisma)
    : null;
  const wrongMembership = await loadOwnPublishedPayslip({
    businessId: BUSINESS_ID,
    membershipId: "00000000-0000-0000-0000-000000000001",
    publicationId: publication.id,
  }, prisma);
  const audits = await prisma.auditLog.findMany({
    where: {
      businessId: BUSINESS_ID,
      entityId: RUN_ID,
      action: { in: [
        "PAYROLL_RUN_SUBMITTED_FOR_REVIEW",
        "PAYROLL_RUN_FINALIZED_WITH_OWNER_OVERRIDE",
        "PAYSLIPS_PUBLISHED",
      ] },
    },
    orderBy: { createdAt: "asc" },
    select: { action: true, actorName: true, createdAt: true, metadata: true },
  });
  const testFixtureAuditCount = await prisma.auditLog.count({
    where: { businessId: BUSINESS_ID, action: "STATUTORY_TEST_FIXTURE_CREATED" },
  });
  const storedBytes = Buffer.from(publication.documentBytes);
  const storedText = storedBytes.toString("latin1");
  const content = {
    business: storedText.includes(BUSINESS_NAME),
    employee: storedText.includes(EMPLOYEE_CODE),
    marker: storedText.includes("TESTING / NON-PRODUCTION STATUTORY FIXTURE"),
    period: storedText.includes("2026-08"),
  };
  console.log(JSON.stringify({
    phase: "FINALIZED_AND_PUBLISHED",
    submitted: {
      at: after.run.submittedAt,
      by: after.run.submittedBy,
    },
    finalized: {
      at: after.run.finalizedAt,
      by: after.run.finalizedBy,
      status: after.run.status,
    },
    amounts: {
      basic: money(afterEntry.basicPay),
      gross: money(afterEntry.grossPay),
      deductions: money(Number(afterEntry.grossPay) - Number(afterEntry.netPay)),
      net: money(afterEntry.netPay),
    },
    publication: {
      id: publication.id,
      bytes: storedBytes.length,
      publishedAt: publication.publishedAt,
      sha256: publication.documentSha256,
    },
    content,
    projection: {
      targetCount: targetList.length,
      ownAllowed: Boolean(own),
      wrongBusinessDenied: wrongBusiness === null,
      wrongMembershipDenied: wrongMembership === null,
    },
    counts: finalCounts,
    exportGuard: finalGuard,
    audits,
    testFixtureAuditCount,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
