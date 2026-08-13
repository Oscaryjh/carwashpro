import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MODULE_REGISTRY, modulesForCapability } from "../../src/lib/modules/registry";

test("Inventory entitlement is independent from POS catalog and has explicit capabilities", () => {
  assert.deepEqual(MODULE_REGISTRY.INVENTORY.dependencies, ["POS"]);
  assert.deepEqual(modulesForCapability("VIEW_INVENTORY", "SALON_BEAUTY"), ["INVENTORY"]);
  assert.deepEqual(modulesForCapability("MANAGE_INVENTORY", "AUTO_DETAILING"), ["INVENTORY"]);
  assert.deepEqual(modulesForCapability("TRANSFER_INVENTORY", "AUTO_DETAILING"), ["INVENTORY"]);
  assert.deepEqual(modulesForCapability("VIEW_CATALOG", "SALON_BEAUTY"), ["POS"]);
});

test("Inventory schema and migration enforce immutable, scoped, non-negative ledger", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20260811120000_inventory_phase1_core_stock_foundation/migration.sql", "utf8");
  assert.match(schema, /trackInventory\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /inventoryTracked\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /model InventoryMovement/);
  assert.match(schema, /@@unique\(\[businessId, operationKey\]\)/);
  assert.match(migration, /inventory_movements_prevent_update/);
  assert.match(migration, /inventory_movements_prevent_delete/);
  assert.match(migration, /inventory_movements_nonnegative_check/);
  assert.match(migration, /product_stocks_branch_scope_fkey/);
  assert.match(migration, /inventory_refund_lines_no_restock_reason_check/);
});

test("all canonical product sale entry points call the same inventory service", () => {
  for (const path of [
    "src/app/(business)/cashier/actions.ts",
    "src/app/(business)/appointments/actions.ts",
    "src/app/(business)/products/actions.ts",
  ]) {
    assert.match(readFileSync(path, "utf8"), /recordSaleInventory/);
  }
  const refund = readFileSync("src/app/(business)/invoices/actions.ts", "utf8");
  assert.match(refund, /recordRefundInventory/);
  assert.match(refund, /recordVoidInventoryReversals/);
  assert.match(refund, /isStandalonePackagePurchase/);
  assert.doesNotMatch(refund, /This invoice is not linked to a refundable package/);
});
