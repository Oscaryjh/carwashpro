import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildPayslipPdf,
  type PayrollDocumentEntry,
  type PayrollDocumentRun,
} from "../../src/lib/payroll/export";

const run: Omit<PayrollDocumentRun, "entries"> = {
  id: "internal-run-id-must-not-render",
  business: {
    name: "Tetamu Malaysia Payroll Demonstration Company With A Long Registered Name",
    companyNo: "202601234567",
    address: "Kuala Lumpur, Malaysia",
    phone: "+60312345678",
    email: "payroll@example.test",
  },
  periodStart: new Date("2026-08-01T00:00:00.000Z"),
  periodEnd: new Date("2026-09-01T00:00:00.000Z"),
  status: "FINALIZED",
  submittedAt: new Date("2026-09-02T03:00:00.000Z"),
  finalizedAt: new Date("2026-09-02T04:49:00.000Z"),
};

function entry(overrides: Partial<PayrollDocumentEntry> = {}): PayrollDocumentEntry {
  return {
    id: "internal-entry-id-must-not-render",
    employeeCode: "MY-EMPLOYEE-CODE-001",
    fullName: "Nur Aisyah Binti Abdul Rahman",
    payBasis: "MONTHLY",
    attendanceDays: 24,
    regularMinutes: 11_520,
    overtimeMinutes: 750,
    publicHolidayMinutes: 480,
    basicPay: 3_800,
    overtimePay: 320,
    publicHolidayPay: 160,
    allowances: 200,
    otherDeductions: 75,
    epfEmployee: 420,
    socsoEmployee: 19.75,
    eisEmployee: 7.9,
    lindung24Employee: 10,
    pcb: 85,
    cp38: 25,
    employerEpf: 494,
    employerSocso: 69.05,
    employerEis: 7.9,
    grossPay: 5_100,
    netPay: 4_577.35,
    claimReimbursements: [{ claimNumber: "CLM-2026-0088", amount: 120 }],
    statutoryStatus: "AUTO_CALCULATED",
    statutoryRuleVersion: "internal-rule-version-must-not-render",
    notes: "Employee-facing payroll note.",
    components: [
      { name: "Basic Salary", type: "EARNING", amount: 3_800 },
      { name: "Commission", type: "EARNING", amount: 620 },
      { name: "Overtime", type: "EARNING", amount: 320 },
      { name: "Public Holiday Pay", type: "EARNING", amount: 160 },
      { name: "Transport Allowance", type: "EARNING", amount: 200 },
      { name: "Staff Loan", type: "DEDUCTION", amount: 75 },
    ],
    ...overrides,
  };
}

