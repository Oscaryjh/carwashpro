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

test("manager Attendance operations include review, adjustment, export, and pagination", () => {
  assert.match(managerPage, /reviewAttendanceExceptionAction/);
  assert.match(managerPage, /adjustAttendanceSessionAction/);
  assert.match(managerPage, /Export CSV/);
  assert.match(managerPage, /const pageSize = 25/);
  assert.match(managerPage, /skip: \(page - 1\) \* pageSize/);
  assert.match(managerPage, /Page \{page\} of \{totalPages\}/);
});

test("Photo Attendance is absent from branch Attendance settings UI", () => {
  assert.doesNotMatch(settingsForm, /requirePhoto|Require photo|photo capture/i);
});