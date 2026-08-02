import type { PrismaClient } from "@prisma/client";
import type { AppSession } from "@/lib/auth/session";
import { writeAuditLog, type AuditRequestContext } from "@/lib/audit";
import {
  safePayrollEntryManualAuditChange,
  writeSensitiveAuditLog,
} from "@/lib/audit/payroll-sensitive";
import { calculatePayroll, calculatePayrollTotals } from "@/lib/payroll/calculation";
import { calculateStatutoryContributions } from "@/lib/payroll/statutory";
import { payrollTransition } from "@/lib/payroll/workflow";
import { prisma } from "@/lib/prisma";

export const DEFAULT_PAYROLL_SETTING = {
  workingDaysPerMonth: 26,
  normalWorkMinutesPerDay: 480,
  breakMinutesPerDay: 60,
  overtimeMultiplier: 1.5,
  publicHolidayExtraMultiplier: 2,
} as const;

type PayrollActor = Pick<AppSession, "userId" | "name" | "email">;

type PayrollContext = {
  businessId: string;
  actor: PayrollActor;
  request?: AuditRequestContext;
};

export function parsePayrollMonth(value: string | undefined) {
  const normalized = value?.trim() || new Date().toISOString().slice(0, 7);
  const match = /^(\d{4})-(\d{2})$/.exec(normalized);
  if (!match) throw new Error("Select a valid payroll month.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2020 || year > 2100 || month < 1 || month > 12) {
    throw new Error("Select a valid payroll month.");
  }
  return {
    value: normalized,
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

export async function generatePayrollRun(
  context: PayrollContext & { month: string },
  database: PrismaClient = prisma,
) {
  const period = parsePayrollMonth(context.month);
  return database.$transaction(async (transaction) => {
    const setting =
      (await transaction.payrollSetting.findUnique({
        where: { businessId: context.businessId },
      })) ?? DEFAULT_PAYROLL_SETTING;
    const existing = await transaction.payrollRun.findUnique({
      where: {
        businessId_periodStart_periodEnd: {
          businessId: context.businessId,
          periodStart: period.start,
          periodEnd: period.end,
        },
      },
      select: { id: true, status: true },
    });
    if (existing && existing.status !== "DRAFT") {
      throw new Error(
        "Payroll awaiting review or already finalized cannot be regenerated.",
      );
    }

    const [memberships, sessions, holidays, leaveDays] = await Promise.all([
      transaction.employeeBusinessMembership.findMany({
        where: {
          businessId: context.businessId,
          baseSalary: { not: null },
          joinedAt: { lt: period.end },
          OR: [{ terminatedAt: null }, { terminatedAt: { gte: period.start } }],
        },
        orderBy: [{ fullName: "asc" }, { employeeCode: "asc" }],
        select: {
          id: true,
          employeeCode: true,
          fullName: true,
          payBasis: true,
          baseSalary: true,
          normalWorkMinutesPerDay: true,
          dateOfBirth: true,
          statutoryNationality: true,
          epfEnabled: true,
          epfMemberBeforeAug1998: true,
          socsoEnabled: true,
          socsoCategory: true,
          eisEnabled: true,
          eisPreviouslyContributed: true,
          lindung24OptIn: true,
        },
      }),
      transaction.employeeAttendance.findMany({
        where: {
          businessId: context.businessId,
          workDate: { gte: period.start, lt: period.end },
          status: "COMPLETED",
          approvalStatus: { in: ["NOT_REQUIRED", "APPROVED"] },
        },
        select: {
          membershipId: true,
          branchId: true,
          workDate: true,
          totalWorkedMinutes: true,
          updatedAt: true,
        },
      }),
      transaction.payrollHoliday.findMany({
        where: {
          businessId: context.businessId,
          workDate: { gte: period.start, lt: period.end },
        },
        select: { branchId: true, workDate: true },
      }),
      transaction.leaveRequestDay.findMany({
        where: {
          businessId: context.businessId,
          leaveDate: { gte: period.start, lt: period.end },
          leaveRequest: { status: "APPROVED" },
        },
        select: {
          membershipId: true,
          leaveDate: true,
          dayFraction: true,
          leaveRequest: {
            select: { payTreatmentSnapshot: true },
          },
        },
      }),
    ]);
    const holidayKeys = new Set(
      holidays.map((holiday) => `${holiday.branchId}:${dateKey(holiday.workDate)}`),
    );
    const run = existing
      ? await transaction.payrollRun.update({
          where: { id: existing.id },
          data: {
            workingDaysPerMonthSnapshot: setting.workingDaysPerMonth,
            normalWorkMinutesPerDaySnapshot: setting.normalWorkMinutesPerDay,
            breakMinutesPerDaySnapshot: setting.breakMinutesPerDay,
            overtimeMultiplierSnapshot: setting.overtimeMultiplier,
            publicHolidayExtraMultiplierSnapshot:
              setting.publicHolidayExtraMultiplier,
          },
        })
      : await transaction.payrollRun.create({
          data: {
            businessId: context.businessId,
            periodStart: period.start,
            periodEnd: period.end,
            workingDaysPerMonthSnapshot: setting.workingDaysPerMonth,
            normalWorkMinutesPerDaySnapshot: setting.normalWorkMinutesPerDay,
            breakMinutesPerDaySnapshot: setting.breakMinutesPerDay,
            overtimeMultiplierSnapshot: setting.overtimeMultiplier,
            publicHolidayExtraMultiplierSnapshot:
              setting.publicHolidayExtraMultiplier,
            createdById: context.actor.userId,
          },
        });

    await transaction.payrollEntry.deleteMany({
      where: { businessId: context.businessId, payrollRunId: run.id },
    });
    for (const membership of memberships) {
      const memberSessions = sessions.filter(
        (session) => session.membershipId === membership.id,
      );
      const workedDates = new Set(memberSessions.map((session) => dateKey(session.workDate)));
      const memberLeave = leaveDays.filter(
        (day) => day.membershipId === membership.id && !workedDates.has(dateKey(day.leaveDate)),
      );
      const paidLeaveDays = memberLeave
        .filter((day) => day.leaveRequest.payTreatmentSnapshot === "PAID")
        .reduce((sum, day) => sum + Number(day.dayFraction), 0);
      const unpaidLeaveDays = memberLeave
        .filter((day) => day.leaveRequest.payTreatmentSnapshot === "UNPAID")
        .reduce((sum, day) => sum + Number(day.dayFraction), 0);
      const days = aggregateDays(memberSessions, holidayKeys);
      const calculation = calculatePayroll({
        payBasis: membership.payBasis,
        baseRateCents: moneyToCents(membership.baseSalary),
        workingDaysPerMonth: setting.workingDaysPerMonth,
        normalWorkMinutesPerDay:
          membership.normalWorkMinutesPerDay ??
          setting.normalWorkMinutesPerDay,
        overtimeMultiplier: Number(setting.overtimeMultiplier),
        publicHolidayExtraMultiplier: Number(
          setting.publicHolidayExtraMultiplier,
        ),
        days,
        paidLeaveDays,
        unpaidLeaveDays,
      });
      const epfWageCents = calculation.basicPayCents + calculation.leavePayCents;
      const perkesoWageCents = calculation.grossPayCents;
      const statutory = calculateStatutoryContributions({
        profile: {
          dateOfBirth: membership.dateOfBirth,
          statutoryNationality: membership.statutoryNationality,
          epfEnabled: membership.epfEnabled,
          epfMemberBeforeAug1998: membership.epfMemberBeforeAug1998,
          socsoEnabled: membership.socsoEnabled,
          socsoCategory: membership.socsoCategory,
          eisEnabled: membership.eisEnabled,
          eisPreviouslyContributed: membership.eisPreviouslyContributed,
          lindung24OptIn: membership.lindung24OptIn,
        },
        payrollPeriodEnd: period.end,
        epfWageCents,
        perkesoWageCents,
      });
      const totals = calculatePayrollTotals({
        basicPayCents: calculation.basicPayCents,
        overtimePayCents: calculation.overtimePayCents,
        publicHolidayPayCents: calculation.publicHolidayPayCents,
        leavePayCents: calculation.leavePayCents,
        allowancesCents: 0,
        otherDeductionsCents: 0,
        epfEmployeeCents: statutory.epfEmployeeCents,
        socsoEmployeeCents: statutory.socsoEmployeeCents,
        eisEmployeeCents: statutory.eisEmployeeCents,
        lindung24EmployeeCents: statutory.lindung24EmployeeCents,
        pcbCents: 0,
      });
      await transaction.payrollEntry.create({
        data: {
          payrollRunId: run.id,
          businessId: context.businessId,
          membershipId: membership.id,
          employeeCodeSnapshot: membership.employeeCode,
          fullNameSnapshot: membership.fullName,
          payBasisSnapshot: membership.payBasis,
          baseRateSnapshot: centsToMoney(
            moneyToCents(membership.baseSalary),
          ),
          workingDaysSnapshot: setting.workingDaysPerMonth,
          normalWorkMinutesSnapshot:
            membership.normalWorkMinutesPerDay ??
            setting.normalWorkMinutesPerDay,
          attendanceDays: calculation.attendanceDays,
          regularMinutes: calculation.regularMinutes,
          overtimeMinutes: calculation.overtimeMinutes,
          publicHolidayMinutes: calculation.publicHolidayMinutes,
          paidLeaveDays: calculation.paidLeaveDays,
          unpaidLeaveDays: calculation.unpaidLeaveDays,
          basicPay: centsToMoney(calculation.basicPayCents),
          leavePay: centsToMoney(calculation.leavePayCents),
          unpaidLeaveDeduction: centsToMoney(calculation.unpaidLeaveDeductionCents),
          overtimePay: centsToMoney(calculation.overtimePayCents),
          publicHolidayPay: centsToMoney(
            calculation.publicHolidayPayCents,
          ),
          epfWageBase: centsToMoney(epfWageCents),
          perkesoWageBase: centsToMoney(perkesoWageCents),
          epfEmployee: centsToMoney(statutory.epfEmployeeCents),
          employerEpf: centsToMoney(statutory.employerEpfCents),
          socsoEmployee: centsToMoney(statutory.socsoEmployeeCents),
          employerSocso: centsToMoney(statutory.employerSocsoCents),
          eisEmployee: centsToMoney(statutory.eisEmployeeCents),
          employerEis: centsToMoney(statutory.employerEisCents),
          lindung24Employee: centsToMoney(
            statutory.lindung24EmployeeCents,
          ),
          statutoryStatus: statutory.status,
          statutoryRuleVersion: statutory.ruleVersion,
          statutoryCalculatedAt:
            statutory.status === "AUTO_CALCULATED" ? new Date() : null,
          statutoryWarning: statutory.warnings.join(" ") || null,
          grossPay: centsToMoney(totals.grossPayCents),
          netPay: centsToMoney(totals.netPayCents),
          attendanceUpdatedAtSnapshot: latestUpdatedAt(memberSessions),
        },
      });
    }
    await writeAuditLog(
      {
        businessId: context.businessId,
        actor: context.actor,
        request: context.request,
        action: existing ? "PAYROLL_RUN_REGENERATED" : "PAYROLL_RUN_CREATED",
        entityType: "PayrollRun",
        entityId: run.id,
        summary: `${period.value} payroll draft generated for ${memberships.length} employees.`,
        metadata: { month: period.value, employeeCount: memberships.length },
      },
      transaction,
    );
    return run;
  }, { isolationLevel: "Serializable", maxWait: 5_000, timeout: 20_000 });
}

export async function updatePayrollEntry(
  context: PayrollContext & {
    entryId: string;
    values: PayrollEntryManualValues;
  },
  database: PrismaClient = prisma,
) {
  return database.$transaction(async (transaction) => {
    const entry = await transaction.payrollEntry.findFirst({
      where: { id: context.entryId, businessId: context.businessId },
      include: { payrollRun: { select: { status: true } } },
    });
    if (!entry || entry.payrollRun.status !== "DRAFT") {
      throw new Error("The editable payroll entry was not found.");
    }
    const values = normalizeManualValues(context.values);
    const totals = calculatePayrollTotals({
      basicPayCents: moneyToCents(entry.basicPay),
      overtimePayCents: moneyToCents(entry.overtimePay),
      publicHolidayPayCents: moneyToCents(entry.publicHolidayPay),
      allowancesCents: values.allowancesCents,
      otherDeductionsCents: values.otherDeductionsCents,
      epfEmployeeCents: values.epfEmployeeCents,
      socsoEmployeeCents: values.socsoEmployeeCents,
      eisEmployeeCents: values.eisEmployeeCents,
      lindung24EmployeeCents: values.lindung24EmployeeCents,
      pcbCents: values.pcbCents,
    });
    const updated = await transaction.payrollEntry.update({
      where: { id: entry.id },
      data: {
        allowances: centsToMoney(values.allowancesCents),
        otherDeductions: centsToMoney(values.otherDeductionsCents),
        epfWageBase: centsToMoney(values.epfWageBaseCents),
        perkesoWageBase: centsToMoney(values.perkesoWageBaseCents),
        lindung24Employee: centsToMoney(values.lindung24EmployeeCents),
        epfEmployee: centsToMoney(values.epfEmployeeCents),
        socsoEmployee: centsToMoney(values.socsoEmployeeCents),
        eisEmployee: centsToMoney(values.eisEmployeeCents),
        pcb: centsToMoney(values.pcbCents),
        employerEpf: centsToMoney(values.employerEpfCents),
        employerSocso: centsToMoney(values.employerSocsoCents),
        employerEis: centsToMoney(values.employerEisCents),
        grossPay: centsToMoney(totals.grossPayCents),
        netPay: centsToMoney(totals.netPayCents),
        statutoryStatus: "MANUAL_OVERRIDE",
        statutoryCalculatedAt: null,
        statutoryWarning: "Statutory amounts were manually adjusted.",
        notes: values.notes || null,
      },
    });
    const auditChange = safePayrollEntryManualAuditChange(entry, updated);
    await writeSensitiveAuditLog(
      {
        businessId: context.businessId,
        actor: context.actor,
        request: context.request,
        action: "PAYROLL_ENTRY_UPDATED",
        entityType: "PayrollEntry",
        entityId: entry.id,
        summary: `Payroll entry updated for ${entry.fullNameSnapshot}.`,
        before: auditChange.before,
        after: auditChange.after,
        metadata: { changedFields: auditChange.changedFields },
      },
      transaction,
    );
    return updated;
  }, { isolationLevel: "Serializable" });
}

export async function submitPayrollRunForReview(
  context: PayrollContext & { runId: string },
  database: PrismaClient = prisma,
) {
  return database.$transaction(async (transaction) => {
    const run = await transaction.payrollRun.findFirst({
      where: { id: context.runId, businessId: context.businessId },
      include: {
        entries: { select: { statutoryStatus: true } },
        _count: { select: { entries: true } },
      },
    });
    if (!run) throw new Error("Payroll run not found.");
    payrollTransition(run.status, "SUBMIT_FOR_REVIEW");
    if (run._count.entries === 0) {
      throw new Error("An empty payroll draft cannot be submitted for review.");
    }
    const reviewRequired = run.entries.filter(
      (entry) => entry.statutoryStatus === "REVIEW_REQUIRED",
    ).length;
    if (reviewRequired) {
      throw new Error(
        `${reviewRequired} employee statutory record(s) still require review.`,
      );
    }
    const submitted = await transaction.payrollRun.update({
      where: { id: run.id },
      data: {
        status: "REVIEW",
        submittedAt: new Date(),
        submittedById: context.actor.userId,
      },
    });
    await writeAuditLog(
      {
        businessId: context.businessId,
        actor: context.actor,
        request: context.request,
        action: "PAYROLL_RUN_SUBMITTED_FOR_REVIEW",
        entityType: "PayrollRun",
        entityId: run.id,
        summary: `Payroll run submitted for review with ${run._count.entries} entries.`,
      },
      transaction,
    );
    return submitted;
  }, { isolationLevel: "Serializable" });
}

export async function returnPayrollRunToDraft(
  context: PayrollContext & { runId: string; reason: string },
  database: PrismaClient = prisma,
) {
  return database.$transaction(async (transaction) => {
    const run = await transaction.payrollRun.findFirst({
      where: { id: context.runId, businessId: context.businessId },
    });
    if (!run) throw new Error("Payroll run not found.");
    payrollTransition(run.status, "RETURN_TO_DRAFT");
    const draft = await transaction.payrollRun.update({
      where: { id: run.id },
      data: {
        status: "DRAFT",
        submittedAt: null,
        submittedById: null,
      },
    });
    await writeAuditLog(
      {
        businessId: context.businessId,
        actor: context.actor,
        request: context.request,
        action: "PAYROLL_RUN_RETURNED_TO_DRAFT",
        entityType: "PayrollRun",
        entityId: run.id,
        summary: "Payroll review returned to draft.",
        metadata: { reason: context.reason },
      },
      transaction,
    );
    return draft;
  }, { isolationLevel: "Serializable" });
}

export async function finalizePayrollRun(
  context: PayrollContext & {
    runId: string;
    allowSelfApprovalOverride?: boolean;
    overrideReason?: string;
  },
  database: PrismaClient = prisma,
) {
  return database.$transaction(async (transaction) => {
    const run = await transaction.payrollRun.findFirst({
      where: { id: context.runId, businessId: context.businessId },
      include: { _count: { select: { entries: true } } },
    });
    if (!run) throw new Error("Payroll run not found.");
    payrollTransition(run.status, "FINALIZE");
    const selfApproval = run.submittedById === context.actor.userId;
    if (selfApproval && !context.allowSelfApprovalOverride) {
      throw new Error("The payroll submitter cannot approve the same payroll run.");
    }
    if (selfApproval && (!context.overrideReason || context.overrideReason.trim().length < 5)) {
      throw new Error("Business owner self-approval requires an override reason.");
    }
    if (run._count.entries === 0) {
      throw new Error("An empty payroll run cannot be finalized.");
    }
    const finalized = await transaction.payrollRun.update({
      where: { id: run.id },
      data: {
        status: "FINALIZED",
        finalizedAt: new Date(),
        finalizedById: context.actor.userId,
      },
    });
    await writeAuditLog(
      {
        businessId: context.businessId,
        actor: context.actor,
        request: context.request,
        action: selfApproval
          ? "PAYROLL_RUN_FINALIZED_WITH_OWNER_OVERRIDE"
          : "PAYROLL_RUN_FINALIZED",
        entityType: "PayrollRun",
        entityId: run.id,
        summary: `Payroll run finalized with ${run._count.entries} entries.`,
        metadata: selfApproval
          ? { ownerOverride: true, reason: context.overrideReason }
          : { ownerOverride: false },
      },
      transaction,
    );
    return finalized;
  }, { isolationLevel: "Serializable" });
}

export async function reopenPayrollRun(
  context: PayrollContext & { runId: string; reason: string },
  database: PrismaClient = prisma,
) {
  const result = await database.$transaction(async (transaction) => {
    const run = await transaction.payrollRun.findFirst({
      where: { id: context.runId, businessId: context.businessId },
    });
    if (!run) throw new Error("Payroll run not found.");
    payrollTransition(run.status, "REOPEN");
    const statutorySubmissionCount = await transaction.payrollStatutorySubmission.count({
      where: { businessId: context.businessId, payrollRunId: run.id },
    });
    if (statutorySubmissionCount > 0) {
      return { blocked: true as const, run };
    }
    await transaction.$executeRaw`
      SELECT set_config('tetamu.payroll_reopen', ${run.id}, TRUE)
    `;
    const reopened = await transaction.payrollRun.update({
      where: { id: run.id },
      data: {
        status: "DRAFT",
        submittedAt: null,
        submittedById: null,
        finalizedAt: null,
        finalizedById: null,
      },
    });
    await writeAuditLog(
      {
        businessId: context.businessId,
        actor: context.actor,
        request: context.request,
        action: "PAYROLL_RUN_REOPENED",
        entityType: "PayrollRun",
        entityId: run.id,
        summary: "Finalized payroll run reopened as a draft.",
        metadata: { reason: context.reason },
      },
      transaction,
    );
    return { blocked: false as const, reopened };
  }, { isolationLevel: "Serializable" });

  if (result.blocked) {
    await writeAuditLog({
      businessId: context.businessId,
      actor: context.actor,
      request: context.request,
      action: "PAYROLL_RUN_REOPEN_REJECTED",
      entityType: "PayrollRun",
      entityId: result.run.id,
      summary: "Payroll run reopen rejected because a statutory export or correction record exists.",
      status: "FAILED",
      metadata: {
        immutableStatutoryRecord: true,
        reason: context.reason,
      },
    }, database);
    throw new Error(
      "Payroll with a statutory export or correction record cannot be reopened directly.",
    );
  }

  return result.reopened;
}

type PayrollEntryManualValues = {
  allowances: unknown;
  otherDeductions: unknown;
  epfWageBase: unknown;
  perkesoWageBase: unknown;
  lindung24Employee: unknown;
  epfEmployee: unknown;
  socsoEmployee: unknown;
  eisEmployee: unknown;
  pcb: unknown;
  employerEpf: unknown;
  employerSocso: unknown;
  employerEis: unknown;
  notes: unknown;
};

function normalizeManualValues(input: PayrollEntryManualValues) {
  return {
    allowancesCents: parseMoneyInput(input.allowances),
    otherDeductionsCents: parseMoneyInput(input.otherDeductions),
    epfWageBaseCents: parseMoneyInput(input.epfWageBase),
    perkesoWageBaseCents: parseMoneyInput(input.perkesoWageBase),
    lindung24EmployeeCents: parseMoneyInput(input.lindung24Employee),
    epfEmployeeCents: parseMoneyInput(input.epfEmployee),
    socsoEmployeeCents: parseMoneyInput(input.socsoEmployee),
    eisEmployeeCents: parseMoneyInput(input.eisEmployee),
    pcbCents: parseMoneyInput(input.pcb),
    employerEpfCents: parseMoneyInput(input.employerEpf),
    employerSocsoCents: parseMoneyInput(input.employerSocso),
    employerEisCents: parseMoneyInput(input.employerEis),
    notes: String(input.notes ?? "").trim().slice(0, 500),
  };
}

export function parseMoneyInput(value: unknown) {
  const text = String(value ?? "").trim() || "0";
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(text)) {
    throw new Error("Enter a valid non-negative RM amount with up to 2 decimals.");
  }
  const [ringgit, sen = ""] = text.split(".");
  return Number(ringgit) * 100 + Number(sen.padEnd(2, "0"));
}

function aggregateDays(
  sessions: Array<{
    branchId: string;
    workDate: Date;
    totalWorkedMinutes: number;
  }>,
  holidayKeys: Set<string>,
) {
  const days = new Map<string, { minutes: number; publicHoliday: boolean }>();
  sessions.forEach((session) => {
    const key = dateKey(session.workDate);
    const current = days.get(key) ?? { minutes: 0, publicHoliday: false };
    current.minutes += session.totalWorkedMinutes;
    current.publicHoliday ||= holidayKeys.has(`${session.branchId}:${key}`);
    days.set(key, current);
  });
  return [...days.values()];
}

function latestUpdatedAt(sessions: Array<{ updatedAt: Date }>) {
  return sessions.reduce<Date | null>(
    (latest, session) =>
      !latest || session.updatedAt > latest ? session.updatedAt : latest,
    null,
  );
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function moneyToCents(value: { toString(): string } | number | null) {
  if (value === null) return 0;
  return Math.round(Number(value.toString()) * 100);
}

function centsToMoney(cents: number) {
  return (cents / 100).toFixed(2);
}
