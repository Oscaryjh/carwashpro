import { createHash } from "node:crypto";
import {
  AttendanceOvertimeApprovalStatus,
  AttendanceOvertimeContext,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { z } from "zod";
import type { AttendanceServiceContext } from "@/lib/attendance/employee-service";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const decisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("APPROVE"),
    approvedMinutes: z.number().int().nonnegative().optional(),
    reason: z.string().trim().max(500).optional(),
  }),
  z.object({
    decision: z.literal("REJECT"),
    approvedMinutes: z.literal(0).optional(),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    decision: z.literal("ADJUST"),
    approvedMinutes: z.number().int().nonnegative(),
    reason: z.string().trim().min(3).max(500),
  }),
]);

const transactionOptions = {
  isolationLevel: "Serializable" as const,
  maxWait: 5_000,
  timeout: 20_000,
};

const finalResultSelect = Prisma.validator<Prisma.AttendanceP2FinalResultSelect>()({
  id: true,
  businessId: true,
  branchId: true,
  membershipId: true,
  workDate: true,
  version: true,
  outcome: true,
  expectedDayKindSnapshot: true,
  expectedDayId: true,
  leaveDayFractionSnapshot: true,
  expectedStartAt: true,
  expectedEndAt: true,
  actualClockInAt: true,
  actualClockOutAt: true,
  totalWorkedMinutes: true,
  sourceDigest: true,
  resolutionDigest: true,
});

export type OvertimeFinalResult = Prisma.AttendanceP2FinalResultGetPayload<{
  select: typeof finalResultSelect;
}>;

export type OvertimeDatabase = Pick<
  PrismaClient,
  | "attendanceP2FinalResult"
  | "attendanceOvertimeReview"
  | "employeeBusinessMembership"
  | "branch"
  | "attendanceExpectedDay"
>;

export type OvertimeCandidate = ReturnType<typeof deriveOvertimeCandidate> & {
  employeeName: string;
  employeeCode: string;
  employeeUserId: string | null;
  branchName: string;
  review: {
    id: string;
    status: AttendanceOvertimeApprovalStatus;
    potentialOtMinutes: number;
    approvedOtMinutes: number;
    context: AttendanceOvertimeContext;
    sourceDigest: string;
    revision: number;
    reviewedAt: Date | null;
    reason: string | null;
  } | null;
  effectiveStatus: AttendanceOvertimeApprovalStatus;
  stale: boolean;
};

export class AttendanceOvertimeError extends Error {
  constructor(
    public readonly code:
      | "CANDIDATE_NOT_FOUND"
      | "OUTSIDE_BRANCH_SCOPE"
      | "SELF_APPROVAL_NOT_ALLOWED"
      | "TIMESHEET_LOCKED"
      | "LEAVE_ATTENDANCE_CONFLICT"
      | "INVALID_APPROVED_MINUTES"
      | "CONCURRENT_CHANGE",
    message: string,
  ) {
    super(message);
    this.name = "AttendanceOvertimeError";
  }
}

