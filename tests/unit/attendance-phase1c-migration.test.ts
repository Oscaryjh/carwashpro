import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    "prisma",
    "migrations",
    "20260730183000_attendance_phase_1c_auth_and_idempotency",
    "migration.sql",
  ),
  "utf8",
).replaceAll("\r\n", "\n");
const compatibilityMigrationSql = readFileSync(
  resolve(
    process.cwd(),
    "prisma",
    "migrations",
    "20260730193000_attendance_phase_1c_compatibility_hardening",
    "migration.sql",
  ),
  "utf8",
).replaceAll("\r\n", "\n");
const phase1aFoundationSql = readFileSync(
  resolve(
    process.cwd(),
    "prisma",
    "migrations",
    "20260730130000_attendance_phase_1a_foundation",
    "migration.sql",
  ),
  "utf8",
).replaceAll("\r\n", "\n");
const phase1aHardeningSql = readFileSync(
  resolve(
    process.cwd(),
    "prisma",
    "migrations",
    "20260730133000_attendance_phase_1a_guard_hardening",
    "migration.sql",
  ),
  "utf8",
).replaceAll("\r\n", "\n");
const schema = readFileSync(
  resolve(process.cwd(), "prisma", "schema.prisma"),
  "utf8",
).replaceAll("\r\n", "\n");

test("Phase 1C migration is additive, transactional, and preserves Phase 1A migrations", () => {
  assert.match(migrationSql, /^\s*BEGIN;\s*/i);
  assert.match(migrationSql, /\s*COMMIT;\s*$/i);
  assert.doesNotMatch(
    migrationSql,
    /\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA|DATABASE|COLUMN|TYPE))\b/i,
  );
  assert.match(
    phase1aFoundationSql,
    /It intentionally does not create employee authentication, OTP, or punch APIs/i,
  );
  assert.match(
    phase1aFoundationSql,
    /CREATE TRIGGER "attendance_punches_immutable_guard"/i,
  );
  assert.match(
    phase1aHardeningSql,
    /CREATE TRIGGER "attendance_punches_immutable_truncate_guard"/i,
  );
});
test("Phase 1C compatibility migration safely hardens draft and final schemas", () => {
  const utcWallClock = "(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')";
  assert.match(compatibilityMigrationSql, /^\s*BEGIN;\s*/i);
  assert.match(compatibilityMigrationSql, /\s*COMMIT;\s*$/i);
  assert.doesNotMatch(
    compatibilityMigrationSql,
    /\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA|DATABASE|COLUMN|TYPE))\b/i,
  );
  assert.doesNotMatch(compatibilityMigrationSql, /\bCREATE\s+(?:TABLE|TYPE)\b/i);
  assert.equal(
    compatibilityMigrationSql.match(
      /SET DEFAULT \(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)/g,
    )?.length,
    7,
  );
  assert.equal(
    compatibilityMigrationSql.match(
      /\(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)/g,
    )?.length,
    13,
  );
  assert.doesNotMatch(
    compatibilityMigrationSql.replaceAll(utcWallClock, ""),
    /\bCURRENT_TIMESTAMP\b/,
  );

  for (const functionName of [
    "enforce_attendance_terminal_punch_link",
    "enforce_attendance_session_terminal_links",
    "invalidate_previous_employee_otp_challenges",
    "enforce_employee_otp_challenge_lifecycle",
    "enforce_employee_session_scope",
    "revoke_sessions_for_inactive_employee_device",
    "enforce_attendance_idempotency_scope",
  ]) {
    assert.ok(
      compatibilityMigrationSql.includes(
        `CREATE OR REPLACE FUNCTION "${functionName}"()`,
      ),
      `Missing compatibility function ${functionName}`,
    );
  }

  assert.match(
    compatibilityMigrationSql,
    /Existing terminal Attendance Punch linkage is invalid/i,
  );
  assert.match(
    compatibilityMigrationSql,
    /DROP TRIGGER IF EXISTS "attendance_terminal_punch_link_guard"[\s\S]*?CREATE CONSTRAINT TRIGGER "attendance_terminal_punch_link_guard"[\s\S]*?DEFERRABLE INITIALLY DEFERRED/i,
  );
  assert.match(
    compatibilityMigrationSql,
    /DROP TRIGGER IF EXISTS "attendance_session_terminal_link_guard"[\s\S]*?CREATE CONSTRAINT TRIGGER "attendance_session_terminal_link_guard"[\s\S]*?DEFERRABLE INITIALLY DEFERRED/i,
  );
  assert.match(
    compatibilityMigrationSql,
    /"effective_until" IS NULL\s+OR "effective_until" >= \(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)/i,
  );
});

