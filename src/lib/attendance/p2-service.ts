import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import type { AttendanceServiceContext } from "@/lib/attendance/employee-service";
import {
  attendanceP2Digest,
  detectAttendanceExceptions,
  type AttendanceP2DetectionInput,
} from "@/lib/attendance/p2-detection";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const reasonSchema = z.string().trim().min(3).max(500);
const expectedDaySchema = z.object({
  branchId: z.string().uuid(),
  membershipId: z.string().uuid(),
  workDate: z.date(),
  kind: z.enum(["WORKDAY", "NOT_SCHEDULED", "REST_DAY", "PUBLIC_HOLIDAY"]),
  source: z.enum(["ROSTER", "FIXED_SCHEDULE", "BRANCH_PATTERN", "MANUAL_EVIDENCE"]),
  expectedStartAt: z.date().nullable(),
  expectedEndAt: z.date().nullable(),
  graceMinutes: z.number().int().min(0).max(240),
  timezoneSnapshot: z.string().trim().min(1).max(100),
  policySnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  evidenceReference: z.string().trim().min(1).max(160).nullable().optional(),
});
const managerResolutionSchema = z.object({
  exceptionId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  type: z.enum(["AUTHORIZED", "UNAUTHORIZED", "CORRECTED", "SCHEDULE_ERROR", "NOT_SCHEDULED", "APPROVED_LEAVE", "EXCLUDED"]),
  reason: reasonSchema,
  correctedClockInAt: z.date().nullable().optional(),
  correctedClockOutAt: z.date().nullable().optional(),
  correctedBreakMinutes: z.number().int().min(0).max(1_440).nullable().optional(),
});
const transactionOptions = { isolationLevel: "Serializable" as const, maxWait: 5_000, timeout: 20_000 };

export class AttendanceP2Error extends Error {
  constructor(
    public readonly code:
      | "OUTSIDE_SCOPE"
      | "INVALID_STATE"
      | "INVALID_RESOLUTION"
      | "CONCURRENT_CHANGE"
      | "SELF_APPROVAL_FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "AttendanceP2Error";
  }
}

export async function recordExpectedAttendance(args: {
  context: AttendanceServiceContext;
  input: unknown;
  database?: PrismaClient;
}) {
  const input = expectedDaySchema.parse(args.input);
  assertBranchScope(args.context, input.branchId);
  validateExpectedTimes(input);
  const database = args.database ?? prisma;
  return database.$transaction(async (transaction) => {
    const member = await transaction.employeeBusinessMembership.findFirst({
      where: { id: input.membershipId, businessId: args.context.businessId },
      select: { id: true },
    });
    const branch = await transaction.branch.findFirst({
      where: { id: input.branchId, businessId: args.context.businessId },
      select: { id: true },
    });
    if (!member || !branch) throw new AttendanceP2Error("OUTSIDE_SCOPE", "Employee or branch is outside the authorized business scope.");
    const current = await transaction.attendanceExpectedDay.findFirst({
      where: {
        businessId: args.context.businessId,
        membershipId: input.membershipId,
        workDate: dateOnly(input.workDate),
        status: "CURRENT",
      },
      orderBy: { revision: "desc" },
    });
    if (current) {
      await transaction.attendanceExpectedDay.update({ where: { id: current.id }, data: { status: "SUPERSEDED" } });
    }
    const expected = await transaction.attendanceExpectedDay.create({
      data: {
        businessId: args.context.businessId,
        branchId: input.branchId,
        membershipId: input.membershipId,
        workDate: dateOnly(input.workDate),
        kind: input.kind,
        source: input.source,
        expectedStartAt: input.expectedStartAt,
        expectedEndAt: input.expectedEndAt,
        graceMinutes: input.graceMinutes,
        timezoneSnapshot: input.timezoneSnapshot,
        policySnapshot: (input.policySnapshot ?? undefined) as Prisma.InputJsonValue | undefined,
        evidenceReference: input.evidenceReference,
        revision: (current?.revision ?? 0) + 1,
        supersedesExpectedDayId: current?.id ?? null,
        createdById: args.context.actor.userId,
      },
    });
    await writeAuditLog({
      businessId: args.context.businessId,
      branchId: input.branchId,
      actor: args.context.actor,
      request: args.context.request,
      action: "ATTENDANCE_EXPECTED_DAY_RECORDED",
      entityType: "AttendanceExpectedDay",
      entityId: expected.id,
      summary: "Expected Attendance evidence was recorded as an immutable version.",
      metadata: { membershipId: input.membershipId, workDate: expected.workDate.toISOString().slice(0, 10), kind: input.kind, source: input.source, revision: expected.revision },
    }, transaction);
    return expected;
  }, transactionOptions);
}

