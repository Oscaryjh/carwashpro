import assert from "node:assert/strict";
import test from "node:test";
import {
  canMoveWorkOrderStatus,
  formatOrderNumber,
} from "../../src/lib/validation/work-orders";
import {
  hasStaffPermission,
  normalizeStaffPermissions,
} from "../../src/lib/auth/staff-permissions";
import { cashierPackagePurchaseSchema } from "../../src/lib/validation/packages";

test("payment does not participate in the job status transition rules", () => {
  assert.equal(canMoveWorkOrderStatus("IN_PROGRESS", "READY_FOR_PICKUP"), true);
  assert.equal(canMoveWorkOrderStatus("READY_FOR_PICKUP", "COMPLETED"), true);
  assert.equal(canMoveWorkOrderStatus("IN_PROGRESS", "COMPLETED"), false);
  assert.equal(canMoveWorkOrderStatus("COMPLETED", "CANCELLED"), false);
});

test("staff permissions are allow-list based and deduplicated", () => {
  assert.deepEqual(
    normalizeStaffPermissions(["CRM", "CRM", "POS", "UNKNOWN"]),
    ["CRM", "POS"],
  );
  assert.equal(
    hasStaffPermission({ role: "STAFF", permissions: ["CRM"] }, "CRM"),
    true,
  );
  assert.equal(
    hasStaffPermission({ role: "STAFF", permissions: ["CRM"] }, "REPORTS"),
    false,
  );
  assert.equal(
    hasStaffPermission({ role: "BUSINESS_OWNER", permissions: [] }, "REPORTS"),
    true,
  );
});

test("legacy work order numbers are shortened for display", () => {
  assert.equal(
    formatOrderNumber("WO-20260708-185239750-AETO"),
    "WO-260708-AETO",
  );
});

test("cashier package purchases bind to a customer account, not a vehicle", () => {
  const baseInput = {
    branchId: "00000000-0000-4000-8000-000000000001",
    customerId: "00000000-0000-4000-8000-000000000002",
    method: "CASH" as const,
    packageId: "00000000-0000-4000-8000-000000000003",
  };

  assert.equal(cashierPackagePurchaseSchema.safeParse(baseInput).success, true);
  assert.equal(
    cashierPackagePurchaseSchema.safeParse({
      ...baseInput,
      customerId: undefined,
      vehicleId: "00000000-0000-4000-8000-000000000004",
    }).success,
    false,
  );
});
