import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

function occurrences(text: string, value: string) {
  return text.split(value).length - 1;
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
  assert.doesNotMatch(text, /COMPANY \/ PAYSLIP INFO/);
  assert.doesNotMatch(text, /Document status/);
  assert.match(text, /EMPLOYEE INFO/);
  assert.match(text, /Nur Aisyah Binti Abdul Rahman/);
  assert.match(text, /MY-EMPLOYEE-CODE-001/);
  assert.match(text, /ATTENDANCE/);
  assert.match(text, /24/);
  assert.match(text, /192h 00m/);
  assert.match(text, /12h 30m/);
  assert.match(text, /8h 00m/);
  assert.equal(occurrences(text, "Pay period: August 2026"), 1);
  assert.equal(occurrences(text, "Finalized 2 Sept 2026, 12:49 pm"), 1);
});

test("Payslip V2 keeps canonical money sections separate and professionally labelled", () => {
  const text = buildPayslipPdf(run, entry()).toString("latin1");
  for (const expected of [
    "GROSS PAY",
    "TOTAL DEDUCTIONS",
    "NET PAY",
    "EARNINGS",
    "TOTAL GROSS EARNINGS",
    "Commission",
    "EMPLOYEE DEDUCTIONS",
    "PCB",
    "CP38",
    "LINDUNG24",
    "EMPLOYER CONTRIBUTIONS",
    "REIMBURSEMENTS",
    "Claim CLM-2026-0088",
  ]) assert.match(text, new RegExp(expected));
  for (const expected of [
    "EPF \\(Employee\\)",
    "SOCSO \\(Employee\\)",
    "EIS \\(Employee\\)",
    "EPF \\(Employer\\)",
    "SOCSO \\(Employer\\)",
    "EIS \\(Employer\\)",
  ]) assert.ok(text.includes(expected));
  assert.doesNotMatch(text, /LENDING 24 jam/i);
  assert.match(text, /Employer-funded - does not reduce Net Pay/);
  assert.match(text, /Non-wage - not part of Gross Pay/);
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

test("Payslip V2 de-duplicates canonical statutory components and reconciles visible totals", () => {
  const text = buildPayslipPdf(run, entry({
    components: [
      { name: "Basic Salary", type: "EARNING", amount: 3_800 },
      { name: "Commission", type: "EARNING", amount: 620 },
      { name: "Overtime", type: "EARNING", amount: 320 },
      { name: "Public Holiday Pay", type: "EARNING", amount: 160 },
      { name: "Transport Allowance", type: "EARNING", amount: 200 },
      { name: "Staff Loan", type: "DEDUCTION", amount: 75 },
      { name: "EPF Employee", type: "DEDUCTION", amount: 420 },
      { name: "SOCSO Employee", type: "DEDUCTION", amount: 19.75 },
      { name: "EIS Employee", type: "DEDUCTION", amount: 7.9 },
      { name: "Monthly Tax Deduction (PCB)", type: "DEDUCTION", amount: 85 },
      { name: "CP38 tax instruction", type: "DEDUCTION", amount: 25 },
      { name: "LINDUNG 24 Employee", type: "DEDUCTION", amount: 10 },
    ],
  })).toString("latin1");
  assert.equal(occurrences(text, "EPF \\(Employee\\)"), 1);
  assert.equal(occurrences(text, "SOCSO \\(Employee\\)"), 1);
  assert.equal(occurrences(text, "EIS \\(Employee\\)"), 1);
  assert.equal(occurrences(text, "PCB"), 1);
  assert.equal(occurrences(text, "CP38"), 1);
  assert.equal(occurrences(text, "LINDUNG24"), 1);
  assert.match(text, /TOTAL DEDUCTIONS/);
  assert.match(text, /RM 642\.65/);
  assert.match(text, /TOTAL EMPLOYER CONTRIBUTIONS/);
  assert.match(text, /RM 570\.95/);
  assert.match(text, /TOTAL REIMBURSEMENTS/);
  assert.match(text, /RM 120\.00/);
});

test("Payslip V2 refuses contradictory visible money facts", () => {
  assert.throws(
    () => buildPayslipPdf(run, entry({ grossPay: 5_101 })),
    /PAYSLIP_PRESENTATION_RECONCILIATION_FAILED:EARNINGS/,
  );
  assert.throws(
    () => buildPayslipPdf(run, entry({ otherDeductions: 80 })),
    /PAYSLIP_PRESENTATION_RECONCILIATION_FAILED:EMPLOYEE_DEDUCTIONS/,
  );
  assert.throws(
    () => buildPayslipPdf(run, entry({ netPay: 4_577.36 })),
    /PAYSLIP_PRESENTATION_RECONCILIATION_FAILED:NET_PAY/,
  );
});

test("Payslip V2 safely paginates long names, large amounts and many rows", () => {
  const manyRows = Array.from({ length: 38 }, (_, index) => ({
    name: `Long employee-facing earning component ${String(index + 1).padStart(2, "0")}`,
    type: "EARNING" as const,
    amount: 123_456.78 + index,
  }));
  const longGross = manyRows.reduce((sum, item) => sum + item.amount, 0);
  const pdf = buildPayslipPdf(run, entry({
    fullName: "A Very Long Employee Name That Must Never Overlap The Amount Column Or Escape The Employee Panel",
    employeeCode: "EMPLOYEE-CODE-WITH-AN-EXCEPTIONALLY-LONG-SUFFIX-2026",
    grossPay: longGross,
    netPay: longGross - 642.65 + 120,
    components: manyRows,
    notes: "A long but employee-appropriate note that should wrap safely across the available width without clipping or overlapping any financial amount.",
  }));
  const text = pdf.toString("latin1");
  const pageCount = (text.match(/\/Type \/Page\b/g) ?? []).length;
  assert.ok(pageCount >= 2);
  assert.match(text, /PAYSLIP - CONTINUED/);
  assert.match(text, new RegExp(moneyPattern(longGross)));
  assert.match(text, /Long employee-facing earning/);
  assert.doesNotMatch(text, /NaN|undefined/);
});

test("Payslip V2 output is deterministic and publication/route security remains unchanged", async () => {
  const first = buildPayslipPdf(run, entry());
  const second = buildPayslipPdf(run, entry());
  assert.deepEqual(first, second);
  assert.equal(
    createHash("sha256").update(first).digest("hex"),
    createHash("sha256").update(second).digest("hex"),
  );
  const text = first.toString("latin1");
  assert.match(text, /\/Subject \(MY-PAYSLIP-V2\)/);
  assert.match(text, /\/Keywords \(MY-PAYSLIP-V2\)/);
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

function moneyPattern(value: number) {
  const formatted = new Intl.NumberFormat("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `RM ${formatted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
}

test("Payslip V2 keeps an ordinary Malaysian payslip on one A4 page", () => {
  const pdf = buildPayslipPdf(run, entry({
    components: [{ name: "Basic Salary", type: "EARNING", amount: 4_000 }],
    basicPay: 4_000,
    overtimePay: 0,
    publicHolidayPay: 0,
    allowances: 0,
    otherDeductions: 500,
    epfEmployee: 0,
    socsoEmployee: 0,
    eisEmployee: 0,
    lindung24Employee: 0,
    pcb: 0,
    cp38: 0,
    employerEpf: 0,
    employerSocso: 0,
    employerEis: 0,
    grossPay: 4_000,
    netPay: 3_600,
    claimReimbursements: [{ claimNumber: "CLM-UAT-001", amount: 100 }],
    notes: null,
  }));
  const pageCount = (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
  assert.equal(pageCount, 1);
});