export async function listAttendanceOvertimeCandidates(args: {
  businessId: string;
  allowedBranchIds: readonly string[];
  periodStart: Date;
  periodEndExclusive: Date;
  membershipId?: string;
  excludedMembershipId?: string;
  database?: OvertimeDatabase;
}): Promise<OvertimeCandidate[]> {
  const database = args.database ?? prisma;
  if (!args.allowedBranchIds.length) return [];
  if (args.membershipId && args.membershipId === args.excludedMembershipId) return [];

  const finalRows = await database.attendanceP2FinalResult.findMany({
    where: {
      businessId: args.businessId,
      branchId: { in: [...args.allowedBranchIds] },
      ...(args.membershipId
        ? { membershipId: args.membershipId }
        : args.excludedMembershipId
          ? { membershipId: { not: args.excludedMembershipId } }
          : {}),
      workDate: { gte: args.periodStart, lt: args.periodEndExclusive },
    },
    select: finalResultSelect,
    orderBy: [{ membershipId: "asc" }, { workDate: "asc" }, { version: "desc" }],
  });
  const latestResults = [...new Map(
    finalRows.map((row) => [`${row.membershipId}:${dateKey(row.workDate)}`, row]),
  ).values()];
  if (!latestResults.length) return [];

  const membershipIds = [...new Set(latestResults.map((row) => row.membershipId))];
  const expectedDayIds = [...new Set(
    latestResults.flatMap((row) => row.expectedDayId ? [row.expectedDayId] : []),
  )];
  const [members, branches, expectedDays, reviews] = await Promise.all([
    database.employeeBusinessMembership.findMany({
      where: { businessId: args.businessId, id: { in: membershipIds } },
      select: {
        id: true,
        fullName: true,
        employeeCode: true,
        staffUser: { select: { id: true } },
      },
    }),
    database.branch.findMany({
      where: {
        businessId: args.businessId,
        id: { in: [...new Set(latestResults.map((row) => row.branchId))] },
      },
      select: { id: true, name: true },
    }),
    expectedDayIds.length
      ? database.attendanceExpectedDay.findMany({
          where: { businessId: args.businessId, id: { in: expectedDayIds } },
          select: { id: true, timezoneSnapshot: true },
        })
      : Promise.resolve([]),
    database.attendanceOvertimeReview.findMany({
      where: {
        businessId: args.businessId,
        membershipId: { in: membershipIds },
        workDate: { gte: args.periodStart, lt: args.periodEndExclusive },
      },
      select: {
        id: true,
        membershipId: true,
        workDate: true,
        status: true,
        potentialOtMinutes: true,
        approvedOtMinutes: true,
        context: true,
        sourceDigest: true,
        revision: true,
        reviewedAt: true,
        reason: true,
      },
    }),
  ]);
  const memberById = new Map(members.map((row) => [row.id, row]));
  const branchById = new Map(branches.map((row) => [row.id, row]));
  const timezoneByExpectedDayId = new Map(
    expectedDays.map((row) => [row.id, row.timezoneSnapshot]),
  );
  const reviewByMemberDate = new Map(
    reviews.map((row) => [`${row.membershipId}:${dateKey(row.workDate)}`, row]),
  );

  return latestResults.flatMap((row) => {
    const member = memberById.get(row.membershipId);
    const branch = branchById.get(row.branchId);
    if (!member || !branch) return [];
    const derived = deriveOvertimeCandidate(
      row,
      row.expectedDayId ? timezoneByExpectedDayId.get(row.expectedDayId) ?? null : null,
    );
    if (derived.potentialOtMinutes <= 0 && !derived.blockedReason) return [];
    const review = reviewByMemberDate.get(`${row.membershipId}:${dateKey(row.workDate)}`) ?? null;
    const stale = Boolean(review && review.sourceDigest !== derived.sourceDigest);
    return [{
      ...derived,
      employeeName: member.fullName,
      employeeCode: member.employeeCode,
      employeeUserId: member.staffUser?.id ?? null,
      branchName: branch.name,
      review,
      stale,
      effectiveStatus: stale || !review
        ? AttendanceOvertimeApprovalStatus.PENDING_REVIEW
        : review.status,
    }];
  });
}

