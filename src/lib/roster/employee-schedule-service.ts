import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { parseBranchLocalDateTime } from "@/lib/attendance/work-date";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { addDays, dateOnly, dateValue, type RosterAssignmentInput } from "./domain";
import type { RosterServiceContext } from "./service";

const scheduleSchema = z.object({
  branchId: z.string().uuid(),
  membershipId: z.string().uuid(),
  effectiveFrom: z.date(),
  defaultShiftTemplateId: z.string().uuid().nullable(),
  restPolicy: z.enum(["FIXED", "VARIABLE"]),
  fixedRestWeekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
  requiredRestDays: z.number().int().min(0).max(7).default(0),
});

const recurringRestDaySchema = z.object({
  branchId: z.string().uuid(),
  membershipId: z.string().uuid(),
  weekday: z.number().int().min(1).max(7),
});

export type ResolvedRosterDay = Omit<
  RosterAssignmentInput,
  | "shiftTemplateId"
  | "shiftNameSnapshot"
  | "shiftColorSnapshot"
  | "crossMidnightSnapshot"
  | "startAt"
  | "endAt"
  | "breakMinutes"
  | "breakPaidSnapshot"
  | "note"
> & {
  id: string;
  shiftTemplateId: string | null;
  shiftNameSnapshot: string | null;
  shiftColorSnapshot: string | null;
  crossMidnightSnapshot: boolean | null;
  startAt: Date | null;
  endAt: Date | null;
  breakMinutes: number;
  sourceAssignmentId: string | null;
  sourceScheduleVersionId: string | null;
  resolvedSource: "DEFAULT_SHIFT" | "FIXED_REST" | "VARIABLE_REST" | "WEEKLY_SHIFT_OVERRIDE" | "WEEKLY_REST_OVERRIDE" | "WEEKLY_NOT_SCHEDULED_OVERRIDE" | "CUSTOM_SHIFT";
  breakPaidSnapshot: boolean;
  note: string | null;
  membership: { id: string; fullName: string; employeeCode: string };
};

export async function saveEmployeeRosterSchedule(args: {
  context: RosterServiceContext;
  input: unknown;
  database?: PrismaClient;
}) {
  const input = scheduleSchema.parse(args.input);
  const effectiveFrom = dateOnly(input.effectiveFrom);
  if (!args.context.allowedBranchIds.includes(input.branchId)) throw new Error("Employee schedule branch is outside the authorised scope.");
  const database = args.database ?? prisma;
  return database.$transaction(async (transaction) => {
    const membership = await transaction.employeeBusinessMembership.findFirst({
      where: {
        id: input.membershipId,
        businessId: args.context.businessId,
        status: "ACTIVE",
        joinedAt: { lte: effectiveFrom },
        OR: [{ terminatedAt: null }, { terminatedAt: { gte: effectiveFrom } }],
        branchAssignments: {
          some: {
            businessId: args.context.businessId,
            branchId: input.branchId,
            status: "ACTIVE",
            effectiveFrom: { lte: effectiveFrom },
            OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: effectiveFrom } }],
          },
        },
      },
      select: { id: true, fullName: true },
    });
    if (!membership) throw new Error("Employee is not active in this branch on the effective date.");
    const template = input.defaultShiftTemplateId ? await transaction.rosterShiftTemplate.findFirst({
      where: {
        id: input.defaultShiftTemplateId,
        businessId: args.context.businessId,
        active: true,
        OR: [{ branchId: null }, { branchId: input.branchId }],
      },
    }) : null;
    if (input.defaultShiftTemplateId && !template) throw new Error("Default shift template is inactive or unavailable for this branch.");
    const fixedRestWeekdays = [...new Set(input.fixedRestWeekdays)].sort((left, right) => left - right);
    if (input.restPolicy === "FIXED" && input.requiredRestDays !== fixedRestWeekdays.length) {
      throw new Error("Fixed rest-day count must match the selected weekdays.");
    }
    if (input.restPolicy === "VARIABLE" && fixedRestWeekdays.length) {
      throw new Error("Variable rest policy cannot contain fixed weekdays.");
    }
    const latest = await transaction.employeeRosterScheduleVersion.findFirst({
      where: { businessId: args.context.businessId, branchId: input.branchId, membershipId: input.membershipId },
      orderBy: [{ effectiveFrom: "desc" }, { revision: "desc" }],
    });
    if (latest && effectiveFrom <= latest.effectiveFrom) {
      throw new Error("Choose an effective date after the current schedule version.");
    }
    if (latest) {
      await transaction.employeeRosterScheduleVersion.update({
        where: { id: latest.id },
        data: { effectiveUntil: addDays(effectiveFrom, -1) },
      });
    }
    const snapshot = {
      defaultShiftTemplateId: template?.id ?? null,
      shiftNameSnapshot: template?.name ?? null,
      shiftShortCodeSnapshot: template?.shortCode ?? null,
      shiftColorSnapshot: template?.colorToken ?? null,
      startMinuteSnapshot: template?.startMinute ?? null,
      endMinuteSnapshot: template?.endMinute ?? null,
      crossMidnightSnapshot: template?.crossMidnight ?? null,
      breakMinutesSnapshot: template?.breakMinutes ?? 0,
      breakPaidSnapshot: template?.breakPaid ?? false,
      restPolicy: input.restPolicy,
      fixedRestWeekdays,
      requiredRestDays: input.requiredRestDays,
    } as const;
    const sourceDigest = digest({ businessId: args.context.businessId, branchId: input.branchId, membershipId: input.membershipId, effectiveFrom: dateValue(effectiveFrom), ...snapshot });
    const version = await transaction.employeeRosterScheduleVersion.create({
      data: {
        businessId: args.context.businessId,
        branchId: input.branchId,
        membershipId: input.membershipId,
        effectiveFrom,
        revision: (latest?.revision ?? 0) + 1,
        sourceDigest,
        createdById: args.context.actor.userId,
        ...snapshot,
      },
    });
    await writeAuditLog({
      businessId: args.context.businessId,
      branchId: input.branchId,
      actor: args.context.actor,
      request: args.context.request,
      action: "EMPLOYEE_ROSTER_SCHEDULE_VERSION_CREATED",
      entityType: "EmployeeRosterScheduleVersion",
      entityId: version.id,
      summary: "Effective-dated employee default shift and rest policy created.",
      before: latest ?? undefined,
      after: version,
      metadata: { historicalPublishedRosterChanged: false, employeeName: membership.fullName },
    }, transaction);
    return version;
  }, { isolationLevel: "Serializable", maxWait: 5_000, timeout: 30_000 });
}