/** Materializes one employee/day from raw session facts, leave and expected evidence. */
export async function materializeAttendanceP2Day(args: {
  context: AttendanceServiceContext;
  membershipId: string;
  workDate: Date;
  database?: PrismaClient;
}) {
  const database = args.database ?? prisma;
  return database.$transaction(
    (transaction) => materializeAttendanceP2DayInTransaction(args, transaction),
    transactionOptions,
  );
}

export async function materializeAttendanceP2DayInTransaction(
  args: { context: AttendanceServiceContext; membershipId: string; workDate: Date },
  transaction: Prisma.TransactionClient,
) {
  const workDate = dateOnly(args.workDate);
  const monthStart = new Date(Date.UTC(workDate.getUTCFullYear(), workDate.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(workDate.getUTCFullYear(), workDate.getUTCMonth() + 1, 1));
  const [expected, sessions, leaveDay, approvedCorrectionCount, assignment] = await Promise.all([
    transaction.attendanceExpectedDay.findFirst({
      where: { businessId: args.context.businessId, membershipId: args.membershipId, workDate, status: "CURRENT" },
      orderBy: { revision: "desc" },
    }),
    transaction.employeeAttendance.findMany({
      where: {
        businessId: args.context.businessId,
        membershipId: args.membershipId,
        branchId: { in: [...args.context.allowedBranchIds] },
        workDate,
      },
      orderBy: [{ clockInAt: "asc" }, { id: "asc" }],
    }),
    transaction.leaveRequestDay.findFirst({
      where: {
        businessId: args.context.businessId,
        membershipId: args.membershipId,
        leaveDate: workDate,
        leaveRequest: { status: "APPROVED" },
      },
      include: { leaveRequest: { select: { id: true } } },
    }),
    transaction.attendanceCorrectionRequest.count({
      where: {
        businessId: args.context.businessId,
        membershipId: args.membershipId,
        status: "APPROVED",
        createdAt: { gte: monthStart, lt: nextMonth },
      },
    }),
    transaction.employeeBranchAssignment.findFirst({
      where: {
        businessId: args.context.businessId,
        membershipId: args.membershipId,
        branchId: { in: [...args.context.allowedBranchIds] },
        status: "ACTIVE",
        effectiveFrom: { lte: workDate },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: workDate } }],
      },
      orderBy: [{ isPrimary: "desc" }, { effectiveFrom: "desc" }],
      select: { branchId: true },
    }),
  ]);
  const branchId = expected?.branchId ?? sessions[0]?.branchId ?? assignment?.branchId;
  if (!branchId || !args.context.allowedBranchIds.includes(branchId)) {
    throw new AttendanceP2Error("OUTSIDE_SCOPE", "Attendance day has no authorized branch evidence.");
  }
  const completedOuts = sessions.flatMap((session) => session.clockOutAt ? [session.clockOutAt] : []);
  const facts = {
    sessionId: sessions.length === 1 ? sessions[0]!.id : null,
    firstClockInAt: sessions[0]?.clockInAt ?? null,
    lastClockOutAt: completedOuts.sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
    totalBreakMinutes: sessions.reduce((sum, item) => sum + item.totalBreakMinutes, 0),
    totalWorkedMinutes: sessions.reduce((sum, item) => sum + item.totalWorkedMinutes, 0),
  };
  const detectionInput: AttendanceP2DetectionInput = {
    businessId: args.context.businessId,
    membershipId: args.membershipId,
    workDate,
    expected: expected ? {
      id: expected.id,
      kind: expected.kind,
      expectedStartAt: expected.expectedStartAt,
      expectedEndAt: expected.expectedEndAt,
      graceMinutes: expected.graceMinutes,
      revision: expected.revision,
    } : null,
    facts,
    leave: leaveDay ? {
      id: leaveDay.leaveRequest.id,
      status: "APPROVED",
      payTreatment: leaveDay.payTreatmentSnapshot,
      emergency: false,
      dayFraction: Number(leaveDay.dayFraction),
    } : null,
    approvedCorrectionCountThisMonth: approvedCorrectionCount,
  };
  const detected = detectAttendanceExceptions(detectionInput);
  const active = await transaction.attendanceP2Exception.findMany({
    where: {
      businessId: args.context.businessId,
      membershipId: args.membershipId,
      workDate,
      status: { in: ["OPEN", "PENDING_EMPLOYEE", "PENDING_MANAGER"] },
    },
  });
  const detectedKeys = new Set(detected.exceptions.map((item) => item.stableKey));
  const obsoleteIds = active.filter((item) => !detectedKeys.has(item.stableKey)).map((item) => item.id);
  if (obsoleteIds.length) {
    await transaction.attendanceP2Exception.updateMany({ where: { id: { in: obsoleteIds } }, data: { status: "CLOSED" } });
  }
  for (const issue of detected.exceptions) {
    await transaction.attendanceP2Exception.upsert({
      where: { stableKey: issue.stableKey },
      create: {
        businessId: args.context.businessId,
        branchId,
        membershipId: args.membershipId,
        workDate,
        type: issue.type,
        stableKey: issue.stableKey,
        expectedDayId: expected?.id ?? null,
        attendanceSessionId: facts.sessionId,
        expectedStartAt: expected?.expectedStartAt ?? null,
        expectedEndAt: expected?.expectedEndAt ?? null,
        actualClockInAt: facts.firstClockInAt,
        actualClockOutAt: facts.lastClockOutAt,
        graceMinutesSnapshot: expected?.graceMinutes ?? 0,
        exceptionMinutes: issue.exceptionMinutes,
        reasonCode: issue.reasonCode,
        sourceDigest: issue.sourceDigest,
      },
      update: {},
    });
  }
  let finalResult = null;
  if (detected.exceptions.length === 0 && detected.suggestedOutcome) {
    finalResult = await appendFinalResult(transaction, {
      businessId: args.context.businessId,
      branchId,
      membershipId: args.membershipId,
      workDate,
      outcome: detected.suggestedOutcome,
      expectedDayKindSnapshot: expected?.kind ?? null,
      expectedDayId: expected?.id ?? null,
      leaveRequestId: leaveDay?.leaveRequest.id ?? null,
      leaveDayFractionSnapshot: leaveDay?.dayFraction ?? null,
      expectedStartAt: expected?.expectedStartAt ?? null,
      expectedEndAt: expected?.expectedEndAt ?? null,
      graceMinutesSnapshot: expected?.graceMinutes ?? 0,
      actualClockInAt: facts.firstClockInAt,
      actualClockOutAt: facts.lastClockOutAt,
      totalBreakMinutes: facts.totalBreakMinutes,
      totalWorkedMinutes: facts.totalWorkedMinutes,
      sourceDigest: detected.sourceDigest,
      resolutionDigest: attendanceP2Digest([]),
      createdById: args.context.actor.userId,
    });
  }
  return { ...detected, finalResult };
}

