import assert from "node:assert/strict";
import test from "node:test";
import {
  addDaysToDateValue,
  parseBusinessDateTime,
  startOfBusinessWeek,
  toBusinessDateValue,
  toBusinessTimeValue,
} from "../../src/lib/business-time";

test("business wall-clock time is stored as the correct UTC instant", () => {
  assert.equal(
    parseBusinessDateTime("2026-07-23", "04:00").toISOString(),
    "2026-07-22T20:00:00.000Z",
  );
});

test("UTC appointment instants render in the business timezone", () => {
  const appointment = new Date("2026-07-22T20:00:00.000Z");
  assert.equal(toBusinessDateValue(appointment), "2026-07-23");
  assert.equal(toBusinessTimeValue(appointment), "04:00");
});

test("business calendar arithmetic is independent of the process timezone", () => {
  assert.equal(startOfBusinessWeek("2026-07-23"), "2026-07-20");
  assert.equal(addDaysToDateValue("2026-07-31", 1), "2026-08-01");
});