export async function addEmployeeRecurringRestDay(args: {
  context: RosterServiceContext;
  input: unknown;
  database?: PrismaClient;
}) {
  const input = recurringRestDaySchema.parse(args.input);
  if (!args.context.allowedBranchIds.includes(input.branchId)) throw new Error("Employee schedule branch is outside the authorised scope.");
  const database = args.database ?? prisma;
  return database.$transaction(async (transaction) => {
    const latest = await transaction.employeeRosterScheduleVersion.findFirst({
      where: { businessId: args.context.businessId, branchId: input.branchId, membershipId: input.membershipId },
      orderBy: [{ effectiveFrom: "desc" }, { revision: "desc" }],
    });
    if (!latest) throw new Error("Set the employee's normal schedule before adding a repeating Rest Day.");
    if (latest.restPolicy === "FIXED" && latest.fixedRestWeekdays.includes(input.weekday)) {
      return { changed: false, version: latest };
    }

    const today = dateOnly(new Date());
    const effectiveFrom = today <= latest.effectiveFrom ? addDays(latest.effectiveFrom, 1) : today;
    const membership = await transaction.employeeBusinessMembership.findFirst({
      where: {
        id: input.membershipId,
        businessId: args.context.businessId,
        status: "ACTIVE",
        joinedAt: { lte: effectiveFrom },
        OR: [{ terminatedAt: null }, { terminatedAt: { gte: effectiveFrom } }],
        branchAssignments: {
          some: {
            businessId: args.context.businessId,
            branchId: input.branchId,
            status: "ACTIVE",
            effectiveFrom: { lte: effectiveFrom },
            OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: effectiveFrom } }],
          },
        },
      },
      select: { id: true, fullName: true },
    });
    if (!membership) throw new Error("Employee is not active in this branch on the effective date.");

    const fixedRestWeekdays = [...new Set([
      ...(latest.restPolicy === "FIXED" ? latest.fixedRestWeekdays : []),
      input.weekday,
    ])].sort((left, right) => left - right);
    const snapshot = {
      defaultShiftTemplateId: latest.defaultShiftTemplateId,
      shiftNameSnapshot: latest.shiftNameSnapshot,
      shiftShortCodeSnapshot: latest.shiftShortCodeSnapshot,
      shiftColorSnapshot: latest.shiftColorSnapshot,
      startMinuteSnapshot: latest.startMinuteSnapshot,
      endMinuteSnapshot: latest.endMinuteSnapshot,
      crossMidnightSnapshot: latest.crossMidnightSnapshot,
      breakMinutesSnapshot: latest.breakMinutesSnapshot,
      breakPaidSnapshot: latest.breakPaidSnapshot,
      restPolicy: "FIXED" as const,
      fixedRestWeekdays,
      requiredRestDays: fixedRestWeekdays.length,
    };
    const sourceDigest = digest({
      businessId: args.context.businessId,
      branchId: input.branchId,
      membershipId: input.membershipId,
      effectiveFrom: dateValue(effectiveFrom),
      ...snapshot,
    });

    await transaction.employeeRosterScheduleVersion.update({
      where: { id: latest.id },
      data: { effectiveUntil: addDays(effectiveFrom, -1) },
    });
    const version = await transaction.employeeRosterScheduleVersion.create({
      data: {
        businessId: args.context.businessId,
        branchId: input.branchId,
        membershipId: input.membershipId,
        effectiveFrom,
        revision: latest.revision + 1,
        sourceDigest,
        createdById: args.context.actor.userId,
        ...snapshot,
      },
    });
    await writeAuditLog({
      businessId: args.context.businessId,
      branchId: input.branchId,
      actor: args.context.actor,
      request: args.context.request,
      action: "EMPLOYEE_RECURRING_REST_DAY_ADDED",
      entityType: "EmployeeRosterScheduleVersion",
      entityId: version.id,
      summary: "Repeating weekly Rest Day added from the roster quick picker.",
      before: latest,
      after: version,
      metadata: { weekday: input.weekday, historicalPublishedRosterChanged: false, employeeName: membership.fullName },
    }, transaction);
    return { changed: true, version };
  }, { isolationLevel: "Serializable", maxWait: 5_000, timeout: 30_000 });
}

