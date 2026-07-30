import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    "prisma",
    "migrations",
    "20260730210000_team_people_unification",
    "migration.sql",
  ),
  "utf8",
).replaceAll("\r\n", "\n");
const schema = readFileSync(
  resolve(process.cwd(), "prisma", "schema.prisma"),
  "utf8",
).replaceAll("\r\n", "\n");

test("People migration is one additive transaction and preserves prior data", () => {
  assert.match(migrationSql, /^\s*BEGIN;\s*/i);
  assert.match(migrationSql, /\s*COMMIT;\s*$/i);
  assert.doesNotMatch(
    migrationSql,
    /\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA|DATABASE|COLUMN|TYPE))\b/i,
  );
  assert.match(
    migrationSql,
    /CREATE TYPE "TeamMemberLinkStatus" AS ENUM \(\s*'LINKED',\s*'UNLINKED',\s*'REVIEW_REQUIRED'\s*\)/,
  );
  assert.match(
    migrationSql,
    /ALTER TABLE "users"[\s\S]*?ADD COLUMN "employee_business_membership_id" UUID[\s\S]*?ADD COLUMN "team_member_link_status" "TeamMemberLinkStatus"\s+NOT NULL DEFAULT 'UNLINKED'[\s\S]*?ADD COLUMN "team_member_link_reason" TEXT[\s\S]*?ADD COLUMN "team_member_linked_at" TIMESTAMP\(3\)/,
  );
});

test("People schema retains separate identities with an explicit one-to-one Membership link", () => {
  assert.match(
    schema,
    /enum TeamMemberLinkStatus\s*\{\s*LINKED\s+UNLINKED\s+REVIEW_REQUIRED\s*\}/,
  );
  assert.match(
    schema,
    /model User[\s\S]*?employeeAccountId\s+String\?[\s\S]*?employeeBusinessMembershipId\s+String\?\s+@unique[\s\S]*?teamMemberLinkStatus\s+TeamMemberLinkStatus\s+@default\(UNLINKED\)[\s\S]*?teamMemberLinkReason\s+String\?[\s\S]*?teamMemberLinkedAt\s+DateTime\?/,
  );
  assert.match(
    schema,
    /employeeBusinessMembership\s+EmployeeBusinessMembership\?\s+@relation\("EmployeeBusinessMembershipStaffUser", fields: \[employeeBusinessMembershipId\], references: \[id\], onDelete: Restrict\)/,
  );
  assert.match(
    schema,
    /model EmployeeBusinessMembership[\s\S]*?staffUser\s+User\?\s+@relation\("EmployeeBusinessMembershipStaffUser"\)/,
  );
  assert.match(
    schema,
    /model ServiceStaffAssignment[\s\S]*?userId\s+String[\s\S]*?user\s+User/,
  );
  assert.match(
    schema,
    /model Appointment[\s\S]*?assignedStaffId\s+String\?[\s\S]*?assignedStaff\s+User\?/,
  );
});

test("backfill prioritizes explicit identity and only exact same-Business phone matches", () => {
  assert.match(
    migrationSql,
    /membership\."employee_account_id"\s*=\s*staff\."employee_account_id"[\s\S]*?membership\."business_id"\s*=\s*staff\."business_id"/,
  );
  assert.match(
    migrationSql,
    /WHERE staff\."role" = 'STAFF'[\s\S]*?staff\."employee_account_id" IS NOT NULL/,
  );
  assert.match(
    migrationSql,
    /membership\."business_id" = phone\."business_id"[\s\S]*?membership\."phone_number_normalized"\s*=\s*phone\."phone_normalized"/,
  );
  assert.match(
    migrationSql,
    /count\(\*\) OVER \(\s*PARTITION BY phone\."user_id"\s*\) AS "membership_count"/,
  );
  assert.match(
    migrationSql,
    /count\(\*\) OVER \(\s*PARTITION BY membership\."id"\s*\) AS "claimant_count"/,
  );
  assert.match(
    migrationSql,
    /'DUPLICATE_EXPLICIT_ACCOUNT_CLAIM'/,
  );
  assert.match(migrationSql, /'DUPLICATE_PHONE_CLAIM'/);
  assert.match(
    migrationSql,
    /'DUPLICATE_PHONE_MEMBERSHIP'/,
  );
  assert.match(migrationSql, /'MEMBERSHIP_ALREADY_LINKED'/);
  assert.match(migrationSql, /'CROSS_BUSINESS_PHONE_MATCH'/);
  assert.match(migrationSql, /'MISSING_PHONE'/);
  assert.match(migrationSql, /'NO_MATCH'/);
  assert.doesNotMatch(
    migrationSql,
    /membership\."full_name"\s*=\s*staff\."name"/i,
  );
});

test("one-to-one state constraints and restrictive FK protect canonical employment", () => {
  assert.match(
    migrationSql,
    /CREATE UNIQUE INDEX\s+"users_employee_business_membership_id_key"\s+ON "users"\("employee_business_membership_id"\)/,
  );
  assert.match(
    migrationSql,
    /FOREIGN KEY \("employee_business_membership_id"\)[\s\S]*?REFERENCES "employee_business_memberships"\("id"\)[\s\S]*?ON DELETE RESTRICT/,
  );
  assert.match(
    migrationSql,
    /"team_member_link_status" = 'LINKED'[\s\S]*?"employee_business_membership_id" IS NOT NULL[\s\S]*?"team_member_linked_at" IS NOT NULL/,
  );
  assert.match(
    migrationSql,
    /"team_member_link_status" IN \(\s*'UNLINKED',\s*'REVIEW_REQUIRED'\s*\)[\s\S]*?"employee_business_membership_id" IS NULL[\s\S]*?"team_member_linked_at" IS NULL/,
  );
});

test("deferred bidirectional guards reject final tenant or account mismatch", () => {
  for (const functionName of [
    "enforce_team_member_user_membership_scope",
    "enforce_team_member_membership_user_scope",
  ]) {
    assert.match(
      migrationSql,
      new RegExp(`CREATE FUNCTION "${functionName}"\\(\\)`),
    );
  }
  assert.match(
    migrationSql,
    /current_business_id IS DISTINCT FROM\s+membership_business_id[\s\S]*?current_employee_account_id IS DISTINCT FROM\s+membership_employee_account_id/,
  );
  assert.match(
    migrationSql,
    /staff\."business_id" IS DISTINCT FROM\s+membership\."business_id"[\s\S]*?staff\."employee_account_id" IS DISTINCT FROM\s+membership\."employee_account_id"/,
  );
  assert.equal(
    migrationSql.match(/DEFERRABLE INITIALLY DEFERRED/g)?.length,
    2,
  );
  assert.match(
    migrationSql,
    /CREATE CONSTRAINT TRIGGER\s+"users_team_member_membership_scope_guard"/,
  );
  assert.match(
    migrationSql,
    /CREATE CONSTRAINT TRIGGER\s+"employee_memberships_team_member_user_scope_guard"/,
  );
});
