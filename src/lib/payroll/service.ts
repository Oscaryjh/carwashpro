import type { Prisma, PrismaClient } from "@prisma/client";
import type { AppSession } from "@/lib/auth/session";
import { writeAuditLog, type AuditRequestContext } from "@/lib/audit";
import {
  safePayrollEntryManualAuditChange,
  writeSensitiveAuditLog,
} from "@/lib/audit/payroll-sensitive";
import {
  assertSupportedPayrollProration,
} from "@/lib/payroll/calculation";
import {
  buildAttendancePayrollComponents,
  buildPayrollAttendanceInput,
} from "@/lib/payroll/attendance-integration";
import { buildSystemPayrollEntryComponents } from "@/lib/payroll/component-calculation";
import { deriveAndPersistEntryAggregates } from "@/lib/payroll/component-service";
import { resolveEmployeeCompensationVersion } from "@/lib/payroll/compensation-version";
import {
  resolveRecurringPayForEmployees,
} from "@/lib/payroll/recurring-pay";
import { materializeStatutoryP2 } from "@/lib/payroll/statutory-p2";
import {
  assertPayrollRunUsesCurrentLockedTimesheet,
  resolveLockedPayrollTimesheet,
} from "@/lib/payroll/timesheet-bridge";
import { payrollTransition } from "@/lib/payroll/workflow";
import {
  buildP4CComponentLines,
  markP4CSourcesApplied,
  resolveP4CSourcesForPayroll,
} from "@/lib/payroll/variable-pay";
import { parsePayrollMonth } from "@/lib/payroll/period";
import {
  assertPayrollReadinessCanProceed,
  getPayrollPeriodReadiness,
} from "@/lib/payroll/readiness";
import { prisma } from "@/lib/prisma";

export { parsePayrollMonth } from "@/lib/payroll/period";

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