export async function submitAttendanceCorrectionRequest(args: {
  auth: EmployeeAuthContext;
  exceptionId: string;
  requestedClockInAt?: Date | null;
  requestedClockOutAt?: Date | null;
  reason: string;
  requestKey: string;
  database?: PrismaClient;
}) {
  const reason = reasonSchema.parse(args.reason);
  const requestKey = z.string().trim().min(8).max(160).parse(args.requestKey);
  const database = args.database ?? prisma;
  return database.$transaction(async (transaction) => {
    const issue = await transaction.attendanceP2Exception.findFirst({
      where: {
        id: args.exceptionId,
        businessId: args.auth.businessId,
        membershipId: args.auth.membershipId,
        type: { in: ["MISSING_CLOCK_IN", "MISSING_CLOCK_OUT"] },
        status: { in: ["OPEN", "PENDING_EMPLOYEE"] },
      },
    });
    if (!issue) throw new AttendanceP2Error("INVALID_STATE", "This missing-punch exception is not available for employee correction.");
    const existing = await transaction.attendanceCorrectionRequest.findUnique({ where: { requestKey } });
    if (existing) {
      if (existing.membershipId !== args.auth.membershipId || existing.exceptionId !== issue.id) {
        throw new AttendanceP2Error("INVALID_STATE", "Correction request key belongs to another request.");
      }
      return existing;
    }
    const correction = await transaction.attendanceCorrectionRequest.create({ data: {
      businessId: args.auth.businessId,
      exceptionId: issue.id,
      membershipId: args.auth.membershipId,
      employeeSessionId: args.auth.sessionId,
      requestKey,
      requestedClockInAt: args.requestedClockInAt,
      requestedClockOutAt: args.requestedClockOutAt,
      reason,
    } });
    await transaction.attendanceP2Exception.update({
      where: { id: issue.id },
      data: { status: "PENDING_MANAGER", revision: { increment: 1 } },
    });
    await writeAuditLog({
      businessId: issue.businessId,
      branchId: issue.branchId,
      action: "ATTENDANCE_P2_CORRECTION_REQUESTED",
      entityType: "AttendanceCorrectionRequest",
      entityId: correction.id,
      summary: "Employee requested a missing-punch correction without changing raw Attendance facts.",
      metadata: { membershipId: issue.membershipId, exceptionId: issue.id },
    }, transaction);
    return correction;
  }, transactionOptions);
}

