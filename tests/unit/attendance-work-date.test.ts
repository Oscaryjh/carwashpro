import assert from "node:assert/strict";
import test from "node:test";
import {
  formatBranchLocalDateTime,
  getAttendanceWorkDate,
  getBranchLocalDateKey,
} from "../../src/lib/attendance/work-date";

test("attendance workDate uses the Asia/Kuching local calendar date", () => {
  const instant = new Date("2026-07-30T18:30:00.000Z");

  assert.equal(
    getBranchLocalDateKey(instant, "Asia/Kuching"),
    "2026-07-31",
  );
  assert.equal(
    getAttendanceWorkDate(instant, "Asia/Kuching").toISOString(),
    "2026-07-31T00:00:00.000Z",
  );
  assert.equal(
    formatBranchLocalDateTime(instant, "Asia/Kuching"),
    "2026-07-31T02:30:00",
  );
});

test("attendance workDate supports other IANA timezones and UTC date boundaries", () => {
  const instant = new Date("2026-07-30T02:30:00.000Z");

  assert.equal(getBranchLocalDateKey(instant, "UTC"), "2026-07-30");
  assert.equal(
    getBranchLocalDateKey(instant, "America/New_York"),
    "2026-07-29",
  );
});

test("a night session keeps its clock-in workDate after local midnight", () => {
  const clockInAt = new Date("2026-07-30T15:30:00.000Z");
  const clockOutAt = new Date("2026-07-30T18:30:00.000Z");
  const storedWorkDate = getAttendanceWorkDate(
    clockInAt,
    "Asia/Kuching",
  );

  assert.equal(storedWorkDate.toISOString(), "2026-07-30T00:00:00.000Z");
  assert.equal(
    getBranchLocalDateKey(clockOutAt, "Asia/Kuching"),
    "2026-07-31",
  );
  assert.equal(storedWorkDate.toISOString(), "2026-07-30T00:00:00.000Z");
});

test("invalid timezone is rejected", () => {
  assert.throws(() =>
    getAttendanceWorkDate(new Date(), "Not/A_Timezone"),
  );
});
