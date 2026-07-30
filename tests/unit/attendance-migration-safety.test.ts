import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migrationPath = resolve(
  process.cwd(),
  "prisma",
  "migrations",
  "20260730130000_attendance_phase_1a_foundation",
  "migration.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8").replaceAll("\r\n", "\n");

const hardeningMigrationPath = resolve(
  process.cwd(),
  "prisma",
  "migrations",
  "20260730133000_attendance_phase_1a_guard_hardening",
  "migration.sql",
);
const hardeningMigrationSql = readFileSync(hardeningMigrationPath, "utf8").replaceAll("\r\n", "\n");

test("Attendance Phase 1A migration is transactional and avoids destructive data DDL", () => {
  assert.match(migrationSql, /^\s*BEGIN;\s*/i);
  assert.match(migrationSql, /\s*COMMIT;\s*$/i);

  const forbiddenStatements = [
    {
      label: "DROP TABLE/SCHEMA/DATABASE",
      pattern: /\bDROP\s+(?:TABLE|SCHEMA|DATABASE)\b/i,
    },
    {
      label: "TRUNCATE",
      pattern: /\bTRUNCATE(?:\s+TABLE)?\b/i,
    },
    {
      label: "DELETE FROM",
      pattern: /\bDELETE\s+FROM\b/i,
    },
  ];

  for (const statement of forbiddenStatements) {
    assert.doesNotMatch(migrationSql, statement.pattern, statement.label);
  }

  const dropStatements = migrationSql
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^DROP\b/i.test(line));

  assert.deepEqual(
    dropStatements,
    [
      'DROP TYPE "EmployeeMembershipStatus_old";',
      'DROP TYPE "EmployeeAttendanceStatus_old";',
    ],
    "Only obsolete enum types created by this migration may be dropped",
  );
});

test("Attendance Punch rows are protected from UPDATE and DELETE", () => {
  assert.match(
    migrationSql,
    /CREATE FUNCTION "prevent_attendance_punch_mutation"\(\)[\s\S]*?RAISE EXCEPTION 'Attendance punches are immutable';[\s\S]*?\$\$ LANGUAGE plpgsql;/i,
  );
  assert.match(
    migrationSql,
    /CREATE TRIGGER "attendance_punches_immutable_guard"\s+BEFORE UPDATE OR DELETE ON "attendance_punches"\s+FOR EACH ROW EXECUTE FUNCTION "prevent_attendance_punch_mutation"\(\);/i,
  );
  assert.doesNotMatch(migrationSql, /\bUPDATE\s+"attendance_punches"\b/i);
  assert.doesNotMatch(migrationSql, /\bDELETE\s+FROM\s+"attendance_punches"\b/i);
});

test("Attendance tenant tables have database-level scope guards", () => {
  const guardFunctions = [
    "enforce_attendance_assignment_scope",
    "enforce_branch_attendance_setting_scope",
    "enforce_attendance_session_scope",
    "enforce_attendance_punch_scope",
    "enforce_attendance_exception_scope",
    "enforce_attendance_adjustment_scope",
  ];

  for (const functionName of guardFunctions) {
    assert.match(
      migrationSql,
      new RegExp(`CREATE FUNCTION "${functionName}"\\(\\)`, "i"),
      `${functionName} must exist`,
    );
  }

  const guardedTables = [
    {
      trigger: "employee_branch_assignments_scope_guard",
      events: "INSERT OR UPDATE",
      table: "employee_branch_assignments",
      fn: "enforce_attendance_assignment_scope",
    },
    {
      trigger: "branch_attendance_settings_scope_guard",
      events: "INSERT OR UPDATE",
      table: "branch_attendance_settings",
      fn: "enforce_branch_attendance_setting_scope",
    },
    {
      trigger: "employee_attendance_scope_guard",
      events: "INSERT OR UPDATE",
      table: "employee_attendance",
      fn: "enforce_attendance_session_scope",
    },
    {
      trigger: "attendance_punches_scope_guard",
      events: "INSERT",
      table: "attendance_punches",
      fn: "enforce_attendance_punch_scope",
    },
    {
      trigger: "attendance_exceptions_scope_guard",
      events: "INSERT OR UPDATE",
      table: "attendance_exceptions",
      fn: "enforce_attendance_exception_scope",
    },
    {
      trigger: "attendance_adjustments_scope_guard",
      events: "INSERT OR UPDATE",
      table: "attendance_adjustments",
      fn: "enforce_attendance_adjustment_scope",
    },
  ];

  for (const guard of guardedTables) {
    assert.match(
      migrationSql,
      new RegExp(
        `CREATE TRIGGER "${guard.trigger}"\\s+BEFORE ${guard.events} ON "${guard.table}"\\s+FOR EACH ROW EXECUTE FUNCTION "${guard.fn}"\\(\\);`,
        "i",
      ),
      `${guard.table} must enforce tenant scope before writes`,
    );
  }

  assert.match(migrationSql, /NEW\."business_id"/);
  assert.match(migrationSql, /NEW\."branch_id"/);
  assert.match(
    migrationSql,
    /CREATE UNIQUE INDEX "employee_attendance_one_active_session_key"\s+ON "employee_attendance"\("membership_id"\)\s+WHERE "status" IN \('OPEN', 'ON_BREAK'\);/i,
  );
});