export async function decideAttendanceOvertime(args: {
  context: AttendanceServiceContext;
  actorMembershipId?: string;
  finalResultId: string;
  expectedRevision: number;
  input: z.input<typeof decisionSchema>;
  database?: PrismaClient;
}) {
  const database = args.database ?? prisma;
  const input = decisionSchema.parse(args.input);

  return database.$transaction(async (transaction) => {
    const finalResult = await transaction.attendanceP2FinalResult.findUnique({
      where: { id: args.finalResultId },
      select: finalResultSelect,
    });
    if (!finalResult || finalResult.businessId !== args.context.businessId) {
      throw new AttendanceOvertimeError("CANDIDATE_NOT_FOUND", "The OT candidate no longer exists.");
    }
    if (!args.context.allowedBranchIds.includes(finalResult.branchId)) {
      throw new AttendanceOvertimeError("OUTSIDE_BRANCH_SCOPE", "This employee is outside your authorized branch scope.");
    }
    if (args.actorMembershipId && finalResult.membershipId === args.actorMembershipId) {
      throw new AttendanceOvertimeError("SELF_APPROVAL_NOT_ALLOWED", "Employees cannot approve their own OT.");
    }
    const periodStart = new Date(Date.UTC(
      finalResult.workDate.getUTCFullYear(),
      finalResult.workDate.getUTCMonth(),
      1,
    ));
    const timesheet = await transaction.attendanceMonthlyTimesheet.findUnique({
      where: {
        businessId_periodStart: { businessId: args.context.businessId, periodStart },
      },
      select: { status: true },
    });
    if (timesheet?.status === "LOCKED") {
      throw new AttendanceOvertimeError("TIMESHEET_LOCKED", "Reopen the locked monthly Timesheet before changing OT.");
    }
    const [expectedDay, membership] = await Promise.all([
      finalResult.expectedDayId
        ? transaction.attendanceExpectedDay.findUnique({
            where: { id: finalResult.expectedDayId },
            select: { timezoneSnapshot: true },
          })
        : Promise.resolve(null),
      transaction.employeeBusinessMembership.findUnique({
        where: { id: finalResult.membershipId },
        select: { staffUser: { select: { id: true } } },
      }),
    ]);
    if (membership?.staffUser?.id === args.context.actor.userId) {
      throw new AttendanceOvertimeError("SELF_APPROVAL_NOT_ALLOWED", "Employees cannot approve their own OT.");
    }
    const candidate = deriveOvertimeCandidate(
      finalResult,
      expectedDay?.timezoneSnapshot ?? null,
    );
    if (candidate.blockedReason === "FULL_DAY_LEAVE_CONFLICT") {
      throw new AttendanceOvertimeError("LEAVE_ATTENDANCE_CONFLICT", "Resolve the full-day Leave and Attendance conflict before OT review.");
    }
    if (candidate.potentialOtMinutes <= 0) {
      throw new AttendanceOvertimeError("CANDIDATE_NOT_FOUND", "No potential OT remains in the latest Final Attendance Result.");
    }

    const approvedMinutes = input.decision === "REJECT"
      ? 0
      : input.approvedMinutes ?? candidate.potentialOtMinutes;
    if (approvedMinutes > candidate.potentialOtMinutes) {
      throw new AttendanceOvertimeError("INVALID_APPROVED_MINUTES", "Approved OT cannot exceed the frozen potential OT minutes.");
    }
    if (approvedMinutes !== candidate.potentialOtMinutes && !input.reason?.trim()) {
      throw new AttendanceOvertimeError("INVALID_APPROVED_MINUTES", "A reason is required when approved OT differs from potential OT.");
    }
    const status = input.decision === "REJECT"
      ? AttendanceOvertimeApprovalStatus.REJECTED
      : approvedMinutes === candidate.potentialOtMinutes
        ? AttendanceOvertimeApprovalStatus.APPROVED
        : AttendanceOvertimeApprovalStatus.ADJUSTED;
    const existing = await transaction.attendanceOvertimeReview.findUnique({
      where: {
        businessId_membershipId_workDate: {
          businessId: args.context.businessId,
          membershipId: finalResult.membershipId,
          workDate: finalResult.workDate,
        },
      },
    });
    if ((existing?.revision ?? 0) !== args.expectedRevision) {
      throw new AttendanceOvertimeError("CONCURRENT_CHANGE", "This OT review changed. Reload before deciding again.");
    }
    const before = existing ? reviewSnapshot(existing) : null;
    const nextRevision = (existing?.revision ?? 0) + 1;
    const review = existing
      ? await updateExistingReview()
      : await transaction.attendanceOvertimeReview.create({
          data: {
            businessId: args.context.businessId,
            branchId: finalResult.branchId,
            membershipId: finalResult.membershipId,
            workDate: finalResult.workDate,
            finalResultId: finalResult.id,
            finalResultVersion: finalResult.version,
            expectedDayId: finalResult.expectedDayId,
            status,
            context: candidate.context,
            potentialOtMinutes: candidate.potentialOtMinutes,
            approvedOtMinutes: approvedMinutes,
            sourceDigest: candidate.sourceDigest,
            revision: nextRevision,
            reviewedById: args.context.actor.userId,
            reviewedAt: new Date(),
            reason: input.reason?.trim() || null,
          },
        });
    const after = reviewSnapshot(review);
    if (!existing) {
      await transaction.attendanceOvertimeReviewEvent.create({
        data: {
          reviewId: review.id,
          businessId: review.businessId,
          branchId: review.branchId,
          membershipId: review.membershipId,
          workDate: review.workDate,
          type: "OT_REVIEW_CREATED",
          reviewRevision: 0,
          potentialOtMinutes: candidate.potentialOtMinutes,
          approvedOtMinutes: 0,
          context: candidate.context,
          actorId: args.context.actor.userId,
          reason: null,
          beforeSnapshot: Prisma.JsonNull,
          afterSnapshot: {
            status: "PENDING_REVIEW",
            potentialOtMinutes: candidate.potentialOtMinutes,
            approvedOtMinutes: 0,
            context: candidate.context,
            sourceDigest: candidate.sourceDigest,
            revision: 0,
          },
        },
      });
    }
    await transaction.attendanceOvertimeReviewEvent.create({
      data: {
        reviewId: review.id,
        businessId: review.businessId,
        branchId: review.branchId,
        membershipId: review.membershipId,
        workDate: review.workDate,
        type: status === AttendanceOvertimeApprovalStatus.REJECTED
          ? "OT_REJECTED"
          : status === AttendanceOvertimeApprovalStatus.ADJUSTED
            ? "OT_ADJUSTED"
            : "OT_APPROVED",
        reviewRevision: review.revision,
        potentialOtMinutes: review.potentialOtMinutes,
        approvedOtMinutes: review.approvedOtMinutes,
        context: review.context,
        actorId: args.context.actor.userId,
        reason: review.reason,
        beforeSnapshot: before ?? Prisma.JsonNull,
        afterSnapshot: after,
      },
    });
    await writeAuditLog({
      businessId: args.context.businessId,
      branchId: review.branchId,
      actor: args.context.actor,
      request: args.context.request,
      action: status === "REJECTED" ? "OT_REJECTED" : status === "ADJUSTED" ? "OT_ADJUSTED" : "OT_APPROVED",
      entityType: "AttendanceOvertimeReview",
      entityId: review.id,
      summary: "Attendance OT decision recorded from the latest Final Attendance Result.",
      before,
      after,
      metadata: { finalResultId: finalResult.id, finalResultVersion: finalResult.version },
    }, transaction);
    return review;

    async function updateExistingReview() {
      const updated = await transaction.attendanceOvertimeReview.updateMany({
        where: {
          id: existing!.id,
          revision: args.expectedRevision,
        },
        data: {
          branchId: finalResult!.branchId,
          finalResultId: finalResult!.id,
          finalResultVersion: finalResult!.version,
          expectedDayId: finalResult!.expectedDayId,
          status,
          context: candidate.context,
          potentialOtMinutes: candidate.potentialOtMinutes,
          approvedOtMinutes: approvedMinutes,
          sourceDigest: candidate.sourceDigest,
          revision: nextRevision,
          reviewedById: args.context.actor.userId,
          reviewedAt: new Date(),
          reason: input.reason?.trim() || null,
        },
      });
      if (updated.count !== 1) {
        throw new AttendanceOvertimeError("CONCURRENT_CHANGE", "This OT review changed. Reload before deciding again.");
      }
      return transaction.attendanceOvertimeReview.findUniqueOrThrow({ where: { id: existing!.id } });
    }
  }, transactionOptions);
}

