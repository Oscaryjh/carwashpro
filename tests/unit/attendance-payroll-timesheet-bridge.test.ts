import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const service = read("src/lib/payroll/service.ts");
const bridge = read("src/lib/payroll/timesheet-bridge.ts");
const runsLoader = read("src/lib/payroll/runs.ts");
const runPage = read("src/app/(business)/team/payroll/runs/[runId]/page.tsx");
const schema = read("prisma/schema.prisma");
const migration = read(
  "prisma/migrations/20260803230000_attendance_payroll_timesheet_bridge/migration.sql",
);

test("A4 Generate and Refresh use only the current locked Timesheet revision", () => {
  const generation = service.slice(
    service.indexOf("export async function generatePayrollRun"),
    service.indexOf("async function runSerializablePayrollTransaction"),
  );
  assert.match(generation, /resolveLockedPayrollTimesheet/);
  assert.match(generation, /LOCKED_TIMESHEET_REVISION/);
  assert.match(generation, /attendanceTimesheetRevisionId/);
  assert.doesNotMatch(generation, /employeeAttendance\.findMany/);
  assert.match(bridge, /where: \{ disposition: "INCLUDED" \}/);
  assert.match(bridge, /status === "LOCKED"/);
});

test("A4 blocks stale Submit and Finalize while preserving historical Finalized provenance", () => {
  const guardCalls = service.match(/assertPayrollRunUsesCurrentLockedTimesheet/g) ?? [];
  assert.equal(guardCalls.length, 3);
  assert.match(bridge, /PAYROLL_REFRESH_REQUIRED/);
  assert.match(runsLoader, /LOCKED_HISTORICAL_SNAPSHOT/);
  assert.match(runsLoader, /LEGACY_FINALIZED/);
  assert.match(runPage, /must first be returned to Draft/);
  assert.match(runPage, /Current locked Timesheet revision/);
});

test("A4 schema and migration retain exact immutable Attendance provenance", () => {
  for (const field of [
    "attendanceSource",
    "attendanceTimesheetRevisionId",
    "attendanceTimesheetRevisionSnapshot",
    "attendanceTimesheetDigestSnapshot",
    "attendanceTimesheetLockedAtSnapshot",
  ]) {
    assert.match(schema, new RegExp(field));
  }
  assert.match(migration, /payroll_runs_attendance_source_evidence/);
  assert.match(migration, /Payroll Attendance Timesheet provenance mismatch/);
  assert.match(migration, /Reviewed or finalized Payroll Attendance provenance is immutable/);
  assert.match(migration, /FOREIGN KEY \("attendance_timesheet_revision_id", "business_id"\)/);
});

function read(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}
