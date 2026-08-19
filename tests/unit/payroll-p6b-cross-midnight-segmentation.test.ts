import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceExpectedDayKind, AttendanceOvertimeContext } from "@prisma/client";
import {
  AttendanceSegmentationError,
  segmentAttendanceWork,
  type AttendanceSegmentDateContext,
} from "../../src/lib/attendance/cross-midnight-segmentation";

const timezone = "Asia/Kuala_Lumpur";
const instant = (value: string) => new Date(value);

test("P6B splits a cross-midnight session by branch-local midnight and conserves minutes", () => {
  const segments = segmentAttendanceWork({
    startAt: instant("2026-08-18T15:00:00.000Z"), // 23:00 MYT
    endAt: instant("2026-08-18T18:00:00.000Z"), // 02:00 MYT
    timezone,
    totalBreakMinutes: 30,
    totalWorkedMinutes: 150,
    breakIntervals: [{
      startAt: instant("2026-08-18T16:45:00.000Z"),
      endAt: instant("2026-08-18T17:15:00.000Z"),
    }],
    dateContexts: [
      context("2026-08-18", AttendanceExpectedDayKind.WORKDAY),
      context("2026-08-19", AttendanceExpectedDayKind.REST_DAY),
    ],
    potentialOtMinutes: 90,
    approvedOtMinutes: 60,
  });

  assert.deepEqual(segments.map((item) => item.localDate), ["2026-08-18", "2026-08-19"]);
  assert.equal(segments[0].endAt.toISOString(), "2026-08-18T16:00:00.000Z");
  assert.equal(segments.reduce((sum, item) => sum + item.grossMinutes, 0), 180);
  assert.equal(segments.reduce((sum, item) => sum + item.breakMinutes, 0), 30);
  assert.equal(segments.reduce((sum, item) => sum + item.workedMinutes, 0), 150);
  assert.equal(segments.reduce((sum, item) => sum + item.approvedOtMinutes, 0), 60);
  assert.equal(segments[1].context, AttendanceOvertimeContext.REST_DAY);
  assert.equal(segments[1].isRestDay, true);
});

test("P6B preserves simultaneous public-holiday and Rest Day evidence", () => {
  const segments = segmentAttendanceWork({
    startAt: instant("2026-08-18T16:00:00.000Z"),
    endAt: instant("2026-08-18T17:00:00.000Z"),
    timezone,
    totalBreakMinutes: 0,
    totalWorkedMinutes: 60,
    breakIntervals: [],
    dateContexts: [{
      ...context("2026-08-19", AttendanceExpectedDayKind.PUBLIC_HOLIDAY),
      isRestDay: true,
      isPublicHoliday: true,
      holidayContext: { occurrenceId: "holiday-1" },
    }],
    potentialOtMinutes: 60,
    approvedOtMinutes: 60,
  });

  assert.equal(segments[0].context, AttendanceOvertimeContext.PUBLIC_HOLIDAY);
  assert.equal(segments[0].isRestDay, true);
  assert.equal(segments[0].isPublicHoliday, true);
});

test("P6B fails closed when a cross-midnight Break cannot be placed on a local date", () => {
  assert.throws(
    () => segmentAttendanceWork({
      startAt: instant("2026-08-18T15:00:00.000Z"),
      endAt: instant("2026-08-18T17:00:00.000Z"),
      timezone,
      totalBreakMinutes: 30,
      totalWorkedMinutes: 90,
      breakIntervals: [],
      dateContexts: [
        context("2026-08-18", AttendanceExpectedDayKind.WORKDAY),
        context("2026-08-19", AttendanceExpectedDayKind.WORKDAY),
      ],
      potentialOtMinutes: 0,
      approvedOtMinutes: 0,
    }),
    (error: unknown) => error instanceof AttendanceSegmentationError && error.code === "UNRESOLVED_BREAK",
  );
});

test("P6B rejects an invalid timezone instead of falling back to server time", () => {
  assert.throws(
    () => segmentAttendanceWork({
      startAt: instant("2026-08-18T15:00:00.000Z"),
      endAt: instant("2026-08-18T16:00:00.000Z"),
      timezone: "Malaysia/Unknown",
      totalBreakMinutes: 0,
      totalWorkedMinutes: 60,
      breakIntervals: [],
      dateContexts: [],
      potentialOtMinutes: 0,
      approvedOtMinutes: 0,
    }),
    (error: unknown) => error instanceof AttendanceSegmentationError && error.code === "INVALID_TIMEZONE",
  );
});