export async function generatePayrollRun(
  context: PayrollContext & { month: string },
  database: PrismaClient = prisma,
) {
  const period = parsePayrollMonth(context.month);
  return runSerializablePayrollTransaction(database, async (transaction) => {
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

    const timesheet = await resolveLockedPayrollTimesheet(
      { businessId: context.businessId, periodStart: period.start },
      transaction,
    );

    const memberships = await transaction.employeeBusinessMembership.findMany({
        where: {
          businessId: context.businessId,
          joinedAt: { lt: period.end },
          OR: [{ terminatedAt: null }, { terminatedAt: { gte: period.start } }],
        },
        orderBy: [{ fullName: "asc" }, { employeeCode: "asc" }],
        select: {
          id: true,
          joinedAt: true,
          terminatedAt: true,
          employeeCode: true,
          fullName: true,
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
          statutoryProfileRevision: true,
          taxProfileRevision: true,
          taxIdentificationNumber: true,
        },
      });
    const run = existing
      ? await transaction.payrollRun.update({
          where: { id: existing.id },
          data: {
            attendanceSource: "LOCKED_TIMESHEET_REVISION",
            attendanceTimesheetRevisionId: timesheet.revisionId,
            attendanceTimesheetRevisionSnapshot: timesheet.revision,
            attendanceTimesheetDigestSnapshot: timesheet.sourceDigest,
            attendanceTimesheetLockedAtSnapshot: timesheet.lockedAt,
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
            attendanceSource: "LOCKED_TIMESHEET_REVISION",
            attendanceTimesheetRevisionId: timesheet.revisionId,
            attendanceTimesheetRevisionSnapshot: timesheet.revision,
            attendanceTimesheetDigestSnapshot: timesheet.sourceDigest,
            attendanceTimesheetLockedAtSnapshot: timesheet.lockedAt,
            workingDaysPerMonthSnapshot: setting.workingDaysPerMonth,
            normalWorkMinutesPerDaySnapshot: setting.normalWorkMinutesPerDay,
            breakMinutesPerDaySnapshot: setting.breakMinutesPerDay,
            overtimeMultiplierSnapshot: setting.overtimeMultiplier,
            publicHolidayExtraMultiplierSnapshot:
              setting.publicHolidayExtraMultiplier,
            createdById: context.actor.userId,
          },
        });

    const previousEntries = await transaction.payrollEntry.findMany({
      where: { businessId: context.businessId, payrollRunId: run.id },
      select: { id: true, membershipId: true },
    });
    const eligibleMembershipIds = new Set(
      memberships.map((membership) => membership.id),
    );
    await transaction.payrollEntry.deleteMany({
      where: {
        businessId: context.businessId,
        payrollRunId: run.id,
        membershipId: {
          in: previousEntries
            .filter((entry) => !eligibleMembershipIds.has(entry.membershipId))
            .map((entry) => entry.membershipId),
        },
      },
    });
    const previousEntryByMembership = new Map(
      previousEntries.map((entry) => [entry.membershipId, entry]),
    );
    const appliedCompensations: Array<{
      applicableMonth: string;
      membershipId: string;
      versionId: string;
    }> = [];
    const recurringPayByMembership = await resolveRecurringPayForEmployees(
      {
        businessId: context.businessId,
        membershipIds: memberships.map((membership) => membership.id),
        payrollPeriodStart: period.start,
      },
      transaction,
    );
    const p4cSources = await resolveP4CSourcesForPayroll(transaction, {
      businessId: context.businessId,
      runId: run.id,
      periodStart: period.start,
      membershipIds: memberships.map((membership) => membership.id),
    });
    const statutoryRules = await transaction.statutoryRuleSet.findMany({
      where: {
        status: "ACTIVE",
        effectiveFrom: { lte: period.start },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: period.start } }],
      },
      include: { classifications: true },
      orderBy: [{ scheme: "asc" }, { effectiveFrom: "desc" }],
    });
    const lindung24Participation = await transaction.employeeLindung24ParticipationVersion.findMany({
      where: {
        businessId: context.businessId,
        membershipId: { in: memberships.map((membership) => membership.id) },
      },
      orderBy: [{ membershipId: "asc" }, { effectiveFromMonth: "asc" }, { revision: "asc" }],
    });
    const lindung24ParticipationByMembership = new Map<string, typeof lindung24Participation>();
    for (const record of lindung24Participation) {
      const records = lindung24ParticipationByMembership.get(record.membershipId) ?? [];
      records.push(record);
      lindung24ParticipationByMembership.set(record.membershipId, records);
    }
    let recurringPaySnapshotCount = 0;
    let variablePayAppliedCount = 0;
    let correctionAppliedCount = 0;
    let attendanceSnapshotCount = 0;
    let attendancePolicyBlockerCount = 0;
    for (const membership of memberships) {
      const compensation = await resolveEmployeeCompensationVersion(
        {
          businessId: context.businessId,
          membershipId: membership.id,
          payrollPeriodStart: period.start,
        },
        transaction,
      );
      appliedCompensations.push({
        applicableMonth: compensation.effectiveFromMonth
          .toISOString()
          .slice(0, 7),
        membershipId: membership.id,
        versionId: compensation.versionId,
      });
      const attendance = buildPayrollAttendanceInput({
        membershipId: membership.id,
        payBasis: compensation.payBasis,
        days: timesheet.p2Days.filter(
          (day) => day.membershipId === membership.id,
        ),
      });
      assertSupportedPayrollProration({
        payBasis: compensation.payBasis,
        joinedAt: membership.joinedAt,
        terminatedAt: membership.terminatedAt,
        periodStart: period.start,
        periodEnd: period.end,
      });
      const baseRateCents = moneyToCents(compensation.baseRate);
      const previewAttendanceLines = buildAttendancePayrollComponents({
        snapshotId: "00000000-0000-4000-8000-000000000000",
        timesheetRevision: timesheet.revision,
        periodStart: period.start,
        payBasis: compensation.payBasis,
        baseRateCents,
        attendance,
      });
      const regularPayCents =
        compensation.payBasis === "MONTHLY"
          ? baseRateCents
          : componentAmount(previewAttendanceLines, [
              "REGULAR_DAILY_PAY",
              "REGULAR_HOURLY_PAY",
            ]);
      const leavePayCents = componentAmount(previewAttendanceLines, [
        "PAID_LEAVE_PAY",
      ]);
      const recurringPay = recurringPayByMembership.get(membership.id) ?? [];
      const variablePay =
        p4cSources.variablePayByMembership.get(membership.id) ?? [];
      const corrections =
        p4cSources.correctionsByMembership.get(membership.id) ?? [];
      const previousEntry = previousEntryByMembership.get(membership.id);
      if (previousEntry) {
        await transaction.payrollEntryComponent.deleteMany({
          where: { payrollEntryId: previousEntry.id, origin: "SYSTEM" },
        });
        await transaction.payrollEntryRecurringPaySnapshot.deleteMany({
          where: { payrollEntryId: previousEntry.id },
        });
      }
      const entryData = {
          payrollRunId: run.id,
          businessId: context.businessId,
          membershipId: membership.id,
          compensationVersionId: compensation.versionId,
          compensationEffectiveFromMonthSnapshot:
            compensation.effectiveFromMonth,
          compensationSourceSnapshot: compensation.source,
          employeeCodeSnapshot: membership.employeeCode,
          fullNameSnapshot: membership.fullName,
          payBasisSnapshot: compensation.payBasis,
          baseRateSnapshot: centsToMoney(baseRateCents),
          workingDaysSnapshot: setting.workingDaysPerMonth,
          normalWorkMinutesSnapshot:
            membership.normalWorkMinutesPerDay ??
            setting.normalWorkMinutesPerDay,
          attendanceDays: Math.floor(attendance.regularDayHundredths / 100),
          regularMinutes: attendance.regularMinutes,
          overtimeMinutes: attendance.approvedOvertimeMinutes,
          publicHolidayMinutes: attendance.publicHolidayWorkedMinutes,
          paidLeaveDays: hundredthsToDecimal(attendance.paidLeaveDayHundredths),
          unpaidLeaveDays: hundredthsToDecimal(attendance.unpaidLeaveDayHundredths),
          basicPay: centsToMoney(regularPayCents),
          leavePay: centsToMoney(leavePayCents),
          unpaidLeaveDeduction: "0.00",
          overtimePay: "0.00",
          publicHolidayPay: "0.00",
          epfWageBase: "0.00",
          perkesoWageBase: "0.00",
          epfEmployee: "0.00",
          employerEpf: "0.00",
          socsoEmployee: "0.00",
          employerSocso: "0.00",
          eisEmployee: "0.00",
          employerEis: "0.00",
          lindung24Employee: "0.00",
          pcb: "0.00",
          statutoryStatus: "REVIEW_REQUIRED" as const,
          statutoryRuleVersion: null,
          statutoryCalculatedAt: null,
          statutoryWarning: "Statutory P2 materialisation pending.",
          attendanceUpdatedAtSnapshot: timesheet.lockedAt,
        };
      const entry = previousEntry
        ? await transaction.payrollEntry.update({
            where: { id: previousEntry.id },
            data: entryData,
          })
        : await transaction.payrollEntry.create({ data: entryData });
      const attendanceSnapshotData = {
        businessId: context.businessId,
        payrollRunId: run.id,
        membershipId: membership.id,
        timesheetId: timesheet.timesheetId,
        timesheetRevisionId: timesheet.revisionId,
        timesheetRevision: timesheet.revision,
        timesheetSourceDigest: timesheet.sourceDigest,
        timesheetLockedAt: timesheet.lockedAt,
        periodStart: period.start,
        periodEnd: period.end,
        regularDays: hundredthsToDecimal(attendance.regularDayHundredths),
        regularMinutes: attendance.regularMinutes,
        paidLeaveDays: hundredthsToDecimal(attendance.paidLeaveDayHundredths),
        unpaidLeaveDays: hundredthsToDecimal(attendance.unpaidLeaveDayHundredths),
        unauthorizedAbsenceDays: hundredthsToDecimal(
          attendance.unauthorizedAbsenceDayHundredths,
        ),
        authorizedAbsenceDays: hundredthsToDecimal(
          attendance.authorizedAbsenceDayHundredths,
        ),
        restDayWorkedMinutes: attendance.restDayWorkedMinutes,
        publicHolidayWorkedMinutes: attendance.publicHolidayWorkedMinutes,
        approvedOvertimeMinutes: attendance.approvedOvertimeMinutes,
        sourceDayCount: attendance.sourceDayCount,
        legacyCompatibility: attendance.legacyCompatibility,
        policyBlockers: attendance.policyBlockers,
        sourceDigest: attendance.sourceDigest,
        generatedAt: new Date(),
      } satisfies Prisma.PayrollAttendanceInputSnapshotUncheckedUpdateInput;
      const attendanceSnapshot = await transaction.payrollAttendanceInputSnapshot.upsert({
        where: { payrollEntryId: entry.id },
        create: {
          ...attendanceSnapshotData,
          payrollEntryId: entry.id,
        },
        update: attendanceSnapshotData,
      });
      attendanceSnapshotCount += 1;
      attendancePolicyBlockerCount += attendance.policyBlockers.length;
      if (recurringPay.length) {
        await transaction.payrollEntryRecurringPaySnapshot.createMany({
          data: recurringPay.map((component) => ({
            amount: component.amount,
            businessId: context.businessId,
            code: component.code,
            currency: component.currency,
            effectiveFromMonth: component.effectiveFromMonth,
            membershipId: membership.id,
            name: component.name,
            payrollEntryId: entry.id,
            sourceComponentId: component.componentId,
            sourceRevision: component.revision,
            sourceVersionId: component.versionId,
            type: component.type,
          })),
        });
        recurringPaySnapshotCount += recurringPay.length;
      }
      const systemLines = buildSystemPayrollEntryComponents({
        compensation: {
          versionId: compensation.versionId,
          effectiveFromMonth: compensation.effectiveFromMonth,
          payBasis: compensation.payBasis,
        },
        amounts: {
          basicPayCents:
            compensation.payBasis === "MONTHLY" ? regularPayCents : 0,
          leavePayCents: 0,
          overtimePayCents: 0,
          publicHolidayPayCents: 0,
        },
        recurring: recurringPay.map((component) => ({
          componentId: component.componentId,
          versionId: component.versionId,
          revision: component.revision,
          type: component.type,
          code: component.code,
          name: component.name,
          amountCents: moneyToCents(component.amount),
          effectiveFromMonth: component.effectiveFromMonth,
        })),
      });
      const attendanceLines = buildAttendancePayrollComponents({
        snapshotId: attendanceSnapshot.id,
        timesheetRevision: timesheet.revision,
        periodStart: period.start,
        payBasis: compensation.payBasis,
        baseRateCents,
        attendance,
      });
      const p4cLines = buildP4CComponentLines({ variablePay, corrections });
      const materializedLines = [...systemLines, ...attendanceLines, ...p4cLines];
      if (materializedLines.length) {
        await transaction.payrollEntryComponent.createMany({
          data: materializedLines.map((line) => ({
            businessId: context.businessId,
            payrollRunId: run.id,
            payrollEntryId: entry.id,
            membershipId: membership.id,
            lineKey: line.lineKey,
            type: line.type,
            code: line.code,
            name: line.name,
            amount: centsToMoney(line.amountCents),
            currency: line.currency,
            sourceType: line.sourceType,
            sourceId: line.sourceId,
            sourceVersionId: line.sourceVersionId,
            sourceRevision: line.sourceRevision,
            effectiveFromMonth: line.effectiveFromMonth,
            calculationBasis: line.calculationBasis,
            origin: line.origin,
            sourceReason: line.sourceReason ?? null,
            reason: line.reason,
            sortOrder: line.sortOrder,
            createdById: context.actor.userId,
          })),
        });
      }
      await markP4CSourcesApplied(transaction, {
        entryId: entry.id,
        variablePay,
        corrections,
        audit: {
          businessId: context.businessId,
          actor: context.actor,
          request: context.request,
        },
      });
      variablePayAppliedCount += variablePay.length;
      correctionAppliedCount += corrections.length;
      await materializeStatutoryP2(transaction, {
        businessId: context.businessId,
        payrollRunId: run.id,
        payrollEntryId: entry.id,
        membershipId: membership.id,
        statutoryPeriod: period.start,
        actorUserId: context.actor.userId,
        preloadedRules: statutoryRules,
        preloadedLindung24Participation:
          lindung24ParticipationByMembership.get(membership.id) ?? [],
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
          statutoryProfileRevision: membership.statutoryProfileRevision,
          taxProfileRevision: membership.taxProfileRevision,
          taxIdentificationNumber: membership.taxIdentificationNumber,
        },
      });
      const statutoryEntry = await transaction.payrollEntry.findUniqueOrThrow({
        where: { id: entry.id },
      });
      await deriveAndPersistEntryAggregates(
        transaction,
        statutoryEntry,
        statutoryEntry.calculationRevision,
      );
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
        metadata: {
          month: period.value,
          employeeCount: memberships.length,
          compensationVersions: appliedCompensations,
          recurringPaySnapshotCount,
          variablePayAppliedCount,
          correctionAppliedCount,
          attendanceSnapshotCount,
          attendancePolicyBlockerCount,
          attendanceTimesheet: {
            revisionId: timesheet.revisionId,
            revision: timesheet.revision,
            sourceDigest: timesheet.sourceDigest,
          },
        },
      },
      transaction,
    );
    return run;
  });
}