export async function resolveAttendanceP2Exception(args: {
  context: AttendanceServiceContext;
  input: unknown;
  database?: PrismaClient;
}) {
  const input = managerResolutionSchema.parse(args.input);
  const database = args.database ?? prisma;
  return database.$transaction(async (transaction) => {
    const issue = await transaction.attendanceP2Exception.findFirst({
      where: { id: input.exceptionId, businessId: args.context.businessId, branchId: { in: [...args.context.allowedBranchIds] } },
    });
    if (!issue || issue.status === "CLOSED" || issue.status === "RESOLVED") {
      throw new AttendanceP2Error("INVALID_STATE", "Attendance exception is not open in the authorized scope.");
    }
    if (issue.revision !== input.expectedRevision) {
      throw new AttendanceP2Error("CONCURRENT_CHANGE", "Attendance exception changed. Reload before resolving it.");
    }
    const actor = await transaction.user.findFirst({
      where: { id: args.context.actor.userId, businessId: args.context.businessId },
      select: { employeeBusinessMembershipId: true },
    });
    if (actor?.employeeBusinessMembershipId === issue.membershipId) {
      throw new AttendanceP2Error("SELF_APPROVAL_FORBIDDEN", "Employees cannot approve their own Attendance exception.");
    }
    validateResolution(issue.type, input.type);
    const leave = await transaction.leaveRequestDay.findFirst({
      where: { businessId: issue.businessId, membershipId: issue.membershipId, leaveDate: issue.workDate, leaveRequest: { status: "APPROVED" } },
      include: { leaveRequest: { select: { id: true } } },
    });
    const outcome = resolutionOutcome(issue.type, input.type, leave?.payTreatmentSnapshot ?? null);
    const resolution = await transaction.attendanceP2Resolution.create({ data: {
      businessId: issue.businessId,
      exceptionId: issue.id,
      membershipId: issue.membershipId,
      revision: issue.revision + 1,
      type: input.type,
      outcome,
      reason: input.reason,
      correctedClockInAt: input.correctedClockInAt,
      correctedClockOutAt: input.correctedClockOutAt,
      correctedBreakMinutes: input.correctedBreakMinutes,
      createdById: args.context.actor.userId,
    } });
    const now = new Date();
    await transaction.attendanceP2Exception.update({
      where: { id: issue.id },
      data: { status: "RESOLVED", currentResolutionId: resolution.id, resolvedAt: now, revision: issue.revision + 1 },
    });
    await transaction.attendanceCorrectionRequest.updateMany({
      where: { exceptionId: issue.id, status: "PENDING" },
      data: {
        status: input.type === "CORRECTED" ? "APPROVED" : "REJECTED",
        reviewedById: args.context.actor.userId,
        reviewedAt: now,
        reviewReason: input.reason,
      },
    });
    const finalResult = await materializeResolvedDayFinalResult(transaction, issue, args.context.actor.userId);
    await writeAuditLog({
      businessId: issue.businessId,
      branchId: issue.branchId,
      actor: args.context.actor,
      request: args.context.request,
      action: "ATTENDANCE_P2_EXCEPTION_RESOLVED",
      entityType: "AttendanceP2Exception",
      entityId: issue.id,
      summary: "Attendance exception was resolved with immutable evidence and reason.",
      metadata: { resolutionId: resolution.id, type: input.type, outcome, finalResultId: finalResult?.id ?? null },
    }, transaction);
    return { resolution, finalResult };
  }, transactionOptions);
}

