import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseBranchLocalDateTime } from "../../src/lib/attendance/work-date";

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
  assert.doesNotMatch(
    staffCases,
    /ACCEPT_AS_RECORDED|APPLY_CORRECTION|MANAGER_EXCLUDED/,
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