export function deriveOvertimeCandidate(
  result: OvertimeFinalResult,
  timezoneSnapshot: string | null,
) {
  const context = result.expectedDayKindSnapshot === "REST_DAY"
    ? AttendanceOvertimeContext.REST_DAY
    : result.expectedDayKindSnapshot === "PUBLIC_HOLIDAY"
      ? AttendanceOvertimeContext.PUBLIC_HOLIDAY
      : AttendanceOvertimeContext.NORMAL;
  const fullDayLeaveConflict =
    result.totalWorkedMinutes > 0 &&
    Number(result.leaveDayFractionSnapshot?.toString() ?? 0) >= 1;
  const fullWorkedDay = context !== AttendanceOvertimeContext.NORMAL ||
    result.expectedDayKindSnapshot === "NOT_SCHEDULED";
  const outsideMinutes = fullWorkedDay
    ? result.totalWorkedMinutes
    : Math.min(
        result.totalWorkedMinutes,
        minutesBefore(result.actualClockInAt, result.expectedStartAt) +
          minutesAfter(result.actualClockOutAt, result.expectedEndAt),
      );
  const potentialOtMinutes = Math.max(0, outsideMinutes);
  const sourceDigest = digest({
    finalResultId: result.id,
    finalResultVersion: result.version,
    sourceDigest: result.sourceDigest,
    resolutionDigest: result.resolutionDigest,
    context,
    potentialOtMinutes,
    expectedDayKind: result.expectedDayKindSnapshot,
    expectedStartAt: result.expectedStartAt?.toISOString() ?? null,
    expectedEndAt: result.expectedEndAt?.toISOString() ?? null,
    actualClockInAt: result.actualClockInAt?.toISOString() ?? null,
    actualClockOutAt: result.actualClockOutAt?.toISOString() ?? null,
    totalWorkedMinutes: result.totalWorkedMinutes,
    leaveDayFraction: result.leaveDayFractionSnapshot?.toString() ?? null,
    timezoneSnapshot,
  });
  return {
    finalResultId: result.id,
    finalResultVersion: result.version,
    businessId: result.businessId,
    branchId: result.branchId,
    membershipId: result.membershipId,
    workDate: result.workDate,
    expectedDayId: result.expectedDayId,
    context,
    potentialOtMinutes,
    sourceDigest,
    blockedReason: fullDayLeaveConflict
      ? ("FULL_DAY_LEAVE_CONFLICT" as const)
      : null,
  };
}

function minutesBefore(actual: Date | null, expected: Date | null) {
  if (!actual || !expected || actual >= expected) return 0;
  return Math.floor((expected.getTime() - actual.getTime()) / 60_000);
}

function minutesAfter(actual: Date | null, expected: Date | null) {
  if (!actual || !expected || actual <= expected) return 0;
  return Math.floor((actual.getTime() - expected.getTime()) / 60_000);
}

function reviewSnapshot(review: {
  id: string;
  status: AttendanceOvertimeApprovalStatus;
  context: AttendanceOvertimeContext;
  potentialOtMinutes: number;
  approvedOtMinutes: number;
  sourceDigest: string;
  revision: number;
  reason: string | null;
}) {
  return {
    id: review.id,
    status: review.status,
    context: review.context,
    potentialOtMinutes: review.potentialOtMinutes,
    approvedOtMinutes: review.approvedOtMinutes,
    sourceDigest: review.sourceDigest,
    revision: review.revision,
    reason: review.reason,
  };
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
