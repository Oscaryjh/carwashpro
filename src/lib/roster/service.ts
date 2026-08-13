import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { getBranchLocalDateKey } from "@/lib/attendance/work-date";
import { writeAuditLog, type AuditRequestContext } from "@/lib/audit";
import type { AppSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  addDays,
  assignmentSourceShape,
  assertWeeklyPeriod,
  dateOnly,
  dateValue,
  expectedKindForRoster,
  rosterAssignmentDigest,
  startOfIsoWeek,
  validateRosterAssignment,
  type RosterAssignmentInput,
} from "./domain";

export type RosterServiceContext = Readonly<{
  businessId: string;
  allowedBranchIds: readonly string[];
  actor: Pick<AppSession, "userId" | "name" | "email">;
  request?: AuditRequestContext;
  canAmendPublished?: boolean;
  canManageRetrospective?: boolean;
}>;

export class RosterError extends Error {
  constructor(
    public readonly code:
      | "OUTSIDE_SCOPE"
      | "CONCURRENT_CHANGE"
      | "INVALID_ASSIGNMENT"
      | "MULTIPLE_SHIFT_SAME_DAY"
      | "SHIFT_CONFLICT"
      | "LEAVE_CONFLICT"
      | "EXPECTED_DAY_CONFLICT"
      | "RETROSPECTIVE_REVIEW_REQUIRED"
      | "TIMESHEET_REOPEN_REQUIRED"
      | "PUBLISHED_AMENDMENT_FORBIDDEN"
      | "TARGET_NOT_EMPTY"
      | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "RosterError";
  }
}

const assignmentSchema = z.object({
  branchId: z.string().uuid(),
  weekStart: z.date(),
  expectedDraftRevision: z.number().int().nonnegative().optional(),
  membershipId: z.string().uuid(),
  workDate: z.date(),
  kind: z.enum(["WORK_SHIFT", "REST_DAY", "NOT_SCHEDULED"]),
  startAt: z.date().nullable().optional(),
  endAt: z.date().nullable().optional(),
  breakMinutes: z.number().int().min(0).max(720).default(0),
  note: z.string().trim().max(500).nullable().optional(),
});

const publishSchema = z.object({
  rosterPeriodId: z.string().uuid(),
  expectedDraftRevision: z.number().int().nonnegative(),
  operationKey: z.string().trim().min(8).max(128),
  reason: z.string().trim().min(3).max(500).nullable().optional(),
});

const transactionOptions = {
  isolationLevel: "Serializable" as const,
  maxWait: 5_000,
  timeout: 30_000,
};

