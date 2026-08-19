import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  allocateLeaveConsumption,
  calculateBucketRemaining,
  calculateCarryForward,
  canRestoreAllocationToBucket,
  resolveCarryForwardExpiry,
} from "../../src/lib/leave/bucket-engine";

const migrationPath = "prisma/migrations/20260817233000_leave_management_phase2b/migration.sql";

function bucket(input: {
  id: string;
  granted: number;
  expiresAt?: string | null;
  availableFrom?: string;
  createdAt?: string;
  consumed?: number;
  restored?: number;
  expired?: number;
}) {
  return {
    id: input.id,
    grantedUnits: input.granted,
    consumedUnits: input.consumed ?? 0,
    restoredUnits: input.restored ?? 0,
    expiredUnits: input.expired ?? 0,
    availableFrom: new Date(input.availableFrom ?? "2027-01-01T00:00:00.000Z"),
    expiresAt: input.expiresAt === undefined || input.expiresAt === null
      ? null
      : new Date(`${input.expiresAt}T00:00:00.000Z`),
    createdAt: new Date(input.createdAt ?? "2027-01-01T00:00:00.000Z"),
  };
}

test("carry-forward applies the frozen cap and records the lapsed remainder", () => {
  assert.deepEqual(calculateCarryForward({ enabled: true, sourceRemainingUnits: 8.5, limitUnits: 5 }), {
    sourceRemainingUnits: 8.5,
    carriedUnits: 5,
    lapsedUnits: 3.5,
  });
  assert.deepEqual(calculateCarryForward({ enabled: false, sourceRemainingUnits: 8.5, limitUnits: 5 }), {
    sourceRemainingUnits: 8.5,
    carriedUnits: 0,
    lapsedUnits: 8.5,
  });
});

test("carry-forward expiry supports day, month and fixed-date rules without passing the destination period", () => {
  const input = {
    destinationPeriodStart: new Date("2027-01-01T00:00:00.000Z"),
    destinationPeriodEnd: new Date("2027-12-31T00:00:00.000Z"),
  };
  assert.equal(resolveCarryForwardExpiry({ ...input, rule: "DAYS_AFTER_ROLLOVER", value: "90" })?.toISOString(), "2027-03-31T00:00:00.000Z");
  assert.equal(resolveCarryForwardExpiry({ ...input, rule: "MONTHS_AFTER_ROLLOVER", value: "3" })?.toISOString(), "2027-03-31T00:00:00.000Z");
  assert.equal(resolveCarryForwardExpiry({ ...input, rule: "FIXED_DATE_IN_DESTINATION_PERIOD", value: "03-31" })?.toISOString(), "2027-03-31T00:00:00.000Z");
  assert.equal(resolveCarryForwardExpiry({ ...input, rule: "NO_EXPIRY" }), null);
});

test("approval consumes earliest-expiring valid buckets first and preserves half-day precision", () => {
  const result = allocateLeaveConsumption({
    requestedUnits: 2.5,
    asOf: new Date("2027-02-01T00:00:00.000Z"),
    priority: "EARLIEST_EXPIRY_FIRST",
    buckets: [
      bucket({ id: "current", granted: 12 }),
      bucket({ id: "carry-later", granted: 2, expiresAt: "2027-06-30" }),
      bucket({ id: "carry-first", granted: 1, expiresAt: "2027-03-31" }),
      bucket({ id: "expired", granted: 99, expiresAt: "2027-01-31" }),
    ],
  });
  assert.deepEqual(result, {
    allocations: [
      { bucketId: "carry-first", units: 1 },
      { bucketId: "carry-later", units: 1.5 },
    ],
    allocatedUnits: 2.5,
    unallocatedUnits: 0,
  });
});

test("oldest-entitlement priority is deterministic and reports uncovered negative-balance units", () => {
  const result = allocateLeaveConsumption({
    requestedUnits: 2,
    asOf: new Date("2027-06-01T00:00:00.000Z"),
    priority: "OLDEST_ENTITLEMENT_FIRST",
    buckets: [
      bucket({ id: "newer", granted: 0.5, availableFrom: "2027-02-01", createdAt: "2027-02-01" }),
      bucket({ id: "older", granted: 0.5, availableFrom: "2027-01-01", createdAt: "2027-01-01" }),
    ],
  });
  assert.deepEqual(result.allocations, [
    { bucketId: "older", units: 0.5 },
    { bucketId: "newer", units: 0.5 },
  ]);
  assert.equal(result.allocatedUnits, 1);
  assert.equal(result.unallocatedUnits, 1);
});

test("cancellation can restore only the exact original bucket while it remains valid", () => {
  assert.equal(canRestoreAllocationToBucket({
    expiresAt: new Date("2027-03-31T00:00:00.000Z"),
    cancelledAt: new Date("2027-03-31T20:00:00.000Z"),
  }), true);
  assert.equal(canRestoreAllocationToBucket({
    expiresAt: new Date("2027-03-31T00:00:00.000Z"),
    cancelledAt: new Date("2027-04-01T00:00:00.000Z"),
  }), false);
  assert.equal(calculateBucketRemaining(bucket({ id: "restored", granted: 3, consumed: 2, restored: 0.5 })), 1.5);
});

test("Phase 2B migration is additive, tenant-scoped, immutable and idempotency constrained", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /CREATE TABLE "leave_entitlement_buckets"/);
  assert.match(migration, /CREATE TABLE "leave_period_rollovers"/);
  assert.match(migration, /CREATE TABLE "leave_consumption_allocations"/);
  assert.match(migration, /CREATE TABLE "leave_allocation_restorations"/);
  assert.match(migration, /CREATE TABLE "leave_bucket_expiries"/);
  assert.match(migration, /leave_period_rollovers_identity_key/);
  assert.match(migration, /leave_consumption_allocations_request_bucket_key/);
  assert.match(migration, /leave_allocation_restorations_allocation_key/);
  assert.match(migration, /leave_bucket_expiries_bucket_key/);
  assert.match(migration, /Leave Phase 2B tenant or policy version mismatch/);
  assert.match(migration, /leave_period_rollovers_immutable/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
});

test("Phase 2B lifecycle stays permission guarded and uses canonical server actions", async () => {
  const actions = await readFile("src/app/(business)/team/leave/actions.ts", "utf8");
  const service = await readFile("src/lib/leave/service.ts", "utf8");
  assert.match(actions, /processLeaveLifecycleAction[\s\S]*?requireBusinessUser\("EDIT_LEAVE_POLICY"\)/);
  assert.match(service, /processDueLeavePeriodRollovers/);
  assert.match(service, /processDueCarryForwardExpiries/);
  assert.match(service, /LEAVE_CANCELLATION_REVIEW_REQUIRED/);
  assert.match(service, /eventType: "CARRY_FORWARD_LAPSE"/);
});

test("Staff App exposes the canonical bucket breakdown without a second balance source", async () => {
  const service = await readFile("src/lib/leave/service.ts", "utf8");
  const staffLeave = await readFile("src/components/staff-pwa/staff-leave.tsx", "utf8");
  assert.match(service, /currentEntitlementDays/);
  assert.match(service, /carryForwardDays/);
  assert.match(service, /manualAdjustmentDays/);
  assert.match(service, /carryForwardBuckets/);
  assert.match(service, /leaveEntitlementBucket\.findMany/);
  assert.match(staffLeave, /Carry forward/);
  assert.match(staffLeave, /days expire on/);
  assert.match(staffLeave, /policy\.carryForwardDays > 0/);
});
