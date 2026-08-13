import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { modulesForCapability } from "../../src/lib/modules/registry";

test("Inventory Phase 3 capabilities remain inside the INVENTORY entitlement", () => {
  for (const capability of ["VIEW_STOCK_COUNTS", "CREATE_STOCK_COUNT", "COUNT_INVENTORY", "SUBMIT_STOCK_COUNT", "APPROVE_STOCK_COUNT", "REOPEN_STOCK_COUNT", "CANCEL_STOCK_COUNT", "MANAGE_REORDER_SETTINGS"] as const) {
    assert.deepEqual(modulesForCapability(capability, "SALON_BEAUTY"), ["INVENTORY"]);
  }
});

test("stock-count schema freezes evidence and protects one active count per branch/product", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20260811190000_inventory_phase3_stock_count_reorder/migration.sql", "utf8");
  for (const model of ["StockCountSession", "StockCountLine", "StockCountLineRevision", "StockCountCommand"]) assert.match(schema, new RegExp(`model ${model}`));
  assert.match(schema, /stockCountSequence\s+Int\s+@default\(0\)/);
  assert.match(schema, /targetStockLevel\s+Int\?/);
  assert.match(migration, /stock_count_lines_one_active_product_per_branch_key/);
  assert.match(migration, /stock_count_line_revisions_prevent_update/);
  assert.match(migration, /stock_count_sessions_branch_id_business_id_fkey/);
  assert.match(migration, /stock_count_user_scope_guard/);
});

test("approval posts a delta through the Phase 1 ledger and never overwrites a balance", () => {
  const service = readFileSync("src/lib/inventory/stock-count-service.ts", "utf8");
  assert.match(service, /applyInventoryMovement/);
  assert.match(service, /sourceType: "STOCK_COUNT"/);
  assert.match(service, /operationKey: `STOCK_COUNT:\$\{session\.id\}:\$\{line\.id\}`/);
  assert.match(service, /type: variance > 0 \? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT"/);
  assert.doesNotMatch(service, /productStock\.update\([\s\S]{0,300}quantity:\s*line\.actualQuantity/);
  assert.doesNotMatch(service, /expense|accountsPayable|costOfGoods|supplierPayment/i);
});

test("reorder suggestion uses on hand plus on order and the existing PO shortcut", () => {
  const service = readFileSync("src/lib/inventory/stock-count-service.ts", "utf8");
  const page = readFileSync("src/app/(business)/inventory/reorder/page.tsx", "utf8");
  assert.match(service, /status: \{ in: \["APPROVED", "PARTIALLY_RECEIVED"\] \}/);
  assert.match(service, /projectedStock = onHand \+ onOrderQuantity/);
  assert.match(service, /Math\.max\(0, targetStockLevel - projectedStock\)/);
  assert.match(page, /purchase-orders\/new\?branchId=/);
  assert.doesNotMatch(service, /purchaseSuggestion\.create|approvePurchaseOrder/);
});

test("Delivery Order is safely deferred because no outbound fulfilment contract exists", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  assert.doesNotMatch(schema, /model DeliveryOrder/);
  assert.doesNotMatch(schema, /enum DeliveryOrderStatus/);
});

test("server actions enforce module capability and operational branch scope", () => {
  const actions = readFileSync("src/app/(business)/inventory/stock-count-actions.ts", "utf8");
  for (const capability of ["CREATE_STOCK_COUNT", "COUNT_INVENTORY", "SUBMIT_STOCK_COUNT", "APPROVE_STOCK_COUNT", "REOPEN_STOCK_COUNT", "CANCEL_STOCK_COUNT", "MANAGE_REORDER_SETTINGS"]) assert.match(actions, new RegExp(capability));
  assert.match(actions, /resolveOperationalBranchId/);
  assert.match(actions, /assertSessionBranch/);
});