export async function upsertRosterAssignment(args: {
  context: RosterServiceContext;
  input: unknown;
  database?: PrismaClient;
}) {
  const input = assignmentSchema.parse(args.input);
  const weekStart = dateOnly(input.weekStart);
  const workDate = dateOnly(input.workDate);
  assertWeeklyPeriod(weekStart, workDate);
  assertBranchScope(args.context, input.branchId);
  try {
    validateRosterAssignment(input);
  } catch (error) {
    throw new RosterError("INVALID_ASSIGNMENT", messageOf(error));
  }
  const database = args.database ?? prisma;
  return runSerializable(database, async (transaction) => {
    const branch = await getRosterBranch(transaction, args.context.businessId, input.branchId);
    await assertEmployeeEligible(transaction, {
      businessId: args.context.businessId,
      branchId: input.branchId,
      membershipId: input.membershipId,
      workDate,
    });
    const period = await transaction.rosterPeriod.upsert({
      where: { businessId_branchId_weekStart: { businessId: args.context.businessId, branchId: input.branchId, weekStart } },
      update: {},
      create: {
        businessId: args.context.businessId,
        branchId: input.branchId,
        weekStart,
        createdById: args.context.actor.userId,
        updatedById: args.context.actor.userId,
      },
    });
    if (period.status === "PUBLISHED" && !args.context.canAmendPublished) {
      throw new RosterError("PUBLISHED_AMENDMENT_FORBIDDEN", "Published roster changes require the amend-roster capability.");
    }
    const expectedRevision = input.expectedDraftRevision ?? period.draftRevision;
    if (expectedRevision !== period.draftRevision) {
      throw new RosterError("CONCURRENT_CHANGE", "The roster changed in another session. Refresh before editing.");
    }
    const existing = await transaction.rosterAssignment.findUnique({
      where: { businessId_membershipId_workDate: { businessId: args.context.businessId, membershipId: input.membershipId, workDate } },
    });
    if (existing && existing.rosterPeriodId !== period.id) {
      throw new RosterError(
        "MULTIPLE_SHIFT_SAME_DAY",
        "This employee already has an assignment on that day. Multiple same-day shifts are safely deferred in Phase 1.",
      );
    }
    if (input.kind === "WORK_SHIFT") {
      await assertNoShiftOverlap(transaction, {
        businessId: args.context.businessId,
        membershipId: input.membershipId,
        startAt: input.startAt!,
        endAt: input.endAt!,
        excludeAssignmentId: existing?.id,
      });
    }
    const assignmentData = {
      branchId: input.branchId,
      kind: input.kind,
      startAt: input.kind === "WORK_SHIFT" ? input.startAt : null,
      endAt: input.kind === "WORK_SHIFT" ? input.endAt : null,
      breakMinutes: input.kind === "WORK_SHIFT" ? input.breakMinutes : 0,
      note: input.note || null,
      updatedById: args.context.actor.userId,
    } as const;
    const assignment = existing
      ? await transaction.rosterAssignment.update({ where: { id: existing.id }, data: assignmentData })
      : await transaction.rosterAssignment.create({
          data: {
            rosterPeriodId: period.id,
            businessId: args.context.businessId,
            membershipId: input.membershipId,
            workDate,
            createdById: args.context.actor.userId,
            ...assignmentData,
          },
        });
    const updated = await transaction.rosterPeriod.updateMany({
      where: { id: period.id, draftRevision: expectedRevision },
      data: { draftRevision: { increment: 1 }, status: "DRAFT", updatedById: args.context.actor.userId },
    });
    if (updated.count !== 1) {
      throw new RosterError("CONCURRENT_CHANGE", "The roster changed in another session. Refresh before editing.");
    }
    await writeAuditLog({
      businessId: args.context.businessId,
      branchId: input.branchId,
      actor: args.context.actor,
      request: args.context.request,
      action: existing ? "ROSTER_ASSIGNMENT_UPDATED" : "ROSTER_ASSIGNMENT_CREATED",
      entityType: "RosterAssignment",
      entityId: assignment.id,
      summary: existing ? "Roster draft assignment updated." : "Roster draft assignment created.",
      before: existing ? assignmentSourceShape(existing) : undefined,
      after: assignmentSourceShape(assignment),
      metadata: { rosterPeriodId: period.id, timezone: branch.timezone },
    }, transaction);
    return { periodId: period.id, assignment, draftRevision: expectedRevision + 1 };
  });
}