test("Payslip V2 renders an A4 professional Malaysian payroll hierarchy", () => {
  const pdf = buildPayslipPdf(run, entry());
  const text = pdf.toString("latin1");
  assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
  assert.match(text, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  assert.match(text, /TETAMU MALAYSIA PAYROLL/);
  assert.match(text, /Company No: 202601234567/);
  assert.match(text, /PAYSLIP/);
  assert.match(text, /Pay period: August 2026/);
  assert.match(text, /COMPANY \/ PAYSLIP INFO/);
  assert.match(text, /EMPLOYEE INFO/);
  assert.match(text, /Nur Aisyah Binti Abdul Rahman/);
  assert.match(text, /MY-EMPLOYEE-CODE-001/);
  assert.match(text, /ATTENDANCE/);
  assert.match(text, /24/);
  assert.match(text, /192h 00m/);
  assert.match(text, /12h 30m/);
  assert.match(text, /8h 00m/);
});

test("Payslip V2 keeps canonical money sections separate and professionally labelled", () => {
  const text = buildPayslipPdf(run, entry()).toString("latin1");
  for (const expected of [
    "GROSS PAY",
    "TOTAL DEDUCTIONS",
    "NET PAY",
    "EARNINGS",
    "Commission",
    "EMPLOYEE DEDUCTIONS",
    "EPF Employee",
    "SOCSO Employee",
    "EIS Employee",
    "PCB",
    "CP38",
    "LINDUNG24",
    "EMPLOYER CONTRIBUTIONS",
    "Employer EPF",
    "Employer SOCSO",
    "Employer EIS",
    "REIMBURSEMENTS",
    "Claim CLM-2026-0088",
  ]) assert.match(text, new RegExp(expected));
  assert.doesNotMatch(text, /LENDING 24 jam/i);
  assert.match(text, /Employer-funded - does not reduce Net Pay/);
  assert.match(text, /Non-wage reimbursements - excluded from Gross Pay/);
});

test("Payslip V2 displays canonical deduction inputs rather than Gross minus Net", () => {
  const reimbursementCase = entry({
    components: [{ name: "Basic Salary", type: "EARNING", amount: 3_800 }],
    grossPay: 3_800,
    otherDeductions: 480,
    epfEmployee: 0,
    socsoEmployee: 0,
    eisEmployee: 0,
    lindung24Employee: 0,
    pcb: 0,
    cp38: 0,
    claimReimbursements: [{ claimNumber: "CLM-REIMBURSE", amount: 120 }],
    netPay: 3_440,
  });
  const text = buildPayslipPdf(run, reimbursementCase).toString("latin1");
  assert.match(text, /TOTAL DEDUCTIONS/);
  assert.match(text, /RM 480\.00/);
  assert.match(text, /RM 3,800\.00/);
  assert.match(text, /RM 3,440\.00/);
  assert.doesNotMatch(text, /RM 360\.00/);
});

test("Payslip V2 removes internal identifiers, rule details, fixture notes and settlement claims", () => {
  const text = buildPayslipPdf(run, entry({ notes: "UAT_STAFF_PAY_20260902 internal fixture" })).toString("latin1");
  assert.doesNotMatch(text, /internal-run-id-must-not-render/);
  assert.doesNotMatch(text, /internal-entry-id-must-not-render/);
  assert.doesNotMatch(text, /internal-rule-version-must-not-render/);
  assert.doesNotMatch(text, /UAT_STAFF_PAY/);
  assert.doesNotMatch(text, /calculation trace/i);
  assert.doesNotMatch(text, /\b(?:Paid|Transferred|Credited)\b/i);
  assert.match(text, /computer-generated payslip/);
  assert.match(text, /No signature is required/);
});

test("Payslip V2 safely paginates long names, large amounts and many rows", () => {
  const manyRows = Array.from({ length: 38 }, (_, index) => ({
    name: `Long employee-facing earning component ${String(index + 1).padStart(2, "0")}`,
    type: "EARNING" as const,
    amount: 123_456.78 + index,
  }));
  const pdf = buildPayslipPdf(run, entry({
    fullName: "A Very Long Employee Name That Must Never Overlap The Amount Column Or Escape The Employee Panel",
    employeeCode: "EMPLOYEE-CODE-WITH-AN-EXCEPTIONALLY-LONG-SUFFIX-2026",
    grossPay: 4_691_357.64,
    netPay: 4_690_714.99,
    components: manyRows,
    notes: "A long but employee-appropriate note that should wrap safely across the available width without clipping or overlapping any financial amount.",
  }));
  const text = pdf.toString("latin1");
  const pageCount = (text.match(/\/Type \/Page\b/g) ?? []).length;
  assert.ok(pageCount >= 2);
  assert.match(text, /PAYSLIP - CONTINUED/);
  assert.match(text, /RM 4,691,357\.64/);
  assert.match(text, /Long employee-facing earning/);
  assert.doesNotMatch(text, /NaN|undefined/);
});

test("Payslip V2 output is deterministic and publication/route security remains unchanged", async () => {
  const first = buildPayslipPdf(run, entry());
  const second = buildPayslipPdf(run, entry());
  assert.deepEqual(first, second);
  const [publication, route, schema] = await Promise.all([
    readFile("src/lib/payroll/payslip-publication.ts", "utf8"),
    readFile("src/app/staff/payslips/[publicationId]/route.ts", "utf8"),
    readFile("prisma/schema.prisma", "utf8"),
  ]);
  assert.match(publication, /payslipPublication/);
  assert.match(publication, /claimReimbursementSnapshots/);
  assert.match(publication, /documentSha256/);
  assert.match(route, /businessId: auth\.businessId/);
  assert.match(route, /membershipId: auth\.membershipId/);
  assert.match(route, /Cache-Control": "private, no-store"/);
  assert.match(route, /Content-Disposition": `attachment;/);
  assert.match(schema, /documentBytes\s+Bytes/);
  assert.match(schema, /documentSha256\s+String/);
});
