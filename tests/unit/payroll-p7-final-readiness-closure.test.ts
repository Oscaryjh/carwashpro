import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertPayrollReadinessCanProceed,
  createPayrollReadinessIssue,
  summarizePayrollReadiness,
} from "../../src/lib/payroll/readiness";
import { calculateCompanyWorkPay } from "../../src/lib/payroll/company-work-pay";

const businessId = "11111111-1111-4111-8111-111111111111";
const readyMembershipId = "22222222-2222-4222-8222-222222222222";
const reviewMembershipId = "33333333-3333-4333-8333-333333333333";
const blockedMembershipId = "44444444-4444-4444-8444-444444444444";

test("P7 readiness exposes canonical READY, REVIEW_REQUIRED and BLOCKED employee states", () => {
  const readiness = summarizePayrollReadiness({
    businessId,
    month: "2026-08",
    runId: "55555555-5555-4555-8555-555555555555",
    memberships: [
      { id: readyMembershipId, employeeCode: "EMP-001", fullName: "Ready Staff" },
      { id: reviewMembershipId, employeeCode: "EMP-002", fullName: "Review Staff" },
      { id: blockedMembershipId, employeeCode: "EMP-003", fullName: "Blocked Staff" },
    ],
    issues: [
      createPayrollReadinessIssue({
        code: "MISSING_BANK_ACCOUNT",
        severity: "REVIEW",
        membershipId: reviewMembershipId,
        employeeCode: "EMP-002",
        employeeName: "Review Staff",
        message: "No active primary bank account is configured.",
      }),
      createPayrollReadinessIssue({
        code: "MISSING_COMPENSATION",
        severity: "BLOCKING",
        membershipId: blockedMembershipId,
        employeeCode: "EMP-003",
        employeeName: "Blocked Staff",
        message: "No verified compensation applies to this payroll month.",
      }),
    ],
  });

  assert.equal(readiness.status, "BLOCKED");
  assert.equal(readiness.readyCount, 1);
  assert.equal(readiness.reviewRequiredCount, 1);
  assert.equal(readiness.blockedCount, 1);
  assert.equal(readiness.canProceed, false);
  assert.deepEqual(
    readiness.employees.map((employee) => employee.status),
    ["READY", "REVIEW_REQUIRED", "BLOCKED"],
  );
  assert.equal(readiness.warnings[0].employeeId, reviewMembershipId);
  assert.equal(readiness.warnings[0].source, "Payment Readiness");
  assert.match(readiness.warnings[0].resolutionHint, /payment batch/i);
  assert.ok(readiness.blockers[0].source.length > 0);
  assert.ok(readiness.blockers[0].resolutionHint.length > 0);
  assert.throws(() => assertPayrollReadinessCanProceed(readiness), /Blocked Staff/);
});

test("P7 payment-only readiness does not block payroll calculation finalization", () => {
  const readiness = summarizePayrollReadiness({
    businessId,
    month: "2026-08",
    runId: null,
    memberships: [
      { id: reviewMembershipId, employeeCode: "EMP-002", fullName: "Review Staff" },
    ],
    issues: [createPayrollReadinessIssue({
      code: "MISSING_BANK_ACCOUNT",
      severity: "REVIEW",
      membershipId: reviewMembershipId,
      employeeCode: "EMP-002",
      employeeName: "Review Staff",
      message: "No active primary bank account is configured.",
    })],
  });

  assert.equal(readiness.status, "REVIEW_REQUIRED");
  assert.equal(readiness.canProceed, true);
  assert.equal(readiness.blockers.length, 0);
  assert.doesNotThrow(() => assertPayrollReadinessCanProceed(readiness));
});

test("P7 finalize re-runs canonical readiness transactionally and fails closed on concurrent change", async () => {
  const service = await readFile("src/lib/payroll/service.ts", "utf8");
  const finalizeStart = service.indexOf("export async function finalizePayrollRun");
  const finalizeEnd = service.indexOf("export async function reopenPayrollRun", finalizeStart);
  const finalizeSource = service.slice(finalizeStart, finalizeEnd);

  assert.ok(finalizeStart >= 0);
  assert.match(finalizeSource, /database\.\$transaction\(async \(transaction\)/);
  assert.match(finalizeSource, /getPayrollPeriodReadiness\([\s\S]*?transaction/);
  assert.match(finalizeSource, /assertPayrollReadinessCanProceed\(readiness\)/);
  assert.match(finalizeSource, /consumePayrollHighRiskAuthorization\(/);
  assert.match(finalizeSource, /payrollRun\.updateMany\(/);
  assert.match(finalizeSource, /status: "REVIEW"/);
  assert.match(finalizeSource, /updatedAt: run\.updatedAt/);
  assert.match(finalizeSource, /finalizedWrite\.count !== 1/);
  assert.match(finalizeSource, /isolationLevel: "Serializable"/);
});

test("P7 HR company work-pay is deterministic and canonical components retain provenance", async () => {
  const schema = await readFile("prisma/schema.prisma", "utf8");
  const calculated = calculateCompanyWorkPay({
    payBasis: "MONTHLY",
    baseRateCents: 260_000,
    workingDaysPerMonth: 26,
    normalWorkMinutesPerDay: 480,
    normalOtMinutes: 180,
    restDayWorkMinutes: 120,
    restDayOtMinutes: 0,
    publicHolidayWorkMinutes: 60,
    publicHolidayOtMinutes: 0,
    overtimeMultiplier: 1.5,
    restDayWorkMultiplier: 2,
    restDayOvertimeMultiplier: 2,
    publicHolidayWorkMultiplier: 2,
    publicHolidayOvertimeMultiplier: 3,
    publicHolidayPayEnabled: true,
  });

  assert.equal(calculated.normalOvertimePayCents, 5_625);
  assert.equal(calculated.restDayWorkPayCents, 5_000);
  assert.equal(calculated.publicHolidayWorkPayCents, 2_500);
  assert.equal(calculated.overtimePayCents, 10_625);
  assert.equal(calculated.publicHolidayPayCents, 2_500);
  assert.match(schema, /model PayrollEntryComponent/);
  assert.match(schema, /sourceType\s+PayrollEntryComponentSourceType/);
  assert.match(schema, /sourceVersionId/);
  assert.match(schema, /sourceRevision/);
  assert.match(schema, /calculationBasis/);
  assert.match(schema, /@@unique\(\[payrollEntryId, lineKey\]\)/);
});

test("P7 run review filters readiness before pagination and shows actionable drill-down", async () => {
  const [runs, page] = await Promise.all([
    readFile("src/lib/payroll/runs.ts", "utf8"),
    readFile("src/app/(business)/team/payroll/runs/[runId]/page.tsx", "utf8"),
  ]);

  assert.match(runs, /membershipIds\?: readonly string\[\]/);
  assert.match(runs, /membershipId: \{ in: \[\.\.\.membershipIds\] \}/);
  assert.match(page, /REVIEW_REQUIRED/);
  assert.match(page, /Blocked/);
  assert.match(page, /Payroll setup incomplete/);
  assert.match(page, /readinessIssueDisplay/);
  assert.match(page, /readinessIssueFix/);
  assert.match(page, /aria-label={`Fix \$\{display\.title\}`}/);
  assert.match(page, /loadPayrollRunDetail\([\s\S]*?filteredMembershipIds/);
});
