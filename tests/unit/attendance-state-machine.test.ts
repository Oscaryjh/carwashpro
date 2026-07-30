import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAttendanceDurations,
  getAllowedAttendanceActions,
  getNextAttendanceStatus,
} from "../../src/lib/attendance/state-machine";

test("attendance state machine follows the required punch sequence", () => {
  assert.deepEqual(getAllowedAttendanceActions(null), ["CLOCK_IN"]);
  assert.equal(getNextAttendanceStatus(null, "CLOCK_IN"), "OPEN");
  assert.equal(getNextAttendanceStatus("OPEN", "BREAK_START"), "ON_BREAK");
  assert.equal(getNextAttendanceStatus("ON_BREAK", "BREAK_END"), "OPEN");
  assert.equal(getNextAttendanceStatus("OPEN", "CLOCK_OUT"), "COMPLETED");
});

test("clock out while on break is explicitly rejected", () => {
  assert.throws(
    () => getNextAttendanceStatus("ON_BREAK", "CLOCK_OUT"),
    /End the current break/,
  );
});

test("invalid duplicate or missing-session actions are rejected", () => {
  assert.throws(() => getNextAttendanceStatus(null, "CLOCK_OUT"));
  assert.throws(() => getNextAttendanceStatus("OPEN", "CLOCK_IN"));
  assert.throws(() => getNextAttendanceStatus("OPEN", "BREAK_END"));
  assert.throws(() => getNextAttendanceStatus("ON_BREAK", "BREAK_START"));
});

test("worked minutes use paired server punch timestamps", () => {
  const durations = calculateAttendanceDurations({
    clockInAt: new Date("2026-07-30T00:00:00.000Z"),
    endAt: new Date("2026-07-30T09:00:00.000Z"),
    breakPunches: [
      {
        type: "BREAK_START",
        serverTimestamp: new Date("2026-07-30T03:00:00.000Z"),
      },
      {
        type: "BREAK_END",
        serverTimestamp: new Date("2026-07-30T03:30:00.000Z"),
      },
      {
        type: "BREAK_START",
        serverTimestamp: new Date("2026-07-30T06:00:00.000Z"),
      },
      {
        type: "BREAK_END",
        serverTimestamp: new Date("2026-07-30T06:15:00.000Z"),
      },
    ],
  });

  assert.equal(durations.totalBreakMinutes, 45);
  assert.equal(durations.totalWorkedMinutes, 495);
  assert.equal(durations.openBreakStartedAt, null);
});

test("today calculation can subtract an ongoing break without treating it as completed", () => {
  const input = {
    clockInAt: new Date("2026-07-30T00:00:00.000Z"),
    endAt: new Date("2026-07-30T02:00:00.000Z"),
    breakPunches: [
      {
        type: "BREAK_START" as const,
        serverTimestamp: new Date("2026-07-30T01:30:00.000Z"),
      },
    ],
  };

  const completedOnly = calculateAttendanceDurations(input);
  const current = calculateAttendanceDurations({
    ...input,
    includeOpenBreakUntilEnd: true,
  });
  assert.equal(completedOnly.totalBreakMinutes, 0);
  assert.equal(current.totalBreakMinutes, 30);
  assert.equal(current.totalWorkedMinutes, 90);
});

test("invalid break pairs and negative elapsed time are rejected", () => {
  assert.throws(() =>
    calculateAttendanceDurations({
      clockInAt: new Date("2026-07-30T02:00:00.000Z"),
      endAt: new Date("2026-07-30T01:00:00.000Z"),
      breakPunches: [],
    }),
  );
  assert.throws(() =>
    calculateAttendanceDurations({
      clockInAt: new Date("2026-07-30T00:00:00.000Z"),
      endAt: new Date("2026-07-30T02:00:00.000Z"),
      breakPunches: [
        {
          type: "BREAK_END",
          serverTimestamp: new Date("2026-07-30T01:00:00.000Z"),
        },
      ],
    }),
  );
});
