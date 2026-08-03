import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { AttendanceServiceContext } from "@/lib/attendance/employee-service";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const reasonSchema = z.string().trim().min(3).max(500);
const transactionOptions = {
  isolationLevel: "Serializable" as const,
  maxWait: 5_000,
  timeout: 20_000,
};

const monthlyTimesheetSessionSelect = Prisma.validator<Prisma.EmployeeAttendanceSelect>()({
  id: true,
  businessId: true,
  branchId: true,
  membershipId: true,
  workDate: true,
  status: true,
  updatedAt: true,
  membership: {
    select: { fullName: true, employeeCode: true },
  },
  resolutionCase: {
    select: {
      id: true,
      status: true,
      currentFinalResultId: true,
      currentFinalResult: {
        select: {
          id: true,
          version: true,
          disposition: true,
          workDate: true,
          clockInAt: true,
          clockOutAt: true,
          totalBreakMinutes: true,
          totalWorkedMinutes: true,
          evidenceChecksum: true,
        },
      },
    },
  },
});

type TimesheetDatabase = Pick<
  PrismaClient,
  | "branch"
  | "employeeAttendance"
  | "attendanceMonthlyTimesheet"
  | "attendanceTimesheetBranchReadiness"
  | "attendanceTimesheetRevision"
>;

export type AttendanceTimesheetContext = AttendanceServiceContext & {
  wholeBusinessScope: boolean;
};

export class AttendanceTimesheetError extends Error {
  constructor(
    public readonly code:
      | "BRANCH_NOT_FOUND"
      | "BLOCKERS_REMAIN"
      | "NOT_ALL_BRANCHES_READY"
      | "TIMESHEET_LOCKED"
      | "TIMESHEET_NOT_LOCKED"
      | "NO_SOURCE_CHANGE"
      | "WHOLE_BUSINESS_REQUIRED"
      | "CONCURRENT_CHANGE",
    message: string,
  ) {
    super(message);
    this.name = "AttendanceTimesheetError";
  }
}

export function parseAttendanceTimesheetMonth(value: string) {
  const month = monthSchema.parse(value);
  const [year, monthNumber] = month.split("-").map(Number);
  return {
    month,
    periodStart: new Date(Date.UTC(year, monthNumber - 1, 1)),
    periodEndExclusive: new Date(Date.UTC(year, monthNumber, 1)),
  };
}

