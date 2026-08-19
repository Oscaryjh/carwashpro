import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const operationsMigration = readFileSync(
  new URL(
    "../../prisma/migrations/20260731110000_attendance_operations_completion/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const guardOrderMigration = readFileSync(
  new URL(
    "../../prisma/migrations/20260731111500_attendance_branch_guard_order/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const managerPage = readFileSync(
  new URL("../../src/app/(business)/team/attendance/page.tsx", import.meta.url),
  "utf8",
);
const attendanceLayout = readFileSync(
  new URL("../../src/app/(business)/team/attendance/layout.tsx", import.meta.url),
  "utf8",
);
const resolutionQueuePage = readFileSync(
  new URL(
    "../../src/app/(business)/team/attendance/resolutions/page.tsx",
    import.meta.url,
  ),
  "utf8",
);
const settingsForm = readFileSync(
  new URL("../../src/components/attendance-settings-form.tsx", import.meta.url),
  "utf8",
);


test("Attendance operations migration is additive, transactional, and tenant guarded", () => {
  assert.match(operationsMigration, /^BEGIN;/);
  assert.match(operationsMigration, /requested_clock_in_at/);
  assert.match(operationsMigration, /requested_clock_out_at/);
  assert.match(operationsMigration, /attendance_branch_id/);
  assert.match(operationsMigration, /employee_sessions_attendance_branch_id_fkey/);
  assert.match(operationsMigration, /validate_employee_session_attendance_branch_scope/);
  assert.match(operationsMigration, /employee_branch_assignments/);
  assert.match(operationsMigration, /COMMIT;\s*$/);
  assert.doesNotMatch(operationsMigration, /DROP\s+TABLE|TRUNCATE|DELETE\s+FROM/i);
});

test("Attendance branch guard preserves established session scope guard ordering", () => {
  assert.match(guardOrderMigration, /^BEGIN;/);
  assert.match(guardOrderMigration, /zz_employee_sessions_attendance_branch_insert_guard/);
  assert.match(guardOrderMigration, /BEFORE UPDATE OF "attendance_branch_id"/);
  assert.match(guardOrderMigration, /COMMIT;\s*$/);
});

test("manager Attendance operations use the Resolution Queue, export, and pagination", () => {
  assert.match(managerPage, /Attendance issue/);
  assert.doesNotMatch(attendanceLayout, /Attendance Issues/);
  assert.match(resolutionQueuePage, /decideAttendanceResolutionAction/);
  assert.match(resolutionQueuePage, /ACCEPT_AS_RECORDED/);
  assert.match(resolutionQueuePage, /APPLY_CORRECTION/);
  assert.match(resolutionQueuePage, /RETURN_TO_EMPLOYEE/);
  assert.match(resolutionQueuePage, /EXCLUDE/);
  assert.match(attendanceLayout, /Export CSV/);
  assert.match(managerPage, /const pageSize = 25/);
  assert.match(managerPage, /skip: \(page - 1\) \* pageSize/);
  assert.match(managerPage, /Page \{page\} of \{totalPages\}/);
});

test("Photo Attendance is absent from branch Attendance settings UI", () => {
  assert.doesNotMatch(settingsForm, /requirePhoto|Require photo|photo capture/i);
});

test("device location is visually confirmed before branch coordinates change", () => {
  assert.match(settingsForm, /pendingDeviceLocation/);
  assert.match(settingsForm, /Google Maps preview/);
  assert.match(settingsForm, /Use this location/);
  assert.match(settingsForm, /confirmCurrentLocation/);
  assert.match(settingsForm, /Location access is off/);
  assert.doesNotMatch(
    settingsForm,
    /\(position\) => \{\s*setLatitude\(position\.coords\.latitude/,
  );
});