export async function bulkUpsertRosterAssignments(args: {
  context: RosterServiceContext;
  input: {
    branchId: string;
    weekStart: Date;
    expectedDraftRevision: number;
    assignments: RosterAssignmentInput[];
  };
  database?: PrismaClient;
}) {
  const weekStart = dateOnly(args.input.weekStart);
  assertWeeklyPeriod(weekStart);
  assertBranchScope(args.context, args.input.branchId);
  if (!args.input.assignments.length || args.input.assignments.length > 200) {
    throw new RosterError("INVALID_ASSIGNMENT", "Bulk assignment requires 1 to 200 employee/day rows.");
  }
  const keys = new Set<string>();
  for (const row of args.input.assignments) {
    assertWeeklyPeriod(weekStart, row.workDate);
    try { validateRosterAssignment(row); } catch (error) { throw new RosterError("INVALID_ASSIGNMENT", messageOf(error)); }
    const key = `${row.membershipId}:${dateValue(row.workDate)}`;
    if (keys.has(key)) throw new RosterError("INVALID_ASSIGNMENT", "Bulk assignment contains a duplicate employee/day row.");
    keys.add(key);
  }
  const database = args.database ?? prisma;
  return runSerializable(database, async (transaction) => {
    await getRosterBranch(transaction, args.context.businessId, args.input.branchId);
    const period = await transaction.rosterPeriod.upsert({
      where: { businessId_branchId_weekStart: { businessId: args.context.businessId, branchId: args.input.branchId, weekStart } },
      update: {},
      create: {
        businessId: args.context.businessId,
        branchId: args.input.branchId,
        weekStart,
        createdById: args.context.actor.userId,
        updatedById: args.context.actor.userId,
      },
    });
    if (period.draftRevision !== args.input.expectedDraftRevision) throw new RosterError("CONCURRENT_CHANGE", "The roster changed in another session. Refresh before bulk editing.");
    if (period.status === "PUBLISHED" && !args.context.canAmendPublished) throw new RosterError("PUBLISHED_AMENDMENT_FORBIDDEN", "Published roster changes require the amend-roster capability.");
    const saved = [];
    for (const row of args.input.assignments) {
      const workDate = dateOnly(row.workDate);
      await assertEmployeeEligible(transaction, { businessId: args.context.businessId, branchId: args.input.branchId, membershipId: row.membershipId, workDate });
      const existing = await transaction.rosterAssignment.findUnique({
        where: { businessId_membershipId_workDate: { businessId: args.context.businessId, membershipId: row.membershipId, workDate } },
      });
      if (existing && existing.rosterPeriodId !== period.id) throw new RosterError("MULTIPLE_SHIFT_SAME_DAY", "An employee already has an assignment on that day in another branch.");
      if (row.kind === "WORK_SHIFT") {
        await assertNoShiftOverlap(transaction, {
          businessId: args.context.businessId,
          membershipId: row.membershipId,
          startAt: row.startAt!,
          endAt: row.endAt!,
          excludeAssignmentId: existing?.id,
        });
      }
      const data = {
        branchId: args.input.branchId,
        kind: row.kind,
        startAt: row.kind === "WORK_SHIFT" ? row.startAt : null,
        endAt: row.kind === "WORK_SHIFT" ? row.endAt : null,
        breakMinutes: row.kind === "WORK_SHIFT" ? row.breakMinutes ?? 0 : 0,
        note: row.note?.trim() || null,
        updatedById: args.context.actor.userId,
      } as const;
      saved.push(existing
        ? await transaction.rosterAssignment.update({ where: { id: existing.id }, data })
        : await transaction.rosterAssignment.create({ data: { rosterPeriodId: period.id, businessId: args.context.businessId, membershipId: row.membershipId, workDate, createdById: args.context.actor.userId, ...data } }));
    }
    const updated = await transaction.rosterPeriod.updateMany({
      where: { id: period.id, draftRevision: args.input.expectedDraftRevision },
      data: { draftRevision: { increment: 1 }, status: "DRAFT", updatedById: args.context.actor.userId },
    });
    if (updated.count !== 1) throw new RosterError("CONCURRENT_CHANGE", "The roster changed while bulk editing.");
    await writeAuditLog({
      businessId: args.context.businessId,
      branchId: args.input.branchId,
      actor: args.context.actor,
      request: args.context.request,
      action: "ROSTER_ASSIGNMENT_BULK_UPDATED",
      entityType: "RosterPeriod",
      entityId: period.id,
      summary: "Roster draft assignments updated atomically in bulk.",
      metadata: { assignmentCount: saved.length, draftRevision: args.input.expectedDraftRevision + 1 },
    }, transaction);
    return { periodId: period.id, assignments: saved, draftRevision: args.input.expectedDraftRevision + 1 };
  });
}

export async function removeRosterAssignment(args: {
  context: RosterServiceContext;
  assignmentId: string;
  expectedDraftRevision: number;
  database?: PrismaClient;
}) {
  const database = args.database ?? prisma;
  return runSerializable(database, async (transaction) => {
    const assignment = await transaction.rosterAssignment.findFirst({
      where: { id: args.assignmentId, businessId: args.context.businessId },
      include: { rosterPeriod: true },
    });
    if (!assignment) throw new RosterError("NOT_FOUND", "Roster assignment was not found.");
    assertBranchScope(args.context, assignment.branchId);
    if (assignment.rosterPeriod.status === "PUBLISHED" && !args.context.canAmendPublished) {
      throw new RosterError("PUBLISHED_AMENDMENT_FORBIDDEN", "Published roster changes require the amend-roster capability.");
    }
    const updated = await transaction.rosterPeriod.updateMany({
      where: { id: assignment.rosterPeriodId, draftRevision: args.expectedDraftRevision },
      data: { draftRevision: { increment: 1 }, status: "DRAFT", updatedById: args.context.actor.userId },
    });
    if (updated.count !== 1) throw new RosterError("CONCURRENT_CHANGE", "The roster changed in another session. Refresh before editing.");
    await transaction.rosterAssignment.delete({ where: { id: assignment.id } });
    await writeAuditLog({
      businessId: args.context.businessId,
      branchId: assignment.branchId,
      actor: args.context.actor,
      request: args.context.request,
      action: "ROSTER_ASSIGNMENT_REMOVED",
      entityType: "RosterAssignment",
      entityId: assignment.id,
      summary: "Roster draft assignment removed. Published history remains unchanged.",
      before: assignmentSourceShape(assignment),
      metadata: { rosterPeriodId: assignment.rosterPeriodId },
    }, transaction);
    return { periodId: assignment.rosterPeriodId, draftRevision: args.expectedDraftRevision + 1 };
  });
}

