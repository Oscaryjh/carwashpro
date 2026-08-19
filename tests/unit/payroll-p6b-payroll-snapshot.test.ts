import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPayrollAttendanceInput,
  CROSS_MIDNIGHT_STATUTORY_SEGMENTATION_NOT_READY,
  type FrozenPayrollAttendanceDay,
  type FrozenPayrollAttendanceSegment,
} from "../../src/lib/payroll/attendance-integration";

test("P6B freezes mutually exclusive payroll buckets from locked cross-midnight segments", () => {
  const attendance = buildPayrollAttendanceInput({
    membershipId: "member-1",
    payBasis: "HOURLY",
    days: [crossMidnightDay()],
    segments: [
      segment({
        id: "segment-1",
        index: 0,
        localDate: "2026-08-30",
        startAt: "2026-08-30T14:00:00.000Z",
        endAt: "2026-08-30T16:00:00.000Z",
        context: "NORMAL",
        workedMinutes: 120,
        potentialOtMinutes: 30,
        approvedOtMinutes: 20,
      }),
      segment({
        id: "segment-2",
        index: 1,
        localDate: "2026-08-31",
        startAt: "2026-08-30T16:00:00.000Z",
        endAt: "2026-08-30T17:00:00.000Z",
        context: "PUBLIC_HOLIDAY",
        workedMinutes: 60,
        potentialOtMinutes: 60,
        approvedOtMinutes: 40,
        isRestDay: true,
        isPublicHoliday: true,
      }),
    ],
  });

  assert.equal(attendance.regularNormalMinutes, 100);
  assert.equal(attendance.normalOtMinutes, 20);
  assert.equal(attendance.restDayWorkMinutes, 0);
  assert.equal(attendance.restDayOtMinutes, 0);
  assert.equal(attendance.publicHolidayWorkMinutes, 20);
  assert.equal(attendance.publicHolidayOtMinutes, 40);
  assert.equal(attendance.approvedOvertimeMinutes, 60);
  assert.equal(
    attendance.regularNormalMinutes
      + attendance.normalOtMinutes
      + attendance.restDayWorkMinutes
      + attendance.restDayOtMinutes
      + attendance.publicHolidayWorkMinutes
      + attendance.publicHolidayOtMinutes,
    180,
  );
  assert.equal(
    attendance.policyBlockers.includes(CROSS_MIDNIGHT_STATUTORY_SEGMENTATION_NOT_READY),
    false,
  );
  assert.equal(attendance.segmentFacts[1].context, "PUBLIC_HOLIDAY");
  assert.equal(attendance.segmentFacts[1].isPublicHoliday, true);
  assert.equal(attendance.segmentFacts[1].isRestDay, true);
});

test("P6B keeps the legacy cross-midnight blocker when no locked segments exist", () => {
  const attendance = buildPayrollAttendanceInput({
    membershipId: "member-1",
    payBasis: "HOURLY",
    days: [crossMidnightDay()],
  });

  assert.equal(
    attendance.policyBlockers.includes(CROSS_MIDNIGHT_STATUTORY_SEGMENTATION_NOT_READY),
    true,
  );
  assert.deepEqual(attendance.segmentFacts, []);
});

test("P6B rejects segment totals that do not reconcile to the locked day", () => {
  assert.throws(
    () => buildPayrollAttendanceInput({
      membershipId: "member-1",
      payBasis: "HOURLY",
      days: [crossMidnightDay()],
      segments: [segment({
        id: "segment-invalid",
        index: 0,
        localDate: "2026-08-30",
        startAt: "2026-08-30T14:00:00.000Z",
        endAt: "2026-08-30T16:00:00.000Z",
        context: "NORMAL",
        workedMinutes: 120,
        potentialOtMinutes: 30,
        approvedOtMinutes: 20,
      })],
    }),
    /do not reconcile to the frozen day total/i,
  );
});

function crossMidnightDay(): FrozenPayrollAttendanceDay {
  return {
    id: "day-1",
    workDate: new Date("2026-08-30T00:00:00.000Z"),
    outcome: "PRESENT",
    expectedDayKindSnapshot: "WORKDAY",
    leaveDayFractionSnapshot: null,
    expectedStartAt: new Date("2026-08-30T14:00:00.000Z"),
    expectedEndAt: new Date("2026-08-30T17:00:00.000Z"),
    actualClockInAt: new Date("2026-08-30T14:00:00.000Z"),
    actualClockOutAt: new Date("2026-08-30T17:00:00.000Z"),
    timezoneSnapshot: "Asia/Kuala_Lumpur",
    crossMidnightSnapshot: true,
    potentialOtMinutes: 90,
    approvedOtMinutes: 60,
    otContext: "NORMAL",
    otApprovalStatus: "ADJUSTED",
    otApprovalRef: "approval-1",
    otApprovalRevision: 1,
    totalWorkedMinutes: 180,
    sourceDigest: "d".repeat(64),
  };
}

function segment(input: {
  id: string;
  index: number;
  localDate: string;
  startAt: string;
  endAt: string;
  context: FrozenPayrollAttendanceSegment["context"];
  workedMinutes: number;
  potentialOtMinutes: number;
  approvedOtMinutes: number;
  isRestDay?: boolean;
  isPublicHoliday?: boolean;
}): FrozenPayrollAttendanceSegment {
  return {
    id: input.id,
    sourceDaySnapshotId: "day-1",
    sourceFinalResultId: "final-1",
    sourceAttendanceId: "attendance-1",
    branchId: "branch-1",
    segmentIndex: input.index,
    localDate: new Date(`${input.localDate}T00:00:00.000Z`),
    startAt: new Date(input.startAt),
    endAt: new Date(input.endAt),
    timezoneSnapshot: "Asia/Kuala_Lumpur",
    context: input.context,
    expectedDayKindSnapshot:
      input.context === "PUBLIC_HOLIDAY"
        ? "PUBLIC_HOLIDAY"
        : input.context === "REST_DAY"
          ? "REST_DAY"
          : "WORKDAY",
    isRestDay: input.isRestDay ?? input.context === "REST_DAY",
    isPublicHoliday: input.isPublicHoliday ?? input.context === "PUBLIC_HOLIDAY",
    isUnscheduled: false,
    holidayContextSnapshot: input.context === "PUBLIC_HOLIDAY" ? { name: "National Day" } : null,
    leaveRequestIdSnapshot: null,
    leaveDayFractionSnapshot: null,
    grossMinutes: input.workedMinutes,
    breakMinutes: 0,
    workedMinutes: input.workedMinutes,
    potentialOtMinutes: input.potentialOtMinutes,
    approvedOtMinutes: input.approvedOtMinutes,
    sourceDigest: input.id.padEnd(64, "0").slice(0, 64),
  };
}