async function runSerializablePayrollTransaction<T>(
  database: PrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
) {
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await database.$transaction(operation, {
        isolationLevel: "Serializable",
        maxWait: 5_000,
        timeout: 20_000,
      });
    } catch (error) {
      if (!isSerializableConflict(error) || attempt === maxAttempts - 1) {
        throw error;
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, 20 * 2 ** attempt),
      );
    }
  }

  throw new Error("Payroll transaction retry limit exceeded.");
}

function isSerializableConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  );
}

export async function updatePayrollEntry(
  context: PayrollContext & {
    entryId: string;
    expectedRevision: number;
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
    if (entry.calculationRevision !== context.expectedRevision) {
      throw new Error("Payroll entry changed after this page was loaded. Reload and try again.");
    }
    const values = normalizeManualValues(context.values);
    const currentStatutoryValues = [
      moneyToCents(entry.epfWageBase),
      moneyToCents(entry.perkesoWageBase),
      moneyToCents(entry.lindung24Employee),
      moneyToCents(entry.epfEmployee),
      moneyToCents(entry.socsoEmployee),
      moneyToCents(entry.eisEmployee),
      moneyToCents(entry.pcb),
      moneyToCents(entry.employerEpf),
      moneyToCents(entry.employerSocso),
      moneyToCents(entry.employerEis),
    ];
    const requestedStatutoryValues = [
      values.epfWageBaseCents,
      values.perkesoWageBaseCents,
      values.lindung24EmployeeCents,
      values.epfEmployeeCents,
      values.socsoEmployeeCents,
      values.eisEmployeeCents,
      values.pcbCents,
      values.employerEpfCents,
      values.employerSocsoCents,
      values.employerEisCents,
    ];
    if (requestedStatutoryValues.some((value, index) => value !== currentStatutoryValues[index])) {
      throw new Error(
        "Direct statutory amount overrides are disabled. Use a controlled statutory source workflow.",
      );
    }
    const write = await transaction.payrollEntry.updateMany({
      where: {
        id: entry.id,
        businessId: context.businessId,
        calculationRevision: context.expectedRevision,
        payrollRun: { status: "DRAFT" },
      },
      data: {
        notes: values.notes || null,
      },
    });
    if (write.count !== 1) {
      throw new Error("Payroll entry changed after this page was loaded. Reload and try again.");
    }
    const statutoryUpdated = await transaction.payrollEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
    await deriveAndPersistEntryAggregates(
      transaction,
      statutoryUpdated,
      context.expectedRevision,
    );
    const updated = await transaction.payrollEntry.findUniqueOrThrow({
      where: { id: entry.id },
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
    await assertPayrollRunUsesCurrentLockedTimesheet(
      { businessId: context.businessId, run },
      transaction,
    );
    if (run._count.entries === 0) {
      throw new Error("An empty payroll draft cannot be submitted for review.");
    }
    const readiness = await getPayrollPeriodReadiness(
      {
        businessId: context.businessId,
        month: run.periodStart.toISOString().slice(0, 7),
        runId: run.id,
      },
      transaction,
    );
    assertPayrollReadinessCanProceed(readiness);
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
    await assertPayrollRunUsesCurrentLockedTimesheet(
      { businessId: context.businessId, run },
      transaction,
    );
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
    const readiness = await getPayrollPeriodReadiness(
      {
        businessId: context.businessId,
        month: run.periodStart.toISOString().slice(0, 7),
        runId: run.id,
      },
      transaction,
    );
    assertPayrollReadinessCanProceed(readiness);
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
    const paymentBatch = await transaction.payrollPaymentBatch.findFirst({
      where: {
        businessId: context.businessId,
        payrollRunId: run.id,
        OR: [
          { status: { in: ["DRAFT", "AWAITING_APPROVAL", "APPROVED", "INSTRUCTION_READY"] } },
          { currentArtifactId: { not: null } },
        ],
      },
      orderBy: { revision: "desc" },
      select: { currentArtifactId: true, id: true, status: true },
    });
    if (paymentBatch) {
      return {
        blocked: true as const,
        blockReason:
          paymentBatch.status === "DRAFT" ||
          paymentBatch.status === "AWAITING_APPROVAL"
            ? ("ACTIVE_PAYMENT_BATCH" as const)
            : ("APPROVED_PAYMENT_INSTRUCTION" as const),
        paymentBatch,
        run,
      };
    }
    const statutorySubmissionCount = await transaction.payrollStatutorySubmission.count({
      where: { businessId: context.businessId, payrollRunId: run.id },
    });
    if (statutorySubmissionCount > 0) {
      return { blocked: true as const, blockReason: "STATUTORY_RECORD" as const, run };
    }
    const publishedPayslipCount = await transaction.payrollPayslipPublication.count({
      where: { businessId: context.businessId, payrollRunId: run.id },
    });
    if (publishedPayslipCount > 0) {
      return { blocked: true as const, blockReason: "PUBLISHED_PAYSLIP" as const, run };
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
      summary:
        result.blockReason === "ACTIVE_PAYMENT_BATCH"
          ? "Payroll run reopen rejected because an active payment batch exists."
          : result.blockReason === "APPROVED_PAYMENT_INSTRUCTION"
            ? "Payroll run reopen rejected because an approved payment instruction exists."
            : result.blockReason === "PUBLISHED_PAYSLIP"
              ? "Payroll run reopen rejected because published payslips exist."
              : "Payroll run reopen rejected because a statutory export or correction record exists.",
      status: "FAILED",
      metadata: {
        ...(result.blockReason === "STATUTORY_RECORD"
          ? { immutableStatutoryRecord: true }
          : result.blockReason === "PUBLISHED_PAYSLIP"
            ? { immutablePublishedPayslip: true }
            : { immutablePaymentRecord: true }),
        paymentBatchId:
          "paymentBatch" in result ? result.paymentBatch?.id : undefined,
        reason: context.reason,
      },
    }, database);
    throw new Error(
      result.blockReason === "ACTIVE_PAYMENT_BATCH"
        ? "Cancel the active payroll payment batch before reopening this payroll."
        : result.blockReason === "APPROVED_PAYMENT_INSTRUCTION"
          ? "This payroll has an approved payment instruction and cannot be reopened through the standard workflow."
          : result.blockReason === "PUBLISHED_PAYSLIP"
            ? "Payroll with published payslips cannot be reopened. Published documents are immutable."
            : "Payroll with a statutory export or correction record cannot be reopened directly.",
    );
  }

  return result.reopened;
}

type PayrollEntryManualValues = {
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

function componentAmount(
  lines: ReadonlyArray<{ code: string; amountCents: number }>,
  codes: readonly string[],
) {
  return lines.reduce(
    (total, line) => total + (codes.includes(line.code) ? line.amountCents : 0),
    0,
  );
}

function hundredthsToDecimal(hundredths: number) {
  if (!Number.isSafeInteger(hundredths) || hundredths < 0) {
    throw new Error("Payroll attendance units are outside the supported range.");
  }
  return (hundredths / 100).toFixed(2);
}

function moneyToCents(value: { toString(): string } | number | null) {
  if (value === null) return 0;
  return Math.round(Number(value.toString()) * 100);
}

function centsToMoney(cents: number) {
  return (cents / 100).toFixed(2);
}
