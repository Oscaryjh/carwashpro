import { createHash } from "node:crypto";

export const ROSTER_MAX_SHIFT_MINUTES = 24 * 60;

export type RosterAssignmentInput = Readonly<{
  membershipId: string;
  workDate: Date;
  kind: "WORK_SHIFT" | "REST_DAY" | "NOT_SCHEDULED";
  shiftTemplateId?: string | null;
  shiftNameSnapshot?: string | null;
  shiftColorSnapshot?: string | null;
  crossMidnightSnapshot?: boolean | null;
  startAt?: Date | null;
  endAt?: Date | null;
  breakMinutes?: number;
  breakPaidSnapshot?: boolean;
  note?: string | null;
}>;

export function dateOnly(value: Date) {
  assertDate(value, "date");
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function dateValue(value: Date) {
  return dateOnly(value).toISOString().slice(0, 10);
}

export function scheduledPaidMinutes(input: {
  startMinute: number;
  endMinute: number;
  breakMinutes: number;
  breakPaid?: boolean;
}) {
  const elapsed = input.endMinute + (input.endMinute <= input.startMinute ? 1_440 : 0) - input.startMinute;
  if (elapsed <= 0 || elapsed > ROSTER_MAX_SHIFT_MINUTES) throw new Error("Shift duration must be greater than zero and no more than 24 hours.");
  if (!Number.isInteger(input.breakMinutes) || input.breakMinutes < 0 || input.breakMinutes >= elapsed) throw new Error("Break minutes must be shorter than the shift duration.");
  return elapsed - (input.breakPaid ? 0 : input.breakMinutes);
}

export function startOfIsoWeek(value: Date) {
  const result = dateOnly(value);
  const day = result.getUTCDay() || 7;
  result.setUTCDate(result.getUTCDate() - day + 1);
  return result;
}

export function addDays(value: Date, days: number) {
  const result = dateOnly(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function isSameDate(left: Date, right: Date) {
  return dateValue(left) === dateValue(right);
}

export function assertWeeklyPeriod(weekStart: Date, workDate?: Date) {
  const normalized = dateOnly(weekStart);
  if (normalized.getUTCDay() !== 1) {
    throw new Error("Roster week must begin on Monday.");
  }
  if (workDate) {
    const work = dateOnly(workDate);
    const next = addDays(normalized, 7);
    if (work < normalized || work >= next) {
      throw new Error("Roster assignment must fall within its weekly period.");
    }
  }
}

export function validateRosterAssignment(input: RosterAssignmentInput) {
  const breakMinutes = input.breakMinutes ?? 0;
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 720) {
    throw new Error("Break minutes must be a whole number from 0 to 720.");
  }
  if (input.kind !== "WORK_SHIFT") {
    if (input.startAt || input.endAt || breakMinutes !== 0) {
      throw new Error("Rest and not-scheduled assignments cannot contain shift times or breaks.");
    }
    return { breakMinutes: 0, durationMinutes: 0 };
  }
  if (!input.startAt || !input.endAt) {
    throw new Error("A work shift requires both a start and an end time.");
  }
  assertDate(input.startAt, "shift start");
  assertDate(input.endAt, "shift end");
  const durationMinutes = Math.round((input.endAt.getTime() - input.startAt.getTime()) / 60_000);
  if (durationMinutes <= 0 || durationMinutes > ROSTER_MAX_SHIFT_MINUTES) {
    throw new Error("A shift must be longer than zero and no longer than 24 hours.");
  }
  if (breakMinutes >= durationMinutes) {
    throw new Error("Break minutes must be shorter than the shift duration.");
  }
  return { breakMinutes, durationMinutes };
}

export function rosterAssignmentDigest(value: unknown) {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

export function expectedKindForRoster(kind: RosterAssignmentInput["kind"]) {
  if (kind === "WORK_SHIFT") return "WORKDAY" as const;
  if (kind === "REST_DAY") return "REST_DAY" as const;
  return "NOT_SCHEDULED" as const;
}

export function assignmentSourceShape(input: RosterAssignmentInput) {
  return {
    membershipId: input.membershipId,
    workDate: dateValue(input.workDate),
    kind: input.kind,
    shiftTemplateId: input.shiftTemplateId ?? null,
    shiftNameSnapshot: input.shiftNameSnapshot ?? null,
    shiftColorSnapshot: input.shiftColorSnapshot ?? null,
    crossMidnightSnapshot: input.crossMidnightSnapshot ?? null,
    startAt: input.startAt?.toISOString() ?? null,
    endAt: input.endAt?.toISOString() ?? null,
    breakMinutes: input.breakMinutes ?? 0,
    breakPaidSnapshot: input.breakPaidSnapshot ?? false,
    note: input.note?.trim() || null,
  };
}

export function changedRosterAssignments(
  current: readonly RosterAssignmentInput[],
  previous: readonly RosterAssignmentInput[],
) {
  const before = new Map(previous.map((item) => [
    `${item.membershipId}:${dateValue(item.workDate)}`,
    { item, signature: stableJson(assignmentSourceShape(item)) },
  ]));
  const after = new Map(current.map((item) => [
    `${item.membershipId}:${dateValue(item.workDate)}`,
    { item, signature: stableJson(assignmentSourceShape(item)) },
  ]));
  return [...new Set([...before.keys(), ...after.keys()])].flatMap((key) => {
    const prior = before.get(key);
    const next = after.get(key);
    if (prior?.signature === next?.signature) return [];
    return [next?.item ?? prior!.item];
  });
}

function assertDate(value: Date, label: string) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`Enter a valid ${label}.`);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