const crossMidnightCases: Array<{
  name: string;
  first: AttendanceExpectedDayKind;
  second: AttendanceExpectedDayKind;
  expectedContexts: AttendanceOvertimeContext[];
}> = [
  {
    name: "Normal to Normal",
    first: AttendanceExpectedDayKind.WORKDAY,
    second: AttendanceExpectedDayKind.WORKDAY,
    expectedContexts: [AttendanceOvertimeContext.NORMAL, AttendanceOvertimeContext.NORMAL],
  },
  {
    name: "Normal to Public Holiday",
    first: AttendanceExpectedDayKind.WORKDAY,
    second: AttendanceExpectedDayKind.PUBLIC_HOLIDAY,
    expectedContexts: [AttendanceOvertimeContext.NORMAL, AttendanceOvertimeContext.PUBLIC_HOLIDAY],
  },
  {
    name: "Public Holiday to Normal",
    first: AttendanceExpectedDayKind.PUBLIC_HOLIDAY,
    second: AttendanceExpectedDayKind.WORKDAY,
    expectedContexts: [AttendanceOvertimeContext.PUBLIC_HOLIDAY, AttendanceOvertimeContext.NORMAL],
  },
  {
    name: "Normal to Rest Day",
    first: AttendanceExpectedDayKind.WORKDAY,
    second: AttendanceExpectedDayKind.REST_DAY,
    expectedContexts: [AttendanceOvertimeContext.NORMAL, AttendanceOvertimeContext.REST_DAY],
  },
  {
    name: "Rest Day to Normal",
    first: AttendanceExpectedDayKind.REST_DAY,
    second: AttendanceExpectedDayKind.WORKDAY,
    expectedContexts: [AttendanceOvertimeContext.REST_DAY, AttendanceOvertimeContext.NORMAL],
  },
  {
    name: "Rest Day to Public Holiday",
    first: AttendanceExpectedDayKind.REST_DAY,
    second: AttendanceExpectedDayKind.PUBLIC_HOLIDAY,
    expectedContexts: [AttendanceOvertimeContext.REST_DAY, AttendanceOvertimeContext.PUBLIC_HOLIDAY],
  },
];

for (const item of crossMidnightCases) {
  test(`P6B classifies ${item.name} independently by local date`, () => {
    const segments = segmentAttendanceWork({
      startAt: instant("2026-08-30T14:00:00.000Z"), // 22:00 MYT
      endAt: instant("2026-08-30T22:00:00.000Z"), // 06:00 MYT
      timezone,
      totalBreakMinutes: 0,
      totalWorkedMinutes: 480,
      breakIntervals: [],
      dateContexts: [
        context("2026-08-30", item.first),
        context("2026-08-31", item.second),
      ],
      potentialOtMinutes: item.expectedContexts.filter((value) => value !== AttendanceOvertimeContext.NORMAL)
        .reduce((sum, _value, index) => sum + (index === 0 ? 120 : 360), 0),
      approvedOtMinutes: 0,
    });

    assert.deepEqual(segments.map((segment) => segment.context), item.expectedContexts);
    assert.deepEqual(segments.map((segment) => segment.workedMinutes), [120, 360]);
  });
}

test("P6B splits an unpaid Break that crosses midnight exactly", () => {
  const segments = segmentAttendanceWork({
    startAt: instant("2026-08-30T15:00:00.000Z"),
    endAt: instant("2026-08-30T17:00:00.000Z"),
    timezone,
    totalBreakMinutes: 30,
    totalWorkedMinutes: 90,
    breakIntervals: [{
      startAt: instant("2026-08-30T15:45:00.000Z"),
      endAt: instant("2026-08-30T16:15:00.000Z"),
    }],
    dateContexts: [
      context("2026-08-30", AttendanceExpectedDayKind.WORKDAY),
      context("2026-08-31", AttendanceExpectedDayKind.WORKDAY),
    ],
    potentialOtMinutes: 0,
    approvedOtMinutes: 0,
  });

  assert.deepEqual(segments.map((segment) => segment.grossMinutes), [60, 60]);
  assert.deepEqual(segments.map((segment) => segment.breakMinutes), [15, 15]);
  assert.deepEqual(segments.map((segment) => segment.workedMinutes), [45, 45]);
});

