import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildPayslipPdf,
  type PayrollDocumentEntry,
  type PayrollDocumentRun,
} from "../src/lib/payroll/export";

const outputDirectory = process.argv[2] ?? "tmp/pdfs/payslip-v2";

const run: Omit<PayrollDocumentRun, "entries"> = {
  id: "visual-fixture-run",
  business: {
    name: "Tetamu Malaysia Payroll Demo",
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

function baseEntry(overrides: Partial<PayrollDocumentEntry> = {}): PayrollDocumentEntry {
  return {
    id: "visual-fixture-entry",
    employeeCode: "DEMO-001",
    fullName: "Nur Aisyah Rahman",
    payBasis: "MONTHLY",
    attendanceDays: 24,
    regularMinutes: 11_520,
    overtimeMinutes: 0,
    publicHolidayMinutes: 0,
    basicPay: 3_800,
    overtimePay: 0,
    publicHolidayPay: 0,
    allowances: 0,
    otherDeductions: 0,
    epfEmployee: 0,
    socsoEmployee: 0,
    eisEmployee: 0,
    lindung24Employee: 0,
    pcb: 0,
    cp38: 0,
    employerEpf: 0,
    employerSocso: 0,
    employerEis: 0,
    grossPay: 3_800,
    netPay: 3_800,
    statutoryStatus: "AUTO_CALCULATED",
    statutoryRuleVersion: "not-rendered",
    notes: null,
    components: [{ name: "Basic Salary", type: "EARNING", amount: 3_800 }],
    ...overrides,
  };
}

const cases: Array<[string, PayrollDocumentEntry]> = [
  ["A-simple", baseEntry()],
  ["B-malaysian-statutory", baseEntry({
    epfEmployee: 420,
    socsoEmployee: 19.75,
    eisEmployee: 7.9,
    pcb: 85,
    employerEpf: 494,
    employerSocso: 69.05,
    employerEis: 7.9,
    netPay: 3_267.35,
  })],
  ["C-commission-ot", baseEntry({
    overtimeMinutes: 750,
    overtimePay: 320,
    grossPay: 4_740,
    netPay: 4_740,
    components: [
      { name: "Basic Salary", type: "EARNING", amount: 3_800 },
      { name: "Commission", type: "EARNING", amount: 620 },
      { name: "Overtime", type: "EARNING", amount: 320 },
    ],
  })],
  ["D-claims-reimbursement", baseEntry({
    basicPay: 4_000,
    grossPay: 4_000,
    otherDeductions: 500,
    netPay: 3_600,
    claimReimbursements: [{ claimNumber: "CLM-DEMO-001", amount: 100 }],
    components: [{ name: "Basic Salary", type: "EARNING", amount: 4_000 }],
  })],
  ["E-long-complex", baseEntry({
    employeeCode: "DEMO-LONG-EMPLOYEE-CODE-2026-0000001",
    fullName: "Nur Aisyah Binti Abdul Rahman With A Very Long Employee Display Name",
    overtimeMinutes: 750,
    publicHolidayMinutes: 480,
    grossPay: 9_876_543.21,
    otherDeductions: 500,
    epfEmployee: 420,
    socsoEmployee: 19.75,
    eisEmployee: 7.9,
    lindung24Employee: 10,
    pcb: 850,
    cp38: 125,
    employerEpf: 494,
    employerSocso: 69.05,
    employerEis: 7.9,
    netPay: 9_874_806.06,
    claimReimbursements: [
      { claimNumber: "CLM-DEMO-TRAVEL-2026-0001", amount: 120 },
      { claimNumber: "CLM-DEMO-MEAL-2026-0002", amount: 75.5 },
    ],
    notes: "Employee-facing note with sufficient length to demonstrate clean wrapping in the official A4 document without exposing internal fixture namespaces.",
    components: [
      { name: "Basic Salary", type: "EARNING", amount: 3_800 },
      { name: "Commission", type: "EARNING", amount: 620 },
      { name: "Overtime", type: "EARNING", amount: 320 },
      { name: "Public Holiday Pay", type: "EARNING", amount: 160 },
      { name: "Transport Allowance", type: "EARNING", amount: 200 },
      { name: "Meal Allowance", type: "EARNING", amount: 150 },
      { name: "Performance Incentive", type: "EARNING", amount: 900 },
      { name: "Service Incentive", type: "EARNING", amount: 450 },
      { name: "Sales Incentive", type: "EARNING", amount: 350 },
      { name: "Acting Allowance", type: "EARNING", amount: 250 },
      { name: "Shift Allowance", type: "EARNING", amount: 180 },
      { name: "Annual Performance Award", type: "EARNING", amount: 9_869_163.21 },
      { name: "Staff Loan", type: "DEDUCTION", amount: 300 },
      { name: "Other Deduction", type: "DEDUCTION", amount: 200 },
    ],
  })],
];

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  for (const [name, entry] of cases) {
    await writeFile(join(outputDirectory, `${name}.pdf`), buildPayslipPdf(run, entry));
  }
  console.log(`Generated ${cases.length} Payslip V2 visual fixtures in ${outputDirectory}.`);
}

void main();
