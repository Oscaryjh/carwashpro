import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  COMPANY_LEAVE_STARTER,
  enumerateCalendarDates,
  leavePolicyCreateInputSchema,
  leavePolicyVersionInputSchema,
  leaveReviewInputSchema,
  resolveLeaveEntitlementDays,
} from "../../src/lib/leave/policy";

test("Leave date enumeration never guesses whether a calendar date is a workday", () => {
  assert.deepEqual(enumerateCalendarDates("2026-08-07", "2026-08-10"), ["2026-08-07", "2026-08-08", "2026-08-09", "2026-08-10"]);
});

test("company Leave starters assert no Malaysia statutory entitlement", () => {
  const annual = COMPANY_LEAVE_STARTER.find((policy) => policy.code === "ANNUAL");
  assert.ok(annual);
  assert.equal(annual.defaultEntitlementDays, 0);
  assert.equal("underTwoYearsDays" in annual, false);
});

test("company policy refuses an unpaid type that consumes paid balance", () => {
  assert.throws(() => leavePolicyVersionInputSchema.parse({
    policyId: "f0cf7c07-224c-4905-9213-b5cf41de07fe",
    effectiveFrom: "2026-01-01",
    name: "Unpaid Leave",
    payTreatment: "UNPAID",
    countMode: "WEEKDAYS",
    balanceTracked: true,
    requiresDocument: false,
    allowNegativeBalance: false,
    reason: "Company policy",
  }), /must not consume/i);
});

test("a business can define a custom Leave type without supplying a trusted code", () => {
  const parsed = leavePolicyCreateInputSchema.parse({
    effectiveFrom: "2026-08-17",
    name: "Vacation leave",
    payTreatment: "PAID",
    countMode: "WEEKDAYS",
    balanceTracked: true,
    defaultEntitlementDays: 8,
    requiresDocument: false,
    allowNegativeBalance: false,
    reason: "Company benefit",
    code: "ANNUAL",
  });
  assert.equal(parsed.name, "Vacation leave");
  assert.equal("code" in parsed, false);
});

test("a new unpaid Leave type cannot consume a tracked paid balance", () => {
  assert.throws(() => leavePolicyCreateInputSchema.parse({
    effectiveFrom: "2026-08-17",
    name: "Personal unpaid leave",
    payTreatment: "UNPAID",
    countMode: "WEEKDAYS",
    balanceTracked: true,
    requiresDocument: false,
    allowNegativeBalance: false,
    reason: "Company policy",
  }), /must not consume/i);
});

test("manager rejection requires a reason and cannot submit a treatment override", () => {
  assert.throws(() => leaveReviewInputSchema.parse({ requestId: "f0cf7c07-224c-4905-9213-b5cf41de07fe", expectedRevision: 0, decision: "REJECTED", reviewNote: "" }), /rejection reason/i);
  const parsed = leaveReviewInputSchema.parse({ requestId: "f0cf7c07-224c-4905-9213-b5cf41de07fe", expectedRevision: 0, decision: "APPROVED", payTreatment: "UNPAID" });
  assert.equal("payTreatment" in parsed, false);
});

test("tenure entitlement resolves only values supplied by the frozen company policy", () => {
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

test("Leave final closure migration is additive, immutable and tenant guarded", async () => {
  const migration = await readFile("prisma/migrations/20260810010000_leave_management_final_closure/migration.sql", "utf8");
  assert.match(migration, /CREATE TABLE "leave_policy_versions"/);
  assert.match(migration, /CREATE TABLE "leave_balance_ledger_entries"/);
  assert.match(migration, /leave_balance_ledger_immutable/);
  assert.match(migration, /LEAVE_LOCKED_TIMESHEET_REOPEN_REQUIRED/);
  assert.match(migration, /LEAVE_SELF_APPROVAL_FORBIDDEN/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
});

test("Leave self-service API does not require Attendance eligibility", async () => {
  const route = await readFile("src/app/api/employee-leave/route.ts", "utf8");
  assert.match(route, /requireEmployeeSelfServiceAuthContext/);
  assert.doesNotMatch(route, /\brequireEmployeeAuthContext\b/);
});

test("custom Leave type migration preserves existing policy codes", async () => {
  const migration = await readFile("prisma/migrations/20260817200000_custom_leave_types/migration.sql", "utf8");
  assert.match(migration, /TYPE VARCHAR\(80\)/);
  assert.match(migration, /USING "code"::text/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
});