export async function copyPreviousRosterWeek(args: {
  context: RosterServiceContext;
  branchId: string;
  targetWeekStart: Date;
  database?: PrismaClient;
}) {
  assertBranchScope(args.context, args.branchId);
  const targetWeekStart = dateOnly(args.targetWeekStart);
  assertWeeklyPeriod(targetWeekStart);
  const sourceWeekStart = addDays(targetWeekStart, -7);
  const database = args.database ?? prisma;
  return runSerializable(database, async (transaction) => {
    await getRosterBranch(transaction, args.context.businessId, args.branchId);
    const sourcePeriod = await transaction.rosterPeriod.findUnique({
      where: { businessId_branchId_weekStart: { businessId: args.context.businessId, branchId: args.branchId, weekStart: sourceWeekStart } },
    });
    if (!sourcePeriod || sourcePeriod.publicationRevision < 1) {
      throw new RosterError("NOT_FOUND", "The previous week has no published roster to copy.");
    }
    const sourcePublication = await transaction.rosterPublication.findUniqueOrThrow({
      where: { rosterPeriodId_revision: { rosterPeriodId: sourcePeriod.id, revision: sourcePeriod.publicationRevision } },
      include: { assignments: { orderBy: [{ workDate: "asc" }, { membershipId: "asc" }] } },
    });
    const target = await transaction.rosterPeriod.upsert({
      where: { businessId_branchId_weekStart: { businessId: args.context.businessId, branchId: args.branchId, weekStart: targetWeekStart } },
      update: {},
      create: {
        businessId: args.context.businessId,
        branchId: args.branchId,
        weekStart: targetWeekStart,
        createdById: args.context.actor.userId,
        updatedById: args.context.actor.userId,
      },
    });
    if (await transaction.rosterAssignment.count({ where: { rosterPeriodId: target.id } })) {
      throw new RosterError("TARGET_NOT_EMPTY", "Copy Week requires an empty target draft.");
    }
    if (target.status === "PUBLISHED" && !args.context.canAmendPublished) {
      throw new RosterError("PUBLISHED_AMENDMENT_FORBIDDEN", "Published roster changes require the amend-roster capability.");
    }
    const rows = [];
    for (const source of sourcePublication.assignments) {
      const workDate = addDays(source.workDate, 7);
      await assertEmployeeEligible(transaction, {
        businessId: args.context.businessId,
        branchId: args.branchId,
        membershipId: source.membershipId,
        workDate,
      });
      if (source.kind === "WORK_SHIFT") {
        await assertNoApprovedFullDayLeave(transaction, args.context.businessId, source.membershipId, workDate);
      }
      const existing = await transaction.rosterAssignment.findUnique({
        where: {
          businessId_membershipId_workDate: {
            businessId: args.context.businessId,
            membershipId: source.membershipId,
            workDate,
          },
        },
        select: { id: true },
      });
      if (existing) {
        throw new RosterError("TARGET_NOT_EMPTY", "Copy Week found an existing employee/day assignment in another roster.");
      }
      if (source.kind === "WORK_SHIFT") {
        await assertNoShiftOverlap(transaction, {
          businessId: args.context.businessId,
          membershipId: source.membershipId,
          startAt: new Date(source.startAt!.getTime() + 7 * 86_400_000),
          endAt: new Date(source.endAt!.getTime() + 7 * 86_400_000),
        });
      }
      rows.push({
        rosterPeriodId: target.id,
        businessId: args.context.businessId,
        branchId: args.branchId,
        membershipId: source.membershipId,
        workDate,
        kind: source.kind,
        startAt: source.startAt ? new Date(source.startAt.getTime() + 7 * 86_400_000) : null,
        endAt: source.endAt ? new Date(source.endAt.getTime() + 7 * 86_400_000) : null,
        breakMinutes: source.breakMinutes,
        note: source.note,
        createdById: args.context.actor.userId,
        updatedById: args.context.actor.userId,
      });
    }
    if (rows.length) await transaction.rosterAssignment.createMany({ data: rows });
    const period = await transaction.rosterPeriod.update({
      where: { id: target.id },
      data: { status: "DRAFT", draftRevision: { increment: 1 }, updatedById: args.context.actor.userId },
    });
    await writeAuditLog({
      businessId: args.context.businessId,
      branchId: args.branchId,
      actor: args.context.actor,
      request: args.context.request,
      action: "ROSTER_WEEK_COPIED",
      entityType: "RosterPeriod",
      entityId: period.id,
      summary: "Previous published roster copied into a new draft only.",
      metadata: { sourcePublicationId: sourcePublication.id, assignmentCount: rows.length },
    }, transaction);
    return period;
  });
}