test("Phase 1C timestamp defaults and guards use a UTC wall clock", () => {
  const utcWallClock = "(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')";
  assert.equal(
    migrationSql.match(/\(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)/g)?.length,
    13,
  );
  assert.doesNotMatch(
    migrationSql.replaceAll(utcWallClock, ""),
    /\bCURRENT_TIMESTAMP\b/,
  );
  assert.match(
    schema,
    /model EmployeeOtpChallenge[\s\S]*?createdAt\s+DateTime\s+@default\(dbgenerated\("\(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)"\)\)/,
  );
  assert.match(
    schema,
    /model EmployeeDevice[\s\S]*?firstVerifiedAt\s+DateTime\s+@default\(dbgenerated\("\(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)"\)\)[\s\S]*?lastActiveAt\s+DateTime\s+@default\(dbgenerated\("\(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)"\)\)[\s\S]*?createdAt\s+DateTime\s+@default\(dbgenerated\("\(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)"\)\)/,
  );
  assert.match(
    schema,
    /model EmployeeSession[\s\S]*?lastActiveAt\s+DateTime\s+@default\(dbgenerated\("\(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)"\)\)[\s\S]*?createdAt\s+DateTime\s+@default\(dbgenerated\("\(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)"\)\)/,
  );
  assert.match(
    schema,
    /model AttendanceRequestIdempotency[\s\S]*?createdAt\s+DateTime\s+@default\(dbgenerated\("\(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)"\)\)/,
  );
});


