import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { getBranchLocalDateKey, parseBranchLocalDateTime } from "@/lib/attendance/work-date";
import { writeAuditLog, type AuditRequestContext } from "@/lib/audit";
import type { AppSession } from "@/lib/auth/session";
import { holidayContext } from "@/lib/holidays/domain";
import { resolveBranchHolidays } from "@/lib/holidays/service";
import { prisma } from "@/lib/prisma";
import {
  addDays,
  assignmentSourceShape,
  assertWeeklyPeriod,
  changedRosterAssignments,
  dateOnly,
  dateValue,
  expectedKindForRoster,
  rosterAssignmentDigest,
  startOfIsoWeek,
  validateRosterAssignment,
  type RosterAssignmentInput,
} from "./domain";
import { resolveRosterWeek } from "./employee-schedule-service";

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
      | "VARIABLE_REST_REQUIRED"
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
  shiftTemplateId: z.string().uuid().nullable().optional(),
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
  const database = args.database ?? prisma;
  return runSerializable(database, async (transaction) => {
    const branch = await getRosterBranch(transaction, args.context.businessId, input.branchId);
    const normalized = await resolveTemplateAssignment(transaction, args.context.businessId, input.branchId, branch.timezone, {
      ...input,
      workDate,
    });
    try {
      validateRosterAssignment(normalized);
    } catch (error) {
      throw new RosterError("INVALID_ASSIGNMENT", messageOf(error));
    }
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
    await assertNoApprovedFullDayLeave(transaction, args.context.businessId, normalized.membershipId, workDate);
    if (normalized.kind === "WORK_SHIFT") {
      await assertNoShiftOverlap(transaction, {
        businessId: args.context.businessId,
        membershipId: normalized.membershipId,
        startAt: normalized.startAt!,
        endAt: normalized.endAt!,
        excludeAssignmentId: existing?.id,
      });
    }
    const assignmentData = {
      branchId: input.branchId,
      kind: normalized.kind,
      shiftTemplateId: normalized.kind === "WORK_SHIFT" ? normalized.shiftTemplateId : null,
      shiftNameSnapshot: normalized.kind === "WORK_SHIFT" ? normalized.shiftNameSnapshot : null,
      shiftColorSnapshot: normalized.kind === "WORK_SHIFT" ? normalized.shiftColorSnapshot : null,
      crossMidnightSnapshot: normalized.kind === "WORK_SHIFT" ? normalized.crossMidnightSnapshot : null,
      startAt: normalized.kind === "WORK_SHIFT" ? normalized.startAt : null,
      endAt: normalized.kind === "WORK_SHIFT" ? normalized.endAt : null,
      breakMinutes: normalized.kind === "WORK_SHIFT" ? normalized.breakMinutes : 0,
      breakPaidSnapshot: normalized.kind === "WORK_SHIFT" ? normalized.breakPaidSnapshot ?? false : false,
      note: normalized.note || null,
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

export async function ensureRosterPeriod(args: {
  context: RosterServiceContext;
  branchId: string;
  weekStart: Date;
  database?: PrismaClient;
}) {
  assertBranchScope(args.context, args.branchId);
  const weekStart = dateOnly(args.weekStart);
  assertWeeklyPeriod(weekStart);
  const database = args.database ?? prisma;
  return database.rosterPeriod.upsert({
    where: { businessId_branchId_weekStart: { businessId: args.context.businessId, branchId: args.branchId, weekStart } },
    update: {},
    create: { businessId: args.context.businessId, branchId: args.branchId, weekStart, createdById: args.context.actor.userId, updatedById: args.context.actor.userId },
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
    const key = `${row.membershipId}:${dateValue(row.workDate)}`;
    if (keys.has(key)) throw new RosterError("INVALID_ASSIGNMENT", "Bulk assignment contains a duplicate employee/day row.");
    keys.add(key);
  }
  const database = args.database ?? prisma;
  return runSerializable(database, async (transaction) => {
    const branch = await getRosterBranch(transaction, args.context.businessId, args.input.branchId);
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
      const normalized = await resolveTemplateAssignment(
        transaction,
        args.context.businessId,
        args.input.branchId,
        branch.timezone,
        { ...row, workDate },
      );
      try { validateRosterAssignment(normalized); } catch (error) { throw new RosterError("INVALID_ASSIGNMENT", messageOf(error)); }
      await assertEmployeeEligible(transaction, { businessId: args.context.businessId, branchId: args.input.branchId, membershipId: row.membershipId, workDate });
      const existing = await transaction.rosterAssignment.findUnique({
        where: { businessId_membershipId_workDate: { businessId: args.context.businessId, membershipId: row.membershipId, workDate } },
      });
      if (existing && existing.rosterPeriodId !== period.id) throw new RosterError("MULTIPLE_SHIFT_SAME_DAY", "An employee already has an assignment on that day in another branch.");
      await assertNoApprovedFullDayLeave(transaction, args.context.businessId, normalized.membershipId, workDate);
      if (normalized.kind === "WORK_SHIFT") {
        await assertNoShiftOverlap(transaction, {
          businessId: args.context.businessId,
          membershipId: normalized.membershipId,
          startAt: normalized.startAt!,
          endAt: normalized.endAt!,
          excludeAssignmentId: existing?.id,
        });
      }
      const data = {
        branchId: args.input.branchId,
        kind: normalized.kind,
        shiftTemplateId: normalized.kind === "WORK_SHIFT" ? normalized.shiftTemplateId : null,
        shiftNameSnapshot: normalized.kind === "WORK_SHIFT" ? normalized.shiftNameSnapshot : null,
        shiftColorSnapshot: normalized.kind === "WORK_SHIFT" ? normalized.shiftColorSnapshot : null,
        crossMidnightSnapshot: normalized.kind === "WORK_SHIFT" ? normalized.crossMidnightSnapshot : null,
        startAt: normalized.kind === "WORK_SHIFT" ? normalized.startAt : null,
        endAt: normalized.kind === "WORK_SHIFT" ? normalized.endAt : null,
        breakMinutes: normalized.kind === "WORK_SHIFT" ? normalized.breakMinutes ?? 0 : 0,
        breakPaidSnapshot: normalized.kind === "WORK_SHIFT" ? normalized.breakPaidSnapshot ?? false : false,
        note: normalized.note?.trim() || null,
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
    const sourceOverrides = sourcePublication.assignments.filter((assignment) => assignment.sourceAssignmentId !== null);
    const rows = [];
    for (const source of sourceOverrides) {
      const workDate = addDays(source.workDate, 7);
      if (source.shiftTemplateId) {
        const reusableTemplate = await transaction.rosterShiftTemplate.findFirst({
          where: {
            id: source.shiftTemplateId,
            businessId: args.context.businessId,
            active: true,
            OR: [{ branchId: null }, { branchId: args.branchId }],
          },
          select: { id: true },
        });
        if (!reusableTemplate) {
          throw new RosterError("INVALID_ASSIGNMENT", `Shift template ${source.shiftNameSnapshot ?? "from the previous week"} is inactive or unavailable.`);
        }
      }
      await assertEmployeeEligible(transaction, {
        businessId: args.context.businessId,
        branchId: args.branchId,
        membershipId: source.membershipId,
        workDate,
      });
      await assertNoApprovedFullDayLeave(transaction, args.context.businessId, source.membershipId, workDate);
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
        shiftTemplateId: source.shiftTemplateId,
        shiftNameSnapshot: source.shiftNameSnapshot,
        shiftColorSnapshot: source.shiftColorSnapshot,
        crossMidnightSnapshot: source.crossMidnightSnapshot,
        startAt: source.startAt ? new Date(source.startAt.getTime() + 7 * 86_400_000) : null,
        endAt: source.endAt ? new Date(source.endAt.getTime() + 7 * 86_400_000) : null,
        breakMinutes: source.breakMinutes,
        breakPaidSnapshot: source.breakPaidSnapshot,
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
      summary: "Previous published weekly exceptions copied into a new draft only.",
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
    const resolution = await resolveRosterWeek({
      businessId: args.context.businessId,
      branchId: period.branchId,
      weekStart: period.weekStart,
      database: transaction,
      overrides: period.assignments,
    });
    if (resolution.attention.length) {
      const employeeNames = resolution.attention.map((item) => `${item.employeeName} (${item.assigned}/${item.required} Rest Days)`).join(", ");
      throw new RosterError("VARIABLE_REST_REQUIRED", `Roster requires attention. Assign the required variable Rest Days before publishing: ${employeeNames}.`);
    }
    const resolvedAssignments = resolution.assignments;
    const historicalDates = new Set<string>();
    for (const assignment of resolvedAssignments) {
      validateRosterAssignment(assignment);
      const day = dateValue(assignment.workDate);
      if (day < localToday || (day === localToday && (!assignment.startAt || assignment.startAt <= now))) historicalDates.add(day);
    }
    for (const assignment of period.assignments) {
      validateRosterAssignment(assignment);
      if (assignment.shiftTemplateId) {
        const template = await transaction.rosterShiftTemplate.findFirst({
          where: {
            id: assignment.shiftTemplateId,
            businessId: args.context.businessId,
            active: true,
            OR: [{ branchId: null }, { branchId: period.branchId }],
          },
          select: { id: true },
        });
        if (!template) {
          throw new RosterError("INVALID_ASSIGNMENT", `Shift template ${assignment.shiftNameSnapshot ?? "used by this roster"} is inactive or unavailable.`);
        }
      }
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
    const changedAssignments = priorPublication
      ? changedRosterAssignments(resolvedAssignments, priorPublication.assignments)
      : period.assignments;
    const retrospectiveChangeDates = new Set(changedAssignments.flatMap((assignment) => {
      const day = dateValue(assignment.workDate);
      return day < localToday || (day === localToday && (!assignment.startAt || assignment.startAt <= now)) ? [day] : [];
    }));
    if (retrospectiveChangeDates.size && (!args.context.canManageRetrospective || !input.reason)) {
      throw new RosterError(
        "RETROSPECTIVE_REVIEW_REQUIRED",
        "Past or already-started roster dates require retrospective capability and a reason. They cannot manufacture No-show evidence.",
      );
    }
    await assertRosterPublishDatesUnlocked(transaction, args.context.businessId, [
      ...resolvedAssignments.map((item) => item.workDate),
      ...(priorPublication?.assignments.map((item) => item.workDate) ?? []),
    ]);
    const sourceDigest = rosterAssignmentDigest(resolvedAssignments.map((assignment) => ({
      ...assignmentSourceShape(assignment),
      sourceAssignmentId: assignment.sourceAssignmentId,
      sourceScheduleVersionId: assignment.sourceScheduleVersionId,
      resolvedSource: assignment.resolvedSource,
    })));
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
      ...resolvedAssignments.map((item) => item.membershipId),
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
    const holidayByDate = new Map<string, Awaited<ReturnType<typeof resolveBranchHolidays>>[number]>();
    for (const holiday of await resolveBranchHolidays({
      businessId: args.context.businessId,
      branchId: period.branchId,
      from: period.weekStart,
      to: addDays(period.weekStart, 6),
      database: transaction,
    })) {
      const key = dateValue(holiday.workDate);
      if (!holidayByDate.has(key)) holidayByDate.set(key, holiday);
    }
    const currentAssignmentKeys = new Set(resolvedAssignments.map((item) => `${item.membershipId}:${dateValue(item.workDate)}`));
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
    for (const assignment of resolvedAssignments) {
      const key = `${assignment.membershipId}:${dateValue(assignment.workDate)}`;
      const retrospective = historicalDates.has(dateValue(assignment.workDate));
      const snapshotId = randomUUID();
      const evidenceReference = retrospective ? null : `roster:${publication.id}:${snapshotId}:r${revision}`;
      const snapshot = await transaction.rosterPublishedAssignment.create({
        data: {
          id: snapshotId,
          publicationId: publication.id,
          sourceAssignmentId: assignment.sourceAssignmentId,
          sourceScheduleVersionId: assignment.sourceScheduleVersionId,
          resolvedSource: assignment.resolvedSource,
          businessId: args.context.businessId,
          branchId: period.branchId,
          membershipId: assignment.membershipId,
          workDate: assignment.workDate,
          kind: assignment.kind,
          shiftTemplateId: assignment.shiftTemplateId,
          shiftNameSnapshot: assignment.shiftNameSnapshot,
          shiftColorSnapshot: assignment.shiftColorSnapshot,
          crossMidnightSnapshot: assignment.crossMidnightSnapshot,
          startAt: assignment.startAt,
          endAt: assignment.endAt,
          breakMinutes: assignment.breakMinutes,
          breakPaidSnapshot: assignment.breakPaidSnapshot,
          note: assignment.note,
          timezoneSnapshot: branch.timezone,
          evidenceDisposition: retrospective ? "RETROSPECTIVE_REVIEW_REQUIRED" : "APPLIED",
          evidenceReference,
        },
      });
      snapshots.push(snapshot);
      if (retrospective) continue;
      const current = currentByMemberDate.get(key);
      const resolvedHoliday = holidayByDate.get(dateValue(assignment.workDate));
      const currentPublicHolidayContext = current?.kind === "PUBLIC_HOLIDAY"
        ? { expectedDayId: current.id, source: current.source, revision: current.revision }
        : null;
      const publicHolidayContext = resolvedHoliday || currentPublicHolidayContext
        ? {
            ...currentPublicHolidayContext,
            ...holidayContext(resolvedHoliday),
          }
        : null;
      if (current && current.source !== "ROSTER" && !(assignment.kind === "WORK_SHIFT" && currentPublicHolidayContext)) {
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
            scheduledBreakPaid: assignment.breakPaidSnapshot,
            resolvedSource: assignment.resolvedSource,
            sourceScheduleVersionId: assignment.sourceScheduleVersionId,
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
      publications: { include: { assignments: true }, orderBy: { revision: "desc" }, take: 1 },
    },
    orderBy: [{ weekStart: "asc" }, { branch: { name: "asc" } }],
  });
  return periods;
}

export async function getEmployeePublishedRoster(args: {
  businessId: string;
  membershipId: string;
  branchId?: string;
  from: Date;
  to: Date;
  database?: PrismaClient;
}) {
  const from = dateOnly(args.from);
  const to = dateOnly(args.to);
  const database = args.database ?? prisma;
  const requestedWeeks: Date[] = [];
  for (let week = startOfIsoWeek(from); week <= startOfIsoWeek(to); week = addDays(week, 7)) requestedWeeks.push(week);
  const periods = await database.rosterPeriod.findMany({
    where: {
      businessId: args.businessId,
      ...(args.branchId ? { branchId: args.branchId } : {}),
      weekStart: { gte: startOfIsoWeek(addDays(from, -6)), lte: startOfIsoWeek(to) },
      publicationRevision: { gt: 0 },
    },
    select: { id: true, weekStart: true, publicationRevision: true },
  });
  const publications = await database.rosterPublication.findMany({
    where: { OR: periods.map((period) => ({ rosterPeriodId: period.id, revision: period.publicationRevision })) },
    select: { id: true, revision: true, publishedAt: true },
  });
  const publishedAssignments = publications.length ? await database.rosterPublishedAssignment.findMany({
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
  }) : [];
  if (!args.branchId) return publishedAssignments;

  const publishedWeekKeys = new Set(periods.map((period) => dateValue(period.weekStart)));
  const branch = await database.branch.findFirst({
    where: { id: args.branchId, businessId: args.businessId, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  if (!branch) return publishedAssignments;
  const effectiveAssignments = [];
  for (const weekStart of requestedWeeks) {
    if (publishedWeekKeys.has(dateValue(weekStart))) continue;
    const resolution = await resolveRosterWeek({
      businessId: args.businessId,
      branchId: args.branchId,
      weekStart,
      database,
      overrides: [],
    });
    if (resolution.attention.some((item) => item.membershipId === args.membershipId)) continue;
    for (const assignment of resolution.assignments) {
      if (assignment.membershipId !== args.membershipId || assignment.workDate < from || assignment.workDate > to) continue;
      effectiveAssignments.push({
        id: assignment.id,
        publicationId: `effective:${assignment.sourceScheduleVersionId ?? "none"}`,
        sourceAssignmentId: null,
        sourceScheduleVersionId: assignment.sourceScheduleVersionId,
        resolvedSource: assignment.resolvedSource,
        businessId: args.businessId,
        branchId: args.branchId,
        membershipId: assignment.membershipId,
        workDate: assignment.workDate,
        kind: assignment.kind,
        shiftTemplateId: assignment.shiftTemplateId,
        shiftNameSnapshot: assignment.shiftNameSnapshot,
        shiftColorSnapshot: assignment.shiftColorSnapshot,
        crossMidnightSnapshot: assignment.crossMidnightSnapshot,
        startAt: assignment.startAt,
        endAt: assignment.endAt,
        breakMinutes: assignment.breakMinutes,
        breakPaidSnapshot: assignment.breakPaidSnapshot,
        note: assignment.note,
        timezoneSnapshot: resolution.timezone,
        evidenceDisposition: "APPLIED" as const,
        evidenceReference: null,
        createdAt: new Date(0),
        branch,
        publication: { revision: 0, publishedAt: new Date(0) },
      });
    }
  }
  return [...publishedAssignments, ...effectiveAssignments].sort((left, right) => left.workDate.getTime() - right.workDate.getTime() || (left.startAt?.getTime() ?? 0) - (right.startAt?.getTime() ?? 0));
}

export async function ensureEffectiveRosterExpectedDayInTransaction(args: {
  businessId: string;
  branchId: string;
  membershipId: string;
  workDate: Date;
  transaction: Prisma.TransactionClient;
}) {
  const workDate = dateOnly(args.workDate);
  const current = await args.transaction.attendanceExpectedDay.findFirst({
    where: { businessId: args.businessId, branchId: args.branchId, membershipId: args.membershipId, workDate, status: "CURRENT" },
    orderBy: { revision: "desc" },
  });
  if (current) return current;

  const weekStart = startOfIsoWeek(workDate);
  const publishedPeriod = await args.transaction.rosterPeriod.findUnique({
    where: { businessId_branchId_weekStart: { businessId: args.businessId, branchId: args.branchId, weekStart } },
    select: { publicationRevision: true },
  });
  if (publishedPeriod?.publicationRevision) return null;

  const resolution = await resolveRosterWeek({ businessId: args.businessId, branchId: args.branchId, weekStart, database: args.transaction, overrides: [] });
  if (resolution.attention.some((item) => item.membershipId === args.membershipId)) return null;
  const assignment = resolution.assignments.find((item) => item.membershipId === args.membershipId && dateValue(item.workDate) === dateValue(workDate));
  if (!assignment?.sourceScheduleVersionId) return null;
  const schedule = await args.transaction.employeeRosterScheduleVersion.findFirst({
    where: { id: assignment.sourceScheduleVersionId, businessId: args.businessId, branchId: args.branchId, membershipId: args.membershipId },
    select: { createdById: true, sourceDigest: true },
  });
  if (!schedule) return null;
  const [resolvedHoliday] = await resolveBranchHolidays({
    businessId: args.businessId,
    branchId: args.branchId,
    from: workDate,
    to: workDate,
    database: args.transaction,
  });
  const latest = await args.transaction.attendanceExpectedDay.findFirst({
    where: { businessId: args.businessId, membershipId: args.membershipId, workDate },
    orderBy: { revision: "desc" },
    select: { revision: true },
  });
  return args.transaction.attendanceExpectedDay.create({
    data: {
      businessId: args.businessId,
      branchId: args.branchId,
      membershipId: args.membershipId,
      workDate,
      kind: expectedKindForRoster(assignment.kind),
      source: "ROSTER",
      expectedStartAt: assignment.startAt,
      expectedEndAt: assignment.endAt,
      graceMinutes: 0,
      timezoneSnapshot: resolution.timezone,
      policySnapshot: {
        effectiveScheduleBaseline: true,
        sourceScheduleVersionId: assignment.sourceScheduleVersionId,
        sourceScheduleDigest: schedule.sourceDigest,
        resolvedSource: assignment.resolvedSource,
        scheduledBreakMinutes: assignment.breakMinutes,
        scheduledBreakPaid: assignment.breakPaidSnapshot,
        publicHolidayContext: holidayContext(resolvedHoliday),
        payrollEffect: "NONE",
      },
      evidenceReference: `effective-roster:${assignment.sourceScheduleVersionId}:${dateValue(workDate)}`,
      revision: (latest?.revision ?? 0) + 1,
      createdById: schedule.createdById,
    },
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

async function resolveTemplateAssignment(
  transaction: Prisma.TransactionClient,
  businessId: string,
  branchId: string,
  timezone: string,
  input: RosterAssignmentInput,
): Promise<RosterAssignmentInput> {
  if (input.kind !== "WORK_SHIFT") {
    return {
      ...input,
      shiftTemplateId: null,
      shiftNameSnapshot: null,
      shiftColorSnapshot: null,
      crossMidnightSnapshot: null,
      startAt: null,
      endAt: null,
      breakMinutes: 0,
      breakPaidSnapshot: false,
    };
  }
  if (!input.shiftTemplateId) return input;
  const template = await transaction.rosterShiftTemplate.findFirst({
    where: {
      id: input.shiftTemplateId,
      businessId,
      active: true,
      OR: [{ branchId: null }, { branchId }],
    },
  });
  if (!template) {
    throw new RosterError("INVALID_ASSIGNMENT", "The selected shift template is inactive or outside this branch.");
  }
  const workDate = dateValue(input.workDate);
  const endDate = template.crossMidnight ? dateValue(addDays(input.workDate, 1)) : workDate;
  return {
    ...input,
    shiftTemplateId: template.id,
    shiftNameSnapshot: template.name,
    shiftColorSnapshot: template.colorToken,
    crossMidnightSnapshot: template.crossMidnight,
    startAt: parseBranchLocalDateTime(`${workDate}T${minuteValue(template.startMinute)}`, timezone),
    endAt: parseBranchLocalDateTime(`${endDate}T${minuteValue(template.endMinute)}`, timezone),
    breakMinutes: template.breakMinutes,
    breakPaidSnapshot: template.breakPaid,
  };
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

function minuteValue(value: number) {
  const hour = Math.floor(value / 60).toString().padStart(2, "0");
  const minute = (value % 60).toString().padStart(2, "0");
  return `${hour}:${minute}`;
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
    throw new RosterError("LEAVE_CONFLICT", "Approved full-day Leave already controls this date. Remove or change the Leave record before adding a weekly roster exception.");
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

export async function assertRosterPublishDatesUnlocked(
  database: PrismaClient | Prisma.TransactionClient,
  businessId: string,
  dates: readonly Date[],
) {
  const months = [...new Map(dates.map((date) => {
    const value = dateOnly(date);
    const month = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
    return [month.toISOString(), month] as const;
  })).values()];
  if (!months.length) return;
  const locked = await database.attendanceMonthlyTimesheet.findFirst({
    where: { businessId, periodStart: { in: months }, status: "LOCKED" },
    select: { periodStart: true },
  });
  if (locked) {
    throw new RosterError(
      "TIMESHEET_REOPEN_REQUIRED",
      `The ${locked.periodStart.toISOString().slice(0, 7)} Timesheet is locked. Reopen it in Attendance > Monthly timesheets before publishing or changing this roster.`,
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