export async function publishRoster(args: {
  context: RosterServiceContext;
  input: unknown;
  database?: PrismaClient;
  now?: Date;
}) {
  const input = publishSchema.parse(args.input);
  const database = args.database ?? prisma;
  const now = args.now ?? new Date();
  return runSerializable(database, async (transaction) => {
    const idempotent = await transaction.rosterPublication.findUnique({
      where: { businessId_operationKey: { businessId: args.context.businessId, operationKey: input.operationKey } },
      include: { assignments: true },
    });
    if (idempotent) return { publication: idempotent, idempotent: true };
    const period = await transaction.rosterPeriod.findFirst({
      where: { id: input.rosterPeriodId, businessId: args.context.businessId },
      include: { assignments: { orderBy: [{ workDate: "asc" }, { membershipId: "asc" }] } },
    });
    if (!period) throw new RosterError("NOT_FOUND", "Roster period was not found.");
    assertBranchScope(args.context, period.branchId);
    if (period.draftRevision !== input.expectedDraftRevision) {
      throw new RosterError("CONCURRENT_CHANGE", "The roster changed in another session. Refresh before publishing.");
    }
    if (period.publicationRevision > 0 && !args.context.canAmendPublished) {
      throw new RosterError("PUBLISHED_AMENDMENT_FORBIDDEN", "Publishing a new revision requires the amend-roster capability.");
    }
    const branch = await getRosterBranch(transaction, args.context.businessId, period.branchId);
    const localToday = getBranchLocalDateKey(now, branch.timezone);
    const priorPublication = period.publicationRevision > 0
      ? await transaction.rosterPublication.findUnique({
          where: { rosterPeriodId_revision: { rosterPeriodId: period.id, revision: period.publicationRevision } },
          include: { assignments: true },
        })
      : null;
    const historicalDates = new Set<string>();
    for (const assignment of period.assignments) {
      validateRosterAssignment(assignment);
      await assertEmployeeEligible(transaction, {
        businessId: args.context.businessId,
        branchId: period.branchId,
        membershipId: assignment.membershipId,
        workDate: assignment.workDate,
      });
      if (assignment.kind === "WORK_SHIFT") {
        await assertNoShiftOverlap(transaction, {
          businessId: args.context.businessId,
          membershipId: assignment.membershipId,
          startAt: assignment.startAt!,
          endAt: assignment.endAt!,
          excludeAssignmentId: assignment.id,
        });
        await assertNoApprovedFullDayLeave(transaction, args.context.businessId, assignment.membershipId, assignment.workDate);
      }
      const day = dateValue(assignment.workDate);
      if (day < localToday || (day === localToday && (!assignment.startAt || assignment.startAt <= now))) historicalDates.add(day);
    }
    for (const prior of priorPublication?.assignments ?? []) {
      if (dateValue(prior.workDate) < localToday) historicalDates.add(dateValue(prior.workDate));
    }
    if (historicalDates.size && (!args.context.canManageRetrospective || !input.reason)) {
      throw new RosterError(
        "RETROSPECTIVE_REVIEW_REQUIRED",
        "Past or already-started roster dates require retrospective capability and a reason. They cannot manufacture No-show evidence.",
      );
    }
    await assertNoLockedTimesheet(transaction, args.context.businessId, [
      ...period.assignments.map((item) => item.workDate),
      ...(priorPublication?.assignments.map((item) => item.workDate) ?? []),
    ]);
    const sourceDigest = rosterAssignmentDigest(period.assignments.map(assignmentSourceShape));
    const revision = period.publicationRevision + 1;
    const publication = await transaction.rosterPublication.create({
      data: {
        rosterPeriodId: period.id,
        businessId: args.context.businessId,
        branchId: period.branchId,
        revision,
        operationKey: input.operationKey,
        sourceDigest,
        reason: input.reason || null,
        publishedById: args.context.actor.userId,
        publishedAt: now,
      },
    });
    const evidenceMembershipIds = [...new Set([
      ...period.assignments.map((item) => item.membershipId),
      ...(priorPublication?.assignments.map((item) => item.membershipId) ?? []),
    ])];
    const currentByMemberDate = new Map(
      (await transaction.attendanceExpectedDay.findMany({
        where: {
          businessId: args.context.businessId,
          membershipId: { in: evidenceMembershipIds },
          workDate: { gte: period.weekStart, lt: addDays(period.weekStart, 7) },
          status: "CURRENT",
        },
      })).map((item) => [`${item.membershipId}:${dateValue(item.workDate)}`, item]),
    );
    const currentAssignmentKeys = new Set(period.assignments.map((item) => `${item.membershipId}:${dateValue(item.workDate)}`));
    for (const prior of priorPublication?.assignments ?? []) {
      const key = `${prior.membershipId}:${dateValue(prior.workDate)}`;
      if (currentAssignmentKeys.has(key) || historicalDates.has(dateValue(prior.workDate))) continue;
      const current = currentByMemberDate.get(key);
      if (current?.source === "ROSTER" && current.evidenceReference === prior.evidenceReference) {
        await transaction.attendanceExpectedDay.update({ where: { id: current.id }, data: { status: "SUPERSEDED" } });
        currentByMemberDate.delete(key);
      }
    }
    const snapshots = [];
    for (const assignment of period.assignments) {
      const key = `${assignment.membershipId}:${dateValue(assignment.workDate)}`;
      const retrospective = historicalDates.has(dateValue(assignment.workDate));
      const snapshotId = randomUUID();
      const evidenceReference = retrospective ? null : `roster:${publication.id}:${snapshotId}:r${revision}`;
      const snapshot = await transaction.rosterPublishedAssignment.create({
        data: {
          id: snapshotId,
          publicationId: publication.id,
          sourceAssignmentId: assignment.id,
          businessId: args.context.businessId,
          branchId: period.branchId,
          membershipId: assignment.membershipId,
          workDate: assignment.workDate,
          kind: assignment.kind,
          startAt: assignment.startAt,
          endAt: assignment.endAt,
          breakMinutes: assignment.breakMinutes,
          note: assignment.note,
          timezoneSnapshot: branch.timezone,
          evidenceDisposition: retrospective ? "RETROSPECTIVE_REVIEW_REQUIRED" : "APPLIED",
          evidenceReference,
        },
      });
      snapshots.push(snapshot);
      if (retrospective) continue;
      const current = currentByMemberDate.get(key);
      const publicHolidayContext = current?.kind === "PUBLIC_HOLIDAY"
        ? { expectedDayId: current.id, source: current.source, revision: current.revision }
        : null;
      if (current && current.source !== "ROSTER" && !(assignment.kind === "WORK_SHIFT" && publicHolidayContext)) {
        throw new RosterError(
          "EXPECTED_DAY_CONFLICT",
          "A non-roster expected-day record already controls this employee and date. Resolve it before publishing.",
        );
      }
      if (current) {
        await transaction.attendanceExpectedDay.update({ where: { id: current.id }, data: { status: "SUPERSEDED" } });
      }
      const latest = await transaction.attendanceExpectedDay.findFirst({
        where: { businessId: args.context.businessId, membershipId: assignment.membershipId, workDate: assignment.workDate },
        orderBy: { revision: "desc" },
      });
      await transaction.attendanceExpectedDay.create({
        data: {
          businessId: args.context.businessId,
          branchId: period.branchId,
          membershipId: assignment.membershipId,
          workDate: assignment.workDate,
          kind: expectedKindForRoster(assignment.kind),
          source: "ROSTER",
          expectedStartAt: assignment.startAt,
          expectedEndAt: assignment.endAt,
          graceMinutes: current?.source === "ROSTER" ? current.graceMinutes : 0,
          timezoneSnapshot: branch.timezone,
          policySnapshot: {
            rosterPublicationId: publication.id,
            rosterPublicationRevision: revision,
            rosterPublishedAssignmentId: snapshot.id,
            scheduledBreakMinutes: assignment.breakMinutes,
            publicHolidayContext,
            payrollEffect: "NONE",
          },
          evidenceReference,
          revision: (latest?.revision ?? 0) + 1,
          supersedesExpectedDayId: current?.id ?? null,
          createdById: args.context.actor.userId,
        },
      });
    }
    const updated = await transaction.rosterPeriod.updateMany({
      where: { id: period.id, draftRevision: input.expectedDraftRevision, publicationRevision: period.publicationRevision },
      data: { status: "PUBLISHED", publicationRevision: revision, updatedById: args.context.actor.userId },
    });
    if (updated.count !== 1) throw new RosterError("CONCURRENT_CHANGE", "The roster changed while publishing.");
    await writeAuditLog({
      businessId: args.context.businessId,
      branchId: period.branchId,
      actor: args.context.actor,
      request: args.context.request,
      action: historicalDates.size ? "ROSTER_RETROSPECTIVE_REVISION_PUBLISHED" : "ROSTER_PUBLISHED",
      entityType: "RosterPublication",
      entityId: publication.id,
      summary: historicalDates.size
        ? "Roster revision published with retrospective dates isolated from automatic Attendance evidence."
        : "Roster revision published and expected Attendance evidence versioned atomically.",
      metadata: {
        rosterPeriodId: period.id,
        revision,
        sourceDigest,
        assignmentCount: snapshots.length,
        retrospectiveDates: [...historicalDates],
      },
    }, transaction);
    return { publication: { ...publication, assignments: snapshots }, idempotent: false };
  });
}

