import type { PayrollRunStatus, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type EntryEditorDatabase = Pick<PrismaClient, "payrollEntry">;

export type PayrollRunEntryEditorData = {
  run: {
    id: string;
    periodStart: Date;
    status: PayrollRunStatus;
  };
  entry: {
    id: string;
    employeeCode: string;
    fullName: string;
    basicPay: number;
    leavePay: number;
    unpaidLeaveDeduction: number;
    overtimePay: number;
    publicHolidayPay: number;
    allowances: number;
    otherDeductions: number;
    epfWageBase: number;
    perkesoWageBase: number;
    lindung24Employee: number;
    epfEmployee: number;
    socsoEmployee: number;
    eisEmployee: number;
    pcb: number;
    employerEpf: number;
    employerSocso: number;
    employerEis: number;
    grossPay: number;
    netPay: number;
    notes: string;
  };
};

export async function loadPayrollRunEntryEditor(
  businessId: string,
  runId: string,
  entryId: string,
  database: EntryEditorDatabase = prisma,
): Promise<PayrollRunEntryEditorData | null> {
  const entry = await database.payrollEntry.findFirst({
    where: {
      id: entryId,
      businessId,
      payrollRunId: runId,
      payrollRun: { status: "DRAFT" },
    },
    select: {
      id: true,
      employeeCodeSnapshot: true,
      fullNameSnapshot: true,
      basicPay: true,
      leavePay: true,
      unpaidLeaveDeduction: true,
      overtimePay: true,
      publicHolidayPay: true,
      allowances: true,
      otherDeductions: true,
      epfWageBase: true,
      perkesoWageBase: true,
      lindung24Employee: true,
      epfEmployee: true,
      socsoEmployee: true,
      eisEmployee: true,
      pcb: true,
      employerEpf: true,
      employerSocso: true,
      employerEis: true,
      grossPay: true,
      netPay: true,
      notes: true,
      payrollRun: {
        select: { id: true, periodStart: true, status: true },
      },
    },
  });
  if (!entry) return null;

  return {
    run: entry.payrollRun,
    entry: {
      id: entry.id,
      employeeCode: entry.employeeCodeSnapshot,
      fullName: entry.fullNameSnapshot,
      basicPay: money(entry.basicPay),
      leavePay: money(entry.leavePay),
      unpaidLeaveDeduction: money(entry.unpaidLeaveDeduction),
      overtimePay: money(entry.overtimePay),
      publicHolidayPay: money(entry.publicHolidayPay),
      allowances: money(entry.allowances),
      otherDeductions: money(entry.otherDeductions),
      epfWageBase: money(entry.epfWageBase),
      perkesoWageBase: money(entry.perkesoWageBase),
      lindung24Employee: money(entry.lindung24Employee),
      epfEmployee: money(entry.epfEmployee),
      socsoEmployee: money(entry.socsoEmployee),
      eisEmployee: money(entry.eisEmployee),
      pcb: money(entry.pcb),
      employerEpf: money(entry.employerEpf),
      employerSocso: money(entry.employerSocso),
      employerEis: money(entry.employerEis),
      grossPay: money(entry.grossPay),
      netPay: money(entry.netPay),
      notes: entry.notes ?? "",
    },
  };
}

function money(value: { toString(): string } | null | undefined) {
  return value ? Number(value.toString()) : 0;
}
