import { createHash } from "node:crypto";
import { AttendanceExpectedDayKind, AttendanceOvertimeContext } from "@prisma/client";
import { businessWallClockToUtc, isValidIanaTimeZone } from "@/lib/business-day";
import { addDaysToDateValue, dateValueToUtcDate } from "@/lib/business-time";
import { getBranchLocalDateKey } from "@/lib/attendance/work-date";

const MAX_SEGMENTED_DAYS = 8;

export type AttendanceBreakInterval = { startAt: Date; endAt: Date };

export type AttendanceSegmentDateContext = {
  localDate: string;
  kind: AttendanceExpectedDayKind;
  expectedStartAt: Date | null;
  expectedEndAt: Date | null;
  timezone: string;
  holidayContext: Record<string, unknown> | null;
  leaveRequestId: string | null;
  leaveDayFraction: number | null;
  isRestDay?: boolean;
  isPublicHoliday?: boolean;
};

export type AttendanceWorkSegment = {
  segmentIndex: number;
  localDate: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  context: AttendanceOvertimeContext;
  expectedDayKind: AttendanceExpectedDayKind;
  expectedStartAt: Date | null;
  expectedEndAt: Date | null;
  isRestDay: boolean;
  isPublicHoliday: boolean;
  isUnscheduled: boolean;
  holidayContext: Record<string, unknown> | null;
  leaveRequestId: string | null;
  leaveDayFraction: number | null;
  grossMinutes: number;
  breakMinutes: number;
  workedMinutes: number;
  potentialOtMinutes: number;
  approvedOtMinutes: number;
  sourceDigest: string;
};

export class AttendanceSegmentationError extends Error {
  constructor(
    public readonly code:
      | "INVALID_TIMEZONE"
      | "INVALID_INTERVAL"
      | "DURATION_MISMATCH"
      | "MISSING_DATE_CONTEXT"
      | "TIMEZONE_MISMATCH"
      | "LEAVE_CONFLICT"
      | "UNRESOLVED_BREAK"
      | "INVALID_BREAK_INTERVAL"
      | "OT_ALLOCATION_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "AttendanceSegmentationError";
  }
}

