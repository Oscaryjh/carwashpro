import { createHash, randomUUID } from "node:crypto";
import {
  AttendanceOvertimeApprovalStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { z } from "zod";
import type { AttendanceServiceContext } from "@/lib/attendance/employee-service";
import {
  listAttendanceOvertimeCandidates,
  type OvertimeCandidate,
} from "@/lib/attendance/overtime-service";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  getAttendancePeriodReadiness,
  materializeAttendanceP2DayInTransaction,
} from "@/lib/attendance/p2-service";
import { getBranchLocalDateKey } from "@/lib/attendance/work-date";
import {
  AttendanceSegmentationError,
  localDateToSnapshotDate,
  segmentAttendanceWork,
  type AttendanceBreakInterval,
} from "@/lib/attendance/cross-midnight-segmentation";

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
  | "attendanceP2Exception"
  | "attendanceCorrectionRequest"
  | "attendanceP2FinalResult"
  | "attendanceTimesheetP2DaySnapshot"
  | "attendanceTimesheetP2SegmentSnapshot"
  | "attendancePunch"
  | "attendanceOvertimeReview"
  | "employeeBusinessMembership"
  | "attendanceExpectedDay"
  | "leaveRequest"
  | "leaveStatutoryRuleSet"
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
      | "TIMESHEET_NOT_APPROVED"
      | "APPROVAL_STALE"
      | "WHOLE_BUSINESS_REQUIRED"
      | "SEGMENTATION_BLOCKED"
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
  const [branches, sessions, timesheet, p2Readiness, p2FinalRows, overtimeCandidates] = await Promise.all([
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
            p2SegmentSnapshots: {
              orderBy: [
                { localDate: "asc" },
                { startAt: "asc" },
                { segmentIndex: "asc" },
              ],
              select: {
                localDate: true,
                startAt: true,
                endAt: true,
                timezoneSnapshot: true,
                context: true,
                isRestDay: true,
                isPublicHoliday: true,
                breakMinutes: true,
                workedMinutes: true,
                approvedOtMinutes: true,
              },
            },
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
    getAttendancePeriodReadiness({
      businessId: args.businessId,
      allowedBranchIds: args.allowedBranchIds,
      periodStart: period.periodStart,
      periodEndExclusive: period.periodEndExclusive,
      database,
    }),
    database.attendanceP2FinalResult.findMany({
      where: {
        businessId: args.businessId,
        branchId: { in: [...args.allowedBranchIds] },
        workDate: { gte: period.periodStart, lt: period.periodEndExclusive },
      },
      orderBy: [{ membershipId: "asc" }, { workDate: "asc" }, { version: "desc" }],
    }),
    listAttendanceOvertimeCandidates({
      businessId: args.businessId,
      allowedBranchIds: args.allowedBranchIds,
      periodStart: period.periodStart,
      periodEndExclusive: period.periodEndExclusive,
      database,
    }),
  ]);

  const latestP2Results = [...new Map(
    p2FinalRows.map((item) => [`${item.membershipId}:${item.workDate.toISOString().slice(0, 10)}`, item]),
  ).values()];

  const readinessByBranch = new Map(
    timesheet?.branchReadiness.map((item) => [item.branchId, item]) ?? [],
  );
  const branchStates = branches.map((branch) => {
    const branchSessions = sessions.filter((session) => session.branchId === branch.id);
    const state = summarizeBranch(
      branch.id,
      branch.name,
      branchSessions,
      p2Readiness.blockers.filter((item) => item.branchId === branch.id),
      latestP2Results.filter((item) => item.branchId === branch.id),
      overtimeCandidates.filter((item) => item.branchId === branch.id),
    );
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
      warnings: p2Readiness.warningCount,
      p2FinalDays: latestP2Results.length,
    },
    currentSourceDigest,
    allBranchesReady:
      branchStates.length > 0 &&
      branchStates.every((branch) => branch.readinessStatus === "READY"),
  };
}