export async function getRosterManagerOverview(args: {
  context: Pick<RosterServiceContext, "businessId" | "allowedBranchIds">;
  from: Date;
  to: Date;
  database?: PrismaClient;
}) {
  const from = dateOnly(args.from);
  const to = dateOnly(args.to);
  const database = args.database ?? prisma;
  const periods = await database.rosterPeriod.findMany({
    where: {
      businessId: args.context.businessId,
      branchId: { in: [...args.context.allowedBranchIds] },
      weekStart: { gte: startOfIsoWeek(from), lte: startOfIsoWeek(to) },
    },
    include: {
      branch: { select: { id: true, name: true } },
      assignments: {
        include: { membership: { select: { id: true, fullName: true, employeeCode: true } } },
        orderBy: [{ workDate: "asc" }, { membership: { fullName: "asc" } }],
      },
      publications: { orderBy: { revision: "desc" }, take: 1 },
    },
    orderBy: [{ weekStart: "asc" }, { branch: { name: "asc" } }],
  });
  return periods;
}

export async function getEmployeePublishedRoster(args: {
  businessId: string;
  membershipId: string;
  from: Date;
  to: Date;
  database?: PrismaClient;
}) {
  const from = dateOnly(args.from);
  const to = dateOnly(args.to);
  const database = args.database ?? prisma;
  const periods = await database.rosterPeriod.findMany({
    where: {
      businessId: args.businessId,
      weekStart: { gte: startOfIsoWeek(addDays(from, -6)), lte: startOfIsoWeek(to) },
      publicationRevision: { gt: 0 },
    },
    select: { id: true, publicationRevision: true },
  });
  if (!periods.length) return [];
  const publications = await database.rosterPublication.findMany({
    where: { OR: periods.map((period) => ({ rosterPeriodId: period.id, revision: period.publicationRevision })) },
    select: { id: true, revision: true, publishedAt: true },
  });
  if (!publications.length) return [];
  return database.rosterPublishedAssignment.findMany({
    where: {
      businessId: args.businessId,
      membershipId: args.membershipId,
      publicationId: { in: publications.map((item) => item.id) },
      workDate: { gte: from, lte: to },
    },
    include: {
      branch: { select: { id: true, name: true } },
      publication: { select: { revision: true, publishedAt: true } },
    },
    orderBy: [{ workDate: "asc" }, { startAt: "asc" }],
  });
}