export async function getAttendancePeriodReadiness(args: {
  businessId: string;
  allowedBranchIds: readonly string[];
  periodStart: Date;
  periodEndExclusive: Date;
  database?: Pick<PrismaClient, "attendanceP2Exception" | "attendanceCorrectionRequest">;
}) {
  const database = args.database ?? prisma;
  const [openExceptions, repeatedCorrections] = await Promise.all([
    database.attendanceP2Exception.findMany({
      where: {
        businessId: args.businessId,
        branchId: { in: [...args.allowedBranchIds] },
        workDate: { gte: args.periodStart, lt: args.periodEndExclusive },
        status: { in: ["OPEN", "PENDING_EMPLOYEE", "PENDING_MANAGER"] },
      },
      select: { id: true, branchId: true, membershipId: true, workDate: true, type: true, status: true },
      orderBy: [{ workDate: "asc" }, { id: "asc" }],
    }),
    database.attendanceCorrectionRequest.groupBy({
      by: ["membershipId"],
      where: {
        businessId: args.businessId,
        status: "APPROVED",
        createdAt: { gte: args.periodStart, lt: args.periodEndExclusive },
      },
      _count: { _all: true },
      having: { membershipId: { _count: { gte: 3 } } },
    }),
  ]);
  return {
    ready: openExceptions.length === 0,
    blockerCount: openExceptions.length,
    warningCount: repeatedCorrections.length,
    blockers: openExceptions,
    warnings: repeatedCorrections.map((item) => ({ type: "REPEATED_CORRECTION_WARNING" as const, membershipId: item.membershipId, count: item._count._all })),
  };
}

