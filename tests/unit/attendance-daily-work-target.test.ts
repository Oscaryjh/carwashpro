import assert from "node:assert/strict";
import test from "node:test";
import { resolveAttendanceDailyWorkTarget } from "../../src/lib/attendance/daily-work-target";

const fallback = {
  branchNormalWorkMinutesPerDay: 480,
  branchTargetBreakMinutes: 60,
  employeeNormalWorkMinutesPerDay: null,
  employeeTargetBreakMinutes: null,
};

test("published roster controls the daily paid-work and break targets", () => {
  const target = resolveAttendanceDailyWorkTarget({
    ...fallback,
    expectedDay: {
      expectedStartAt: new Date("2026-08-17T01:00:00.000Z"),
      expectedEndAt: new Date("2026-08-17T10:00:00.000Z"),
      kind: "WORKDAY",
      policySnapshot: { scheduledBreakMinutes: 60 },
      source: "ROSTER",
    },
  });

  assert.deepEqual(target, {
    expectedBreakMinutes: 60,
    expectedBreakSource: "PUBLISHED_ROSTER",
    normalWorkMinutesPerDay: 480,
    normalWorkMinutesSource: "PUBLISHED_ROSTER",
  });
});

test("published roster supports a five-hour shift without a break", () => {
  const target = resolveAttendanceDailyWorkTarget({
    ...fallback,
    employeeNormalWorkMinutesPerDay: 480,
    employeeTargetBreakMinutes: 60,
    expectedDay: {
      expectedStartAt: new Date("2026-08-17T01:00:00.000Z"),
      expectedEndAt: new Date("2026-08-17T06:00:00.000Z"),
      kind: "WORKDAY",
      policySnapshot: { scheduledBreakMinutes: 0 },
      source: "ROSTER",
    },
  });

  assert.equal(target.normalWorkMinutesPerDay, 300);
  assert.equal(target.expectedBreakMinutes, 0);
});

test("employee defaults override branch policy when no published roster exists", () => {
  const target = resolveAttendanceDailyWorkTarget({
    ...fallback,
    employeeNormalWorkMinutesPerDay: 300,
    employeeTargetBreakMinutes: 0,
    expectedDay: null,
  });

  assert.equal(target.normalWorkMinutesPerDay, 300);
  assert.equal(target.normalWorkMinutesSource, "EMPLOYEE_PROFILE");
  assert.equal(target.expectedBreakMinutes, 0);
  assert.equal(target.expectedBreakSource, "EMPLOYEE_PROFILE");
});

test("draft, non-workday, and malformed roster evidence cannot override defaults", () => {
  for (const expectedDay of [
    null,
    {
      expectedStartAt: new Date("2026-08-17T01:00:00.000Z"),
      expectedEndAt: new Date("2026-08-17T10:00:00.000Z"),
      kind: "WORKDAY",
      policySnapshot: { scheduledBreakMinutes: 60 },
      source: "MANUAL_EVIDENCE",
    },
    {
      expectedStartAt: null,
      expectedEndAt: null,
      kind: "REST_DAY",
      policySnapshot: { scheduledBreakMinutes: 0 },
      source: "ROSTER",
    },
    {
      expectedStartAt: new Date("2026-08-17T01:00:00.000Z"),
      expectedEndAt: new Date("2026-08-17T10:00:00.000Z"),
      kind: "WORKDAY",
      policySnapshot: {},
      source: "ROSTER",
    },
  ]) {
    const target = resolveAttendanceDailyWorkTarget({
      ...fallback,
      expectedDay,
    });
    assert.equal(target.normalWorkMinutesPerDay, 480);
    assert.equal(target.expectedBreakMinutes, 60);
  }
});
