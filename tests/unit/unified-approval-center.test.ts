import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  availableApprovalDomains,
  projectAttendanceP2,
  projectClaim,
  projectCommission,
  projectLeave,
  projectPayroll,
  type UnifiedApprovalContext,
} from "../../src/lib/approvals/service";
import type { BusinessCapability } from "../../src/lib/business-groups/capabilities";
import type { ModuleKey } from "../../src/lib/modules/registry";

const root = process.cwd();

test("approval domains require HR, their module and an actionable capability", () => {
  assert.deepEqual(availableApprovalDomains(context(["CORE", "POS", "SALON"], [])), []);
  assert.deepEqual(
    availableApprovalDomains(context(["CORE", "HR"], ["MODIFY_ATTENDANCE_EMPLOYEES", "APPROVE_LEAVE"])),
    ["ATTENDANCE", "LEAVE"],
  );
  assert.deepEqual(
    availableApprovalDomains(context(["CORE", "COMMISSION"], ["APPROVE_COMMISSION"])),
    [],
    "commission-only businesses keep their independent page without acquiring an HR center",
  );
  assert.deepEqual(
    availableApprovalDomains(context(
      ["CORE", "HR", "CLAIMS", "COMMISSION", "PAYROLL"],
      ["MODIFY_ATTENDANCE_EMPLOYEES", "APPROVE_LEAVE", "REVIEW_CLAIM", "APPROVE_COMMISSION", "APPROVE_PAYROLL"],
    )),
    ["ATTENDANCE", "LEAVE", "CLAIMS", "COMMISSION", "PAYROLL"],
  );
});

test("domain projections use stable identities and expose only minimal review summaries", () => {
  const now = new Date("2026-08-11T01:00:00.000Z");
  const attendance = projectAttendanceP2({
    id: "attendance-id", branchId: "branch-id", workDate: now,
    type: "NO_ATTENDANCE_RECORDED", revision: 2, detectedAt: now,
    exceptionMinutes: 0, membership: { id: "member-id", fullName: "QA Staff", employeeCode: "QA-1" },
    branch: { name: "QA Branch" },
  }, "business-id");
  const leave = projectLeave({
    id: "leave-id", branchId: "branch-id", policyNameSnapshot: "Annual leave",
    payTreatmentSnapshot: "PAID", leaveUnit: "FULL_DAY", startsOn: now, endsOn: now,
    requestedDays: "1", documentReference: "private-object-key", revision: 1, createdAt: now,
    membership: { id: "member-id", fullName: "QA Staff", employeeCode: "QA-1" }, branch: { name: "QA Branch" },
  }, "business-id");
  const claim = projectClaim({
    id: "claim-id", branchId: "branch-id", claimNumber: "CLM-1", submittedTotal: "42.50",
    duplicateWarning: true, revision: 3, submittedAt: now, createdAt: now,
    membership: { id: "member-id", fullName: "QA Staff", employeeCode: "QA-1" }, branch: { name: "QA Branch" },
    lines: [{ categoryNameSnapshot: "Travel", attachments: [{ id: "attachment-id" }] }],
  }, "business-id");

  assert.equal(attendance.id, "ATTENDANCE:P2:attendance-id");
  assert.equal(attendance.title, "No attendance recorded");
  assert.equal(leave.id, "LEAVE:leave-id");
  assert.equal(leave.metadata.attachment, true);
  assert.doesNotMatch(leave.summary, /private-object-key/);
  assert.equal(claim.id, "CLAIM:claim-id");
  assert.match(claim.summary, /Receipt attached/);
  assert.doesNotMatch(JSON.stringify(claim), /objectKey|checksum|mimeType|bytes/);
});

test("compensation projections remain capability-bound and Payroll advertises its MFA boundary", () => {
  const now = new Date("2026-08-11T01:00:00.000Z");
  const commission = projectCommission({
    id: "period-id", branchId: null, branch: null, earnedPeriodStart: now,
    earnedPeriodEnd: now, currentRevision: 4, calculatedAt: now,
    statements: [{ eligibleSalesCents: 10_000, adjustmentCents: 100, finalCommissionCents: 900, membership: { fullName: "QA Staff" } }],
  }, "business-id");
  const payroll = projectPayroll({
    id: "run-id", status: "REVIEW", periodStart: now, submittedAt: now, updatedAt: now,
    entries: [{ grossPay: "3000", netPay: "2800" }],
  }, { canProceed: false, blockers: [{ code: "TEST_BLOCKER" }] }, "business-id");

  assert.equal(commission.requiredCapability, "APPROVE_COMMISSION");
  assert.equal(commission.amount, 9);
  assert.equal(payroll.requiredCapability, "APPROVE_PAYROLL");
  assert.equal(payroll.status, "BLOCKED");
  assert.equal(payroll.metadata.mfaBoundary, true);
  assert.equal(payroll.targetUrl, "/team/payroll/runs/run-id");
});

test("Approval Center remains a read model and delegates every mutation", async () => {
  const [service, page, payrollPage, permissions, shell] = await Promise.all([
    source("src/lib/approvals/service.ts"),
    source("src/app/(business)/team/approvals/page.tsx"),
    source("src/app/(business)/team/payroll/runs/[runId]/page.tsx"),
    source("src/lib/auth/staff-permissions.ts"),
    source("src/components/app-shell.tsx"),
  ]);
  assert.doesNotMatch(service, /genericApproval|approvalItem\.(create|update)|ApprovalStatus/);
  assert.doesNotMatch(page, /"use server"|prisma\.[a-zA-Z]+\.(create|update|delete)|action=\{/);
  assert.match(page, /item\.targetUrl/);
  assert.match(service, /businessId: context\.businessId/);
  assert.match(service, /branchId: \{ in: branchIds \}/);
  assert.match(service, /staffUser: \{ isNot: \{ id: context\.actorUserId \} \}/);
  assert.match(payrollPage, /PayrollHighRiskMfaFields/);
  assert.match(permissions, /pathname === "\/team\/approvals"[\s\S]*return null/);
  assert.match(shell, /href: "\/team\/approvals"/);
});

function context(
  modules: ModuleKey[],
  capabilities: BusinessCapability[],
): UnifiedApprovalContext {
  return {
    actorUserId: "actor-id",
    businessId: "business-id",
    allowedBranchIds: ["branch-id"],
    wholeBusinessScope: true,
    enabledModules: new Set(modules),
    capabilities: new Set(capabilities),
  };
}

function source(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}