export async function approveMonthlyAttendanceTimesheet(args: {
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
    if (!snapshot.timesheet || snapshot.timesheet.status !== "DRAFT") {
      throw new AttendanceTimesheetError("TIMESHEET_LOCKED", "Only a draft monthly Timesheet can be approved.");
    }
    if (args.expectedUpdatedAt && snapshot.timesheet.updatedAt.toISOString() !== args.expectedUpdatedAt) {
      throw new AttendanceTimesheetError("CONCURRENT_CHANGE", "The Timesheet changed. Reload before approving it.");
    }
    if (snapshot.totals.blockers > 0 || !snapshot.allBranchesReady) {
      throw new AttendanceTimesheetError("NOT_ALL_BRANCHES_READY", "All active branches must be blocker-free and ready before approval.");
    }
    const approved = await transaction.attendanceMonthlyTimesheet.update({
      where: { id: snapshot.timesheet.id },
      data: {
        status: "APPROVED",
        approvalRevision: { increment: 1 },
        approvalSourceDigest: snapshot.currentSourceDigest,
        approvalReason: reason,
        approvedAt: new Date(),
        approvedById: args.context.actor.userId,
      },
    });
    await writeAuditLog({
      businessId: args.context.businessId,
      actor: args.context.actor,
      request: args.context.request,
      action: "ATTENDANCE_TIMESHEET_APPROVED",
      entityType: "AttendanceMonthlyTimesheet",
      entityId: approved.id,
      summary: "Monthly Attendance Timesheet was approved independently from locking.",
      metadata: { month: args.month, approvalRevision: approved.approvalRevision, sourceDigest: snapshot.currentSourceDigest, reason },
    }, transaction);
    return { timesheetId: approved.id, approvalRevision: approved.approvalRevision };
  }, transactionOptions);
}

