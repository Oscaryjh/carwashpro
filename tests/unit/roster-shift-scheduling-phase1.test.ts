import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  addDays,
  assertWeeklyPeriod,
  expectedKindForRoster,
  rosterAssignmentDigest,
  startOfIsoWeek,
  validateRosterAssignment,
} from "../../src/lib/roster/domain";

test("Roster Phase 1 normalizes Monday weeks and preserves blank-day semantics", () => {
  const day = new Date("2026-08-20T00:00:00.000Z");
  assert.equal(startOfIsoWeek(day).toISOString().slice(0, 10), "2026-08-17");
  assert.equal(addDays(startOfIsoWeek(day), 6).toISOString().slice(0, 10), "2026-08-23");
  assert.doesNotThrow(() => assertWeeklyPeriod(new Date("2026-08-17T00:00:00.000Z"), day));
  assert.throws(() => assertWeeklyPeriod(new Date("2026-08-18T00:00:00.000Z")), /Monday/);
  assert.equal(expectedKindForRoster("WORK_SHIFT"), "WORKDAY");
  assert.equal(expectedKindForRoster("REST_DAY"), "REST_DAY");
  assert.equal(expectedKindForRoster("NOT_SCHEDULED"), "NOT_SCHEDULED");
});

test("Roster assignment validation supports overnight work but rejects unsafe duration and non-work times", () => {
  assert.deepEqual(validateRosterAssignment({
    membershipId: "employee",
    workDate: new Date("2026-08-17T00:00:00.000Z"),
    kind: "WORK_SHIFT",
    startAt: new Date("2026-08-17T14:00:00.000Z"),
    endAt: new Date("2026-08-17T22:00:00.000Z"),
    breakMinutes: 60,
  }), { breakMinutes: 60, durationMinutes: 480 });
  assert.throws(() => validateRosterAssignment({
    membershipId: "employee",
    workDate: new Date("2026-08-17T00:00:00.000Z"),
    kind: "REST_DAY",
    startAt: new Date("2026-08-17T01:00:00.000Z"),
  }), /cannot contain shift times/);
  assert.throws(() => validateRosterAssignment({
    membershipId: "employee",
    workDate: new Date("2026-08-17T00:00:00.000Z"),
    kind: "WORK_SHIFT",
    startAt: new Date("2026-08-17T01:00:00.000Z"),
    endAt: new Date("2026-08-18T02:00:00.000Z"),
  }), /24 hours/);
});

test("Roster publication digest is deterministic", () => {
  assert.equal(
    rosterAssignmentDigest([{ workDate: "2026-08-17", kind: "WORK_SHIFT" }]),
    rosterAssignmentDigest([{ kind: "WORK_SHIFT", workDate: "2026-08-17" }]),
  );
});

test("Roster contract keeps Draft, published history, Staff visibility and Attendance boundaries explicit", () => {
  const service = readFileSync("src/lib/roster/service.ts", "utf8");
  const staffPage = readFileSync("src/app/staff/roster/page.tsx", "utf8");
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  assert.match(service, /RETROSPECTIVE_REVIEW_REQUIRED/);
  assert.match(service, /TIMESHEET_REOPEN_REQUIRED/);
  assert.match(service, /source: "ROSTER"/);
  assert.match(service, /payrollEffect: "NONE"/);
  assert.match(service, /publicationRevision/);
  assert.match(staffPage, /No published schedule available/);
  assert.match(staffPage, /Unspecified · not an Off Day/);
  assert.match(schema, /model RosterPublishedAssignment/);
  assert.match(schema, /evidenceDisposition RosterEvidenceDisposition/);
});