export async function reconcileRosterExpectedDays(args: {
  context: Pick<RosterServiceContext, "businessId" | "allowedBranchIds">;
  from: Date;
  to: Date;
  database?: PrismaClient;
}) {
  const database = args.database ?? prisma;
  const snapshots = await database.rosterPublishedAssignment.findMany({
    where: {
      businessId: args.context.businessId,
      branchId: { in: [...args.context.allowedBranchIds] },
      workDate: { gte: dateOnly(args.from), lte: dateOnly(args.to) },
      evidenceDisposition: "APPLIED",
      publication: { rosterPeriod: { publicationRevision: { gt: 0 } } },
    },
    include: { publication: { include: { rosterPeriod: { select: { publicationRevision: true } } } } },
  });
  const currentSnapshots = snapshots.filter((item) => item.publication.revision === item.publication.rosterPeriod.publicationRevision);
  const expected = await database.attendanceExpectedDay.findMany({
    where: {
      businessId: args.context.businessId,
      branchId: { in: [...args.context.allowedBranchIds] },
      workDate: { gte: dateOnly(args.from), lte: dateOnly(args.to) },
      status: "CURRENT",
    },
  });
  const expectedByReference = new Map(expected.flatMap((item) => item.evidenceReference ? [[item.evidenceReference, item] as const] : []));
  const issues: Array<{ code: string; snapshotId: string; expectedDayId?: string }> = [];
  for (const snapshot of currentSnapshots) {
    const row = snapshot.evidenceReference ? expectedByReference.get(snapshot.evidenceReference) : undefined;
    if (!row) {
      issues.push({ code: "MISSING_EXPECTED_DAY", snapshotId: snapshot.id });
      continue;
    }
    if (
      row.source !== "ROSTER" ||
      row.membershipId !== snapshot.membershipId ||
      row.branchId !== snapshot.branchId ||
      dateValue(row.workDate) !== dateValue(snapshot.workDate) ||
      row.kind !== expectedKindForRoster(snapshot.kind) ||
      row.expectedStartAt?.getTime() !== snapshot.startAt?.getTime() ||
      row.expectedEndAt?.getTime() !== snapshot.endAt?.getTime() ||
      row.timezoneSnapshot !== snapshot.timezoneSnapshot
    ) {
      issues.push({ code: "EXPECTED_DAY_MISMATCH", snapshotId: snapshot.id, expectedDayId: row.id });
    }
  }
  const references = new Set(currentSnapshots.flatMap((item) => item.evidenceReference ? [item.evidenceReference] : []));
  for (const row of expected) {
    if (row.source === "ROSTER" && (!row.evidenceReference || !references.has(row.evidenceReference))) {
      issues.push({ code: "STALE_ROSTER_EXPECTED_DAY", snapshotId: "", expectedDayId: row.id });
    }
  }
  return { checked: currentSnapshots.length, issues, consistent: issues.length === 0 };
}

