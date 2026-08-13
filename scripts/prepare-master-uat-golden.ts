import bcrypt from "bcryptjs";
import { loadEnvConfig } from "@next/env";
import { saveExpenseIntegrationSettings, synchronizeInventoryPurchaseExpense } from "../src/lib/expense/source-integration";
import { ensureStarterExpenseCategories } from "../src/lib/expense/service";
import { approvePurchaseOrder, createPurchaseOrder, createSupplier, receivePurchaseOrder } from "../src/lib/inventory/purchasing-service";
import { confirmSupplierBill, createSupplierBillDraft, recordSupplierPayment, reverseSupplierPayment } from "../src/lib/inventory/supplier-ap-service";
import { assertLocalDatabaseTarget } from "../src/lib/release/environment";

loadEnvConfig(process.cwd());

if (process.env.NODE_ENV === "production") throw new Error("Master UAT Golden fixtures are forbidden in production.");
assertLocalDatabaseTarget(process.env.DATABASE_URL, "Master UAT Golden fixture");

const passwordFromEnvironment = process.env.MASTER_UAT_QA_PASSWORD;
if (!passwordFromEnvironment || passwordFromEnvironment.length < 9) throw new Error("MASTER_UAT_QA_PASSWORD is required.");
const password: string = passwordFromEnvironment;

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const existing = await prisma.business.findUnique({ where: { slug: "master-uat-ap-golden" } });
  if (existing) {
    console.log(JSON.stringify({ environment: "LOCAL_TESTING_ONLY", reused: true, businessId: existing.id }));
    return;
  }

  const business = await prisma.business.create({ data: { name: "MASTER UAT AP GOLDEN", slug: "master-uat-ap-golden", industryType: "SALON_BEAUTY", timezone: "Asia/Kuala_Lumpur" } });
  const branch = await prisma.branch.create({ data: { businessId: business.id, name: "Golden Main" } });
  const passwordHash = await bcrypt.hash(password, 12);
  const creator = await prisma.user.create({ data: { businessId: business.id, branchId: branch.id, email: "master.uat.ap@local.test", name: "Master UAT AP Owner", passwordHash, loginEnabled: true, role: "BUSINESS_OWNER", status: "active" } });
  const reviewer = await prisma.user.create({ data: { businessId: business.id, branchId: branch.id, email: "master.uat.ap.reviewer@local.test", name: "Master UAT AP Reviewer", passwordHash, loginEnabled: true, role: "BUSINESS_OWNER", status: "active" } });
  const actor = (user: typeof creator) => ({ userId: user.id, name: user.name, email: user.email! });
  await prisma.businessModuleEntitlement.createMany({ data: ["INVENTORY", "EXPENSE"].map((moduleKey) => ({ businessId: business.id, moduleKey: moduleKey as "INVENTORY", status: "ENABLED" as const, source: "MANUAL" as const, enabledFrom: new Date("2026-01-01T00:00:00.000Z"), createdById: creator.id, updatedById: creator.id })) });
  await ensureStarterExpenseCategories(business.id, prisma);
  const inventoryCategory = await prisma.expenseCategory.findFirstOrThrow({ where: { businessId: business.id, code: "INVENTORY_PURCHASES" } });
  await saveExpenseIntegrationSettings({ actor: actor(creator), businessId: business.id, claimDefaultCategoryId: null, payrollCategoryId: null, inventoryPurchaseCategoryId: inventoryCategory.id }, prisma);
  const product = await prisma.product.create({ data: { businessId: business.id, name: "Master UAT Stock Item", sku: "MASTER-UAT-ITEM", costPrice: 20, price: 35, trackInventory: true } });
  const supplier = await createSupplier({ actor: actor(creator), businessId: business.id, name: "Master UAT Supplier", operationKey: "MASTER-UAT:SUPPLIER:0001" });
  const po = await createPurchaseOrder({ actor: actor(creator), businessId: business.id, branchId: branch.id, supplierId: supplier.id, orderDate: new Date("2026-08-12T00:00:00.000Z"), operationKey: "MASTER-UAT:PO:00000001", lines: [{ productId: product.id, orderedQuantity: 10, expectedUnitCost: 20 }] });
  const approved = await approvePurchaseOrder({ actor: actor(reviewer), businessId: business.id, purchaseOrderId: po.id, expectedRevision: po.revision, operationKey: "MASTER-UAT:PO-APPROVE:01" });
  await receivePurchaseOrder({ actor: actor(creator), businessId: business.id, purchaseOrderId: po.id, operationKey: "MASTER-UAT:GR:00000001", lines: [{ purchaseOrderLineId: approved.lines[0].id, quantity: 6 }] });
  const draft = await createSupplierBillDraft({ actor: actor(creator), allowedBranchIds: [branch.id], businessId: business.id, branchId: branch.id, purchaseOrderId: po.id, supplierInvoiceNumber: "MASTER-UAT-INV-001", invoiceDate: new Date("2026-08-12T00:00:00.000Z"), dueDate: new Date("2026-09-12T00:00:00.000Z"), operationKey: "MASTER-UAT:BILL:0000001", lines: [{ purchaseOrderLineId: approved.lines[0].id, billedQuantity: 6, unitPrice: 20 }] });
  await confirmSupplierBill({ actor: actor(reviewer), allowedBranchIds: [branch.id], allowOwnerSelfConfirm: false, businessId: business.id, billId: draft.id, expectedRevision: draft.revision, priceVarianceAcknowledged: false, operationKey: "MASTER-UAT:BILL-CONFIRM:01" });
  await synchronizeInventoryPurchaseExpense({ actor: actor(reviewer), businessId: business.id, supplierBillId: draft.id }, prisma);
  await recordSupplierPayment({ actor: actor(reviewer), allowedBranchIds: [branch.id], authorize: async () => ({ assurance: "MFA", authorizationId: "MASTER-UAT-MFA-50" }), businessId: business.id, billId: draft.id, amount: 50, paymentDate: new Date("2026-08-12T00:00:00.000Z"), paymentMethod: "BANK_TRANSFER", operationKey: "MASTER-UAT:PAY:00000050" });
  const pay70 = await recordSupplierPayment({ actor: actor(reviewer), allowedBranchIds: [branch.id], authorize: async () => ({ assurance: "MFA", authorizationId: "MASTER-UAT-MFA-70" }), businessId: business.id, billId: draft.id, amount: 70, paymentDate: new Date("2026-08-12T00:00:00.000Z"), paymentMethod: "BANK_TRANSFER", operationKey: "MASTER-UAT:PAY:00000070" });
  await reverseSupplierPayment({ actor: actor(reviewer), allowedBranchIds: [branch.id], authorize: async () => ({ assurance: "MFA", authorizationId: "MASTER-UAT-MFA-REV" }), businessId: business.id, paymentId: pay70.id, reason: "Master UAT controlled reversal", operationKey: "MASTER-UAT:PAY-REV:0001" });
  await synchronizeInventoryPurchaseExpense({ actor: actor(reviewer), businessId: business.id, supplierBillId: draft.id }, prisma);
  console.log(JSON.stringify({ environment: "LOCAL_TESTING_ONLY", reused: false, businessId: business.id, branchId: branch.id, billId: draft.id }));
  await prisma.$disconnect();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