test("OTP challenge stores only hashes and is single-use with serialized replacement", () => {
  assert.match(schema, /enum EmployeeOtpPurpose\s*\{\s*LOGIN\s+REGISTER_DEVICE\s*\}/);
  assert.match(
    schema,
    /model EmployeeOtpChallenge[\s\S]*?otpHash\s+String[\s\S]*?resendAvailableAt\s+DateTime[\s\S]*?verifiedAt\s+DateTime\?[\s\S]*?invalidatedAt\s+DateTime\?/,
  );
  assert.doesNotMatch(
    schema,
    /model EmployeeOtpChallenge[\s\S]*?\botp\s+String\b/,
  );
  assert.match(
    migrationSql,
    /pg_advisory_xact_lock\([\s\S]*?hashtextextended\(/i,
  );
  assert.match(
    migrationSql,
    /UPDATE "employee_otp_challenges"[\s\S]*?SET "invalidated_at" = \(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)[\s\S]*?"invalidated_at" IS NULL/i,
  );
  const replacementFunction =
    migrationSql
      .split('CREATE FUNCTION "invalidate_previous_employee_otp_challenges"')[1]
      ?.split('CREATE FUNCTION "enforce_employee_otp_challenge_lifecycle"')[0] ?? "";
  const replacementUpdate =
    migrationSql
      .split('UPDATE "employee_otp_challenges"')[1]
      ?.split("RETURN NEW;")[0] ?? "";
  assert.doesNotMatch(replacementFunction, /NEW\."purpose"/i);
  assert.doesNotMatch(replacementUpdate, /"verified_at" IS NULL/i);
  assert.doesNotMatch(
    migrationSql,
    /employee_otp_challenges_terminal_state_check/i,
  );
  assert.match(
    migrationSql,
    /"invalidated_at" >= COALESCE\([\s\S]*?"verified_at"[\s\S]*?"created_at"/i,
  );
  assert.match(
    migrationSql,
    /OLD\."verified_at" IS NOT NULL[\s\S]*?Employee OTP challenge was already used/i,
  );
  assert.match(
    migrationSql,
    /OLD\."expires_at" <= \(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)[\s\S]*?OLD\."attempts" >= OLD\."max_attempts"/i,
  );
});

test("Employee Device and Session enforce one punch device and tenant-consistent scope", () => {
  assert.match(
    schema,
    /model EmployeeDevice[\s\S]*?deviceIdentifierHash\s+String[\s\S]*?status\s+EmployeeDeviceStatus[\s\S]*?canView\s+Boolean[\s\S]*?canPunch\s+Boolean/,
  );
  assert.match(
    schema,
    /model EmployeeSession[\s\S]*?employeeAccountId\s+String[\s\S]*?membershipId\s+String[\s\S]*?businessId\s+String[\s\S]*?primaryBranchId\s+String[\s\S]*?employeeDeviceId\s+String\?[\s\S]*?refreshTokenHash\s+String\s+@unique/,
  );
  assert.match(
    migrationSql,
    /CREATE UNIQUE INDEX "employee_devices_one_active_punch_device_key"[\s\S]*?WHERE "status" = 'ACTIVE' AND "can_punch" = true/i,
  );
  assert.match(
    migrationSql,
    /CREATE FUNCTION "enforce_employee_session_scope"\(\)[\s\S]*?"employee_account_id" = NEW\."employee_account_id"[\s\S]*?"business_id" = NEW\."business_id"/i,
  );
  assert.match(
    migrationSql,
    /FROM "branches"[\s\S]*?"id" = NEW\."primary_branch_id"[\s\S]*?"business_id" = NEW\."business_id"/i,
  );
  assert.match(
    migrationSql,
    /FROM "employee_devices"[\s\S]*?"id" = NEW\."employee_device_id"[\s\S]*?"employee_account_id" = NEW\."employee_account_id"/i,
  );
  assert.match(
    migrationSql,
    /CREATE TRIGGER "employee_devices_revoke_sessions"[\s\S]*?revoke_sessions_for_inactive_employee_device/i,
  );
  assert.match(
    migrationSql,
    /OLD\."status" = 'REVOKED'[\s\S]*?NEW\."status" <> 'REVOKED'[\s\S]*?Revoked Employee device cannot be reactivated/i,
  );
  assert.doesNotMatch(
    migrationSql,
    /OLD\."status" <> 'ACTIVE'[\s\S]*?cannot be reactivated/i,
  );
  assert.match(
    migrationSql,
    /CREATE FUNCTION "prevent_employee_account_auth_identity_mutation"\(\)[\s\S]*?FROM "employee_otp_challenges"[\s\S]*?FROM "employee_devices"[\s\S]*?FROM "employee_sessions"/i,
  );
  assert.match(
    migrationSql,
    /CREATE TRIGGER "employee_accounts_auth_identity_guard"/i,
  );
});

test("one membership has one live Attendance Session and Punch immutability remains required", () => {
  assert.match(
    migrationSql,
    /employee_attendance_one_active_session_key[\s\S]*?index_definition\.indisunique[\s\S]*?ILIKE '%OPEN%'[\s\S]*?ILIKE '%ON_BREAK%'/i,
  );
  assert.doesNotMatch(
    migrationSql,
    /CREATE UNIQUE INDEX\s+"employee_attendance_one_live_session_per_membership_key"/i,
  );
  assert.match(
    migrationSql,
    /Attendance Punch immutability guards are missing/i,
  );
  assert.doesNotMatch(
    migrationSql,
    /CREATE OR REPLACE FUNCTION\s+"prevent_attendance_punch_mutation"/i,
  );
});
test("terminal Punch linkage is deferred, bidirectional, and cannot be cleared or swapped", () => {
  assert.match(
    migrationSql,
    /Existing terminal Attendance Punch linkage is invalid/i,
  );
  assert.match(
    migrationSql,
    /CREATE CONSTRAINT TRIGGER "attendance_terminal_punch_link_guard"\s+AFTER INSERT OR UPDATE ON "attendance_punches"\s+DEFERRABLE INITIALLY DEFERRED[\s\S]*?enforce_attendance_terminal_punch_link/i,
  );
  assert.match(
    migrationSql,
    /CREATE FUNCTION "enforce_attendance_terminal_punch_link"\(\)[\s\S]*?NEW\."attendance_session_id" IS NULL[\s\S]*?session\."clock_in_punch_id" = NEW\."id"[\s\S]*?session\."clock_out_punch_id" = NEW\."id"/i,
  );
  assert.match(
    migrationSql,
    /CREATE CONSTRAINT TRIGGER "attendance_session_terminal_link_guard"\s+AFTER INSERT OR UPDATE ON "employee_attendance"\s+DEFERRABLE INITIALLY DEFERRED[\s\S]*?enforce_attendance_session_terminal_links/i,
  );
  assert.match(
    migrationSql,
    /CREATE FUNCTION "enforce_attendance_session_terminal_links"\(\)[\s\S]*?current_session\."clock_in_punch_id" IS DISTINCT FROM punch\."id"[\s\S]*?must retain its linked clock-in Punch[\s\S]*?current_session\."clock_out_punch_id" IS DISTINCT FROM punch\."id"[\s\S]*?must retain its linked clock-out Punch/i,
  );
});

test("Employee Session assignment effectiveUntil remains inclusive", () => {
  assert.match(
    migrationSql,
    /"effective_until" IS NULL\s+OR "effective_until" >= \(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)/i,
  );
  assert.doesNotMatch(
    migrationSql,
    /OR "effective_until" > \(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)/i,
  );
});


test("idempotency persists payload identity, original result, and tenant-safe relations", () => {
  assert.match(
    schema,
    /model AttendanceRequestIdempotency[\s\S]*?membershipId\s+String[\s\S]*?employeeSessionId\s+String[\s\S]*?idempotencyKey\s+String[\s\S]*?requestPayloadHash\s+String[\s\S]*?punchType\s+AttendancePunchType[\s\S]*?attendancePunchId\s+String\?\s+@unique/,
  );
  assert.match(
    schema,
    /@@unique\(\[membershipId, idempotencyKey\], map: "attendance_idempotency_membership_key"\)/,
  );
  assert.match(
    migrationSql,
    /"status" = 'PROCESSING'[\s\S]*?"attendance_punch_id" IS NULL[\s\S]*?"status" = 'COMPLETED'[\s\S]*?"attendance_punch_id" IS NOT NULL/i,
  );
  assert.match(
    migrationSql,
    /CREATE FUNCTION "enforce_attendance_idempotency_scope"\(\)[\s\S]*?FROM "employee_sessions"[\s\S]*?"membership_id" = NEW\."membership_id"[\s\S]*?"business_id" = NEW\."business_id"/i,
  );
  assert.match(
    migrationSql,
    /FROM "attendance_punches"[\s\S]*?"employee_id" = NEW\."membership_id"[\s\S]*?"attendance_session_id" = NEW\."attendance_session_id"[\s\S]*?"type" = NEW\."punch_type"/i,
  );
  assert.match(
    migrationSql,
    /Completed Attendance idempotency result is immutable/i,
  );
});
