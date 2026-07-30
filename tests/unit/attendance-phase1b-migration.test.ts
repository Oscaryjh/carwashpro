import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migrationPath = resolve(
  process.cwd(),
  "prisma",
  "migrations",
  "20260730170000_attendance_assignment_history",
  "migration.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8").replaceAll("\r\n", "\n");
const schema = readFileSync(
  resolve(process.cwd(), "prisma", "schema.prisma"),
  "utf8",
).replaceAll("\r\n", "\n");

test("Phase 1B assignment-history migration is transactional and preserves data", () => {
  assert.match(migrationSql, /^\s*BEGIN;\s*/i);
  assert.match(migrationSql, /\s*COMMIT;\s*$/i);
  assert.doesNotMatch(
    migrationSql,
    /\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA|DATABASE|COLUMN))\b/i,
  );
  assert.match(
    migrationSql,
    /DROP INDEX IF EXISTS\s+"employee_branch_assignments_membership_id_branch_id_key"/i,
  );
});

test("Phase 1B permits historical periods but keeps one active assignment per branch", () => {
  assert.match(
    migrationSql,
    /CREATE INDEX\s+"employee_branch_assignments_membership_id_branch_id_idx"\s+ON "employee_branch_assignments"\("membership_id", "branch_id"\)/i,
  );
  assert.match(
    migrationSql,
    /CREATE UNIQUE INDEX\s+"employee_branch_assignments_one_active_branch_key"\s+ON "employee_branch_assignments"\("membership_id", "branch_id"\)\s+WHERE "status" = 'ACTIVE'/i,
  );
  assert.match(
    schema,
    /model EmployeeBranchAssignment[\s\S]*?@@index\(\[membershipId, branchId\]\)/,
  );
  assert.doesNotMatch(
    schema,
    /model EmployeeBranchAssignment[\s\S]*?@@unique\(\[membershipId, branchId\]\)/,
  );
});

test("Phase 1B keeps Business immutable but permits safe pre-attendance account relink", () => {
  assert.match(
    migrationSql,
    /CREATE OR REPLACE FUNCTION\s+"prevent_attendance_membership_tenant_key_mutation"\(\)/i,
  );
  assert.match(
    migrationSql,
    /IF NEW\."business_id" IS DISTINCT FROM OLD\."business_id"[\s\S]*?FROM "employee_branch_assignments"/i,
  );
  assert.match(
    migrationSql,
    /IF NEW\."employee_account_id" IS DISTINCT FROM[\s\S]*?FROM "employee_attendance"/i,
  );

  const accountRelinkGuard =
    migrationSql
      .split('IF NEW."employee_account_id"')[1]
      ?.split("RETURN NEW;")[0] ?? "";
  assert.doesNotMatch(
    accountRelinkGuard,
    /employee_branch_assignments/i,
  );
});
