import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath =
  "prisma/migrations/20260915090000_people_workbench_account_classification/migration.sql";

test("People account classification is explicit and additive in Prisma", async () => {
  const schema = await readFile("prisma/schema.prisma", "utf8");

  assert.match(schema, /enum UserAccountType\s*{\s*HUMAN\s*SERVICE\s*}/s);
  assert.match(
    schema,
    /model User\s*{[\s\S]*?accountType\s+UserAccountType\s+@default\(HUMAN\)\s+@map\("account_type"\)/,
  );
  assert.match(
    schema,
    /model EmployeeBusinessMembership\s*{[\s\S]*?isTestAccount\s+Boolean\s+@default\(false\)\s+@map\("is_test_account"\)/,
  );
  assert.match(schema, /@@index\(\[businessId, accountType, status\]\)/);
  assert.match(schema, /@@index\(\[businessId, isTestAccount, status\]\)/);
});

test("People account classification migration has no destructive or statutory scope", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /CREATE TYPE "UserAccountType" AS ENUM \('HUMAN', 'SERVICE'\)/);
  assert.match(migration, /ADD COLUMN "account_type" "UserAccountType" NOT NULL DEFAULT 'HUMAN'/);
  assert.match(migration, /ADD COLUMN "is_test_account" BOOLEAN NOT NULL DEFAULT false/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE|UPDATE)\b/i);
  assert.doesNotMatch(migration, /statutory|pcb|epf|socso|eis|lindung/i);
});