async function getRosterBranch(transaction: Prisma.TransactionClient, businessId: string, branchId: string) {
  const branch = await transaction.branch.findFirst({
    where: { id: branchId, businessId, status: "ACTIVE" },
    select: {
      id: true,
      attendanceSetting: { select: { timezone: true } },
      business: { select: { timezone: true } },
    },
  });
  if (!branch) throw new RosterError("OUTSIDE_SCOPE", "Roster branch is not active in the authorised business.");
  return { id: branch.id, timezone: branch.attendanceSetting?.timezone ?? branch.business.timezone };
}

async function assertEmployeeEligible(
  transaction: Prisma.TransactionClient,
  input: { businessId: string; branchId: string; membershipId: string; workDate: Date },
) {
  const nextDay = addDays(input.workDate, 1);
  const membership = await transaction.employeeBusinessMembership.findFirst({
    where: {
      id: input.membershipId,
      businessId: input.businessId,
      status: "ACTIVE",
      joinedAt: { lt: nextDay },
      OR: [{ terminatedAt: null }, { terminatedAt: { gte: input.workDate } }],
      branchAssignments: {
        some: {
          businessId: input.businessId,
          branchId: input.branchId,
          status: "ACTIVE",
          effectiveFrom: { lt: nextDay },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: input.workDate } }],
        },
      },
    },
    select: { id: true },
  });
  if (!membership) {
    throw new RosterError("OUTSIDE_SCOPE", "Employee is inactive, outside employment dates, or not assigned to this branch.");
  }
}

async function assertNoApprovedFullDayLeave(
  transaction: Prisma.TransactionClient,
  businessId: string,
  membershipId: string,
  workDate: Date,
) {
  const leave = await transaction.leaveRequestDay.findFirst({
    where: {
      businessId,
      membershipId,
      leaveDate: workDate,
      dayFraction: { gte: 1 },
      leaveRequest: { status: "APPROVED" },
    },
    select: { id: true },
  });
  if (leave) {
    throw new RosterError("LEAVE_CONFLICT", "An approved full-day Leave record conflicts with this work shift.");
  }
}

async function assertNoShiftOverlap(
  transaction: Prisma.TransactionClient,
  input: {
    businessId: string;
    membershipId: string;
    startAt: Date;
    endAt: Date;
    excludeAssignmentId?: string;
  },
) {
  const conflict = await transaction.rosterAssignment.findFirst({
    where: {
      businessId: input.businessId,
      membershipId: input.membershipId,
      kind: "WORK_SHIFT",
      startAt: { lt: input.endAt },
      endAt: { gt: input.startAt },
      ...(input.excludeAssignmentId ? { id: { not: input.excludeAssignmentId } } : {}),
    },
    select: { id: true },
  });
  if (conflict) {
    throw new RosterError(
      "SHIFT_CONFLICT",
      "This shift overlaps another assignment for the employee, including an overnight or cross-branch shift.",
    );
  }
}

async function assertNoLockedTimesheet(
  transaction: Prisma.TransactionClient,
  businessId: string,
  dates: readonly Date[],
) {
  const months = [...new Map(dates.map((date) => {
    const value = dateOnly(date);
    const month = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
    return [month.toISOString(), month] as const;
  })).values()];
  if (!months.length) return;
  const locked = await transaction.attendanceMonthlyTimesheet.findFirst({
    where: { businessId, periodStart: { in: months }, status: "LOCKED" },
    select: { periodStart: true },
  });
  if (locked) {
    throw new RosterError(
      "TIMESHEET_REOPEN_REQUIRED",
      `The ${locked.periodStart.toISOString().slice(0, 7)} Timesheet is locked. Reopen it through the canonical Timesheet workflow first.`,
    );
  }
}

function assertBranchScope(context: Pick<RosterServiceContext, "allowedBranchIds">, branchId: string) {
  if (!context.allowedBranchIds.includes(branchId)) {
    throw new RosterError("OUTSIDE_SCOPE", "Roster branch is outside the authorised scope.");
  }
}

async function runSerializable<T>(database: PrismaClient, operation: (transaction: Prisma.TransactionClient) => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await database.$transaction(operation, transactionOptions);
    } catch (error) {
      lastError = error;
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034") throw error;
    }
  }
  throw lastError;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "Invalid roster assignment.";
}
