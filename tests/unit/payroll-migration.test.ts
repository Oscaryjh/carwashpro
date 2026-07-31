import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSql = readFileSync(
  new URL(
    "../../prisma/migrations/20260731160000_payroll_foundation/migration.sql",
    import.meta.url,
  ),
  "utf8",
).replaceAll("\r\n", "\n");

test("Payroll migration is additive and transactional", () => {
  assert.match(migrationSql, /^BEGIN;/);
  assert.match(migrationSql, /CREATE TABLE "payroll_settings"/);
  assert.match(migrationSql, /CREATE TABLE "payroll_holidays"/);
  assert.match(migrationSql, /CREATE TABLE "payroll_runs"/);
  assert.match(migrationSql, /CREATE TABLE "payroll_entries"/);
  assert.match(migrationSql, /COMMIT;\s*$/);
  assert.doesNotMatch(
    migrationSql,
    /DROP\s+(?:TABLE|COLUMN|TYPE)|TRUNCATE|DELETE\s+FROM/i,
  );
});

test("Payroll tables enforce tenant-consistent business scope", () => {
  assert.match(
    migrationSql,
    /CREATE CONSTRAINT TRIGGER "payroll_holidays_scope_guard"[\s\S]*?EXECUTE FUNCTION "payroll_validate_scope"\(\)/,
  );
  assert.match(
    migrationSql,
    /CREATE CONSTRAINT TRIGGER "payroll_entries_scope_guard"[\s\S]*?EXECUTE FUNCTION "payroll_validate_scope"\(\)/,
  );
  assert.match(
    migrationSql,
    /Payroll holiday branch must belong to the same business/,
  );
  assert.match(
    migrationSql,
    /Payroll entry employee must belong to the same business/,
  );
});

test("Finalized payroll runs and entries are database-immutable", () => {
  assert.match(
    migrationSql,
    /OLD\."status" = 'FINALIZED'[\s\S]*?Finalized payroll runs are immutable/,
  );
  assert.match(
    migrationSql,
    /CREATE TRIGGER "payroll_runs_finalized_lock" BEFORE UPDATE OR DELETE/,
  );
  assert.match(
    migrationSql,
    /CREATE TRIGGER "payroll_entries_finalized_lock" BEFORE INSERT OR UPDATE OR DELETE/,
  );
});
