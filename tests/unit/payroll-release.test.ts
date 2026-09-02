import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildPayrollExport,
  buildPayslipPdf,
  buildStatutoryExport,
  pcbPayslipPresentation,
  payslipFileName,
  type PayrollDocumentRun,
} from "../../src/lib/payroll/export";
import { payrollTransition } from "../../src/lib/payroll/workflow";

const run: PayrollDocumentRun = {
  id: "run-1",
  business: {
    name: "Tetamu Test Salon",
    companyNo: "202601234567",
    address: "Kota Kinabalu, Sabah",
    phone: "+60123456789",
    email: "payroll@example.com",
  },
  periodStart: new Date("2026-08-01T00:00:00.000Z"),
  periodEnd: new Date("2026-09-01T00:00:00.000Z"),
  status: "FINALIZED",
  submittedAt: new Date("2026-09-01T01:00:00.000Z"),
  finalizedAt: new Date("2026-09-01T02:00:00.000Z"),
  entries: [
    {
      id: "entry-1",
      employeeCode: "EMP-001",
      fullName: "Aina Rahman",
      payBasis: "MONTHLY",
      attendanceDays: 26,
      regularMinutes: 12_480,
      overtimeMinutes: 120,
      publicHolidayMinutes: 0,
      basicPay: 2000,
      overtimePay: 28.85,
      publicHolidayPay: 0,
      allowances: 100,
      otherDeductions: 10,
      epfEmployee: 220,
      socsoEmployee: 10.25,
      eisEmployee: 4.1,
      lindung24Employee: 0,
      pcb: 12,
      cp38: 0,
      employerEpf: 260,
      employerSocso: 35.85,
      employerEis: 4.1,
      grossPay: 2128.85,
      netPay: 1872.5,
      statutoryStatus: "AUTO_CALCULATED",
      statutoryRuleVersion: "KWSP_TEST|PERKESO_TEST",
      notes: "Approved",
    },
  ],
};

test("payroll workflow enforces review before finalization", () => {
  assert.equal(payrollTransition("DRAFT", "SUBMIT_FOR_REVIEW"), "REVIEW");
  assert.equal(payrollTransition("REVIEW", "FINALIZE"), "FINALIZED");
  assert.equal(payrollTransition("REVIEW", "RETURN_TO_DRAFT"), "DRAFT");
  assert.equal(payrollTransition("FINALIZED", "REOPEN"), "DRAFT");
  assert.throws(
    () => payrollTransition("DRAFT", "FINALIZE"),
    /submitted for review/,
  );
});

test("payslip PDF contains payroll identity and has a safe filename", () => {
  const { entries, ...runHeader } = run;
  const pdf = buildPayslipPdf(runHeader, entries[0]);
  assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
  assert.match(pdf.toString("latin1"), /PAYSLIP/);
  assert.match(pdf.toString("latin1"), /Aina Rahman/);
  assert.equal(
    payslipFileName(runHeader, entries[0]),
    "EMP-001-2026-08-payslip.pdf",
  );
});

test("draft payslip keeps blocked PCB out of final net-pay semantics", () => {
  const entry = {
    ...run.entries[0],
    fullName: "Oscar Yong",
    basicPay: 2000,
    overtimePay: 129.81,
    grossPay: 2129.81,
    otherDeductions: 76.92,
    unpaidLeaveDeduction: 76.92,
    unauthorizedAbsenceDays: 1,
    epfEmployee: 220,
    socsoEmployee: 10.75,
    eisEmployee: 4.3,
    lindung24Employee: 16.15,
    pcb: 0,
    netPay: 1801.69,
    employerEpf: 260,
    employerSocso: 37.65,
    employerEis: 4.3,
    components: [
      { name: "Basic Salary", type: "EARNING" as const, amount: 2000, sourceType: "BASIC_SALARY" },
      { name: "Overtime Pay", type: "EARNING" as const, amount: 129.81, sourceType: "PAYROLL_CALCULATION" },
      { name: "Unpaid Absence Deduction", type: "DEDUCTION" as const, amount: 76.92, sourceType: "ATTENDANCE" },
      { name: "EPF / KWSP", type: "DEDUCTION" as const, amount: 220, sourceType: "STATUTORY" },
    ],
    statutorySnapshots: [
      { scheme: "EPF" as const, status: "CALCULATED" as const, blockerCode: null, employeeContribution: 220, employerContribution: 260 },
      { scheme: "SOCSO" as const, status: "CALCULATED" as const, blockerCode: null, employeeContribution: 10.75, employerContribution: 37.65 },
      { scheme: "EIS" as const, status: "CALCULATED" as const, blockerCode: null, employeeContribution: 4.3, employerContribution: 4.3 },
      { scheme: "LINDUNG24" as const, status: "CALCULATED" as const, blockerCode: null, employeeContribution: 16.15, employerContribution: 0 },
      { scheme: "PCB" as const, status: "BLOCKED" as const, blockerCode: "PCB_TAX_REGIME_NOT_VERIFIED", employeeContribution: 0, employerContribution: 0 },
    ],
  };
  const { entries, ...runHeader } = run;
  assert.ok(entries.length > 0);
  const pdf = buildPayslipPdf({ ...runHeader, status: "DRAFT", finalizedAt: null }, entry).toString("latin1");
  assert.match(pdf, /DRAFT PAYSLIP PREVIEW/);
  assert.match(pdf, /Unpaid absence: 1 day/);
  assert.ok(pdf.includes("Current deductions \\(excludes pending PCB\\)"));
  assert.ok(pdf.includes("RM 328.12"));
  assert.ok(pdf.includes("ESTIMATED NET PAY \\(BEFORE PCB\\)"));
  assert.ok(pdf.includes("RM 1,801.69"));
  assert.match(pdf, /PCB \/ MTD: Pending configuration/);
  assert.doesNotMatch(pdf, /PCB \/ MTD: RM0\.00/);
  assert.equal(pdf.match(/EPF \/ KWSP/g)?.length, undefined);
  assert.equal(pdf.split("EPF \\(Employee\\)").length - 1, 1);
});