export function segmentAttendanceWork(input: {
  startAt: Date;
  endAt: Date;
  timezone: string;
  totalBreakMinutes: number;
  totalWorkedMinutes: number;
  breakIntervals: AttendanceBreakInterval[];
  dateContexts: AttendanceSegmentDateContext[];
  potentialOtMinutes: number;
  approvedOtMinutes: number;
}): AttendanceWorkSegment[] {
  validateInput(input);

  const boundaries = buildLocalMidnightBoundaries(input.startAt, input.endAt, input.timezone);
  const intervals = boundaries.slice(0, -1).map((startAt, index) => ({
    startAt,
    endAt: boundaries[index + 1],
  }));
  const contextByDate = new Map(input.dateContexts.map((item) => [item.localDate, item]));
  const grossMinutes = allocateByWeights(
    input.totalBreakMinutes + input.totalWorkedMinutes,
    intervals.map((item) => item.endAt.getTime() - item.startAt.getTime()),
  );
  const rawBreakWeights = intervals.map((segment) =>
    input.breakIntervals.reduce(
      (sum, item) => sum + overlapMilliseconds(segment.startAt, segment.endAt, item.startAt, item.endAt),
      0,
    ),
  );
  const breakMinutes = allocateWithCaps(input.totalBreakMinutes, rawBreakWeights, grossMinutes);

  const provisional = intervals.map((interval, segmentIndex) => {
    const localDate = getBranchLocalDateKey(interval.startAt, input.timezone);
    const dateContext = contextByDate.get(localDate);
    if (!dateContext) {
      throw new AttendanceSegmentationError(
        "MISSING_DATE_CONTEXT",
        `Attendance date context is missing for ${localDate}.`,
      );
    }
    if (dateContext.timezone !== input.timezone) {
      throw new AttendanceSegmentationError(
        "TIMEZONE_MISMATCH",
        `Attendance timezone changed inside the same locked work session (${localDate}).`,
      );
    }

    const isPublicHoliday = dateContext.isPublicHoliday ??
      dateContext.kind === AttendanceExpectedDayKind.PUBLIC_HOLIDAY;
    const isRestDay = dateContext.isRestDay ??
      dateContext.kind === AttendanceExpectedDayKind.REST_DAY;
    const isUnscheduled = dateContext.kind === AttendanceExpectedDayKind.NOT_SCHEDULED;
    const context = isPublicHoliday
      ? AttendanceOvertimeContext.PUBLIC_HOLIDAY
      : isRestDay
        ? AttendanceOvertimeContext.REST_DAY
        : AttendanceOvertimeContext.NORMAL;
    const workedMinutes = grossMinutes[segmentIndex] - breakMinutes[segmentIndex];
    if ((dateContext.leaveDayFraction ?? 0) > 0 && workedMinutes > 0) {
      throw new AttendanceSegmentationError(
        "LEAVE_CONFLICT",
        `Worked minutes conflict with approved Leave on ${localDate}; the attendance record requires review.`,
      );
    }
    const potentialCapacity = context !== AttendanceOvertimeContext.NORMAL || isUnscheduled
      ? workedMinutes
      : normalDayOtCapacity({
          ...interval,
          workedMinutes,
          breakIntervals: input.breakIntervals,
          expectedStartAt: dateContext.expectedStartAt,
          expectedEndAt: dateContext.expectedEndAt,
        });

    return {
      segmentIndex,
      localDate,
      ...interval,
      timezone: input.timezone,
      context,
      expectedDayKind: dateContext.kind,
      expectedStartAt: dateContext.expectedStartAt,
      expectedEndAt: dateContext.expectedEndAt,
      isRestDay,
      isPublicHoliday,
      isUnscheduled,
      holidayContext: dateContext.holidayContext,
      leaveRequestId: dateContext.leaveRequestId,
      leaveDayFraction: dateContext.leaveDayFraction,
      grossMinutes: grossMinutes[segmentIndex],
      breakMinutes: breakMinutes[segmentIndex],
      workedMinutes,
      potentialOtMinutes: potentialCapacity,
    };
  });

  const potentialAllocation = allocateEarliest(
    input.potentialOtMinutes,
    provisional.map((item) => item.potentialOtMinutes),
    "potential OT",
  );
  const approvedAllocation = allocateEarliest(
    input.approvedOtMinutes,
    potentialAllocation,
    "approved OT",
  );

  return provisional.map((item, index) => {
    const segment = {
      ...item,
      potentialOtMinutes: potentialAllocation[index],
      approvedOtMinutes: approvedAllocation[index],
    };
    return {
      ...segment,
      sourceDigest: digest(segment),
    };
  });
}

function validateInput(input: Parameters<typeof segmentAttendanceWork>[0]) {
  if (!isValidIanaTimeZone(input.timezone)) {
    throw new AttendanceSegmentationError("INVALID_TIMEZONE", "Attendance timezone is invalid.");
  }
  if (!(input.startAt < input.endAt)) {
    throw new AttendanceSegmentationError("INVALID_INTERVAL", "Attendance work interval is invalid.");
  }
  const integerFields = [
    input.totalBreakMinutes,
    input.totalWorkedMinutes,
    input.potentialOtMinutes,
    input.approvedOtMinutes,
  ];
  if (integerFields.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new AttendanceSegmentationError("DURATION_MISMATCH", "Attendance minutes must be non-negative integers.");
  }
  if (input.approvedOtMinutes > input.potentialOtMinutes) {
    throw new AttendanceSegmentationError("OT_ALLOCATION_MISMATCH", "Approved OT exceeds potential OT.");
  }
  const elapsedMinutes = Math.floor((input.endAt.getTime() - input.startAt.getTime()) / 60_000);
  const frozenMinutes = input.totalBreakMinutes + input.totalWorkedMinutes;
  if (Math.abs(elapsedMinutes - frozenMinutes) > 1) {
    throw new AttendanceSegmentationError(
      "DURATION_MISMATCH",
      "Frozen worked and break minutes do not reconcile with the attendance interval.",
    );
  }
  for (const interval of input.breakIntervals) {
    if (!(interval.startAt < interval.endAt) || interval.startAt < input.startAt || interval.endAt > input.endAt) {
      throw new AttendanceSegmentationError("INVALID_BREAK_INTERVAL", "A Break interval is outside the attendance session.");
    }
  }
  const rawBreakMinutes = Math.floor(
    input.breakIntervals.reduce((sum, item) => sum + item.endAt.getTime() - item.startAt.getTime(), 0) / 60_000,
  );
  if (input.breakIntervals.length && Math.abs(rawBreakMinutes - input.totalBreakMinutes) > 1) {
    throw new AttendanceSegmentationError("UNRESOLVED_BREAK", "Break intervals do not reconcile with frozen Break minutes.");
  }
}