async function materializeResolvedDayFinalResult(
  transaction: Prisma.TransactionClient,
  issue: { businessId: string; branchId: string; membershipId: string; workDate: Date; expectedDayId: string | null; expectedStartAt: Date | null; expectedEndAt: Date | null; graceMinutesSnapshot: number; actualClockInAt: Date | null; actualClockOutAt: Date | null; sourceDigest: string },
  createdById: string,
) {
  const remaining = await transaction.attendanceP2Exception.count({
    where: {
      businessId: issue.businessId,
      membershipId: issue.membershipId,
      workDate: issue.workDate,
      status: { in: ["OPEN", "PENDING_EMPLOYEE", "PENDING_MANAGER"] },
    },
  });
  if (remaining > 0) return null;
  // Query through the day's immutable exception ids without requiring Prisma relations.
  const dayIssues = await transaction.attendanceP2Exception.findMany({
    where: { businessId: issue.businessId, membershipId: issue.membershipId, workDate: issue.workDate, status: "RESOLVED" },
    select: { currentResolutionId: true },
  });
  const resolutionRows = await transaction.attendanceP2Resolution.findMany({
    where: { id: { in: dayIssues.flatMap((item) => item.currentResolutionId ? [item.currentResolutionId] : []) } },
    orderBy: { createdAt: "asc" },
  });
  const chosen = resolutionRows.find((item) => item.outcome === "UNAUTHORIZED_ABSENCE")
    ?? resolutionRows.find((item) => item.outcome === "PRESENT_LATE_UNAUTHORIZED" || item.outcome === "PRESENT_EARLY_UNAUTHORIZED")
    ?? resolutionRows.at(-1);
  if (!chosen) return null;
  const correctedIn = resolutionRows.flatMap((item) => item.correctedClockInAt ? [item.correctedClockInAt] : []).at(-1) ?? issue.actualClockInAt;
  const correctedOut = resolutionRows.flatMap((item) => item.correctedClockOutAt ? [item.correctedClockOutAt] : []).at(-1) ?? issue.actualClockOutAt;
  const correctedBreak = resolutionRows.flatMap((item) => item.correctedBreakMinutes !== null ? [item.correctedBreakMinutes] : []).at(-1) ?? 0;
  const worked = correctedIn && correctedOut && correctedOut > correctedIn
    ? Math.max(0, Math.floor((correctedOut.getTime() - correctedIn.getTime()) / 60_000) - correctedBreak)
    : 0;
  const [leave, expected] = await Promise.all([
    transaction.leaveRequestDay.findFirst({
      where: { businessId: issue.businessId, membershipId: issue.membershipId, leaveDate: issue.workDate, leaveRequest: { status: "APPROVED" } },
      select: { leaveRequestId: true, dayFraction: true },
    }),
    issue.expectedDayId
      ? transaction.attendanceExpectedDay.findFirst({
          where: { id: issue.expectedDayId, businessId: issue.businessId },
          select: { kind: true },
        })
      : Promise.resolve(null),
  ]);
  return appendFinalResult(transaction, {
    businessId: issue.businessId,
    branchId: issue.branchId,
    membershipId: issue.membershipId,
    workDate: issue.workDate,
    outcome: chosen.outcome,
    expectedDayKindSnapshot: expected?.kind ?? null,
    expectedDayId: issue.expectedDayId,
    leaveRequestId: leave?.leaveRequestId ?? null,
    leaveDayFractionSnapshot: leave?.dayFraction ?? null,
    expectedStartAt: issue.expectedStartAt,
    expectedEndAt: issue.expectedEndAt,
    graceMinutesSnapshot: issue.graceMinutesSnapshot,
    actualClockInAt: correctedIn,
    actualClockOutAt: correctedOut,
    totalBreakMinutes: correctedBreak,
    totalWorkedMinutes: worked,
    sourceDigest: issue.sourceDigest,
    resolutionDigest: attendanceP2Digest(resolutionRows.map((item) => [item.id, item.revision, item.type, item.outcome])),
    createdById,
  });
}

type AppendFinalResultInput = Omit<
  Prisma.AttendanceP2FinalResultUncheckedCreateInput,
  "id" | "version" | "supersedesResultId" | "createdAt"
>;

async function appendFinalResult(transaction: Prisma.TransactionClient, data: AppendFinalResultInput) {
  const current = await transaction.attendanceP2FinalResult.findFirst({
    where: { businessId: data.businessId, membershipId: data.membershipId, workDate: data.workDate },
    orderBy: { version: "desc" },
  });
  if (current?.sourceDigest === data.sourceDigest && current.resolutionDigest === data.resolutionDigest && current.outcome === data.outcome) return current;
  return transaction.attendanceP2FinalResult.create({
    data: { ...data, version: (current?.version ?? 0) + 1, supersedesResultId: current?.id ?? null },
  });
}

