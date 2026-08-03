import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseBranchLocalDateTime } from "../../src/lib/attendance/work-date";
import { getEmployeeResolutionCancellationState } from "../../src/lib/attendance/resolution-workflow-service";

test("A2 migration creates append-only scoped Resolution Events", () => {
  const migration = read(
    "prisma/migrations/20260803190000_attendance_resolution_workflow/migration.sql",
  );
  assert.match(migration, /CREATE TABLE "attendance_resolution_events"/);
  assert.match(migration, /attendance_resolution_events_actor_check/);
  assert.match(migration, /guard_attendance_resolution_event_insert/);
  assert.match(migration, /Attendance Resolution Events are immutable/);
  assert.match(migration, /BEFORE UPDATE OR DELETE/);
  assert.match(migration, /BEFORE TRUNCATE/);
  assert.match(migration, /RETURNED_FOR_CORRECTION/);
});

test("A2.1 migration makes Adjustments immutable and permits append-only cancellation", () => {
  const enumMigration = read(
    "prisma/migrations/20260803193000_attendance_resolution_gap_hardening/migration.sql",
  );
  const guardMigration = read(
    "prisma/migrations/20260803193100_attendance_resolution_gap_guards/migration.sql",
  );
  assert.match(enumMigration, /ADD VALUE IF NOT EXISTS 'EMPLOYEE_CANCELLED'/);
  assert.match(guardMigration, /Attendance Adjustments are immutable/);
  assert.match(guardMigration, /BEFORE UPDATE OR DELETE ON "attendance_adjustments"/);
  assert.match(guardMigration, /BEFORE TRUNCATE ON "attendance_adjustments"/);
  assert.match(
    guardMigration,
    /"type" IN \('EMPLOYEE_SUBMITTED', 'EMPLOYEE_CANCELLED'\)/,
  );
});

test("A2 staff and manager routes enforce separate authentication boundaries", () => {
  const staffRoute = read(
    "src/app/api/employee-attendance/resolutions/route.ts",
  );
  const managerAction = read(
    "src/app/(business)/team/attendance/resolutions/actions.ts",
  );
  const workflow = read(
    "src/lib/attendance/resolution-workflow-service.ts",
  );

  assert.match(staffRoute, /requireEmployeeAuthContext/);
  assert.match(staffRoute, /requireEmployeePunchAuthContext/);
  assert.match(staffRoute, /assertEmployeeAuthSameOrigin/);
  assert.match(staffRoute, /export async function DELETE/);
  assert.match(staffRoute, /cancelEmployeeAttendanceResolution/);
  assert.match(managerAction, /MODIFY_ATTENDANCE_EMPLOYEES/);
  assert.match(managerAction, /resolveAttendanceScope/);
  assert.match(workflow, /employeeId: args\.auth\.membershipId/);
  assert.match(workflow, /SELF_RESOLUTION_FORBIDDEN/);
  assert.doesNotMatch(workflow, /payrollRun|payrollEntry/i);
});

test("A2 Staff PWA exposes only the employee resubmit workflow", () => {
  const staffToday = read("src/components/staff-pwa/staff-today.tsx");
  const staffCases = read(
    "src/components/staff-pwa/staff-resolution-cases.tsx",
  );

  assert.match(staffToday, /<StaffResolutionCases/);
  assert.match(staffCases, /\/api\/employee-attendance\/resolutions/);
  assert.match(staffCases, /RETURNED_FOR_CORRECTION/);
  assert.match(staffCases, /Submit to manager/);
  assert.match(staffCases, /Cancel pending request/);
  assert.doesNotMatch(
    staffCases,
    /ACCEPT_AS_RECORDED|APPLY_CORRECTION|MANAGER_EXCLUDED/,
  );
});

test("A2.1 queue labels blocking truthfully without claiming Timesheet or Payroll readiness", () => {
  const queue = read(
    "src/app/(business)/team/attendance/resolutions/page.tsx",
  );
  assert.match(queue, /Payroll blocked/);
  assert.match(queue, /Resolution complete/);
  assert.match(queue, /Create correction version/);
  assert.doesNotMatch(queue, /Payroll Ready|Timesheet Ready/);
});

test("A2.1 cancellation permits only the first pending submission inside the deadline", () => {
  const submittedAt = new Date("2026-08-03T01:00:00.000Z");
  assert.equal(
    getEmployeeResolutionCancellationState({
      status: "UNDER_REVIEW",
      currentFinalResultId: null,
      events: [{ type: "EMPLOYEE_SUBMITTED", createdAt: submittedAt }],
      now: new Date("2026-08-03T01:14:59.000Z"),
    }).canCancel,
    true,
  );
  assert.equal(
    getEmployeeResolutionCancellationState({
      status: "UNDER_REVIEW",
      currentFinalResultId: null,
      events: [{ type: "EMPLOYEE_SUBMITTED", createdAt: submittedAt }],
      now: new Date("2026-08-03T01:15:00.000Z"),
    }).canCancel,
    false,
  );
  assert.equal(
    getEmployeeResolutionCancellationState({
      status: "UNDER_REVIEW",
      currentFinalResultId: null,
      events: [
        { type: "EMPLOYEE_SUBMITTED", createdAt: submittedAt },
        { type: "MANAGER_RETURNED", createdAt: new Date("2026-08-03T00:55:00.000Z") },
      ],
      now: new Date("2026-08-03T01:05:00.000Z"),
    }).canCancel,
    false,
  );
});

test("A2 branch-local correction parser preserves Malaysia local time", () => {
  assert.equal(
    parseBranchLocalDateTime(
      "2026-08-03T09:30",
      "Asia/Kuala_Lumpur",
    ).toISOString(),
    "2026-08-03T01:30:00.000Z",
  );
});

function read(path: string) {
  return readFileSync(path, "utf8");
}
