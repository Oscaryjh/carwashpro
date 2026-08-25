import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildPayrollExport,
  buildPayslipPdf,
  buildStatutoryExport,
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
