import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSql = readFileSync(
  new URL(
    "../../prisma/migrations/20260731180000_statutory_contribution_foundation/migration.sql",
    import.meta.url,
  ),
  "utf8",
).replaceAll("\r\n", "\n");

test("Statutory contribution migration is additive and transactional", () => {
  assert.match(migrationSql, /^BEGIN;/);
  assert.match(migrationSql, /CREATE TYPE "EmployeeStatutoryNationality"/);
  assert.match(migrationSql, /CREATE TYPE "EmployeeSocsoCategory"/);
  assert.match(migrationSql, /CREATE TYPE "PayrollStatutoryStatus"/);
  assert.match(migrationSql, /ALTER TABLE "employee_business_memberships"/);
  assert.match(migrationSql, /ALTER TABLE "payroll_entries"/);
  assert.match(migrationSql, /COMMIT;\s*$/);
  assert.doesNotMatch(
    migrationSql,
    /DROP\s+(?:TABLE|COLUMN|TYPE)|TRUNCATE|DELETE\s+FROM/i,
  );
});

test("Existing employees and payroll entries retain safe defaults", () => {
  for (const column of [
    "epf_enabled",
    "socso_enabled",
    "eis_enabled",
    "lindung_24_opt_in",
  ]) {
    assert.match(migrationSql, new RegExp(`"${column}" BOOLEAN NOT NULL DEFAULT false`));
  }
  assert.match(migrationSql, /"statutory_status" "PayrollStatutoryStatus" NOT NULL DEFAULT 'NOT_CONFIGURED'/);
  assert.match(migrationSql, /"epf_wage_base" DECIMAL\(12,2\) NOT NULL DEFAULT 0/);
  assert.match(migrationSql, /"perkeso_wage_base" DECIMAL\(12,2\) NOT NULL DEFAULT 0/);
});