export async function listEmployeeRosterSchedules(args: {
  context: Pick<RosterServiceContext, "businessId" | "allowedBranchIds">;
  branchId: string;
  database?: PrismaClient;
}) {
  if (!args.context.allowedBranchIds.includes(args.branchId)) throw new Error("Employee schedule branch is outside the authorised scope.");
  return (args.database ?? prisma).employeeRosterScheduleVersion.findMany({
    where: { businessId: args.context.businessId, branchId: args.branchId },
    include: { membership: { select: { id: true, fullName: true, employeeCode: true } }, defaultShiftTemplate: true },
    orderBy: [{ membership: { fullName: "asc" } }, { effectiveFrom: "desc" }, { revision: "desc" }],
  });
}

export async function resolveRosterWeek(args: {
  businessId: string;
  branchId: string;
  weekStart: Date;
  database: Prisma.TransactionClient | PrismaClient;
  overrides?: Array<Prisma.RosterAssignmentGetPayload<Record<string, never>>>;
}) {
  const weekStart = dateOnly(args.weekStart);
  const weekEnd = addDays(weekStart, 6);
  const [branch, members, schedules] = await Promise.all([
    args.database.branch.findFirst({
      where: { id: args.branchId, businessId: args.businessId, status: "ACTIVE" },
      select: { attendanceSetting: { select: { timezone: true } }, business: { select: { timezone: true } } },
    }),
    args.database.employeeBusinessMembership.findMany({
      where: {
        businessId: args.businessId,
        status: "ACTIVE",
        joinedAt: { lt: addDays(weekEnd, 1) },
        OR: [{ terminatedAt: null }, { terminatedAt: { gte: weekStart } }],
        branchAssignments: { some: { businessId: args.businessId, branchId: args.branchId, status: "ACTIVE", effectiveFrom: { lt: addDays(weekEnd, 1) }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: weekStart } }] } },
      },
      select: { id: true, fullName: true, employeeCode: true },
      orderBy: { fullName: "asc" },
    }),
    args.database.employeeRosterScheduleVersion.findMany({
      where: { businessId: args.businessId, branchId: args.branchId, effectiveFrom: { lte: weekEnd }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: weekStart } }] },
      orderBy: [{ effectiveFrom: "desc" }, { revision: "desc" }],
    }),
  ]);
  if (!branch) throw new Error("Roster branch is not active.");
  const timezone = branch.attendanceSetting?.timezone ?? branch.business.timezone;
  const overrideRows = args.overrides ?? await args.database.rosterAssignment.findMany({
    where: { businessId: args.businessId, branchId: args.branchId, workDate: { gte: weekStart, lte: weekEnd } },
  });
  const overrideMap = new Map(overrideRows.map((row) => [`${row.membershipId}:${dateValue(row.workDate)}`, row]));
  const resolved: ResolvedRosterDay[] = [];
  const unresolvedDays: Array<{
    membershipId: string;
    workDate: Date;
    reason: "BEFORE_SCHEDULE_START" | "NO_DEFAULT_SCHEDULE";
    scheduleStartsAt: Date | null;
  }> = [];
  const attention: Array<{ membershipId: string; employeeName: string; required: number; assigned: number }> = [];
  for (const member of members) {
    const memberSchedules = schedules.filter((schedule) => schedule.membershipId === member.id);
    const variableVersions = new Map<string, number>();
    for (let index = 0; index < 7; index += 1) {
      const workDate = addDays(weekStart, index);
      const schedule = memberSchedules.find((item) => item.effectiveFrom <= workDate && (!item.effectiveUntil || item.effectiveUntil >= workDate));
      if (schedule?.restPolicy === "VARIABLE") variableVersions.set(schedule.id, schedule.requiredRestDays);
    }
    for (const [scheduleId, required] of variableVersions) {
      const assigned = overrideRows.filter((row) => row.membershipId === member.id && row.kind === "REST_DAY" && memberSchedules.some((schedule) => schedule.id === scheduleId && schedule.effectiveFrom <= row.workDate && (!schedule.effectiveUntil || schedule.effectiveUntil >= row.workDate))).length;
      if (assigned < required) attention.push({ membershipId: member.id, employeeName: member.fullName, required, assigned });
    }
    for (let index = 0; index < 7; index += 1) {
      const workDate = addDays(weekStart, index);
      const key = `${member.id}:${dateValue(workDate)}`;
      const override = overrideMap.get(key);
      const schedule = memberSchedules.find((item) => item.effectiveFrom <= workDate && (!item.effectiveUntil || item.effectiveUntil >= workDate));
      if (override) {
        resolved.push({
          ...override,
          id: override.id,
          sourceAssignmentId: override.id,
          sourceScheduleVersionId: schedule?.id ?? null,
          resolvedSource: override.kind === "REST_DAY" ? "WEEKLY_REST_OVERRIDE" : override.kind === "NOT_SCHEDULED" ? "WEEKLY_NOT_SCHEDULED_OVERRIDE" : override.shiftTemplateId ? "WEEKLY_SHIFT_OVERRIDE" : "CUSTOM_SHIFT",
          breakPaidSnapshot: override.breakPaidSnapshot ?? false,
          membership: member,
        });
        continue;
      }
      if (!schedule) {
        const nextSchedule = memberSchedules
          .filter((item) => item.effectiveFrom > workDate)
          .sort((left, right) => left.effectiveFrom.getTime() - right.effectiveFrom.getTime())[0];
        unresolvedDays.push({
          membershipId: member.id,
          workDate,
          reason: nextSchedule ? "BEFORE_SCHEDULE_START" : "NO_DEFAULT_SCHEDULE",
          scheduleStartsAt: nextSchedule?.effectiveFrom ?? null,
        });
        continue;
      }
      const weekday = workDate.getUTCDay() || 7;
      if (schedule.restPolicy === "FIXED" && schedule.fixedRestWeekdays.includes(weekday)) {
        resolved.push({ id: `baseline:${schedule.id}:${dateValue(workDate)}`, sourceAssignmentId: null, sourceScheduleVersionId: schedule.id, resolvedSource: "FIXED_REST", membership: member, membershipId: member.id, workDate, kind: "REST_DAY", shiftTemplateId: null, shiftNameSnapshot: null, shiftColorSnapshot: null, crossMidnightSnapshot: null, startAt: null, endAt: null, breakMinutes: 0, breakPaidSnapshot: false, note: null });
        continue;
      }
      if (schedule.defaultShiftTemplateId && schedule.startMinuteSnapshot !== null && schedule.endMinuteSnapshot !== null) {
        const startAt = localDateTime(workDate, schedule.startMinuteSnapshot, timezone, false);
        const endAt = localDateTime(workDate, schedule.endMinuteSnapshot, timezone, Boolean(schedule.crossMidnightSnapshot));
        resolved.push({ id: `baseline:${schedule.id}:${dateValue(workDate)}`, sourceAssignmentId: null, sourceScheduleVersionId: schedule.id, resolvedSource: "DEFAULT_SHIFT", membership: member, membershipId: member.id, workDate, kind: "WORK_SHIFT", shiftTemplateId: schedule.defaultShiftTemplateId, shiftNameSnapshot: schedule.shiftNameSnapshot, shiftColorSnapshot: schedule.shiftColorSnapshot, crossMidnightSnapshot: schedule.crossMidnightSnapshot, startAt, endAt, breakMinutes: schedule.breakMinutesSnapshot, breakPaidSnapshot: schedule.breakPaidSnapshot, note: null });
      } else {
        unresolvedDays.push({ membershipId: member.id, workDate, reason: "NO_DEFAULT_SCHEDULE", scheduleStartsAt: null });
      }
    }
  }
  return { assignments: resolved, attention, unresolvedDays, timezone, members };
}

function localDateTime(workDate: Date, minute: number, timezone: string, nextDay: boolean) {
  const date = nextDay ? addDays(workDate, 1) : workDate;
  const hours = Math.floor(minute / 60).toString().padStart(2, "0");
  const minutes = (minute % 60).toString().padStart(2, "0");
  return parseBranchLocalDateTime(`${dateValue(date)}T${hours}:${minutes}`, timezone);
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
