import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseAttendanceTimesheetMonth } from "../../src/lib/attendance/timesheet-service";

test("A3 month parser uses a strict calendar month and exclusive next-month boundary", () => {
  const august = parseAttendanceTimesheetMonth("2026-08");
  assert.equal(august.periodStart.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(august.periodEndExclusive.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.throws(() => parseAttendanceTimesheetMonth("2026-8"));
  assert.throws(() => parseAttendanceTimesheetMonth("2026-13"));
});

test("A3 migration is additive, scoped, immutable, and does not bridge Payroll", () => {
  const sql = readFileSync(join(
    process.cwd(),
    "prisma/migrations/20260803210000_attendance_monthly_timesheet_foundation/migration.sql",
  ), "utf8");
  assert.match(sql, /attendance_monthly_timesheets/);
  assert.match(sql, /attendance_timesheet_branch_readiness/);
  assert.match(sql, /attendance_timesheet_revisions/);
  assert.match(sql, /attendance_timesheet_revision_entries/);
  assert.match(sql, /Locked Attendance Timesheet revisions and entries are immutable/);
  assert.match(sql, /Attendance Timesheet entry evidence scope mismatch/);
  assert.match(sql, /BEFORE TRUNCATE ON "attendance_timesheet_revisions"/);
  assert.match(sql, /BEFORE TRUNCATE ON "attendance_timesheet_revision_entries"/);
  assert.doesNotMatch(sql, /ALTER TABLE "payroll_/i);
  assert.doesNotMatch(sql, /UPDATE "payroll_/i);
  assert.doesNotMatch(sql, /DELETE FROM "payroll_/i);
});

test("monthly timesheet UI keeps Attendance evidence separate from Payroll calculation", () => {
  const page = readFileSync(join(
    process.cwd(),
    "src/app/(business)/team/attendance/timesheets/page.tsx",
  ), "utf8");
  assert.match(page, /Attendance and approved OT minutes are frozen by local date for Payroll/);
  assert.match(page, /Monetary OT calculation remains deferred to Payroll P6C/);
  assert.match(page, /Final Attendance Result/);
  assert.match(page, /Finalize \{monthLabel\} timesheet/);
  assert.match(page, /Finalize timesheet/);
  assert.match(page, /Finalized versions/);
  assert.doesNotMatch(page, /Payroll Ready/);
  assert.doesNotMatch(page, /Timesheet Ready/);
});
