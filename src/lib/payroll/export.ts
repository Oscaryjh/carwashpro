import {
  buildTabularCsv,
  buildTabularXlsx,
  buildTextPdf,
} from "@/lib/business-groups/group-report-export";
import { isProductionRuntime } from "@/lib/release/environment";

export type PayrollDocumentStatus = "DRAFT" | "REVIEW" | "FINALIZED";

export type PayrollDocumentStatutorySnapshot = {
  scheme: "EPF" | "SOCSO" | "EIS" | "LINDUNG24" | "PCB" | "WORK_PAY";
  status: "CALCULATED" | "MANUAL" | "BLOCKED" | "NOT_APPLICABLE";
  blockerCode: string | null;
  employeeContribution: number;
  employerContribution: number;
};

export type PayrollDocumentEntry = {
  id: string;
  employeeCode: string;
  fullName: string;
  payBasis: string;
  attendanceDays: number;
  regularMinutes: number;
  overtimeMinutes: number;
  publicHolidayMinutes: number;
  unpaidLeaveDays?: number;
  unauthorizedAbsenceDays?: number;
  unpaidLeaveDeduction?: number;
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
    sourceType?: string;
  }>;
  statutoryEvidenceNature?: "REAL" | "SYNTHETIC_TESTING";
  statutoryEvidenceEnvironment?: "LOCAL" | "TESTING" | null;
  statutoryFixturePurpose?: "PAYROLL_PAYSLIP_UAT" | null;
  officialStatutoryExportEligible?: boolean;
  statutorySnapshots?: PayrollDocumentStatutorySnapshot[];
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
  assertDocumentStatutoryExportEligible(run);
  const rows = statutoryRows(run);
  return format === "csv"
    ? buildTabularCsv(rows)
    : buildTabularXlsx(rows, "Statutory Contributions");
}

export function buildPayslipPdf(
  run: Omit<PayrollDocumentRun, "entries">,
  entry: PayrollDocumentEntry,
) {
  if (
    entry.statutoryEvidenceNature === "SYNTHETIC_TESTING" &&
    isProductionRuntime()
  ) {
    throw new Error("SYNTHETIC_STATUTORY_EVIDENCE_FORBIDDEN_IN_PRODUCTION");
  }
  const employeeDeductions =
    entry.otherDeductions +
    entry.epfEmployee +
    entry.socsoEmployee +
    entry.eisEmployee +
    entry.lindung24Employee +
    entry.pcb +
    entry.cp38;
  const employerContributions =
    entry.employerEpf + entry.employerSocso + entry.employerEis;
  const componentEarnings = entry.components?.filter((component) => component.type === "EARNING") ?? [];
  const componentDeductions = entry.components?.filter((component) => component.type === "DEDUCTION") ?? [];
  return buildTextPdf([
    run.business.name.toUpperCase(),
    run.business.companyNo ? `Company No: ${run.business.companyNo}` : "",
    run.business.address ?? "",
    [run.business.phone, run.business.email].filter(Boolean).join(" | "),
    "",
    "PAYSLIP",
    ...(entry.statutoryEvidenceNature === "SYNTHETIC_TESTING"
      ? [
          "TESTING / NON-PRODUCTION STATUTORY FIXTURE",
          `Fixture environment: ${entry.statutoryEvidenceEnvironment ?? "Not recorded"}`,
          `Fixture purpose: ${entry.statutoryFixturePurpose ?? "Not recorded"}`,
        ]
      : []),
    `Pay period: ${formatPayrollPeriod(run.periodStart)}`,
    `Document status: ${formatStatus(run.status)}`,
    run.finalizedAt
      ? `Finalized: ${formatDateTime(run.finalizedAt)}`
      : run.submittedAt
        ? `Submitted for review: ${formatDateTime(run.submittedAt)}`
        : "Draft preview - not finalized",
    "",
    `Employee: ${entry.fullName}`,
    `Employee code: ${entry.employeeCode}`,
    `Pay basis: ${formatPayBasis(entry.payBasis)}`,
    "",
    "ATTENDANCE",
    `Days worked: ${entry.attendanceDays}`,
    `Regular hours: ${formatMinutes(entry.regularMinutes)}`,
    `Overtime hours: ${formatMinutes(entry.overtimeMinutes)}`,
    `Public holiday hours: ${formatMinutes(entry.publicHolidayMinutes)}`,
    "",
    "EARNINGS",
    ...(componentEarnings.length
      ? componentEarnings.map((component) => moneyLine(component.name, component.amount))
      : [
          moneyLine("Basic pay", entry.basicPay),
          moneyLine("Overtime pay", entry.overtimePay),
          moneyLine("Public holiday pay", entry.publicHolidayPay),
          moneyLine("Allowances", entry.allowances),
        ]),
    moneyLine("Gross pay", entry.grossPay),
    "",
    "EMPLOYEE DEDUCTIONS",
    ...(componentDeductions.length
      ? componentDeductions.map((component) => moneyLine(component.name, component.amount))
      : [moneyLine("Other deductions", entry.otherDeductions)]),
    statutoryPayslipLine(entry, "EPF", "EPF employee", entry.epfEmployee),
    statutoryPayslipLine(entry, "SOCSO", "SOCSO employee", entry.socsoEmployee),
    statutoryPayslipLine(entry, "EIS", "EIS employee", entry.eisEmployee),
    statutoryPayslipLine(
      entry,
      "LINDUNG24",
      "LINDUNG 24 (employee deduction)",
      entry.lindung24Employee,
    ),
    statutoryPayslipLine(entry, "PCB", "PCB", entry.pcb),
    moneyLine("CP38 instruction", entry.cp38),
    moneyLine("Total deductions", employeeDeductions),
    "",
    ...(entry.claimReimbursements?.length
      ? [
          "REIMBURSEMENTS (NON-WAGE)",
          ...entry.claimReimbursements.map((item) => moneyLine(`Claim ${item.claimNumber}`, item.amount)),
          "",
        ]
      : []),
    moneyLine("NET PAY", entry.netPay),
    "",
    "EMPLOYER CONTRIBUTIONS",
    statutoryPayslipLine(entry, "EPF", "Employer EPF", entry.employerEpf, "employer"),
    statutoryPayslipLine(entry, "SOCSO", "Employer SOCSO", entry.employerSocso, "employer"),
    statutoryPayslipLine(entry, "EIS", "Employer EIS", entry.employerEis, "employer"),
    moneyLine("Total employer contributions", employerContributions),
    "",
    `Statutory status: ${formatStatus(entry.statutoryStatus)}`,
    entry.statutoryRuleVersion
      ? `Rule version: ${entry.statutoryRuleVersion}`
      : "Rule version: Not recorded",
    entry.notes ? `Notes: ${entry.notes}` : "",
    "",
    "This is a computer-generated payroll document.",
  ]);
}

