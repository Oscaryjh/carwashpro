import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getSensitiveActionPolicy } from "../../src/lib/auth/sensitive-actions";
import { modulesForCapability, modulesForStaffPermission } from "../../src/lib/modules/registry";
import { normalizeSupplierInvoiceNumber } from "../../src/lib/inventory/supplier-ap-service";

test("Supplier AP capabilities and direct permissions remain inside INVENTORY", () => {
  const capabilities = ["VIEW_SUPPLIER_BILL", "CREATE_SUPPLIER_BILL", "EDIT_SUPPLIER_BILL_DRAFT", "CONFIRM_SUPPLIER_BILL", "VOID_SUPPLIER_BILL", "VIEW_ACCOUNTS_PAYABLE", "RECORD_SUPPLIER_PAYMENT", "REVERSE_SUPPLIER_PAYMENT", "VIEW_SUPPLIER_INVOICE_ATTACHMENT"] as const;
  for (const capability of capabilities) assert.deepEqual(modulesForCapability(capability, "SALON_BEAUTY"), ["INVENTORY"]);
  assert.deepEqual(modulesForStaffPermission("SUPPLIER_PAYMENTS_RECORD", "AUTO_DETAILING"), ["INVENTORY"]);
});

test("Supplier payment and reversal require resource-bound true MFA", () => {
  const payment = getSensitiveActionPolicy("SUPPLIER_PAYMENT_RECORD");
  const reversal = getSensitiveActionPolicy("SUPPLIER_PAYMENT_REVERSE");
  assert.equal(payment.requiredAssurance, "MFA");
  assert.equal(payment.resourceType, "SUPPLIER_BILL");
  assert.equal(payment.requiredCapability, "RECORD_SUPPLIER_PAYMENT");
  assert.equal(reversal.requiredAssurance, "MFA");
  assert.equal(reversal.resourceType, "SUPPLIER_PAYMENT");
  assert.equal(reversal.requiresReason, true);
});

test("Supplier AP schema and migration enforce duplicate, scope and immutability controls", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20260812020000_supplier_bill_accounts_payable_phase1/migration.sql", "utf8");
  for (const model of ["SupplierBill", "SupplierBillLine", "SupplierBillAttachment", "SupplierPayment", "SupplierPaymentReversal", "SupplierApCommand"]) assert.match(schema, new RegExp(`model ${model}`));
  assert.match(migration, /supplier_bills_active_supplier_invoice_key/);
  assert.match(migration, /supplier_bills_branch_id_business_id_fkey/);
  assert.match(migration, /supplier_payments_supplier_bill_id_business_id_fkey/);
  assert.match(migration, /supplier_payments_protect_update/);
  assert.match(migration, /supplier_payment_reversals_prevent_delete/);
  assert.match(migration, /supplier_ap_user_scope_guard/);
});

test("Supplier AP code keeps inventory and Expense boundaries explicit", () => {
  const service = readFileSync("src/lib/inventory/supplier-ap-service.ts", "utf8");
  assert.doesNotMatch(service, /applyInventoryMovement|tx\.businessExpense|prisma\.businessExpense/);
  assert.match(service, /validPaymentTotal/);
  assert.match(service, /status: "COMPLETED"/);
  assert.match(service, /Over-bill blocked/);
  assert.match(service, /Overpayment blocked/);
  assert.equal(normalizeSupplierInvoiceNumber("  inv   001 "), "INV 001");
});