function validateResolution(exceptionType: string, type: string) {
  const allowed: Record<string, readonly string[]> = {
    MISSING_CLOCK_IN: ["CORRECTED", "AUTHORIZED", "EXCLUDED"],
    MISSING_CLOCK_OUT: ["CORRECTED", "AUTHORIZED", "EXCLUDED"],
    LATE_ARRIVAL: ["AUTHORIZED", "UNAUTHORIZED", "CORRECTED", "SCHEDULE_ERROR", "EXCLUDED"],
    EARLY_DEPARTURE: ["AUTHORIZED", "UNAUTHORIZED", "CORRECTED", "SCHEDULE_ERROR", "EXCLUDED"],
    NO_ATTENDANCE_RECORDED: ["AUTHORIZED", "UNAUTHORIZED", "NOT_SCHEDULED", "SCHEDULE_ERROR", "APPROVED_LEAVE", "EXCLUDED"],
    SUSPECTED_NO_SHOW: ["AUTHORIZED", "UNAUTHORIZED", "NOT_SCHEDULED", "SCHEDULE_ERROR", "APPROVED_LEAVE", "EXCLUDED"],
    LEAVE_ATTENDANCE_CONFLICT: ["CORRECTED", "APPROVED_LEAVE", "EXCLUDED"],
  };
  if (!allowed[exceptionType]?.includes(type)) throw new AttendanceP2Error("INVALID_RESOLUTION", "Resolution type is not valid for this Attendance exception.");
}

function resolutionOutcome(exceptionType: string, type: string, leavePayTreatment: "PAID" | "UNPAID" | null) {
  if (type === "APPROVED_LEAVE") {
    if (!leavePayTreatment) throw new AttendanceP2Error("INVALID_RESOLUTION", "Approved leave resolution requires an approved Leave-domain record.");
    return leavePayTreatment === "PAID" ? "APPROVED_PAID_LEAVE" as const : "APPROVED_UNPAID_LEAVE" as const;
  }
  if (type === "EXCLUDED") return "EXCLUDED" as const;
  if (type === "NOT_SCHEDULED" || type === "SCHEDULE_ERROR") return "NOT_SCHEDULED" as const;
  if (exceptionType === "LATE_ARRIVAL") return type === "UNAUTHORIZED" ? "PRESENT_LATE_UNAUTHORIZED" as const : "PRESENT_LATE_AUTHORIZED" as const;
  if (exceptionType === "EARLY_DEPARTURE") return type === "UNAUTHORIZED" ? "PRESENT_EARLY_UNAUTHORIZED" as const : "PRESENT_EARLY_AUTHORIZED" as const;
  if (exceptionType === "NO_ATTENDANCE_RECORDED" || exceptionType === "SUSPECTED_NO_SHOW") {
    return type === "UNAUTHORIZED" ? "UNAUTHORIZED_ABSENCE" as const : "AUTHORIZED_ABSENCE" as const;
  }
  return "PRESENT" as const;
}

function validateExpectedTimes(input: z.infer<typeof expectedDaySchema>) {
  if (input.kind === "WORKDAY") {
    if (!input.expectedStartAt || !input.expectedEndAt || input.expectedEndAt <= input.expectedStartAt) {
      throw new AttendanceP2Error("INVALID_STATE", "Workday evidence requires a valid expected start and end time.");
    }
  } else if (input.expectedStartAt || input.expectedEndAt) {
    throw new AttendanceP2Error("INVALID_STATE", "Non-workday evidence cannot contain expected work times.");
  }
}

function assertBranchScope(context: AttendanceServiceContext, branchId: string) {
  if (!context.allowedBranchIds.includes(branchId)) throw new AttendanceP2Error("OUTSIDE_SCOPE", "Branch is outside the authorized Attendance scope.");
}

function dateOnly(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
