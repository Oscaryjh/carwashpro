import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = "prisma/migrations/20260817223000_leave_management_phase2a/migration.sql";

test("Leave Phase 2A migration is additive and never seeds unverified statutory figures", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /CREATE TABLE "leave_statutory_rule_sets"/);
  assert.match(migration, /CREATE TABLE "leave_statutory_rules"/);
  assert.match(migration, /CREATE TABLE "leave_statutory_entitlement_tiers"/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+"leave_statutory_/i);
});

test("Leave Phase 2A statutory evidence uses tenant-scoped composite foreign keys", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /leave_statutory_rule_sets_id_business_id_key/);
  assert.match(migration, /leave_statutory_rules_id_business_id_key/);
  assert.match(migration, /FOREIGN KEY \("rule_set_id", "business_id"\) REFERENCES "leave_statutory_rule_sets"\("id", "business_id"\)/);
  assert.match(migration, /FOREIGN KEY \("statutory_rule_id", "business_id"\) REFERENCES "leave_statutory_rules"\("id", "business_id"\)/);
});

test("reviewed statutory rules and tiers reject inserts, updates and deletes at the database boundary", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE ON "leave_statutory_rules"/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE ON "leave_statutory_entitlement_tiers"/);
  assert.match(migration, /Reviewed Leave statutory rules and tiers are immutable/);
  assert.match(migration, /Reviewed Leave statutory entitlement tiers are immutable/);
});

test("statutory activation is platform-only, requires human sign-off, and preserves independent review", async () => {
  const service = await readFile("src/lib/leave/statutory-service.ts", "utf8");

  assert.match(service, /input\.actor\.role !== "PLATFORM_ADMIN"/);
  assert.match(service, /Only a human-sign-off candidate can be activated/);
  assert.match(service, /Explicit human sign-off and an activation note are required/);
  assert.match(service, /existing\.createdById === input\.actor\.userId/);
  assert.match(service, /Independent review is required/);
  assert.match(service, /status: "SUPERSEDED"/);
  assert.doesNotMatch(service, /status: "ACTIVE"[\s\S]{0,300}reviewedById: input\.actor\.userId/);
});

test("Leave Phase 2A writes remain server-side and permission guarded", async () => {
  const actions = await readFile("src/app/(business)/team/leave/actions.ts", "utf8");

  assert.match(actions, /^"use server";/);
  assert.match(actions, /installSabahStatutoryRulePackDraftAction[\s\S]*?requireBusinessUser\("EDIT_LEAVE_POLICY"\)/);
  assert.match(actions, /submitStatutoryRuleSetAction[\s\S]*?requireBusinessUser\("EDIT_LEAVE_POLICY"\)/);
  assert.match(actions, /markStatutoryRuleSetReadyForHumanSignOffAction[\s\S]*?requireBusinessUser\("EDIT_LEAVE_POLICY"\)/);
  assert.doesNotMatch(actions, /activateStatutoryRuleSetAction/);
  assert.match(actions, /generateLeaveEntitlementsAction[\s\S]*?requireBusinessUser\("EDIT_LEAVE_POLICY"\)/);
});