test("P6B does not deduct paid Break time when frozen Break minutes are zero", () => {
  const segments = segmentAttendanceWork({
    startAt: instant("2026-08-30T15:00:00.000Z"),
    endAt: instant("2026-08-30T17:00:00.000Z"),
    timezone,
    totalBreakMinutes: 0,
    totalWorkedMinutes: 120,
    breakIntervals: [],
    dateContexts: [
      context("2026-08-30", AttendanceExpectedDayKind.WORKDAY),
      context("2026-08-31", AttendanceExpectedDayKind.WORKDAY),
    ],
    potentialOtMinutes: 0,
    approvedOtMinutes: 0,
  });

  assert.deepEqual(segments.map((segment) => segment.workedMinutes), [60, 60]);
});

test("P6B allocates approved OT deterministically from the earliest segment", () => {
  const segments = segmentAttendanceWork({
    startAt: instant("2026-08-30T15:00:00.000Z"),
    endAt: instant("2026-08-30T17:00:00.000Z"),
    timezone,
    totalBreakMinutes: 0,
    totalWorkedMinutes: 120,
    breakIntervals: [],
    dateContexts: [
      context("2026-08-30", AttendanceExpectedDayKind.REST_DAY),
      context("2026-08-31", AttendanceExpectedDayKind.PUBLIC_HOLIDAY),
    ],
    potentialOtMinutes: 120,
    approvedOtMinutes: 90,
  });

  assert.deepEqual(segments.map((segment) => segment.potentialOtMinutes), [60, 60]);
  assert.deepEqual(segments.map((segment) => segment.approvedOtMinutes), [60, 30]);
});

test("P6B supports deterministic multi-day segmentation", () => {
  const segments = segmentAttendanceWork({
    startAt: instant("2026-08-30T14:00:00.000Z"),
    endAt: instant("2026-08-31T18:00:00.000Z"),
    timezone,
    totalBreakMinutes: 0,
    totalWorkedMinutes: 1680,
    breakIntervals: [],
    dateContexts: [
      context("2026-08-30", AttendanceExpectedDayKind.WORKDAY),
      context("2026-08-31", AttendanceExpectedDayKind.WORKDAY),
      context("2026-09-01", AttendanceExpectedDayKind.WORKDAY),
    ],
    potentialOtMinutes: 0,
    approvedOtMinutes: 0,
  });

  assert.deepEqual(segments.map((segment) => segment.localDate), ["2026-08-30", "2026-08-31", "2026-09-01"]);
  assert.deepEqual(segments.map((segment) => segment.workedMinutes), [120, 1440, 120]);
});

for (const leaveDayFraction of [1, 0.5]) {
  test(`P6B blocks worked time against approved Leave fraction ${leaveDayFraction}`, () => {
    const dateContext = context("2026-08-31", AttendanceExpectedDayKind.WORKDAY);
    dateContext.leaveRequestId = "leave-1";
    dateContext.leaveDayFraction = leaveDayFraction;

    assert.throws(
      () => segmentAttendanceWork({
        startAt: instant("2026-08-30T16:00:00.000Z"),
        endAt: instant("2026-08-30T17:00:00.000Z"),
        timezone,
        totalBreakMinutes: 0,
        totalWorkedMinutes: 60,
        breakIntervals: [],
        dateContexts: [dateContext],
        potentialOtMinutes: 0,
        approvedOtMinutes: 0,
      }),
      (error: unknown) => error instanceof AttendanceSegmentationError && error.code === "LEAVE_CONFLICT",
    );
  });
}

function context(localDate: string, kind: AttendanceExpectedDayKind): AttendanceSegmentDateContext {
  return {
    localDate,
    kind,
    expectedStartAt: null,
    expectedEndAt: null,
    timezone,
    holidayContext: null,
    leaveRequestId: null,
    leaveDayFraction: null,
  };
}