export async function loadMonthlyAttendanceTimesheet(args: {
  businessId: string;
  allowedBranchIds: readonly string[];
  month: string;
  database?: TimesheetDatabase;
}) {
  const database = args.database ?? prisma;
  const period = parseAttendanceTimesheetMonth(args.month);
  const [branches, sessions, timesheet] = await Promise.all([
    database.branch.findMany({
      where: {
        businessId: args.businessId,
        status: "ACTIVE",
        id: { in: [...args.allowedBranchIds] },
      },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    database.employeeAttendance.findMany({
      where: {
        businessId: args.businessId,
        branchId: { in: [...args.allowedBranchIds] },
        workDate: {
          gte: period.periodStart,
          lt: period.periodEndExclusive,
        },
      },
      select: monthlyTimesheetSessionSelect,
      orderBy: [{ workDate: "asc" }, { id: "asc" }],
    }),
    database.attendanceMonthlyTimesheet.findUnique({
      where: {
        businessId_periodStart: {
          businessId: args.businessId,
          periodStart: period.periodStart,
        },
      },
      include: {
        branchReadiness: true,
        currentRevision: {
          select: {
            id: true,
            revision: true,
            sourceDigest: true,
            reason: true,
            lockedAt: true,
            lockedBy: { select: { name: true } },
            _count: { select: { entries: true } },
          },
        },
        revisions: {
          select: {
            id: true,
            revision: true,
            reason: true,
            lockedAt: true,
            lockedBy: { select: { name: true } },
            _count: { select: { entries: true } },
          },
          orderBy: { revision: "desc" },
        },
      },
    }),
  ]);

  const readinessByBranch = new Map(
    timesheet?.branchReadiness.map((item) => [item.branchId, item]) ?? [],
  );
  const branchStates = branches.map((branch) => {
    const branchSessions = sessions.filter((session) => session.branchId === branch.id);
    const state = summarizeBranch(branch.id, branch.name, branchSessions);
    const persisted = readinessByBranch.get(branch.id);
    const ready = Boolean(
      persisted?.status === "READY" &&
        persisted.sourceDigest === state.sourceDigest &&
        state.blockerCount === 0,
    );
    return {
      ...state,
      readinessStatus: ready ? ("READY" as const) : ("NOT_READY" as const),
      stale: Boolean(persisted?.status === "READY" && !ready),
      readyAt: ready ? persisted?.readyAt ?? null : null,
      readyById: ready ? persisted?.readyById ?? null : null,
    };
  });
  const currentSourceDigest = digest(
    branchStates.map((branch) => [branch.branchId, branch.sourceDigest]),
  );

  return {
    period,
    timesheet,
    branches: branchStates,
    totals: {
      sessions: branchStates.reduce((sum, branch) => sum + branch.sessionCount, 0),
      included: branchStates.reduce((sum, branch) => sum + branch.includedCount, 0),
      excluded: branchStates.reduce((sum, branch) => sum + branch.excludedCount, 0),
      blockers: branchStates.reduce((sum, branch) => sum + branch.blockerCount, 0),
      readyBranches: branchStates.filter((branch) => branch.readinessStatus === "READY").length,
      totalBranches: branchStates.length,
      workedMinutes: branchStates.reduce((sum, branch) => sum + branch.workedMinutes, 0),
    },
    currentSourceDigest,
    allBranchesReady:
      branchStates.length > 0 &&
      branchStates.every((branch) => branch.readinessStatus === "READY"),
  };
}

export async function markAttendanceTimesheetBranchReady(args: {
  context: AttendanceTimesheetContext;
  month: string;
  branchId: string;
  database?: PrismaClient;
}) {
  const database = args.database ?? prisma;
  return database.$transaction(async (transaction) => {
    const snapshot = await loadMonthlyAttendanceTimesheet({
      businessId: args.context.businessId,
      allowedBranchIds: args.context.allowedBranchIds,
      month: args.month,
      database: transaction,
    });
    const branch = snapshot.branches.find((item) => item.branchId === args.branchId);
    if (!branch) {
      throw new AttendanceTimesheetError("BRANCH_NOT_FOUND", "Branch is outside the authorized Attendance scope.");
    }
    if (snapshot.timesheet?.status === "LOCKED") {
      throw new AttendanceTimesheetError("TIMESHEET_LOCKED", "Start a controlled revision before changing a locked Timesheet.");
    }
    if (branch.blockerCount > 0) {
      throw new AttendanceTimesheetError("BLOCKERS_REMAIN", "Resolve all Attendance blockers before marking this branch ready.");
    }
    const timesheet = await transaction.attendanceMonthlyTimesheet.upsert({
      where: {
        businessId_periodStart: {
          businessId: args.context.businessId,
          periodStart: snapshot.period.periodStart,
        },
      },
      create: {
        businessId: args.context.businessId,
        periodStart: snapshot.period.periodStart,
      },
      update: {},
    });
    await transaction.attendanceTimesheetBranchReadiness.upsert({
      where: {
        timesheetId_branchId: { timesheetId: timesheet.id, branchId: branch.branchId },
      },
      create: {
        timesheetId: timesheet.id,
        businessId: args.context.businessId,
        branchId: branch.branchId,
        status: "READY",
        sourceDigest: branch.sourceDigest,
        readyAt: new Date(),
        readyById: args.context.actor.userId,
      },
      update: {
        status: "READY",
        sourceDigest: branch.sourceDigest,
        readyAt: new Date(),
        readyById: args.context.actor.userId,
      },
    });
    await writeAuditLog({
      businessId: args.context.businessId,
      branchId: branch.branchId,
      actor: args.context.actor,
      request: args.context.request,
      action: "ATTENDANCE_TIMESHEET_BRANCH_READY",
      entityType: "AttendanceMonthlyTimesheet",
      entityId: timesheet.id,
      summary: "Attendance Timesheet branch marked ready from current Final Attendance Results.",
      metadata: { month: args.month, sourceDigest: branch.sourceDigest, sessionCount: branch.sessionCount },
    }, transaction);
    return { timesheetId: timesheet.id, branchId: branch.branchId };
  }, transactionOptions);
}

export async function lockMonthlyAttendanceTimesheet(args: {
  context: AttendanceTimesheetContext;
  month: string;
  reason: string;
  expectedUpdatedAt?: string;
  database?: PrismaClient;
}) {
  const database = args.database ?? prisma;
  const reason = reasonSchema.parse(args.reason);
  assertWholeBusiness(args.context);
  return database.$transaction(async (transaction) => {
    const snapshot = await loadMonthlyAttendanceTimesheet({
      businessId: args.context.businessId,
      allowedBranchIds: args.context.allowedBranchIds,
      month: args.month,
      database: transaction,
    });
    if (!snapshot.timesheet) {
      throw new AttendanceTimesheetError("NOT_ALL_BRANCHES_READY", "Every active branch must be marked ready before the Timesheet can be locked.");
    }
    if (snapshot.timesheet.status === "LOCKED") {
      throw new AttendanceTimesheetError("TIMESHEET_LOCKED", "This monthly Timesheet is already locked.");
    }
    if (args.expectedUpdatedAt && snapshot.timesheet.updatedAt.toISOString() !== args.expectedUpdatedAt) {
      throw new AttendanceTimesheetError("CONCURRENT_CHANGE", "The Timesheet changed. Reload before locking it.");
    }
    if (snapshot.totals.blockers > 0 || !snapshot.allBranchesReady) {
      throw new AttendanceTimesheetError("NOT_ALL_BRANCHES_READY", "All active branches must be blocker-free and ready using the latest Final Attendance Results.");
    }
    const latestRevision = await transaction.attendanceTimesheetRevision.findFirst({
      where: { timesheetId: snapshot.timesheet.id },
      orderBy: { revision: "desc" },
      select: { revision: true },
    });
    const revision = await transaction.attendanceTimesheetRevision.create({
      data: {
        timesheetId: snapshot.timesheet.id,
        businessId: args.context.businessId,
        revision: (latestRevision?.revision ?? 0) + 1,
        periodStart: snapshot.period.periodStart,
        sourceDigest: snapshot.currentSourceDigest,
        reason,
        lockedById: args.context.actor.userId,
      },
    });
    const entries = snapshot.branches.flatMap((branch) => branch.results);
    if (entries.length) {
      await transaction.attendanceTimesheetRevisionEntry.createMany({
        data: entries.map((entry) => ({
          revisionId: revision.id,
          businessId: args.context.businessId,
          branchId: entry.branchId,
          employeeId: entry.employeeId,
          attendanceSessionId: entry.attendanceSessionId,
          finalResultId: entry.finalResultId,
          finalResultVersion: entry.finalResultVersion,
          disposition: entry.disposition,
          workDate: entry.workDate,
          clockInAt: entry.clockInAt,
          clockOutAt: entry.clockOutAt,
          totalBreakMinutes: entry.totalBreakMinutes,
          totalWorkedMinutes: entry.totalWorkedMinutes,
          finalResultChecksum: entry.finalResultChecksum,
        })),
      });
    }
    await transaction.attendanceMonthlyTimesheet.update({
      where: { id: snapshot.timesheet.id },
      data: { status: "LOCKED", currentRevisionId: revision.id, revisionReason: null },
    });
    await writeAuditLog({
      businessId: args.context.businessId,
      actor: args.context.actor,
      request: args.context.request,
      action: "ATTENDANCE_TIMESHEET_LOCKED",
      entityType: "AttendanceTimesheetRevision",
      entityId: revision.id,
      summary: "Monthly Attendance Timesheet approved and locked as an immutable revision.",
      after: { revision: revision.revision, month: args.month, entryCount: entries.length },
      metadata: { sourceDigest: snapshot.currentSourceDigest, reason },
    }, transaction);
    return { timesheetId: snapshot.timesheet.id, revisionId: revision.id, revision: revision.revision };
  }, transactionOptions);
}

export async function beginMonthlyAttendanceTimesheetRevision(args: {
  context: AttendanceTimesheetContext;
  month: string;
  reason: string;
  expectedUpdatedAt?: string;
  database?: PrismaClient;
}) {
  const database = args.database ?? prisma;
  const reason = reasonSchema.parse(args.reason);
  assertWholeBusiness(args.context);
  return database.$transaction(async (transaction) => {
    const snapshot = await loadMonthlyAttendanceTimesheet({
      businessId: args.context.businessId,
      allowedBranchIds: args.context.allowedBranchIds,
      month: args.month,
      database: transaction,
    });
    if (!snapshot.timesheet || snapshot.timesheet.status !== "LOCKED" || !snapshot.timesheet.currentRevision) {
      throw new AttendanceTimesheetError("TIMESHEET_NOT_LOCKED", "Only a locked Timesheet can start a revision.");
    }
    if (args.expectedUpdatedAt && snapshot.timesheet.updatedAt.toISOString() !== args.expectedUpdatedAt) {
      throw new AttendanceTimesheetError("CONCURRENT_CHANGE", "The Timesheet changed. Reload before starting a revision.");
    }
    if (snapshot.currentSourceDigest === snapshot.timesheet.currentRevision.sourceDigest) {
      throw new AttendanceTimesheetError("NO_SOURCE_CHANGE", "No Final Attendance Result has changed since the locked revision.");
    }
    await transaction.attendanceTimesheetBranchReadiness.updateMany({
      where: { timesheetId: snapshot.timesheet.id },
      data: { status: "NOT_READY", sourceDigest: null, readyAt: null, readyById: null },
    });
    await transaction.attendanceMonthlyTimesheet.update({
      where: { id: snapshot.timesheet.id },
      data: { status: "DRAFT", currentRevisionId: null, revisionReason: reason },
    });
    await writeAuditLog({
      businessId: args.context.businessId,
      actor: args.context.actor,
      request: args.context.request,
      action: "ATTENDANCE_TIMESHEET_REVISION_STARTED",
      entityType: "AttendanceMonthlyTimesheet",
      entityId: snapshot.timesheet.id,
      summary: "A controlled Attendance Timesheet revision was started; prior locked revisions remain immutable.",
      metadata: { month: args.month, priorRevision: snapshot.timesheet.currentRevision.revision, reason },
    }, transaction);
    return { timesheetId: snapshot.timesheet.id };
  }, transactionOptions);
}

function summarizeBranch(
  branchId: string,
  branchName: string,
  sessions: Prisma.EmployeeAttendanceGetPayload<{
    select: typeof monthlyTimesheetSessionSelect;
  }>[],
) {
  const blockers = sessions.filter((session) =>
    !session.resolutionCase ||
    session.resolutionCase.status !== "RESOLVED" ||
    !session.resolutionCase.currentFinalResult,
  );
  const results = sessions.flatMap((session) => {
    const result = session.resolutionCase?.currentFinalResult;
    return result ? [{
      branchId: session.branchId,
      employeeId: session.membershipId,
      employeeName: session.membership.fullName,
      employeeCode: session.membership.employeeCode,
      attendanceSessionId: session.id,
      finalResultId: result.id,
      finalResultVersion: result.version,
      disposition: result.disposition,
      workDate: result.workDate,
      clockInAt: result.clockInAt,
      clockOutAt: result.clockOutAt,
      totalBreakMinutes: result.totalBreakMinutes,
      totalWorkedMinutes: result.totalWorkedMinutes,
      finalResultChecksum: result.evidenceChecksum,
    }] : [];
  });
  const sourceDigest = digest(sessions.map((session) => [
    session.id,
    session.status,
    session.updatedAt.toISOString(),
    session.resolutionCase?.id ?? null,
    session.resolutionCase?.status ?? null,
    session.resolutionCase?.currentFinalResult?.id ?? null,
    session.resolutionCase?.currentFinalResult?.version ?? null,
    session.resolutionCase?.currentFinalResult?.evidenceChecksum ?? null,
  ]));
  return {
    branchId,
    branchName,
    sourceDigest,
    sessionCount: sessions.length,
    includedCount: results.filter((result) => result.disposition === "INCLUDED").length,
    excludedCount: results.filter((result) => result.disposition === "EXCLUDED").length,
    blockerCount: blockers.length,
    workedMinutes: results.filter((result) => result.disposition === "INCLUDED").reduce((sum, result) => sum + result.totalWorkedMinutes, 0),
    blockers: blockers.map((session) => ({
      attendanceSessionId: session.id,
      employeeId: session.membershipId,
      employeeName: session.membership.fullName,
      employeeCode: session.membership.employeeCode,
      workDate: session.workDate,
      sessionStatus: session.status,
      resolutionStatus: session.resolutionCase?.status ?? null,
    })),
    results,
  };
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function assertWholeBusiness(context: AttendanceTimesheetContext) {
  if (!context.wholeBusinessScope) {
    throw new AttendanceTimesheetError("WHOLE_BUSINESS_REQUIRED", "Whole-business Attendance scope is required to approve or revise a monthly Timesheet.");
  }
}
