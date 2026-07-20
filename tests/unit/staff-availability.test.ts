import assert from "node:assert/strict";
import test from "node:test";
import {
  isTimeRangeAvailable,
  parseStaffTime,
  timeRangesOverlap,
} from "../../src/lib/appointments/staff-availability";

test("staff availability accepts a service fully inside working hours", () => {
  assert.equal(parseStaffTime("09:00"), 540);
  assert.equal(
    isTimeRangeAvailable({
      startTime: "09:00",
      endTime: "18:00",
      appointmentStartMinutes: 10 * 60,
      appointmentEndMinutes: 11 * 60,
    }),
    true,
  );
});

test("staff availability rejects services outside hours or crossing an invalid range", () => {
  assert.equal(
    isTimeRangeAvailable({
      startTime: "09:00",
      endTime: "18:00",
      appointmentStartMinutes: 17 * 60 + 30,
      appointmentEndMinutes: 18 * 60 + 30,
    }),
    false,
  );
  assert.equal(
    isTimeRangeAvailable({
      startTime: "18:00",
      endTime: "09:00",
      appointmentStartMinutes: 10 * 60,
      appointmentEndMinutes: 11 * 60,
    }),
    false,
  );
  assert.equal(parseStaffTime("25:00"), null);
});

test("staff breaks block overlapping appointment slots", () => {
  assert.equal(
    timeRangesOverlap({
      firstStart: "12:00",
      firstEnd: "13:00",
      secondStartMinutes: 12 * 60 + 30,
      secondEndMinutes: 13 * 60 + 30,
    }),
    true,
  );
  assert.equal(
    timeRangesOverlap({
      firstStart: "12:00",
      firstEnd: "13:00",
      secondStartMinutes: 13 * 60,
      secondEndMinutes: 14 * 60,
    }),
    false,
  );
});
