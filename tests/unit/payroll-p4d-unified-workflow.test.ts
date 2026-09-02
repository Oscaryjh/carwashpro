import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { buildPayslipPdf, type PayrollDocumentEntry } from "../../src/lib/payroll/export";
import {
  loadOwnPublishedPayslip,
} from "../../src/lib/payroll/payslip-publication";
import {
  assertPayrollReadinessCanProceed,
  createPayrollReadinessIssue,
  summarizePayrollReadiness,
} from "../../src/lib/payroll/readiness";

const businessId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const membershipId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("P4D readiness is deterministic and warnings do not block workflow", () => {
  const warning = createPayrollReadinessIssue({
    code: "MISSING_BANK_ACCOUNT",
    severity: "REVIEW",
    membershipId,
    employeeCode: "EMP-1",
    employeeName: "Aina",
    message: "No active primary bank account is configured.",
  });
  const input = {
    businessId,
    month: "2026-08",
    runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    memberships: [{ id: membershipId, employeeCode: "EMP-1", fullName: "Aina" }],
    issues: [warning],
  };
  const first = summarizePayrollReadiness(input);
  const second = summarizePayrollReadiness(input);
  assert.deepEqual(first, second);
  assert.equal(first.canProceed, true);
  assert.equal(first.blockers.length, 0);
  assert.equal(first.warnings.length, 1);
  assert.equal(first.status, "REVIEW_REQUIRED");
  assert.equal(first.reviewRequiredCount, 1);
  assert.equal(first.warnings[0].source, "Payment Readiness");
  assert.match(first.warnings[0].resolutionHint, /payment batch/);
  assert.equal(first.counts.MISSING_BANK_ACCOUNT, 1);
  assert.doesNotThrow(() => assertPayrollReadinessCanProceed(first));
});

test("P4D blockers fail closed with a concrete employee reason", () => {
  const readiness = summarizePayrollReadiness({
    businessId,
    month: "2026-08",
    runId: null,
    memberships: [{ id: membershipId, employeeCode: "EMP-1", fullName: "Aina" }],
    issues: [createPayrollReadinessIssue({
      code: "MISSING_COMPENSATION",
      severity: "BLOCKING",
      membershipId,
      employeeCode: "EMP-1",
      employeeName: "Aina",
      message: "No verified compensation applies to this payroll month.",
    })],
  });
  assert.equal(readiness.canProceed, false);
  assert.equal(readiness.employees[0].status, "BLOCKED");
  assert.throws(
    () => assertPayrollReadinessCanProceed(readiness),
    /Aina: No verified compensation/,
  );
});

test("P4D reconciliation, proration and missing correction materialization all block", () => {
  const blockerCodes = [
    "RECONCILIATION_FAILED",
    "PRORATION_NOT_SUPPORTED",
    "APPROVED_CORRECTION_MISSING",
  ] as const;
  const readiness = summarizePayrollReadiness({
    businessId,
    month: "2026-08",
    runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    memberships: [{ id: membershipId, employeeCode: "EMP-1", fullName: "Aina" }],
    issues: blockerCodes.map((code) => createPayrollReadinessIssue({
      code,
      severity: "BLOCKING" as const,
      membershipId,
      employeeCode: "EMP-1",
      employeeName: "Aina",
      message: code,
    })),
  });
  assert.equal(readiness.canProceed, false);
  assert.equal(readiness.blockers.length, 3);
  for (const code of blockerCodes) {
    assert.equal(readiness.counts[code], 1);
  }
});

test("P4D self-service query binds publication, business and membership", async () => {
  let where: unknown;
  const database = {
    payrollPayslipPublication: {
      findFirst(query: { where: unknown }) {
        where = query.where;
        return Promise.resolve(null);
      },
    },
  } as unknown as PrismaClient;
  await loadOwnPublishedPayslip({
    businessId,
    membershipId,
    publicationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  }, database);
  assert.deepEqual(where, {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    businessId,
    membershipId,
  });
});

