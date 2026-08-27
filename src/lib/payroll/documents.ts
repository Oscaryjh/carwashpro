import type { PayrollEntry } from "@prisma/client";
import type {
  PayrollDocumentEntry,
  PayrollDocumentRun,
} from "@/lib/payroll/export";
import { parsePayrollMonth } from "@/lib/payroll/service";
import { prisma } from "@/lib/prisma";

const businessDocumentSelect = {
  name: true,
  companyNo: true,
  address: true,
  phone: true,
  email: true,
} as const;

export async function loadPayrollDocumentRun(
  businessId: string,
  month: string,
): Promise<PayrollDocumentRun | null> {
  const period = parsePayrollMonth(month);
  const run = await prisma.payrollRun.findUnique({
    where: {
      businessId_periodStart_periodEnd: {
        businessId,
        periodStart: period.start,
        periodEnd: period.end,
      },
    },
    include: {
      business: { select: businessDocumentSelect },
      entries: {
        orderBy: [{ fullNameSnapshot: "asc" }],
        include: {
          components: { orderBy: [{ sortOrder: "asc" }, { lineKey: "asc" }] },
          statutorySnapshots: {
            select: {
              evidenceNature: true,
              evidenceEnvironment: true,
              fixturePurpose: true,
              officialExportEligible: true,
              scheme: true,
              status: true,
              blockerCode: true,
              employeeContribution: true,
              employerContribution: true,
            },
          },
          claimReimbursementSnapshots: { where: { status: { in: ["READY", "SETTLED"] } }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (!run) return null;
  return {
    id: run.id,
    business: run.business,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    status: run.status,
    submittedAt: run.submittedAt,
    finalizedAt: run.finalizedAt,
    entries: run.entries.map(payrollDocumentEntry),
  };
}

export async function loadPayrollPayslip(
  businessId: string,
  entryId: string,
) {
  const entry = await prisma.payrollEntry.findFirst({
    where: { id: entryId, businessId },
    include: {
      components: { orderBy: [{ sortOrder: "asc" }, { lineKey: "asc" }] },
      statutorySnapshots: {
        select: {
          evidenceNature: true,
          evidenceEnvironment: true,
          fixturePurpose: true,
          officialExportEligible: true,
          scheme: true,
          status: true,
          blockerCode: true,
          employeeContribution: true,
          employerContribution: true,
        },
      },
      claimReimbursementSnapshots: { where: { status: { in: ["READY", "SETTLED"] } }, orderBy: { createdAt: "asc" } },
      payrollRun: {
        include: { business: { select: businessDocumentSelect } },
      },
    },
  });
  if (!entry || entry.payrollRun.businessId !== businessId) return null;
  return {
    run: {
      id: entry.payrollRun.id,
      business: entry.payrollRun.business,
      periodStart: entry.payrollRun.periodStart,
      periodEnd: entry.payrollRun.periodEnd,
      status: entry.payrollRun.status,
      submittedAt: entry.payrollRun.submittedAt,
      finalizedAt: entry.payrollRun.finalizedAt,
    },
    entry: payrollDocumentEntry(entry),
  };
}

export function payrollDocumentEntry(
  entry: PayrollEntry & {
    components?: Array<{ amount: { toString(): string }; name: string; type: "EARNING" | "DEDUCTION" }>;
    claimReimbursementSnapshots?: Array<{ amount: { toString(): string }; claimNumberSnapshot: string }>;
    statutorySnapshots?: Array<{
      evidenceNature: "REAL" | "SYNTHETIC_TESTING";
      evidenceEnvironment: "LOCAL" | "TESTING" | null;
      fixturePurpose: "PAYROLL_PAYSLIP_UAT" | null;
      officialExportEligible: boolean;
      scheme: "EPF" | "SOCSO" | "EIS" | "LINDUNG24" | "PCB" | "WORK_PAY";
      status: "CALCULATED" | "MANUAL" | "BLOCKED" | "NOT_APPLICABLE";
      blockerCode: string | null;
      employeeContribution: { toString(): string };
      employerContribution: { toString(): string };
    }>;
  },
): PayrollDocumentEntry {
  const syntheticSnapshot = entry.statutorySnapshots?.find(
    (snapshot) => snapshot.evidenceNature === "SYNTHETIC_TESTING",
  );
  return {
    id: entry.id,
    employeeCode: entry.employeeCodeSnapshot,
    fullName: entry.fullNameSnapshot,
    payBasis: entry.payBasisSnapshot,
    attendanceDays: entry.attendanceDays,
    regularMinutes: entry.regularMinutes,
    overtimeMinutes: entry.overtimeMinutes,
    publicHolidayMinutes: entry.publicHolidayMinutes,
    basicPay: Number(entry.basicPay),
    overtimePay: Number(entry.overtimePay),
    publicHolidayPay: Number(entry.publicHolidayPay),
    allowances: Number(entry.allowances),
    otherDeductions: Number(entry.otherDeductions),
    epfEmployee: Number(entry.epfEmployee),
    socsoEmployee: Number(entry.socsoEmployee),
    eisEmployee: Number(entry.eisEmployee),
    lindung24Employee: Number(entry.lindung24Employee),
    pcb: Number(entry.pcb),
    cp38: Number(entry.cp38),
    employerEpf: Number(entry.employerEpf),
    employerSocso: Number(entry.employerSocso),
    employerEis: Number(entry.employerEis),
    grossPay: Number(entry.grossPay),
    netPay: Number(entry.netPay),
    claimReimbursements: entry.claimReimbursementSnapshots?.map((snapshot) => ({
      claimNumber: snapshot.claimNumberSnapshot,
      amount: Number(snapshot.amount.toString()),
    })),
    statutoryStatus: entry.statutoryStatus,
    statutoryRuleVersion: entry.statutoryRuleVersion,
    notes: entry.notes,
    components: entry.components?.map((component) => ({
      amount: Number(component.amount.toString()),
      name: component.name,
      type: component.type,
    })),
    statutoryEvidenceNature: syntheticSnapshot ? "SYNTHETIC_TESTING" : "REAL",
    statutoryEvidenceEnvironment: syntheticSnapshot?.evidenceEnvironment ?? null,
    statutoryFixturePurpose: syntheticSnapshot?.fixturePurpose ?? null,
    officialStatutoryExportEligible:
      entry.statutorySnapshots?.every(
        (snapshot) => snapshot.officialExportEligible,
      ) ?? true,
    statutorySnapshots: entry.statutorySnapshots?.map((snapshot) => ({
      scheme: snapshot.scheme,
      status: snapshot.status,
      blockerCode: snapshot.blockerCode,
      employeeContribution: Number(snapshot.employeeContribution.toString()),
      employerContribution: Number(snapshot.employerContribution.toString()),
    })),
  };
}
