import assert from "node:assert/strict";
import test from "node:test";
import {
  canMoveWorkOrderStatus,
  formatOrderNumber,
} from "../../src/lib/validation/work-orders";
import {
  defaultStaffPermissions,
  getStaffHomePath,
  hasStaffPermission,
  normalizeStaffPermissions,
  routePermission,
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

test("new staff defaults are limited to daily cashier operations", () => {
  assert.deepEqual(defaultStaffPermissions, [
    "CRM",
    "JOBS",
    "APPOINTMENTS",
    "POS",
    "INVOICES",
    "CLOSING",
    "WHATSAPP",
  ]);
  assert.equal(defaultStaffPermissions.includes("REPORTS"), false);
  assert.equal(defaultStaffPermissions.includes("WHATSAPP_SESSION"), false);
  assert.equal(defaultStaffPermissions.includes("DELETE_CUSTOMER"), false);
});

test("sensitive WhatsApp routes use the session management permission", () => {
  assert.equal(routePermission("/whatsapp/inbox"), "WHATSAPP");
  assert.equal(routePermission("/whatsapp/settings"), "WHATSAPP_SESSION");
  assert.equal(routePermission("/whatsapp/diagnostics"), "WHATSAPP_SESSION");
  assert.equal(routePermission("/branches"), "OWNER_ONLY");
});

test("staff without dashboard access are redirected to their first allowed module", () => {
  assert.equal(getStaffHomePath(["JOBS", "CRM"]), "/work-orders");
  assert.equal(getStaffHomePath(["CRM"]), "/crm");
  assert.equal(getStaffHomePath([]), "/login");
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
