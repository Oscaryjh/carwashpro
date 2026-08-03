import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  assertAttendanceResolutionTransition,
  assertFinalAttendanceResultValues,
  canTransitionAttendanceResolutionCase,
  classifyAttendanceSessionForResolution,
} from "../../src/lib/attendance/resolution-state-machine";

test("Attendance resolution classification separates active, unresolved, included, and excluded sessions", () => {
  assert.deepEqual(
    classifyAttendanceSessionForResolution({
      status: "OPEN",
      approvalStatus: "NOT_REQUIRED",
    }),
    { kind: "ACTIVE_SESSION" },
  );
  assert.equal(
    classifyAttendanceSessionForResolution({
      status: "INCOMPLETE",
      approvalStatus: "PENDING",
    }).kind,
    "ACTION_REQUIRED",
  );
  assert.deepEqual(
    classifyAttendanceSessionForResolution({
      status: "COMPLETED",
      approvalStatus: "REJECTED",
      hasCompleteTime: true,
    }),
    {
      kind: "ACTION_REQUIRED",
      caseStatus: "OPEN",
      openedReason: "APPROVAL_REJECTED",
    },
  );
  assert.deepEqual(
    classifyAttendanceSessionForResolution({
      status: "COMPLETED",
      approvalStatus: "NOT_REQUIRED",
      hasCompleteTime: false,
    }),
    {
      kind: "ACTION_REQUIRED",
      caseStatus: "OPEN",
      openedReason: "INCOMPLETE_SESSION",
    },
  );
  assert.deepEqual(
    classifyAttendanceSessionForResolution({
      status: "CANCELLED",
      approvalStatus: "NOT_REQUIRED",
    }),
    {
      kind: "FINAL_RESULT",
      caseStatus: "RESOLVED",
      disposition: "EXCLUDED",
      openedReason: "CANCELLED_SESSION",
      source: "RAW_SESSION",
    },
  );
  assert.equal(
    classifyAttendanceSessionForResolution({
      status: "COMPLETED",
      approvalStatus: "APPROVED",
      hasCompleteTime: true,
    }).kind,
    "FINAL_RESULT",
  );
  const adjusted = classifyAttendanceSessionForResolution({
    status: "COMPLETED",
    approvalStatus: "NOT_REQUIRED",
    hasAdjustment: true,
    hasCompleteTime: true,
  });
  assert.equal(adjusted.kind, "FINAL_RESULT");
  if (adjusted.kind === "FINAL_RESULT") {
    assert.equal(adjusted.source, "MANAGER_ADJUSTMENT");
  }
});

test("Attendance Resolution Case transitions do not reopen or overwrite resolved history", () => {
  assert.equal(canTransitionAttendanceResolutionCase("OPEN", "RESOLVED"), true);
  assert.equal(canTransitionAttendanceResolutionCase("UNDER_REVIEW", "OPEN"), true);
  assert.equal(
    canTransitionAttendanceResolutionCase("RETURNED_FOR_CORRECTION", "UNDER_REVIEW"),
    true,
  );
  assert.equal(canTransitionAttendanceResolutionCase("SUPERSEDED", "OPEN"), false);
  assert.throws(
    () => assertAttendanceResolutionTransition("SUPERSEDED", "RESOLVED"),
    /cannot transition/i,
  );
});

test("Final Attendance Result validation rejects invalid included times and minutes", () => {
  assert.throws(
    () =>
      assertFinalAttendanceResultValues({
        disposition: "INCLUDED",
        clockInAt: new Date("2026-08-01T01:00:00.000Z"),
        clockOutAt: null,
        totalBreakMinutes: 0,
        totalWorkedMinutes: 480,
        expectedBreakMinutes: 60,
        confirmedBreakMinutes: null,
      }),
    /clock-in and clock-out/i,
  );
  assert.throws(
    () =>
      assertFinalAttendanceResultValues({
        disposition: "EXCLUDED",
        clockInAt: null,
        clockOutAt: null,
        totalBreakMinutes: -1,
        totalWorkedMinutes: 0,
        expectedBreakMinutes: 0,
        confirmedBreakMinutes: null,
      }),
    /non-negative integers/i,
  );
});

test("A1 migration is additive, backfills legacy terminal sessions, and protects immutable results", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "prisma/migrations/20260803170000_attendance_resolution_foundation/migration.sql",
    ),
    "utf8",
  );

  assert.match(sql, /attendance_resolution_cases/);
  assert.match(sql, /attendance_final_results/);
  assert.match(sql, /LEGACY_BACKFILL/);
  assert.match(sql, /APPROVAL_REJECTED/);
  assert.match(sql, /INCOMPLETE_SESSION/);
  assert.match(sql, /Final Attendance Results are immutable/);
  assert.match(sql, /Attendance Resolution Cases cannot be deleted/);
  assert.doesNotMatch(sql, /UPDATE\s+"payroll_(?:runs|entries)"/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+"payroll_(?:runs|entries)"/i);
  assert.doesNotMatch(sql, /ALTER\s+TABLE\s+"payroll_(?:runs|entries)"/i);
});