test("PCB presentation distinguishes pending review, calculated zero and not applicable", () => {
  const base = { pcb: 0, statutorySnapshots: [] };
  assert.deepEqual(pcbPayslipPresentation("DRAFT", base), {
    pending: true,
    value: "Pending configuration",
  });
  assert.deepEqual(pcbPayslipPresentation("DRAFT", {
    pcb: 0,
    statutorySnapshots: [{ scheme: "PCB", status: "BLOCKED", blockerCode: "PCB_RULE_SOURCE_UNVERIFIED", employeeContribution: 0, employerContribution: 0 }],
  }), { pending: true, value: "Review required" });
  assert.deepEqual(pcbPayslipPresentation("FINALIZED", {
    pcb: 0,
    statutorySnapshots: [{ scheme: "PCB", status: "CALCULATED", blockerCode: null, employeeContribution: 0, employerContribution: 0 }],
  }), { pending: false, value: "RM0.00" });
  assert.deepEqual(pcbPayslipPresentation("FINALIZED", {
    pcb: 0,
    statutorySnapshots: [{ scheme: "PCB", status: "NOT_APPLICABLE", blockerCode: null, employeeContribution: 0, employerContribution: 0 }],
  }), { pending: false, value: "RM0.00" });
});

test("payroll and statutory exports contain finalized contribution data", () => {
  const payrollCsv = buildPayrollExport(run, "csv").toString("utf8");
  const statutoryCsv = buildStatutoryExport(run, "csv").toString("utf8");
  const workbook = buildPayrollExport(run, "xlsx");
  assert.match(payrollCsv, /Aina Rahman/);
  assert.match(payrollCsv, /Net pay/);
  assert.match(statutoryCsv, /EPF employer/);
  assert.match(statutoryCsv, /KWSP_TEST\|PERKESO_TEST/);
  assert.equal(workbook.subarray(0, 2).toString("ascii"), "PK");
});

test("payroll release migration adds review audit fields safely", () => {
  const statusSql = readFileSync(
    "prisma/migrations/20260801090000_payroll_review_status/migration.sql",
    "utf8",
  );
  const sql = readFileSync(
    "prisma/migrations/20260801090500_payroll_review_release/migration.sql",
    "utf8",
  );
  assert.match(statusSql, /ADD VALUE IF NOT EXISTS 'REVIEW'/);
  assert.match(sql, /ADD COLUMN "submitted_by_id" UUID/);
  assert.match(sql, /ON DELETE SET NULL/);
  assert.match(sql, /current_setting\('tetamu\.payroll_reopen'/);
});

test("payroll run exposes a read-only draft preview while final download semantics stay explicit", () => {
  const runPage = readFileSync(
    "src/app/(business)/team/payroll/runs/[runId]/page.tsx",
    "utf8",
  );
  const payslipRoute = readFileSync(
    "src/app/(business)/team/payroll/payslips/[entryId]/route.ts",
    "utf8",
  );
  assert.match(runPage, /Open draft payslip preview/);
  assert.match(runPage, /Download finalized payslip/);
  assert.match(runPage, /Before pending PCB \/ MTD/);
  assert.match(payslipRoute, /PAYSLIP_PREVIEWED/);
  assert.match(payslipRoute, /const disposition = isFinalized \? "attachment" : "inline"/);
  assert.doesNotMatch(payslipRoute, /status !== "FINALIZED"[\s\S]{0,100}404/);
});
