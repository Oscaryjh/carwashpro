import assert from "node:assert/strict";
import test from "node:test";
import { parseBranchLocalDateTime } from "../../src/lib/attendance/work-date";
import {
  isRosterAssignmentRetrospective,
  rosterAssignmentDayKey,
} from "../../src/lib/roster/retrospective-classification";

const timezone = "Asia/Kuala_Lumpur";

function shift(workDate: string, start: string) {
  return {
    membershipId: "member-1",
    workDate: new Date(`${workDate}T00:00:00.000Z`),
    kind: "WORK_SHIFT" as const,
    startAt: parseBranchLocalDateTime(`${workDate}T${start}`, timezone),
  };
}

test("same-day future shift stays current-safe while started shift is retrospective", () => {
  const now = parseBranchLocalDateTime("2026-08-27T16:04", timezone);

  assert.equal(isRosterAssignmentRetrospective(shift("2026-08-27", "16:30"), now, timezone), false);
  assert.equal(isRosterAssignmentRetrospective(shift("2026-08-27", "15:30"), now, timezone), true);
});

test("exact shift start is the retrospective boundary", () => {
  const assignment = shift("2026-08-27", "16:30");

  assert.equal(
    isRosterAssignmentRetrospective(
      assignment,
      parseBranchLocalDateTime("2026-08-27T16:29", timezone),
      timezone,
    ),
    false,
  );
  assert.equal(
    isRosterAssignmentRetrospective(assignment, assignment.startAt, timezone),
    true,
  );
});

test("future and historical calendar dates keep their canonical protection", () => {
  const now = parseBranchLocalDateTime("2026-08-27T16:04", timezone);

  assert.equal(isRosterAssignmentRetrospective(shift("2026-08-28", "09:00"), now, timezone), false);
  assert.equal(isRosterAssignmentRetrospective(shift("2026-08-26", "23:30"), now, timezone), true);
});

test("midnight boundaries use the branch timezone and are server-timezone independent", () => {
  const beforeMidnight = parseBranchLocalDateTime("2026-08-27T23:50", timezone);
  const afterMidnight = parseBranchLocalDateTime("2026-08-28T00:05", timezone);

  assert.equal(isRosterAssignmentRetrospective(shift("2026-08-28", "00:10"), beforeMidnight, timezone), false);
  assert.equal(isRosterAssignmentRetrospective(shift("2026-08-27", "23:30"), afterMidnight, timezone), true);
  assert.equal(beforeMidnight.toISOString(), "2026-08-27T15:50:00.000Z");
  assert.equal(afterMidnight.toISOString(), "2026-08-27T16:05:00.000Z");
});

test("retrospective identity is scoped to employee and work date", () => {
  const first = shift("2026-08-27", "09:00");
  const second = { ...shift("2026-08-27", "16:30"), membershipId: "member-2" };

  assert.notEqual(rosterAssignmentDayKey(first), rosterAssignmentDayKey(second));
});
