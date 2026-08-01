import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { enumerateLeaveDates, PENINSULAR_LABUAN_LEAVE_PRESET, resolveLeaveEntitlementDays } from "../../src/lib/leave/policy";

test("weekday leave excludes Saturday and Sunday", () => {
  assert.deepEqual(enumerateLeaveDates("2026-08-07", "2026-08-10", "WEEKDAYS"), ["2026-08-07", "2026-08-10"]);
});

test("calendar-day leave includes weekends", () => {
  assert.deepEqual(enumerateLeaveDates("2026-08-07", "2026-08-10", "CALENDAR_DAYS"), ["2026-08-07", "2026-08-08", "2026-08-09", "2026-08-10"]);
});

test("Peninsular and Labuan annual leave tiers are explicit opt-in policy values", () => {
  const annual = PENINSULAR_LABUAN_LEAVE_PRESET.find((policy) => policy.code === "ANNUAL");
  assert.ok(annual);
  assert.equal(annual.underTwoYearsDays, 8);
  assert.equal(annual.twoToFiveYearsDays, 12);
  assert.equal(annual.fiveYearsPlusDays, 16);
});

test("tenure entitlement uses the employee join date and policy tier", () => {
  const policy = {
    defaultEntitlementDays: null,
    underTwoYearsDays: { valueOf: () => 8 },
    twoToFiveYearsDays: { valueOf: () => 12 },
    fiveYearsPlusDays: { valueOf: () => 16 },
  } as never;
  assert.equal(resolveLeaveEntitlementDays(policy, new Date("2025-06-01T00:00:00Z"), 2026), 8);
  assert.equal(resolveLeaveEntitlementDays(policy, new Date("2022-06-01T00:00:00Z"), 2026), 12);
  assert.equal(resolveLeaveEntitlementDays(policy, new Date("2018-06-01T00:00:00Z"), 2026), 16);
});

test("leave migration is additive and contains database tenant guards", async () => {
  const migration = await readFile("prisma/migrations/20260801170000_leave_management_foundation/migration.sql", "utf8");
  assert.match(migration, /CREATE TABLE "leave_requests"/);
  assert.match(migration, /CREATE TABLE "leave_request_days"/);
  assert.match(migration, /enforce_leave_tenant_scope/);
  assert.match(migration, /Leave membership tenant mismatch/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
});