test("Attendance hardening migration is additive and transactional", () => {
  assert.match(hardeningMigrationSql, /^\s*BEGIN;\s*/i);
  assert.match(hardeningMigrationSql, /\s*COMMIT;\s*$/i);
  assert.doesNotMatch(
    hardeningMigrationSql,
    /\bDROP\s+(?:TABLE|SCHEMA|DATABASE|COLUMN)\b/i,
  );
  assert.doesNotMatch(hardeningMigrationSql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(
    hardeningMigrationSql,
    /^\s*TRUNCATE\s+(?:TABLE\s+)?/im,
    "The trigger event may mention TRUNCATE, but the migration must not execute it",
  );
});

test("Attendance hardening closes terminal punch and actor scope gaps", () => {
  assert.match(
    hardeningMigrationSql,
    /employee_attendance_distinct_terminal_punches_check/i,
  );
  assert.match(
    hardeningMigrationSql,
    /punch\."type" = 'CLOCK_IN'[\s\S]*?punch\."attendance_session_id" IS NULL[\s\S]*?punch\."attendance_session_id" = NEW\."id"/i,
  );
  assert.match(
    hardeningMigrationSql,
    /punch\."type" = 'CLOCK_OUT'[\s\S]*?punch\."attendance_session_id" = NEW\."id"/i,
  );
  assert.match(
    hardeningMigrationSql,
    /Attendance exception punch does not belong to its session/i,
  );
  assert.match(
    hardeningMigrationSql,
    /CREATE FUNCTION "has_attendance_actor_scope"/i,
  );
  assert.match(hardeningMigrationSql, /'ALL_BRANCHES' = ANY\(actor\."permissions"\)/i);
  assert.match(hardeningMigrationSql, /business_group_user_business_access/i);
});

test("Attendance hardening protects parent scope, Punch truncation, and primary assignment", () => {
  assert.match(
    hardeningMigrationSql,
    /CREATE TRIGGER "branches_attendance_tenant_key_guard"/i,
  );
  assert.match(
    hardeningMigrationSql,
    /CREATE TRIGGER "employee_memberships_attendance_tenant_key_guard"/i,
  );
  assert.match(
    hardeningMigrationSql,
    /CREATE TRIGGER "attendance_punches_immutable_truncate_guard"\s+BEFORE TRUNCATE ON "attendance_punches"/i,
  );
  assert.match(
    hardeningMigrationSql,
    /CREATE TRIGGER "employee_branch_assignments_truncate_guard"\s+BEFORE TRUNCATE ON "employee_branch_assignments"/i,
  );
  assert.match(
    hardeningMigrationSql,
    /CREATE CONSTRAINT TRIGGER\s+"employee_memberships_active_primary_assignment_guard"[\s\S]*?DEFERRABLE INITIALLY DEFERRED/i,
  );
  assert.match(
    hardeningMigrationSql,
    /CREATE CONSTRAINT TRIGGER\s+"employee_branch_assignments_active_primary_guard"[\s\S]*?DEFERRABLE INITIALLY DEFERRED/i,
  );
});