test("P4D payslip renders frozen canonical component names", () => {
  const entry: PayrollDocumentEntry = {
    id: "entry",
    employeeCode: "EMP-1",
    fullName: "Aina",
    payBasis: "MONTHLY",
    attendanceDays: 26,
    regularMinutes: 0,
    overtimeMinutes: 0,
    publicHolidayMinutes: 0,
    basicPay: 3500,
    overtimePay: 0,
    publicHolidayPay: 0,
    allowances: 1150,
    otherDeductions: 200,
    epfEmployee: 0,
    socsoEmployee: 0,
    eisEmployee: 0,
    lindung24Employee: 0,
    pcb: 0,
    cp38: 0,
    employerEpf: 0,
    employerSocso: 0,
    employerEis: 0,
    grossPay: 4650,
    netPay: 4450,
    statutoryStatus: "NOT_CONFIGURED",
    statutoryRuleVersion: null,
    notes: null,
    components: [
      { name: "Basic Salary", type: "EARNING", amount: 3500 },
      { name: "Transport Allowance", type: "EARNING", amount: 300 },
      { name: "Commission", type: "EARNING", amount: 850 },
      { name: "Staff Loan", type: "DEDUCTION", amount: 200 },
    ],
  };
  const pdf = buildPayslipPdf({
    id: "run",
    business: { name: "Tetamu", companyNo: null, address: null, phone: null, email: null },
    periodStart: new Date("2026-08-01T00:00:00.000Z"),
    periodEnd: new Date("2026-09-01T00:00:00.000Z"),
    status: "FINALIZED",
    submittedAt: null,
    finalizedAt: new Date("2026-09-01T00:00:00.000Z"),
  }, entry).toString("latin1");
  assert.match(pdf, /Transport Allowance/);
  assert.match(pdf, /Commission/);
  assert.match(pdf, /Staff Loan/);
});

test("P4D wiring keeps domain logic server-side and publication immutable", async () => {
  const [readiness, service, runPage, entryPage, staffRoute, staffLoading, staffError, schema, migration] = await Promise.all([
    readFile("src/lib/payroll/readiness.ts", "utf8"),
    readFile("src/lib/payroll/service.ts", "utf8"),
    readFile("src/app/(business)/team/payroll/runs/[runId]/page.tsx", "utf8"),
    readFile("src/app/(business)/team/payroll/runs/[runId]/entries/[entryId]/page.tsx", "utf8"),
    readFile("src/app/staff/payslips/[publicationId]/route.ts", "utf8"),
    readFile("src/app/staff/payslips/loading.tsx", "utf8"),
    readFile("src/app/staff/payslips/error.tsx", "utf8"),
    readFile("prisma/schema.prisma", "utf8"),
    readFile("prisma/migrations/20260808210000_payroll_p4d_payslip_publication/migration.sql", "utf8"),
  ]);
  assert.match(readiness, /getPayrollRunComponentReconciliationFailures/);
  assert.match(readiness, /APPROVED_CORRECTION_MISSING/);
  assert.match(readiness, /PRORATION_NOT_SUPPORTED/);
  assert.match(service, /assertPayrollReadinessCanProceed\(readiness\)/);
  assert.match(runPage, /Payroll readiness/);
  assert.match(runPage, /groupReadinessIssues/);
  assert.match(runPage, /Payroll setup incomplete/);
  assert.match(runPage, /View fixes/);
  assert.match(runPage, /\/admin\/statutory\/rulesets/);
  assert.match(runPage, /section=statutory/);
  assert.match(runPage, /Publish payslips/);
  assert.match(entryPage, /Review is locked for editing/);
  assert.match(entryPage, /Finalized payroll is immutable/);
  assert.match(staffRoute, /membershipId: auth\.membershipId/);
  assert.match(staffLoading, /aria-busy="true"/);
  assert.match(staffError, /No stale or unpublished (?:payroll document|payslip) is shown/);
  assert.match(schema, /model PayrollPayslipPublication/);
  assert.match(migration, /Published payslips are immutable/);
  assert.match(migration, /run_status IS DISTINCT FROM 'FINALIZED'/);
});
