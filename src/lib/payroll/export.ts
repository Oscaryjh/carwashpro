import {
  buildTabularCsv,
  buildTabularXlsx,
} from "@/lib/business-groups/group-report-export";
import { buildProfessionalPayslipPdf } from "@/lib/payroll/payslip-pdf-v2";

export type PayrollDocumentStatus = "DRAFT" | "REVIEW" | "FINALIZED";

export type PayrollDocumentEntry = {
  id: string;
  employeeCode: string;
  fullName: string;
  payBasis: string;
  attendanceDays: number;
  regularMinutes: number;
  overtimeMinutes: number;
  publicHolidayMinutes: number;
  basicPay: number;
  overtimePay: number;
  publicHolidayPay: number;
  allowances: number;
  otherDeductions: number;
  epfEmployee: number;
  socsoEmployee: number;
  eisEmployee: number;
  lindung24Employee: number;
  pcb: number;
  cp38: number;
  employerEpf: number;
  employerSocso: number;
  employerEis: number;
  grossPay: number;
  netPay: number;
  claimReimbursements?: Array<{ claimNumber: string; amount: number }>;
  statutoryStatus: string;
  statutoryRuleVersion: string | null;
  notes: string | null;
  components?: Array<{
    name: string;
    type: "EARNING" | "DEDUCTION";
    amount: number;
  }>;
};

export type PayrollDocumentRun = {
  id: string;
  business: {
    name: string;
    companyNo: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  };
  periodStart: Date;
  periodEnd: Date;
  status: PayrollDocumentStatus;
  submittedAt: Date | null;
  finalizedAt: Date | null;
  entries: PayrollDocumentEntry[];
};

export function buildPayrollExport(
  run: PayrollDocumentRun,
  format: "csv" | "xlsx",
) {
  const rows = payrollRows(run);
  return format === "csv"
    ? buildTabularCsv(rows)
    : buildTabularXlsx(rows, "Payroll");
}

export function buildStatutoryExport(
  run: PayrollDocumentRun,
  format: "csv" | "xlsx",
) {
  const rows = statutoryRows(run);
  return format === "csv"
    ? buildTabularCsv(rows)
    : buildTabularXlsx(rows, "Statutory Contributions");
}

export function buildPayslipPdf(
  run: Omit<PayrollDocumentRun, "entries">,
  entry: PayrollDocumentEntry,
) {
  return buildProfessionalPayslipPdf(run, entry);
}

export function payrollExportFileName(
  run: PayrollDocumentRun,
  kind: "payroll" | "statutory",
  extension: "csv" | "xlsx",
) {
  return `${safeFilePart(run.business.name)}-${payrollMonth(run.periodStart)}-${kind}.${extension}`;
}

export function payslipFileName(
  run: Omit<PayrollDocumentRun, "entries">,
  entry: PayrollDocumentEntry,
) {
  return `${safeFilePart(entry.employeeCode)}-${payrollMonth(run.periodStart)}-payslip.pdf`;
}

function payrollRows(run: PayrollDocumentRun): Array<Array<string | number>> {
  return [
    ["Business", run.business.name],
    ["Company no.", run.business.companyNo ?? ""],
    ["Payroll month", payrollMonth(run.periodStart)],
    ["Status", run.status],
    [],
    [
      "Employee code",
      "Employee",
      "Pay basis",
      "Days",
      "Regular hours",
      "Overtime hours",
      "Public holiday hours",
      "Basic pay",
      "Overtime pay",
      "Public holiday pay",
      "Allowances",
      "Gross pay",
      "Other deductions",
      "EPF employee",
      "SOCSO employee",
      "EIS employee",
      "LINDUNG 24 Jam",
      "PCB",
      "CP38",
      "Net pay",
      "Notes",
    ],
    ...run.entries.map((entry) => [
      entry.employeeCode,
      entry.fullName,
      entry.payBasis,
      entry.attendanceDays,
      hours(entry.regularMinutes),
      hours(entry.overtimeMinutes),
      hours(entry.publicHolidayMinutes),
      entry.basicPay,
      entry.overtimePay,
      entry.publicHolidayPay,
      entry.allowances,
      entry.grossPay,
      entry.otherDeductions,
      entry.epfEmployee,
      entry.socsoEmployee,
      entry.eisEmployee,
      entry.lindung24Employee,
      entry.pcb,
      entry.cp38,
      entry.netPay,
      entry.notes ?? "",
    ]),
  ];
}

function statutoryRows(run: PayrollDocumentRun): Array<Array<string | number>> {
  return [
    ["Business", run.business.name],
    ["Company no.", run.business.companyNo ?? ""],
    ["Payroll month", payrollMonth(run.periodStart)],
    ["Status", run.status],
    [],
    [
      "Employee code",
      "Employee",
      "Gross pay",
      "EPF employee",
      "EPF employer",
      "SOCSO employee",
      "SOCSO employer",
      "EIS employee",
      "EIS employer",
      "LINDUNG 24 Jam",
      "PCB",
      "CP38",
      "Statutory status",
      "Rule version",
    ],
    ...run.entries.map((entry) => [
      entry.employeeCode,
      entry.fullName,
      entry.grossPay,
      entry.epfEmployee,
      entry.employerEpf,
      entry.socsoEmployee,
      entry.employerSocso,
      entry.eisEmployee,
      entry.employerEis,
      entry.lindung24Employee,
      entry.pcb,
      entry.cp38,
      entry.statutoryStatus,
      entry.statutoryRuleVersion ?? "",
    ]),
  ];
}

function payrollMonth(value: Date) {
  return value.toISOString().slice(0, 7);
}

function hours(value: number) {
  return Number((value / 60).toFixed(2));
}

function safeFilePart(value: string) {
  return (
    value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) ||
    "payroll"
  );
}