function buildLocalMidnightBoundaries(startAt: Date, endAt: Date, timezone: string) {
  const result = [startAt];
  let localDate = getBranchLocalDateKey(startAt, timezone);
  const endLocalDate = getBranchLocalDateKey(new Date(endAt.getTime() - 1), timezone);
  let days = 0;
  while (localDate !== endLocalDate) {
    localDate = addDaysToDateValue(localDate, 1);
    const midnight = businessWallClockToUtc(localDate, "00:00", timezone);
    if (midnight <= result[result.length - 1] || midnight >= endAt) break;
    result.push(midnight);
    days += 1;
    if (days >= MAX_SEGMENTED_DAYS) {
      throw new AttendanceSegmentationError("INVALID_INTERVAL", "Attendance interval exceeds the segmentation safety limit.");
    }
  }
  result.push(endAt);
  return result;
}

function normalDayOtCapacity(input: {
  startAt: Date;
  endAt: Date;
  workedMinutes: number;
  breakIntervals: AttendanceBreakInterval[];
  expectedStartAt: Date | null;
  expectedEndAt: Date | null;
}) {
  if (!input.expectedStartAt || !input.expectedEndAt) return 0;
  const before = overlapMilliseconds(input.startAt, input.endAt, input.startAt, input.expectedStartAt);
  const after = overlapMilliseconds(input.startAt, input.endAt, input.expectedEndAt, input.endAt);
  const outsideMs = before + after;
  const outsideBreakMs = input.breakIntervals.reduce((sum, item) => {
    return sum +
      overlapMilliseconds(input.startAt, input.expectedStartAt!, item.startAt, item.endAt) +
      overlapMilliseconds(input.expectedEndAt!, input.endAt, item.startAt, item.endAt);
  }, 0);
  return Math.min(input.workedMinutes, Math.max(0, Math.floor((outsideMs - outsideBreakMs) / 60_000)));
}

function allocateByWeights(total: number, weights: number[]) {
  if (!weights.length) return [];
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  if (weightTotal <= 0) return weights.map(() => 0);
  const raw = weights.map((weight) => total * weight / weightTotal);
  const allocated = raw.map(Math.floor);
  const remainder = total - allocated.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let index = 0; index < remainder; index += 1) allocated[order[index % order.length].index] += 1;
  return allocated;
}

function allocateWithCaps(total: number, weights: number[], caps: number[]) {
  if (total === 0) return caps.map(() => 0);
  if (weights.reduce((sum, value) => sum + value, 0) <= 0) {
    if (caps.length === 1 && total <= caps[0]) return [total];
    throw new AttendanceSegmentationError("UNRESOLVED_BREAK", "Cross-midnight Break allocation needs resolved Break intervals.");
  }
  const result = allocateByWeights(total, weights).map((value, index) => Math.min(value, caps[index]));
  let remainder = total - result.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < result.length && remainder > 0; index += 1) {
    const available = caps[index] - result[index];
    const take = Math.min(available, remainder);
    result[index] += take;
    remainder -= take;
  }
  if (remainder) throw new AttendanceSegmentationError("UNRESOLVED_BREAK", "Break minutes exceed segmented gross minutes.");
  return result;
}

function allocateEarliest(total: number, capacities: number[], label: string) {
  const result = capacities.map(() => 0);
  let remainder = total;
  for (let index = 0; index < capacities.length && remainder > 0; index += 1) {
    const take = Math.min(capacities[index], remainder);
    result[index] = take;
    remainder -= take;
  }
  if (remainder > 0) {
    throw new AttendanceSegmentationError("OT_ALLOCATION_MISMATCH", `${label} minutes exceed segmented work capacity.`);
  }
  return result;
}

function overlapMilliseconds(leftStart: Date, leftEnd: Date, rightStart: Date, rightEnd: Date) {
  return Math.max(0, Math.min(leftEnd.getTime(), rightEnd.getTime()) - Math.max(leftStart.getTime(), rightStart.getTime()));
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function localDateToSnapshotDate(value: string) {
  return dateValueToUtcDate(value);
}
