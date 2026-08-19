import assert from "node:assert/strict";
import test from "node:test";
import { workHoursToMinutesInput } from "../../src/lib/team/work-duration";

test("employee form converts understandable work hours to canonical minutes", () => {
  assert.equal(workHoursToMinutesInput("8"), "480");
  assert.equal(workHoursToMinutesInput("7.5"), "450");
  assert.equal(workHoursToMinutesInput("5"), "300");
  assert.equal(workHoursToMinutesInput(""), "");
});