export async function markAttendanceTimesheetBranchReady(args: {
  context: AttendanceTimesheetContext;
  month: string;
  branchId: string;
  database?: PrismaClient;
}) {
  const database = args.database ?? prisma;
  // Commit roster/leave-backed P2 materialization before the readiness check.
  // If blockers are detected, the following transaction intentionally rejects
  // while these canonical exception records remain available for resolution.
  await database.$transaction(async (transaction) => {
    const initialSnapshot = await loadMonthlyAttendanceTimesheet({
      businessId: args.context.businessId,
      allowedBranchIds: args.context.allowedBranchIds,
      month: args.month,
      database: transaction,
    });
    const initialBranch = initialSnapshot.branches.find((item) => item.branchId === args.branchId);
    if (!initialBranch) {
      throw new AttendanceTimesheetError("BRANCH_NOT_FOUND", "Branch is outside the authorized Attendance scope.");
    }
    if (initialSnapshot.timesheet?.status === "LOCKED" || initialSnapshot.timesheet?.status === "APPROVED") {
      throw new AttendanceTimesheetError("TIMESHEET_LOCKED", "Start a controlled revision before changing a locked Timesheet.");
    }
    await materializeBranchP2Coverage({
      context: args.context,
      branchId: args.branchId,
      periodStart: initialSnapshot.period.periodStart,
      periodEndExclusive: initialSnapshot.period.periodEndExclusive,
      transaction,
    });
  }, transactionOptions);
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
    if (snapshot.timesheet?.status === "LOCKED" || snapshot.timesheet?.status === "APPROVED") {
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

async function materializeBranchP2Coverage(args: {
  context: AttendanceTimesheetContext;
  branchId: string;
  periodStart: Date;
  periodEndExclusive: Date;
  transaction: Prisma.TransactionClient;
}) {
  const [expectedDays, leaveDays] = await Promise.all([
    args.transaction.attendanceExpectedDay.findMany({
      where: {
        businessId: args.context.businessId,
        branchId: args.branchId,
        workDate: { gte: args.periodStart, lt: args.periodEndExclusive },
        status: "CURRENT",
      },
      select: { membershipId: true, workDate: true },
    }),
    args.transaction.leaveRequestDay.findMany({
      where: {
        businessId: args.context.businessId,
        leaveDate: { gte: args.periodStart, lt: args.periodEndExclusive },
        leaveRequest: { status: "APPROVED", branchId: args.branchId },
      },
      select: { membershipId: true, leaveDate: true },
    }),
  ]);
  const coverage = new Map<string, { membershipId: string; workDate: Date }>();
  for (const item of expectedDays) {
    coverage.set(`${item.membershipId}:${dateKey(item.workDate)}`, item);
  }
  for (const item of leaveDays) {
    coverage.set(`${item.membershipId}:${dateKey(item.leaveDate)}`, {
      membershipId: item.membershipId,
      workDate: item.leaveDate,
    });
  }
  for (const item of coverage.values()) {
    await materializeAttendanceP2DayInTransaction({
      context: args.context,
      membershipId: item.membershipId,
      workDate: item.workDate,
    }, args.transaction);
  }
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
    if (snapshot.timesheet.status !== "APPROVED" || !snapshot.timesheet.approvalSourceDigest) {
      throw new AttendanceTimesheetError("TIMESHEET_NOT_APPROVED", "Approve the blocker-free monthly Timesheet before locking it.");
    }
    if (args.expectedUpdatedAt && snapshot.timesheet.updatedAt.toISOString() !== args.expectedUpdatedAt) {
      throw new AttendanceTimesheetError("CONCURRENT_CHANGE", "The Timesheet changed. Reload before locking it.");
    }
    if (snapshot.totals.blockers > 0 || !snapshot.allBranchesReady) {
      throw new AttendanceTimesheetError("NOT_ALL_BRANCHES_READY", "All active branches must be blocker-free and ready using the latest Final Attendance Results.");
    }
    if (snapshot.timesheet.approvalSourceDigest !== snapshot.currentSourceDigest) {
      throw new AttendanceTimesheetError("APPROVAL_STALE", "Attendance evidence changed after approval. Reopen and approve again before locking.");
    }
    const latestRevision = await transaction.attendanceTimesheetRevision.findFirst({
      where: { timesheetId: snapshot.timesheet.id },
      orderBy: { revision: "desc" },
      select: { revision: true },
    });
    const revision = {
      id: randomUUID(),
      revision: (latestRevision?.revision ?? 0) + 1,
    };
    const entries = snapshot.branches.flatMap((branch) => branch.results);
    const p2Entries = snapshot.branches.flatMap((branch) => branch.p2Results);
    const overtimeByMemberDate = new Map(
      snapshot.branches.flatMap((branch) => branch.overtimeCandidates).map((candidate) => [
        `${candidate.membershipId}:${dateKey(candidate.workDate)}`,
        candidate,
      ]),
    );
    const membershipIds = [...new Set([
      ...entries.map((entry) => entry.employeeId),
      ...p2Entries.map((entry) => entry.membershipId),
    ])];
    const segmentContextP2Rows = membershipIds.length
      ? await transaction.attendanceP2FinalResult.findMany({
          where: {
            businessId: args.context.businessId,
            membershipId: { in: membershipIds },
            workDate: {
              gte: snapshot.period.periodStart,
              lt: new Date(snapshot.period.periodEndExclusive.getTime() + 8 * 86_400_000),
            },
          },
          orderBy: [
            { membershipId: "asc" },
            { workDate: "asc" },
            { version: "desc" },
          ],
        })
      : [];
    const segmentContextP2ByMemberDate = new Map<string, (typeof segmentContextP2Rows)[number]>();
    for (const result of segmentContextP2Rows) {
      const key = `${result.membershipId}:${dateKey(result.workDate)}`;
      if (!segmentContextP2ByMemberDate.has(key)) segmentContextP2ByMemberDate.set(key, result);
    }
    const leaveRequestIds = [...new Set([
      ...p2Entries.flatMap((entry) => entry.leaveRequestId ? [entry.leaveRequestId] : []),
      ...segmentContextP2Rows.flatMap((entry) => entry.leaveRequestId ? [entry.leaveRequestId] : []),
    ])];
    const leaveRequests = leaveRequestIds.length
      ? await transaction.leaveRequest.findMany({
          where: {
            businessId: args.context.businessId,
            id: { in: leaveRequestIds },
          },
          select: {
            id: true,
            membershipId: true,
            branchId: true,
            policyId: true,
            policyVersionId: true,
            policyNameSnapshot: true,
            payTreatmentSnapshot: true,
            leaveUnit: true,
            legalStatusSnapshot: true,
            jurisdictionCodeSnapshot: true,
            statutoryRuleSetVersionSnapshot: true,
            statutoryCategorySnapshot: true,
            statutoryEligibilitySnapshot: true,
            statutoryPayTreatmentSnapshot: true,
            complianceStatusSnapshot: true,
            revision: true,
            decisionDigest: true,
            status: true,
          },
        })
      : [];
    const leaveRequestById = new Map(leaveRequests.map((request) => [request.id, request]));
    const statutoryRuleRefs = [...new Map(
      leaveRequests.flatMap((request) =>
        request.jurisdictionCodeSnapshot && request.statutoryRuleSetVersionSnapshot
          ? [[
              `${request.jurisdictionCodeSnapshot}:${request.statutoryRuleSetVersionSnapshot}`,
              {
                jurisdictionCode: request.jurisdictionCodeSnapshot,
                version: request.statutoryRuleSetVersionSnapshot,
              },
            ] as const]
          : [],
      ),
    ).values()];
    const statutoryRuleSets = statutoryRuleRefs.length
      ? await transaction.leaveStatutoryRuleSet.findMany({
          where: {
            businessId: args.context.businessId,
            OR: statutoryRuleRefs,
          },
          select: { jurisdictionCode: true, version: true, status: true },
        })
      : [];
    const statutoryRuleStatusByRef = new Map(
      statutoryRuleSets.flatMap((ruleSet) =>
        ruleSet.jurisdictionCode
          ? [[`${ruleSet.jurisdictionCode}:${ruleSet.version}`, ruleSet.status] as const]
          : [],
      ),
    );
    const currentExpectedDays = membershipIds.length
      ? await transaction.attendanceExpectedDay.findMany({
          where: {
            businessId: args.context.businessId,
            membershipId: { in: membershipIds },
            workDate: {
              gte: snapshot.period.periodStart,
              lt: new Date(snapshot.period.periodEndExclusive.getTime() + 8 * 86_400_000),
            },
            status: "CURRENT",
          },
          select: {
            id: true,
            membershipId: true,
            workDate: true,
            kind: true,
            expectedStartAt: true,
            expectedEndAt: true,
            timezoneSnapshot: true,
            policySnapshot: true,
          },
        })
      : [];
    const expectedDayByMemberDate = new Map(
      currentExpectedDays.map((expectedDay) => [
        `${expectedDay.membershipId}:${dateKey(expectedDay.workDate)}`,
        expectedDay,
      ]),
    );
    const holidayContextByMemberDate = new Map<string, Prisma.InputJsonObject>(
      currentExpectedDays
        .flatMap((expectedDay) => {
          const holiday = readHolidayContext(expectedDay.policySnapshot);
          return holiday ? [[`${expectedDay.membershipId}:${dateKey(expectedDay.workDate)}`, holiday] as const] : [];
        }),
    );
    const attendanceIdByMemberDate = new Map(
      entries.map((entry) => [
        `${entry.employeeId}:${dateKey(entry.workDate)}`,
        entry.attendanceSessionId,
      ]),
    );
    const sourceAttendanceIds = [...new Set(attendanceIdByMemberDate.values())];
    const breakPunches = sourceAttendanceIds.length
      ? await transaction.attendancePunch.findMany({
          where: {
            businessId: args.context.businessId,
            attendanceSessionId: { in: sourceAttendanceIds },
            type: { in: ["BREAK_START", "BREAK_END"] },
          },
          select: {
            id: true,
            attendanceSessionId: true,
            type: true,
            serverTimestamp: true,
          },
          orderBy: [{ attendanceSessionId: "asc" }, { serverTimestamp: "asc" }, { id: "asc" }],
        })
      : [];
    const breakIntervalsByAttendanceId = pairBreakPunches(breakPunches);
    const p2DayRows: Prisma.AttendanceTimesheetP2DaySnapshotCreateManyInput[] = [];
    const segmentRows: Prisma.AttendanceTimesheetP2SegmentSnapshotCreateManyInput[] = [];
    for (const entry of p2Entries) {
      const entryKey = `${entry.membershipId}:${dateKey(entry.workDate)}`;
      const expectedDay = expectedDayByMemberDate.get(entryKey);
      const leaveRequest = entry.leaveRequestId
        ? leaveRequestById.get(entry.leaveRequestId)
        : null;
      const matchedApprovedLeave =
        leaveRequest?.status === "APPROVED" &&
        leaveRequest.membershipId === entry.membershipId &&
        leaveRequest.branchId === entry.branchId
          ? leaveRequest
          : null;
      const statutoryRuleSetStatus =
        matchedApprovedLeave?.jurisdictionCodeSnapshot &&
        matchedApprovedLeave.statutoryRuleSetVersionSnapshot
          ? statutoryRuleStatusByRef.get(
              `${matchedApprovedLeave.jurisdictionCodeSnapshot}:${matchedApprovedLeave.statutoryRuleSetVersionSnapshot}`,
            ) ?? null
          : null;
      const overtime = overtimeByMemberDate.get(entryKey);
      const sourceDaySnapshotId = randomUUID();
      p2DayRows.push({
        id: sourceDaySnapshotId,
        revisionId: revision.id,
        businessId: args.context.businessId,
        branchId: entry.branchId,
        membershipId: entry.membershipId,
        workDate: entry.workDate,
        finalResultId: entry.id,
        finalResultVersion: entry.version,
        outcome: entry.outcome,
        expectedDayKindSnapshot: entry.expectedDayKindSnapshot,
        leaveDayFractionSnapshot: entry.leaveDayFractionSnapshot,
        leaveRequestIdSnapshot: entry.leaveRequestId,
        leaveRequestRevisionSnapshot: matchedApprovedLeave?.revision ?? null,
        leaveRequestDigestSnapshot: matchedApprovedLeave?.decisionDigest ?? null,
        leavePolicyIdSnapshot: matchedApprovedLeave?.policyId ?? null,
        leavePolicyVersionIdSnapshot: matchedApprovedLeave?.policyVersionId ?? null,
        leavePolicyNameSnapshot: matchedApprovedLeave?.policyNameSnapshot ?? null,
        leavePayTreatmentSnapshot: matchedApprovedLeave?.payTreatmentSnapshot ?? null,
        leaveUnitSnapshot: matchedApprovedLeave?.leaveUnit ?? null,
        leaveLegalStatusSnapshot: matchedApprovedLeave?.legalStatusSnapshot ?? null,
        leaveJurisdictionCodeSnapshot: matchedApprovedLeave?.jurisdictionCodeSnapshot ?? null,
        leaveStatutoryRuleSetVersionSnapshot:
          matchedApprovedLeave?.statutoryRuleSetVersionSnapshot ?? null,
        leaveStatutoryRuleSetStatusSnapshot: statutoryRuleSetStatus,
        leaveStatutoryCategorySnapshot: matchedApprovedLeave?.statutoryCategorySnapshot ?? null,
        leaveStatutoryEligibilitySnapshot:
          matchedApprovedLeave?.statutoryEligibilitySnapshot ?? undefined,
        leaveStatutoryPayTreatmentSnapshot:
          matchedApprovedLeave?.statutoryPayTreatmentSnapshot ?? undefined,
        leaveComplianceStatusSnapshot: matchedApprovedLeave?.complianceStatusSnapshot ?? null,
        expectedStartAt: entry.expectedStartAt,
        expectedEndAt: entry.expectedEndAt,
        actualClockInAt: entry.actualClockInAt,
        actualClockOutAt: entry.actualClockOutAt,
        timezoneSnapshot: expectedDay?.timezoneSnapshot ?? null,
        crossMidnightSnapshot: expectedDay
          ? crossesBranchLocalDate(
              entry.actualClockInAt ?? entry.expectedStartAt,
              entry.actualClockOutAt ?? entry.expectedEndAt,
              expectedDay.timezoneSnapshot,
            )
          : false,
        potentialOtMinutes: overtime?.potentialOtMinutes ?? 0,
        approvedOtMinutes: overtime?.review?.approvedOtMinutes ?? 0,
        otContext: overtime?.context ?? null,
        otApprovalStatus:
          overtime?.review?.status ?? AttendanceOvertimeApprovalStatus.NOT_APPLICABLE,
        otApprovalRef: overtime?.review?.id ?? null,
        otApprovalRevision: overtime?.review?.revision ?? null,
        totalBreakMinutes: entry.totalBreakMinutes,
        totalWorkedMinutes: entry.totalWorkedMinutes,
        sourceDigest: entry.sourceDigest,
        ...(holidayContextByMemberDate.get(entryKey)
          ? { holidayContextSnapshot: holidayContextByMemberDate.get(entryKey)! }
          : {}),
      });

      if (entry.totalWorkedMinutes <= 0 && entry.totalBreakMinutes <= 0) continue;
      if (!entry.actualClockInAt || !entry.actualClockOutAt || !expectedDay) {
        throw new AttendanceTimesheetError(
          "SEGMENTATION_BLOCKED",
          `Attendance segmentation is missing a resolved interval or timezone for ${dateKey(entry.workDate)}.`,
        );
      }
      const sourceAttendanceId = attendanceIdByMemberDate.get(entryKey) ?? null;
      const resolvedBreaks = sourceAttendanceId
        ? breakIntervalsByAttendanceId.get(sourceAttendanceId)
        : [];
      if (resolvedBreaks === null) {
        throw new AttendanceTimesheetError(
          "SEGMENTATION_BLOCKED",
          `Break punches are incomplete for ${dateKey(entry.workDate)}.`,
        );
      }
      try {
        const segments = segmentAttendanceWork({
          startAt: entry.actualClockInAt,
          endAt: entry.actualClockOutAt,
          timezone: expectedDay.timezoneSnapshot,
          totalBreakMinutes: entry.totalBreakMinutes,
          totalWorkedMinutes: entry.totalWorkedMinutes,
          breakIntervals: resolvedBreaks ?? [],
          dateContexts: currentExpectedDays
            .filter((day) => day.membershipId === entry.membershipId)
            .map((day) => {
              const contextKey = `${day.membershipId}:${dateKey(day.workDate)}`;
              const p2Context = segmentContextP2ByMemberDate.get(contextKey);
              const holidayContext = readHolidayContext(day.policySnapshot);
              return {
                localDate: dateKey(day.workDate),
                kind: day.kind,
                expectedStartAt: day.expectedStartAt,
                expectedEndAt: day.expectedEndAt,
                timezone: day.timezoneSnapshot,
                holidayContext,
                leaveRequestId: p2Context?.leaveRequestId ?? null,
                leaveDayFraction: p2Context?.leaveDayFractionSnapshot === null ||
                  p2Context?.leaveDayFractionSnapshot === undefined
                    ? null
                    : Number(p2Context.leaveDayFractionSnapshot),
                isRestDay: day.kind === "REST_DAY",
                isPublicHoliday: day.kind === "PUBLIC_HOLIDAY" || Boolean(holidayContext),
              };
            }),
          potentialOtMinutes: overtime?.potentialOtMinutes ?? 0,
          approvedOtMinutes: overtime?.review?.approvedOtMinutes ?? 0,
        });
        segmentRows.push(...segments.map((segment) => ({
          revisionId: revision.id,
          businessId: args.context.businessId,
          branchId: entry.branchId,
          membershipId: entry.membershipId,
          sourceDaySnapshotId,
          sourceFinalResultId: entry.id,
          sourceAttendanceId,
          segmentIndex: segment.segmentIndex,
          localDate: localDateToSnapshotDate(segment.localDate),
          startAt: segment.startAt,
          endAt: segment.endAt,
          timezoneSnapshot: segment.timezone,
          context: segment.context,
          expectedDayKindSnapshot: segment.expectedDayKind,
          expectedStartAt: segment.expectedStartAt,
          expectedEndAt: segment.expectedEndAt,
          isRestDay: segment.isRestDay,
          isPublicHoliday: segment.isPublicHoliday,
          isUnscheduled: segment.isUnscheduled,
          leaveRequestIdSnapshot: segment.leaveRequestId,
          leaveDayFractionSnapshot: segment.leaveDayFraction,
          grossMinutes: segment.grossMinutes,
          breakMinutes: segment.breakMinutes,
          workedMinutes: segment.workedMinutes,
          potentialOtMinutes: segment.potentialOtMinutes,
          approvedOtMinutes: segment.approvedOtMinutes,
          sourceDigest: segment.sourceDigest,
          ...(segment.holidayContext
            ? { holidayContextSnapshot: segment.holidayContext as Prisma.InputJsonObject }
            : {}),
        })));
      } catch (error) {
        if (error instanceof AttendanceSegmentationError) {
          throw new AttendanceTimesheetError(
            "SEGMENTATION_BLOCKED",
            `${error.message} (${error.code})`,
          );
        }
        throw error;
      }
    }
    const lockedSourceDigest = digest({
      sourceDigest: snapshot.currentSourceDigest,
      segments: segmentRows.map((segment) => segment.sourceDigest).sort(),
    });
    await transaction.attendanceTimesheetRevision.create({
      data: {
        id: revision.id,
        timesheetId: snapshot.timesheet.id,
        businessId: args.context.businessId,
        revision: revision.revision,
        periodStart: snapshot.period.periodStart,
        sourceDigest: lockedSourceDigest,
        reason,
        lockedById: args.context.actor.userId,
      },
    });
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
          ...(holidayContextByMemberDate.get(`${entry.employeeId}:${dateKey(entry.workDate)}`)
            ? { holidayContextSnapshot: holidayContextByMemberDate.get(`${entry.employeeId}:${dateKey(entry.workDate)}`)! }
            : {}),
        })),
      });
    }
    if (p2DayRows.length) {
      await transaction.attendanceTimesheetP2DaySnapshot.createMany({ data: p2DayRows });
    }
    if (segmentRows.length) {
      await transaction.attendanceTimesheetP2SegmentSnapshot.createMany({ data: segmentRows });
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
      summary: "Approved monthly Attendance Timesheet was locked as an immutable revision.",
      after: {
        revision: revision.revision,
        month: args.month,
        entryCount: entries.length,
        p2DayCount: p2Entries.length,
        segmentCount: segmentRows.length,
      },
      metadata: { sourceDigest: lockedSourceDigest, attendanceSourceDigest: snapshot.currentSourceDigest, reason },
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
    if (!snapshot.timesheet || snapshot.timesheet.status === "DRAFT") {
      throw new AttendanceTimesheetError("TIMESHEET_NOT_LOCKED", "Only an approved or locked Timesheet can be reopened.");
    }
    if (args.expectedUpdatedAt && snapshot.timesheet.updatedAt.toISOString() !== args.expectedUpdatedAt) {
      throw new AttendanceTimesheetError("CONCURRENT_CHANGE", "The Timesheet changed. Reload before starting a revision.");
    }
    await transaction.attendanceTimesheetBranchReadiness.updateMany({
      where: { timesheetId: snapshot.timesheet.id },
      data: { status: "NOT_READY", sourceDigest: null, readyAt: null, readyById: null },
    });
    await transaction.attendanceMonthlyTimesheet.update({
      where: { id: snapshot.timesheet.id },
      data: {
        status: "DRAFT",
        currentRevisionId: null,
        revisionReason: reason,
        approvalSourceDigest: null,
        approvalReason: null,
        approvedAt: null,
        approvedById: null,
      },
    });
    const reopenedReviews = snapshot.branches
      .flatMap((branch) => branch.overtimeCandidates)
      .flatMap((candidate) => candidate.review ? [{ candidate, review: candidate.review }] : []);
    if (reopenedReviews.length) {
      await transaction.attendanceOvertimeReviewEvent.createMany({
        data: reopenedReviews.map(({ candidate, review }) => ({
          reviewId: review.id,
          businessId: args.context.businessId,
          branchId: candidate.branchId,
          membershipId: candidate.membershipId,
          workDate: candidate.workDate,
          type: "OT_REOPENED",
          reviewRevision: review.revision,
          potentialOtMinutes: review.potentialOtMinutes,
          approvedOtMinutes: review.approvedOtMinutes,
          context: review.context,
          actorId: args.context.actor.userId,
          reason,
          beforeSnapshot: {
            status: review.status,
            sourceDigest: review.sourceDigest,
            revision: review.revision,
          },
          afterSnapshot: {
            status: review.status,
            sourceDigest: review.sourceDigest,
            revision: review.revision,
            timesheetReopened: true,
          },
        })),
      });
    }
    await writeAuditLog({
      businessId: args.context.businessId,
      actor: args.context.actor,
      request: args.context.request,
      action: "ATTENDANCE_TIMESHEET_REOPENED",
      entityType: "AttendanceMonthlyTimesheet",
      entityId: snapshot.timesheet.id,
      summary: "Attendance Timesheet was reopened; prior approvals and locked revisions remain auditable.",
      metadata: { month: args.month, priorRevision: snapshot.timesheet.currentRevision?.revision ?? null, reason },
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
  p2Blockers: Array<{ id: string; membershipId: string; workDate: Date; type: string; status: string }>,
  p2Results: Prisma.AttendanceP2FinalResultGetPayload<Record<string, never>>[],
  overtimeCandidates: OvertimeCandidate[],
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
  const sourceDigest = digest({
    legacy: sessions.map((session) => [
      session.id,
      session.status,
      session.updatedAt.toISOString(),
      session.resolutionCase?.id ?? null,
      session.resolutionCase?.status ?? null,
      session.resolutionCase?.currentFinalResult?.id ?? null,
      session.resolutionCase?.currentFinalResult?.version ?? null,
      session.resolutionCase?.currentFinalResult?.evidenceChecksum ?? null,
    ]),
    p2Blockers: p2Blockers.map((item) => [item.id, item.type, item.status]),
    p2Results: p2Results.map((item) => [item.id, item.version, item.outcome, item.sourceDigest, item.resolutionDigest]),
    overtime: overtimeCandidates.map((item) => [
      item.finalResultId,
      item.sourceDigest,
      item.context,
      item.potentialOtMinutes,
      item.blockedReason,
      item.review?.id ?? null,
      item.review?.revision ?? null,
      item.effectiveStatus,
      item.review?.approvedOtMinutes ?? null,
      item.stale,
    ]),
  });
  const overtimeBlockers = overtimeCandidates.filter((item) =>
    item.blockedReason !== null ||
    item.stale ||
    item.effectiveStatus === AttendanceOvertimeApprovalStatus.PENDING_REVIEW,
  );
  return {
    branchId,
    branchName,
    sourceDigest,
    sessionCount: sessions.length,
    includedCount: results.filter((result) => result.disposition === "INCLUDED").length,
    excludedCount: results.filter((result) => result.disposition === "EXCLUDED").length,
    blockerCount: blockers.length + p2Blockers.length + overtimeBlockers.length,
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
    p2Blockers,
    results,
    p2Results,
    overtimeCandidates,
    overtimeBlockers,
  };
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function pairBreakPunches(punches: Array<{
  id: string;
  attendanceSessionId: string | null;
  type: string;
  serverTimestamp: Date;
}>): Map<string, AttendanceBreakInterval[] | null> {
  const grouped = new Map<string, typeof punches>();
  for (const punch of punches) {
    if (!punch.attendanceSessionId) continue;
    const list = grouped.get(punch.attendanceSessionId) ?? [];
    list.push(punch);
    grouped.set(punch.attendanceSessionId, list);
  }
  const result = new Map<string, AttendanceBreakInterval[] | null>();
  for (const [attendanceSessionId, sessionPunches] of grouped) {
    const intervals: AttendanceBreakInterval[] = [];
    let open: Date | null = null;
    let invalid = false;
    for (const punch of sessionPunches) {
      if (punch.type === "BREAK_START") {
        if (open) {
          invalid = true;
          break;
        }
        open = punch.serverTimestamp;
      } else if (punch.type === "BREAK_END") {
        if (!open || punch.serverTimestamp <= open) {
          invalid = true;
          break;
        }
        intervals.push({ startAt: open, endAt: punch.serverTimestamp });
        open = null;
      }
    }
    result.set(attendanceSessionId, invalid || open ? null : intervals);
  }
  return result;
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function crossesBranchLocalDate(
  startAt: Date | null,
  endAt: Date | null,
  timeZone: string,
) {
  if (!startAt || !endAt) return false;
  return (
    getBranchLocalDateKey(startAt, timeZone) !==
    getBranchLocalDateKey(new Date(endAt.getTime() - 1), timeZone)
  );
}

function readHolidayContext(value: Prisma.JsonValue | null): Prisma.InputJsonObject | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const context = value.publicHolidayContext;
  if (!context || Array.isArray(context) || typeof context !== "object") return null;
  return context as Prisma.InputJsonObject;
}

function assertWholeBusiness(context: AttendanceTimesheetContext) {
  if (!context.wholeBusinessScope) {
    throw new AttendanceTimesheetError("WHOLE_BUSINESS_REQUIRED", "Whole-business Attendance scope is required to approve or revise a monthly Timesheet.");
  }
}