function statutoryPayslipLine(
  entry: PayrollDocumentEntry,
  scheme: PayrollDocumentStatutorySnapshot["scheme"],
  label: string,
  fallbackAmount: number,
  contribution: "employee" | "employer" = "employee",
) {
  const snapshot = entry.statutorySnapshots?.find((item) => item.scheme === scheme);
  if (!snapshot) return moneyLine(label, fallbackAmount);
  if (snapshot.status === "CALCULATED" || snapshot.status === "MANUAL") {
    return moneyLine(
      label,
      contribution === "employee"
        ? snapshot.employeeContribution
        : snapshot.employerContribution,
    );
  }
  if (snapshot.status === "NOT_APPLICABLE") {
    return `${label}: Not applicable`;
  }
  if (scheme === "PCB") {
    return `${label}: Pending configuration (not included in net pay)`;
  }
  return `${label}: Not calculated - review required${snapshot.blockerCode ? ` (${snapshot.blockerCode})` : ""}`;
}

export function assertDocumentStatutoryExportEligible(run: PayrollDocumentRun) {
  if (
    run.entries.some(
      (entry) =>
        entry.statutoryEvidenceNature === "SYNTHETIC_TESTING" ||
        entry.officialStatutoryExportEligible === false,
    )
  ) {
    throw new Error("SYNTHETIC_STATUTORY_EVIDENCE_NOT_EXPORTABLE");
  }
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

function formatPayrollPeriod(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(value);
}

function formatMinutes(value: number) {
  return `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, "0")}m`;
}

function hours(value: number) {
  return Number((value / 60).toFixed(2));
}

function moneyLine(label: string, value: number) {
  return `${label}: RM ${value.toFixed(2)}`;
}

function formatPayBasis(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function formatStatus(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) =>
    letter.toUpperCase(),
  );
}

function safeFilePart(value: string) {
  return (
    value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) ||
    "payroll"
  );
}
