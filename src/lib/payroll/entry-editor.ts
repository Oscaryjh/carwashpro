import type { PayrollRunStatus, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type EntryEditorDatabase = Pick<
  PrismaClient,
  "payrollEntry" | "payrollVariablePay" | "payrollCorrection"
>;

export type PayrollRunEntryEditorData = {
  run: {
    id: string;
    periodStart: Date;
    status: PayrollRunStatus;
  };
  entry: {
    id: string;
    membershipId: string;
    calculationRevision: number;
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
    attendance: {
      timesheetRevision: number;
      timesheetLockedAt: Date;
      regularDays: number;
      regularMinutes: number;
      paidLeaveDays: number;
      unpaidLeaveDays: number;
      unauthorizedAbsenceDays: number;
      authorizedAbsenceDays: number;
      restDayWorkedMinutes: number;
      publicHolidayWorkedMinutes: number;
      approvedOvertimeMinutes: number;
      policyBlockers: string[];
      legacyCompatibility: boolean;
    } | null;
    statutorySnapshots: Array<{
      scheme: string;
      status: string;
      calculationSource: string;
      ruleVersion: string | null;
      wageBase: number;
      employeeContribution: number;
      employerContribution: number;
      blockerCode: string | null;
    }>;
    components: Array<{
      id: string;
      type: "EARNING" | "DEDUCTION";
      code: string;
      name: string;
      amount: number;
      source: string;
      effectiveFromMonth: Date | null;
      calculationBasis: string;
      origin: "SYSTEM" | "MANUAL";
      adjustmentCategory: string | null;
      reason: string | null;
    }>;
    variablePay: Array<{
      id: string;
      type: string;
      name: string;
      amount: number;
      status: string;
      revision: number;
      origin: string;
      earnedPeriodStart: Date;
      earnedPeriodEnd: Date;
      sourceReference: string | null;
      reason: string;
    }>;
    corrections: Array<{
      id: string;
      name: string;
      deltaType: "EARNING" | "DEDUCTION";
      deltaAmount: number;
      status: string;
      revision: number;
      originalPayrollEntryId: string;
      sourceReference: string | null;
      reason: string;
    }>;
    correctionOrigins: Array<{
      id: string;
      periodStart: Date;
      grossPay: number;
      netPay: number;
    }>;
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
    },
    select: {
      id: true,
      membershipId: true,
      calculationRevision: true,
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
      attendanceInputSnapshot: {
        select: {
          timesheetRevision: true,
          timesheetLockedAt: true,
          regularDays: true,
          regularMinutes: true,
          paidLeaveDays: true,
          unpaidLeaveDays: true,
          unauthorizedAbsenceDays: true,
          authorizedAbsenceDays: true,
          restDayWorkedMinutes: true,
          publicHolidayWorkedMinutes: true,
          approvedOvertimeMinutes: true,
          policyBlockers: true,
          legacyCompatibility: true,
        },
      },
      statutorySnapshots: {
        orderBy: { scheme: "asc" },
        select: {
          scheme: true,
          status: true,
          calculationSource: true,
          ruleVersionSnapshot: true,
          wageBase: true,
          employeeContribution: true,
          employerContribution: true,
          blockerCode: true,
        },
      },
      components: {
        orderBy: [{ sortOrder: "asc" }, { lineKey: "asc" }],
        select: {
          id: true,
          type: true,
          code: true,
          name: true,
          amount: true,
          sourceType: true,
          sourceRevision: true,
          effectiveFromMonth: true,
          calculationBasis: true,
          origin: true,
          adjustmentCategory: true,
          sourceReason: true,
          reason: true,
        },
      },
      payrollRun: {
        select: { id: true, periodStart: true, status: true },
      },
    },
  });
  if (!entry) return null;

  const [variablePay, corrections, correctionOrigins] = await Promise.all([
    database.payrollVariablePay.findMany({
      where: {
        businessId,
        membershipId: entry.membershipId,
        payrollPeriodStart: entry.payrollRun.periodStart,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        type: true,
        name: true,
        amount: true,
        status: true,
        revision: true,
        origin: true,
        earnedPeriodStart: true,
        earnedPeriodEnd: true,
        sourceReference: true,
        reason: true,
      },
    }),
    database.payrollCorrection.findMany({
      where: {
        businessId,
        membershipId: entry.membershipId,
        applyToPeriodStart: entry.payrollRun.periodStart,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        deltaType: true,
        deltaAmount: true,
        status: true,
        revision: true,
        originalPayrollEntryId: true,
        sourceReference: true,
        reason: true,
      },
    }),
    database.payrollEntry.findMany({
      where: {
        businessId,
        membershipId: entry.membershipId,
        payrollRun: {
          status: "FINALIZED",
          periodStart: { lt: entry.payrollRun.periodStart },
        },
      },
      orderBy: { payrollRun: { periodStart: "desc" } },
      take: 12,
      select: {
        id: true,
        grossPay: true,
        netPay: true,
        payrollRun: { select: { periodStart: true } },
      },
    }),
  ]);

  return {
    run: entry.payrollRun,
    entry: {
      id: entry.id,
      membershipId: entry.membershipId,
      calculationRevision: entry.calculationRevision,
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
      attendance: entry.attendanceInputSnapshot
        ? {
            ...entry.attendanceInputSnapshot,
            regularDays: money(entry.attendanceInputSnapshot.regularDays),
            paidLeaveDays: money(entry.attendanceInputSnapshot.paidLeaveDays),
            unpaidLeaveDays: money(entry.attendanceInputSnapshot.unpaidLeaveDays),
            unauthorizedAbsenceDays: money(
              entry.attendanceInputSnapshot.unauthorizedAbsenceDays,
            ),
            authorizedAbsenceDays: money(
              entry.attendanceInputSnapshot.authorizedAbsenceDays,
            ),
            policyBlockers: jsonStringArray(
              entry.attendanceInputSnapshot.policyBlockers,
            ),
          }
        : null,
      statutorySnapshots: entry.statutorySnapshots.map((snapshot) => ({
        scheme: snapshot.scheme,
        status: snapshot.status,
        calculationSource: snapshot.calculationSource,
        ruleVersion: snapshot.ruleVersionSnapshot,
        wageBase: money(snapshot.wageBase),
        employeeContribution: money(snapshot.employeeContribution),
        employerContribution: money(snapshot.employerContribution),
        blockerCode: snapshot.blockerCode,
      })),
      components: entry.components.map((component) => ({
        id: component.id,
        type: component.type,
        code: component.code,
        name: component.name,
        amount: money(component.amount),
        source: componentSourceLabel(
          component.sourceType,
          component.sourceRevision,
        ),
        effectiveFromMonth: component.effectiveFromMonth,
        calculationBasis: component.calculationBasis,
        origin: component.origin,
        adjustmentCategory: component.adjustmentCategory,
        reason: component.reason ?? component.sourceReason,
      })),
      variablePay: variablePay.map((source) => ({
        ...source,
        amount: money(source.amount),
      })),
      corrections: corrections.map((source) => ({
        ...source,
        deltaAmount: money(source.deltaAmount),
      })),
      correctionOrigins: correctionOrigins.map((origin) => ({
        id: origin.id,
        periodStart: origin.payrollRun.periodStart,
        grossPay: money(origin.grossPay),
        netPay: money(origin.netPay),
      })),
    },
  };
}

function componentSourceLabel(source: string, revision: number | null) {
  if (source === "BASIC_SALARY") return "Compensation version snapshot";
  if (source === "RECURRING_PAY") {
    return revision ? `Recurring pay revision ${revision}` : "Recurring pay snapshot";
  }
  if (source === "MANUAL_ADJUSTMENT") return "Manual adjustment";
  if (source === "VARIABLE_PAY") return "Approved frozen variable pay";
  if (source === "CORRECTION") return "Approved future-payroll correction delta";
  if (source === "ATTENDANCE") {
    return revision
      ? `Locked Attendance Timesheet revision ${revision}`
      : "Locked Attendance Timesheet snapshot";
  }
  return "Payroll calculation snapshot";
}

function jsonStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function money(value: { toString(): string } | null | undefined) {
  return value ? Number(value.toString()) : 0;
}
