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
import { calculateCompanyWorkPay } from "@/lib/payroll/company-work-pay";
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
import {
  consumePayrollHighRiskAuthorization,
  type PayrollHighRiskStepUp,
} from "@/lib/payroll/high-risk-mfa";
import { prisma } from "@/lib/prisma";

export { parsePayrollMonth } from "@/lib/payroll/period";

export const DEFAULT_PAYROLL_SETTING = {
  workingDaysPerMonth: 26,
  normalWorkMinutesPerDay: 480,
  breakMinutesPerDay: 60,
  overtimeMultiplier: 1.5,
  restDayWorkMultiplier: 1,
  restDayOvertimeMultiplier: 2,
  publicHolidayExtraMultiplier: 2,
  publicHolidayOvertimeMultiplier: 3,
  publicHolidayPayEnabled: false,
  publicHolidayPayPolicyRevision: 1,
  stateCode: null,
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
          workingDaysPerMonth: true,
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
          pcbProfile: true,
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
            restDayWorkMultiplierSnapshot: setting.restDayWorkMultiplier,
            restDayOvertimeMultiplierSnapshot:
              setting.restDayOvertimeMultiplier,
            publicHolidayExtraMultiplierSnapshot:
              setting.publicHolidayExtraMultiplier,
            publicHolidayOvertimeMultiplierSnapshot:
              setting.publicHolidayOvertimeMultiplier,
            publicHolidayPayEnabledSnapshot: setting.publicHolidayPayEnabled,
            publicHolidayPayPolicyRevisionSnapshot:
              setting.publicHolidayPayPolicyRevision,
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
            restDayWorkMultiplierSnapshot: setting.restDayWorkMultiplier,
            restDayOvertimeMultiplierSnapshot:
              setting.restDayOvertimeMultiplier,
            publicHolidayExtraMultiplierSnapshot:
              setting.publicHolidayExtraMultiplier,
            publicHolidayOvertimeMultiplierSnapshot:
              setting.publicHolidayOvertimeMultiplier,
            publicHolidayPayEnabledSnapshot: setting.publicHolidayPayEnabled,
            publicHolidayPayPolicyRevisionSnapshot:
              setting.publicHolidayPayPolicyRevision,
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
      include: {
        classifications: {
          include: { reviewDecisions: { orderBy: { decisionRevision: "asc" } } },
        },
      },
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
    let leaveSnapshotFactCount = 0;
    let companyWorkPayEmployeeCount = 0;
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
        // HR-owned company settings are the canonical work-pay policy used to
        // generate Payroll.
        publicHolidayPayPolicyReady: true,
        statutoryWorkPayPolicyReady: true,
        monthlyAbsencePolicyReady: true,
        days: timesheet.p2Days.filter(
          (day) => day.membershipId === membership.id,
        ),
        segments: timesheet.p2Segments.filter(
          (segment) => segment.membershipId === membership.id,
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
      const workingDaysPerMonth =
        membership.workingDaysPerMonth ?? setting.workingDaysPerMonth;
      const companyWorkPay = calculateCompanyWorkPay({
        payBasis: compensation.payBasis,
        baseRateCents,
        workingDaysPerMonth,
        normalWorkMinutesPerDay:
          membership.normalWorkMinutesPerDay ??
          setting.normalWorkMinutesPerDay,
        normalOtMinutes: attendance.normalOtMinutes,
        restDayWorkMinutes: attendance.restDayWorkMinutes,
        restDayOtMinutes: attendance.restDayOtMinutes,
        publicHolidayWorkMinutes: attendance.publicHolidayWorkMinutes,
        publicHolidayOtMinutes: attendance.publicHolidayOtMinutes,
        overtimeMultiplier: Number(setting.overtimeMultiplier),
        restDayWorkMultiplier: Number(setting.restDayWorkMultiplier),
        restDayOvertimeMultiplier: Number(
          setting.restDayOvertimeMultiplier,
        ),
        publicHolidayWorkMultiplier: Number(
          setting.publicHolidayExtraMultiplier,
        ),
        publicHolidayOvertimeMultiplier: Number(
          setting.publicHolidayOvertimeMultiplier,
        ),
        publicHolidayPayEnabled: setting.publicHolidayPayEnabled,
      });
      if (
        companyWorkPay.overtimePayCents > 0 ||
        companyWorkPay.publicHolidayPayCents > 0
      ) {
        companyWorkPayEmployeeCount += 1;
      }
      const previewAttendanceLines = buildAttendancePayrollComponents({
        snapshotId: "00000000-0000-4000-8000-000000000000",
        timesheetRevision: timesheet.revision,
        periodStart: period.start,
        payBasis: compensation.payBasis,
        baseRateCents,
        workingDaysPerMonth,
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
      const unpaidAbsenceDeductionCents = componentAmount(
        previewAttendanceLines,
        ["UNPAID_ABSENCE_DEDUCTION"],
      );
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
        await transaction.payrollWorkPayCalculationSnapshot.deleteMany({
          where: { payrollEntryId: previousEntry.id },
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
          workingDaysSnapshot:
            membership.workingDaysPerMonth ?? setting.workingDaysPerMonth,
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
          unpaidLeaveDeduction: centsToMoney(unpaidAbsenceDeductionCents),
          overtimePay: centsToMoney(companyWorkPay.overtimePayCents),
          publicHolidayPay: centsToMoney(
            companyWorkPay.publicHolidayPayCents,
          ),
          publicHolidayPayPreview: "0.00",
          publicHolidayPayDecisionStatus:
            attendance.publicHolidayWorkedMinutes === 0 ||
            setting.publicHolidayPayEnabled
              ? ("NOT_APPLICABLE" as const)
              : ("POLICY_DISABLED" as const),
          publicHolidayPayDecisionReason: null,
          publicHolidayPayDecidedById: null,
          publicHolidayPayDecidedAt: null,
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
        regularNormalMinutes: attendance.regularNormalMinutes,
        normalOtMinutes: attendance.normalOtMinutes,
        restDayWorkMinutes: attendance.restDayWorkMinutes,
        restDayOtMinutes: attendance.restDayOtMinutes,
        publicHolidayWorkMinutes: attendance.publicHolidayWorkMinutes,
        publicHolidayOtMinutes: attendance.publicHolidayOtMinutes,
        segmentFacts: JSON.parse(
          JSON.stringify(attendance.segmentFacts),
        ) as Prisma.InputJsonValue,
        sourceDayCount: attendance.sourceDayCount,
        legacyCompatibility: attendance.legacyCompatibility,
        policyBlockers: attendance.policyBlockers,
        leaveFacts: JSON.parse(JSON.stringify(attendance.leaveFacts)) as Prisma.InputJsonValue,
        leaveCategoryBreakdown: JSON.parse(
          JSON.stringify(attendance.leaveCategoryBreakdown),
        ) as Prisma.InputJsonValue,
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
      leaveSnapshotFactCount += attendance.leaveFacts.length;
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
          overtimePayCents: companyWorkPay.overtimePayCents,
          publicHolidayPayCents: companyWorkPay.publicHolidayPayCents,
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
        workingDaysPerMonth,
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
          pcbProfile: membership.pcbProfile,
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
          companyWorkPayEmployeeCount,
          companyWorkPayPolicyRevision:
            setting.publicHolidayPayPolicyRevision,
          attendanceTimesheet: {
            revisionId: timesheet.revisionId,
            revision: timesheet.revision,
            sourceDigest: timesheet.sourceDigest,
          },
        },
      },
      transaction,
    );
    await writeAuditLog(
      {
        businessId: context.businessId,
        actor: context.actor,
        request: context.request,
        action: "PAYROLL_LEAVE_SNAPSHOT_CREATED",
        entityType: "PayrollRun",
        entityId: run.id,
        summary: `Frozen Leave evidence was copied from locked Timesheet revision ${timesheet.revision}.`,
        metadata: {
          month: period.value,
          timesheetRevisionId: timesheet.revisionId,
          timesheetRevision: timesheet.revision,
          employeeSnapshotCount: attendanceSnapshotCount,
          leaveFactCount: leaveSnapshotFactCount,
          policyBlockerCount: attendancePolicyBlockerCount,
        },
      },
      transaction,
    );
    if (companyWorkPayEmployeeCount > 0) {
      await writeAuditLog(
        {
          businessId: context.businessId,
          actor: context.actor,
          request: context.request,
          action: "PAYROLL_COMPANY_WORK_PAY_APPLIED",
          entityType: "PayrollRun",
          entityId: run.id,
          summary: `${companyWorkPayEmployeeCount} employee work-pay calculations used frozen HR company rules.`,
          metadata: {
            month: period.value,
            employeeCount: companyWorkPayEmployeeCount,
            overtimeMultiplier: setting.overtimeMultiplier.toString(),
            restDayWorkMultiplier:
              setting.restDayWorkMultiplier.toString(),
            restDayOvertimeMultiplier:
              setting.restDayOvertimeMultiplier.toString(),
            publicHolidayWorkMultiplier:
              setting.publicHolidayExtraMultiplier.toString(),
            publicHolidayOvertimeMultiplier:
              setting.publicHolidayOvertimeMultiplier.toString(),
            publicHolidayPayEnabled: setting.publicHolidayPayEnabled,
          },
        },
        transaction,
      );
    }
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
    values: PayrollEntryEditableValues;
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
    assertNoDirectStatutoryEntryValues(context.values);
    const notes = String(context.values.notes ?? "").trim().slice(0, 500);
    const write = await transaction.payrollEntry.updateMany({
      where: {
        id: entry.id,
        businessId: context.businessId,
        calculationRevision: context.expectedRevision,
        payrollRun: { status: "DRAFT" },
      },
      data: {
        notes: notes || null,
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

export async function decidePayrollHolidayPay(
  context: PayrollContext & {
    entryId: string;
    expectedRevision: number;
    decision: "CONFIRMED" | "EXCLUDED";
    reason?: string;
  },
  database: PrismaClient = prisma,
) {
  const reason = String(context.reason ?? "").trim();
  if (context.decision === "EXCLUDED" && (reason.length < 5 || reason.length > 500)) {
    throw new Error("Exclusion reason must be 5 to 500 characters.");
  }
  return database.$transaction(async (transaction) => {
    const entry = await transaction.payrollEntry.findFirst({
      where: {
        id: context.entryId,
        businessId: context.businessId,
        payrollRun: { status: "DRAFT" },
      },
      include: {
        payrollRun: true,
        attendanceInputSnapshot: true,
        membership: {
          select: {
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
            pcbProfile: true,
          },
        },
      },
    });
    if (!entry || !entry.attendanceInputSnapshot) {
      throw new Error("The editable payroll holiday record was not found.");
    }
    if (entry.calculationRevision !== context.expectedRevision) {
      throw new Error("Payroll entry changed after this page was loaded. Reload and try again.");
    }
    if (!entry.payrollRun.publicHolidayPayEnabledSnapshot) {
      throw new Error("Holiday pay preview is disabled for this Payroll Run.");
    }
    if (entry.attendanceInputSnapshot.publicHolidayWorkedMinutes <= 0) {
      throw new Error("No frozen public-holiday worked minutes require a decision.");
    }

    const hasDetailedHolidayBuckets =
      entry.attendanceInputSnapshot.publicHolidayWorkMinutes +
        entry.attendanceInputSnapshot.publicHolidayOtMinutes >
      0;
    const preview = calculateCompanyWorkPay({
      payBasis: entry.payBasisSnapshot,
      baseRateCents: moneyToCents(entry.baseRateSnapshot),
      workingDaysPerMonth: entry.workingDaysSnapshot,
      normalWorkMinutesPerDay: entry.normalWorkMinutesSnapshot,
      normalOtMinutes: 0,
      restDayWorkMinutes: 0,
      restDayOtMinutes: 0,
      publicHolidayWorkMinutes: hasDetailedHolidayBuckets
        ? entry.attendanceInputSnapshot.publicHolidayWorkMinutes
        : entry.attendanceInputSnapshot.publicHolidayWorkedMinutes,
      publicHolidayOtMinutes: hasDetailedHolidayBuckets
        ? entry.attendanceInputSnapshot.publicHolidayOtMinutes
        : 0,
      overtimeMultiplier: Number(entry.payrollRun.overtimeMultiplierSnapshot),
      restDayWorkMultiplier: Number(
        entry.payrollRun.restDayWorkMultiplierSnapshot,
      ),
      restDayOvertimeMultiplier: Number(
        entry.payrollRun.restDayOvertimeMultiplierSnapshot,
      ),
      publicHolidayWorkMultiplier: Number(
        entry.payrollRun.publicHolidayExtraMultiplierSnapshot,
      ),
      publicHolidayOvertimeMultiplier: Number(
        entry.payrollRun.publicHolidayOvertimeMultiplierSnapshot,
      ),
      publicHolidayPayEnabled: true,
    });
    const previewAmount = centsToMoney(preview.publicHolidayPayCents);
    const calculationBasis =
      "Frozen holiday minutes multiplied by the HR company work-pay settings saved with this Payroll Run.";
    const sourceReason =
      "Calculated from the Payroll Run's frozen HR company multipliers.";
    const lineKey = "SYSTEM:PUBLIC_HOLIDAY_PAY";
    if (context.decision === "CONFIRMED") {
      await transaction.payrollEntryComponent.upsert({
        where: {
          payrollEntryId_lineKey: {
            payrollEntryId: entry.id,
            lineKey,
          },
        },
        create: {
          businessId: context.businessId,
          payrollRunId: entry.payrollRunId,
          payrollEntryId: entry.id,
          membershipId: entry.membershipId,
          lineKey,
          type: "EARNING",
          code: "PUBLIC_HOLIDAY_PAY",
          name: "Public Holiday Pay",
          amount: previewAmount,
          currency: "MYR",
          sourceType: "PAYROLL_CALCULATION",
          sourceId: entry.attendanceInputSnapshot.id,
          sourceVersionId: entry.attendanceInputSnapshot.timesheetRevisionId,
          sourceRevision: entry.attendanceInputSnapshot.timesheetRevision,
          effectiveFromMonth: entry.payrollRun.periodStart,
          calculationBasis,
          origin: "SYSTEM",
          sourceReason,
          sortOrder: 400,
          createdById: context.actor.userId,
        },
        update: {
          amount: previewAmount,
          sourceId: entry.attendanceInputSnapshot.id,
          sourceVersionId: entry.attendanceInputSnapshot.timesheetRevisionId,
          sourceRevision: entry.attendanceInputSnapshot.timesheetRevision,
          calculationBasis,
          sourceReason,
        },
      });
    } else {
      await transaction.payrollEntryComponent.deleteMany({
        where: {
          businessId: context.businessId,
          payrollEntryId: entry.id,
          lineKey,
          origin: "SYSTEM",
        },
      });
    }

    const write = await transaction.payrollEntry.updateMany({
      where: {
        id: entry.id,
        businessId: context.businessId,
        calculationRevision: context.expectedRevision,
        payrollRun: { status: "DRAFT" },
      },
      data: {
        publicHolidayPayPreview: previewAmount,
        publicHolidayPay:
          context.decision === "CONFIRMED"
            ? previewAmount
            : "0.00",
        publicHolidayPayDecisionStatus: context.decision,
        publicHolidayPayDecisionReason: reason || null,
        publicHolidayPayDecidedById: context.actor.userId,
        publicHolidayPayDecidedAt: new Date(),
      },
    });
    if (write.count !== 1) {
      throw new Error("Payroll entry changed after this page was loaded. Reload and try again.");
    }

    await materializeStatutoryP2(transaction, {
      businessId: context.businessId,
      payrollRunId: entry.payrollRunId,
      payrollEntryId: entry.id,
      membershipId: entry.membershipId,
      statutoryPeriod: entry.payrollRun.periodStart,
      actorUserId: context.actor.userId,
      profile: entry.membership,
    });
    const refreshed = await transaction.payrollEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
    await deriveAndPersistEntryAggregates(
      transaction,
      refreshed,
      context.expectedRevision,
    );
    await writeSensitiveAuditLog(
      {
        businessId: context.businessId,
        actor: context.actor,
        request: context.request,
        action: `PAYROLL_HOLIDAY_PAY_${context.decision}`,
        entityType: "PayrollEntry",
        entityId: entry.id,
        summary: `Holiday pay ${context.decision.toLowerCase()} for ${entry.fullNameSnapshot}.`,
        before: {
          decision: entry.publicHolidayPayDecisionStatus,
          policyRevision:
            entry.payrollRun.publicHolidayPayPolicyRevisionSnapshot,
        },
        after: {
          decision: context.decision,
          reasonRecorded: Boolean(reason),
          amount: "[REDACTED]",
        },
      },
      transaction,
    );
    return transaction.payrollEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
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
        entries: {
          select: {
            statutoryStatus: true,
            publicHolidayPayDecisionStatus: true,
          },
        },
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
    const pendingHolidayPay = run.entries.filter(
      (entry) =>
        entry.publicHolidayPayDecisionStatus === "PENDING_CONFIRMATION",
    ).length;
    if (pendingHolidayPay) {
      throw new Error(
        `${pendingHolidayPay} employee holiday pay preview(s) still require confirmation or exclusion.`,
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
    stepUp: PayrollHighRiskStepUp;
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
    const stepUpAudit = await consumePayrollHighRiskAuthorization(
      {
        actionKey: "PAYROLL_FINALIZE",
        businessId: context.businessId,
        resourceId: run.id,
        stepUp: context.stepUp,
        userId: context.actor.userId,
      },
      transaction,
    );
    const finalizedWrite = await transaction.payrollRun.updateMany({
      where: {
        id: run.id,
        businessId: context.businessId,
        status: "REVIEW",
        updatedAt: run.updatedAt,
      },
      data: {
        status: "FINALIZED",
        finalizedAt: new Date(),
        finalizedById: context.actor.userId,
      },
    });
    if (finalizedWrite.count !== 1) {
      throw new Error(
        "Payroll run changed during final review. Reload the latest revision and run readiness again.",
      );
    }
    const finalized = await transaction.payrollRun.findFirstOrThrow({
      where: { id: run.id, businessId: context.businessId },
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
          ? {
              ownerOverride: true,
              reason: context.overrideReason,
              ...stepUpAudit,
            }
          : { ownerOverride: false, ...stepUpAudit },
      },
      transaction,
    );
    return finalized;
  }, { isolationLevel: "Serializable" });
}

export async function reopenPayrollRun(
  context: PayrollContext & {
    runId: string;
    reason: string;
    stepUp: PayrollHighRiskStepUp;
  },
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
    const stepUpAudit = await consumePayrollHighRiskAuthorization(
      {
        actionKey: "PAYROLL_REOPEN",
        businessId: context.businessId,
        resourceId: run.id,
        stepUp: context.stepUp,
        userId: context.actor.userId,
      },
      transaction,
    );
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
        metadata: { reason: context.reason, ...stepUpAudit },
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

type PayrollEntryEditableValues = {
  notes: unknown;
};

export function assertNoDirectStatutoryEntryValues(
  values: PayrollEntryEditableValues,
) {
  const statutoryFields = [
    "epfWageBase",
    "perkesoWageBase",
    "lindung24Employee",
    "epfEmployee",
    "socsoEmployee",
    "eisEmployee",
    "pcb",
    "cp38",
    "employerEpf",
    "employerSocso",
    "employerEis",
  ] as const;
  if (statutoryFields.some((field) => Object.hasOwn(values, field))) {
    throw new Error(
      "Direct statutory amount overrides are disabled. Use a controlled statutory source workflow.",
    );
  }
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
