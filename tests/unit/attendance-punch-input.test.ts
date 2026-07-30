import assert from "node:assert/strict";
import test from "node:test";
import {
  attendanceExceptionInputSchema,
  attendanceHistoryInputSchema,
  attendancePunchInputSchema,
} from "../../src/lib/attendance/punch-input";

const BRANCH_ID = "22222222-2222-4222-8222-222222222222";

test("punch input accepts valid evidence and never accepts client-derived scope fields", () => {
  const parsed = attendancePunchInputSchema.parse({
    branchId: BRANCH_ID,
    latitude: 1.5535,
    longitude: 110.3593,
    accuracyMeters: 10,
    deviceTimestamp: "2026-07-30T12:00:00+08:00",
    deviceIdentifier: "verified-device-123",
    idempotencyKey: "clock-in:request-123",
    exceptionReason: null,
  });
  assert.equal(
    parsed.deviceTimestamp?.toISOString(),
    "2026-07-30T04:00:00.000Z",
  );

  assert.equal(
    attendancePunchInputSchema.safeParse({
      ...parsed,
      employeeId: "attacker-selected-employee",
    }).success,
    false,
  );
});

test("punch input rejects invalid GPS and idempotency evidence", () => {
  for (const invalid of [
    { latitude: 91 },
    { longitude: 181 },
    { accuracyMeters: 0 },
    { accuracyMeters: Number.POSITIVE_INFINITY },
    { idempotencyKey: "short" },
    { deviceIdentifier: "short" },
  ]) {
    assert.equal(
      attendancePunchInputSchema.safeParse({
        branchId: BRANCH_ID,
        latitude: 1,
        longitude: 1,
        accuracyMeters: 10,
        deviceIdentifier: "verified-device-123",
        idempotencyKey: "request-key-123",
        ...invalid,
      }).success,
      false,
    );
  }

  for (const partialGps of [
    { latitude: 1 },
    { longitude: 1 },
    { accuracyMeters: 10 },
    { latitude: 1, longitude: 1 },
  ]) {
    assert.equal(
      attendancePunchInputSchema.safeParse({
        branchId: BRANCH_ID,
        deviceIdentifier: "verified-device-123",
        idempotencyKey: "request-key-123",
        ...partialGps,
      }).success,
      false,
    );
  }
});

test("employee exception is restricted to Phase 1C types and bounded reason", () => {
  const base = {
    branchId: BRANCH_ID,
    attendanceSessionId: "33333333-3333-4333-8333-333333333333",
    type: "OTHER",
    reason: "Forgot to enable location permission.",
    deviceIdentifier: "verified-device-123",
  };
  assert.equal(attendanceExceptionInputSchema.safeParse(base).success, true);
  assert.equal(
    attendanceExceptionInputSchema.safeParse({
      ...base,
      type: "FORGOT_CLOCK_IN",
    }).success,
    false,
  );
  assert.equal(
    attendanceExceptionInputSchema.safeParse({
      ...base,
      reason: "x".repeat(501),
    }).success,
    false,
  );
  assert.equal(
    attendanceExceptionInputSchema.safeParse({
      ...base,
      idempotencyKey: "exception:request-123",
    }).success,
    false,
    "standalone exceptions do not consume Punch idempotency keys",
  );
});

test("history pagination and calendar date range are bounded", () => {
  const parsed = attendanceHistoryInputSchema.parse({});
  assert.equal(parsed.page, 1);
  assert.equal(parsed.pageSize, 25);

  assert.equal(
    attendanceHistoryInputSchema.safeParse({ pageSize: 101 }).success,
    false,
  );
  assert.equal(
    attendanceHistoryInputSchema.safeParse({ employeeId: "other" }).success,
    false,
  );
  assert.equal(
    attendanceHistoryInputSchema.safeParse({
      from: "2026-02-30",
      to: "2026-03-01",
    }).success,
    false,
  );
  assert.equal(
    attendanceHistoryInputSchema.safeParse({
      from: "2026-07-30",
      to: "2026-07-29",
    }).success,
    false,
  );
  assert.equal(
    attendanceHistoryInputSchema.safeParse({
      from: "2026-06-01",
      to: "2026-07-02",
    }).success,
    false,
  );
  assert.equal(
    attendanceHistoryInputSchema.safeParse({
      from: "2026-07-01",
      to: "2026-07-31",
    }).success,
    true,
  );
});
