import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { modulesForCapability } from "../../src/lib/modules/registry";

test("Inventory Phase 2 capabilities remain inside the INVENTORY entitlement", () => {
  for (const capability of ["VIEW_SUPPLIERS", "MANAGE_SUPPLIERS", "VIEW_PURCHASE_ORDERS", "CREATE_PURCHASE_ORDER", "APPROVE_PURCHASE_ORDER", "CANCEL_PURCHASE_ORDER", "RECEIVE_PURCHASE_ORDER", "REVERSE_GOODS_RECEIPT"] as const) {
    assert.deepEqual(modulesForCapability(capability, "SALON_BEAUTY"), ["INVENTORY"]);
  }
});

test("Inventory Phase 2 schema and migration protect tenant scope and immutable receipts", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20260811160000_inventory_phase2_purchasing_foundation/migration.sql", "utf8");
  for (const model of ["Supplier", "PurchaseOrder", "PurchaseOrderLine", "GoodsReceipt", "GoodsReceiptLine", "GoodsReceiptReversal", "InventoryPurchasingCommand"]) assert.match(schema, new RegExp(`model ${model}`));
  assert.match(schema, /purchaseOrderSequence\s+Int\s+@default\(1000\)/);
  assert.match(schema, /goodsReceiptSequence\s+Int\s+@default\(1000\)/);
  assert.match(migration, /goods_receipt_lines_prevent_update/);
  assert.match(migration, /goods_receipt_reversals_prevent_delete/);
  assert.match(migration, /purchase_orders_branch_id_business_id_fkey/);
  assert.match(migration, /purchase_order_lines_quantity_check/);
});

test("Goods Receive routes through the Phase 1 inventory movement service and never creates accounting records", () => {
  const service = readFileSync("src/lib/inventory/purchasing-service.ts", "utf8");
  assert.match(service, /applyInventoryMovement/);
  assert.match(service, /sourceType: "GOODS_RECEIPT"/);
  assert.match(service, /sourceType: "GOODS_RECEIPT_REVERSAL"/);
  assert.match(service, /creator cannot approve their own order/i);
  assert.doesNotMatch(service, /expense|accountsPayable|payment\.create/i);
});
