import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import { reconcileExpenseSources, saveExpenseIntegrationSettings, synchronizeInventoryPurchaseExpense } from "../../src/lib/expense/source-integration";
import { ensureStarterExpenseCategories, getExpenseDashboard } from "../../src/lib/expense/service";
import { approvePurchaseOrder, createPurchaseOrder, createSupplier, receivePurchaseOrder, reverseGoodsReceiptLine } from "../../src/lib/inventory/purchasing-service";
import { confirmSupplierBill, createSupplierBillDraft, getAccountsPayableOverview, getSupplierBillDetail, listSupplierBills, recordSupplierPayment, reconcileAccountsPayable, reverseSupplierPayment, SupplierApScopeError } from "../../src/lib/inventory/supplier-ap-service";

const prisma = new PrismaClient();
after(async () => prisma.$disconnect());

test("Supplier Bill → AP → partial/full payment → reversal is canonical, isolated and stock-neutral", async () => {
  assertLocalDatabase(); const token = randomUUID().slice(0, 8);
  const business = await prisma.business.create({ data: { name: `AP Salon ${token}`, slug: `ap-salon-${token}`, industryType: "SALON_BEAUTY" } });
  await prisma.businessModuleEntitlement.createMany({ data: ["INVENTORY", "EXPENSE"].map((moduleKey) => ({ businessId: business.id, moduleKey: moduleKey as "INVENTORY", status: "ENABLED" as const, enabledFrom: new Date("2026-01-01T00:00:00.000Z"), source: "MANUAL" as const })) });
  const [branch, otherBranch] = await Promise.all([prisma.branch.create({ data: { businessId: business.id, name: `Salon ${token}` } }), prisma.branch.create({ data: { businessId: business.id, name: `Other ${token}` } })]);
  const [creator, reviewer, payer] = await Promise.all([
    prisma.user.create({ data: { branchId: branch.id, businessId: business.id, name: "AP Creator", role: "BUSINESS_OWNER" } }),
    prisma.user.create({ data: { branchId: branch.id, businessId: business.id, name: "AP Reviewer", role: "BUSINESS_OWNER" } }),
    prisma.user.create({ data: { branchId: branch.id, businessId: business.id, name: "AP Payer", role: "BUSINESS_OWNER" } }),
  ]);
  const actor = (user: typeof creator) => ({ userId: user.id, name: user.name, email: user.email ?? "" });
  await ensureStarterExpenseCategories(business.id, prisma);
  const inventoryPurchaseCategory = await prisma.expenseCategory.findFirstOrThrow({ where: { businessId: business.id, code: "INVENTORY_PURCHASES" } });
  await saveExpenseIntegrationSettings({ actor: actor(creator), businessId: business.id, claimDefaultCategoryId: null, inventoryPurchaseCategoryId: inventoryPurchaseCategory.id, payrollCategoryId: null }, prisma);
  const context = (user: typeof creator, key: string) => ({ actor: actor(user), allowedBranchIds: [branch.id], businessId: business.id, operationKey: `AP:${token}:${key}:00000001` });
  const product = await prisma.product.create({ data: { businessId: business.id, costPrice: 20, name: `Salon Product ${token}`, price: 35, sku: `AP-${token}`, trackInventory: true } });
  const supplier = await createSupplier({ actor: actor(creator), businessId: business.id, name: `Supplier ${token}`, operationKey: `AP:${token}:SUPPLIER:0001` });
  const po = await createPurchaseOrder({ actor: actor(creator), branchId: branch.id, businessId: business.id, lines: [{ expectedUnitCost: 20, orderedQuantity: 10, productId: product.id }], operationKey: `AP:${token}:PO:000000001`, orderDate: new Date("2026-08-11T00:00:00Z"), supplierId: supplier.id });
  const approved = await approvePurchaseOrder({ actor: actor(reviewer), businessId: business.id, expectedRevision: po.revision, operationKey: `AP:${token}:APPROVE:0001`, purchaseOrderId: po.id });
  const receipt = await receivePurchaseOrder({ actor: actor(creator), businessId: business.id, lines: [{ purchaseOrderLineId: approved.lines[0].id, quantity: 6 }], operationKey: `AP:${token}:RECEIVE:0001`, purchaseOrderId: po.id });
  const stockAfterReceipt = await stock(branch.id, product.id); const expensesBefore = await prisma.businessExpense.count({ where: { businessId: business.id } });

  const draft = await createSupplierBillDraft({ ...context(creator, "BILL1"), branchId: branch.id, dueDate: new Date("2026-09-10T00:00:00Z"), invoiceDate: new Date("2026-08-11T00:00:00Z"), lines: [{ purchaseOrderLineId: approved.lines[0].id, billedQuantity: 6, unitPrice: 20 }], purchaseOrderId: po.id, supplierInvoiceNumber: "INV-001" });
  assert.equal(draft.status, "DRAFT"); assert.equal((await getAccountsPayableOverview({ businessId: business.id, allowedBranchIds: [branch.id] })).totalOutstanding.toFixed(2), "0.00");
  assert.equal((await synchronizeInventoryPurchaseExpense({ actor: actor(creator), businessId: business.id, supplierBillId: draft.id }, prisma)).status, "IN_SYNC");
  assert.equal(await prisma.businessExpense.count({ where: { businessId: business.id } }), expensesBefore);
  const confirmed = await confirmSupplierBill({ ...context(reviewer, "CONFIRM1"), allowOwnerSelfConfirm: false, billId: draft.id, expectedRevision: draft.revision, priceVarianceAcknowledged: false });
  assert.equal(confirmed.totalAmount.toFixed(2), "120.00"); assert.equal(await stock(branch.id, product.id), stockAfterReceipt);
  const syncRace = await Promise.allSettled([
    synchronizeInventoryPurchaseExpense({ actor: actor(reviewer), businessId: business.id, supplierBillId: draft.id }, prisma),
    synchronizeInventoryPurchaseExpense({ actor: actor(reviewer), businessId: business.id, supplierBillId: draft.id }, prisma),
  ]);
  assert.ok(syncRace.some((result) => result.status === "fulfilled"));
  const firstSync = await synchronizeInventoryPurchaseExpense({ actor: actor(reviewer), businessId: business.id, supplierBillId: draft.id }, prisma);
  const replaySync = await synchronizeInventoryPurchaseExpense({ actor: actor(reviewer), businessId: business.id, supplierBillId: draft.id }, prisma);
  assert.equal(firstSync.expenseId, replaySync.expenseId);
  assert.equal(await prisma.businessExpense.count({ where: { businessId: business.id, sourceType: "INVENTORY_PURCHASE", sourceId: draft.id, status: { not: "VOID" } } }), 1);
  let inventoryExpense = await prisma.businessExpense.findUniqueOrThrow({ where: { id: firstSync.expenseId }, include: { sourceSettlement: true, sourceSnapshot: true } });
  assert.equal(inventoryExpense.amount.toFixed(2), "120.00"); assert.equal(inventoryExpense.branchId, branch.id); assert.equal(inventoryExpense.expenseDate.toISOString().slice(0, 10), "2026-08-11"); assert.equal(inventoryExpense.sourceSnapshot?.sourceRevision, String(confirmed.confirmedRevision));
  assert.equal(inventoryExpense.sourceSettlement?.outstandingAmount.toFixed(2), "120.00"); assert.equal(await prisma.businessExpense.count({ where: { businessId: business.id } }), expensesBefore + 1);

  const pay50 = await recordSupplierPayment({ ...context(payer, "PAY50"), amount: 50, authorize: async () => ({ assurance: "MFA", authorizationId: randomUUID() }), billId: draft.id, paymentDate: new Date("2026-08-11T00:00:00Z"), paymentMethod: "BANK_TRANSFER" });
  await synchronizeInventoryPurchaseExpense({ actor: actor(payer), businessId: business.id, supplierBillId: draft.id }, prisma);
  let detail = await getSupplierBillDetail({ businessId: business.id, billId: draft.id, allowedBranchIds: [branch.id] });
  assert.equal(detail.outstandingAmount.toFixed(2), "70.00"); assert.equal(detail.derivedPaymentStatus, "PARTIALLY_PAID");
  inventoryExpense = await prisma.businessExpense.findUniqueOrThrow({ where: { id: firstSync.expenseId }, include: { sourceSettlement: true, sourceSnapshot: true } }); assert.equal(inventoryExpense.amount.toFixed(2), "120.00"); assert.equal(inventoryExpense.sourceSettlement?.paidAmount.toFixed(2), "50.00"); assert.equal(inventoryExpense.sourceSettlement?.outstandingAmount.toFixed(2), "70.00"); assert.equal(inventoryExpense.sourceSettlement?.settlementStatus, "PARTIALLY_PAID");
  const pay70 = await recordSupplierPayment({ ...context(payer, "PAY70"), amount: 70, authorize: async () => ({ assurance: "MFA", authorizationId: randomUUID() }), billId: draft.id, paymentDate: new Date("2026-08-11T00:00:00Z"), paymentMethod: "BANK_TRANSFER" });
  await synchronizeInventoryPurchaseExpense({ actor: actor(payer), businessId: business.id, supplierBillId: draft.id }, prisma);
  detail = await getSupplierBillDetail({ businessId: business.id, billId: draft.id, allowedBranchIds: [branch.id] }); assert.equal(detail.outstandingAmount.toFixed(2), "0.00"); assert.equal(detail.derivedPaymentStatus, "PAID");
  inventoryExpense = await prisma.businessExpense.findUniqueOrThrow({ where: { id: firstSync.expenseId }, include: { sourceSettlement: true, sourceSnapshot: true } }); assert.equal(inventoryExpense.amount.toFixed(2), "120.00"); assert.equal(inventoryExpense.sourceSettlement?.paidAmount.toFixed(2), "120.00"); assert.equal(inventoryExpense.sourceSettlement?.outstandingAmount.toFixed(2), "0.00"); assert.equal(inventoryExpense.sourceSettlement?.settlementStatus, "PAID");
  await reverseSupplierPayment({ ...context(payer, "REVERSE70"), authorize: async () => ({ assurance: "MFA", authorizationId: randomUUID() }), paymentId: pay70.id, reason: "Bank transfer entered twice" });
  await synchronizeInventoryPurchaseExpense({ actor: actor(payer), businessId: business.id, supplierBillId: draft.id }, prisma);
  detail = await getSupplierBillDetail({ businessId: business.id, billId: draft.id, allowedBranchIds: [branch.id] }); assert.equal(detail.outstandingAmount.toFixed(2), "70.00"); assert.equal(detail.derivedPaymentStatus, "PARTIALLY_PAID");
  inventoryExpense = await prisma.businessExpense.findUniqueOrThrow({ where: { id: firstSync.expenseId }, include: { sourceSettlement: true, sourceSnapshot: true } }); assert.equal(inventoryExpense.amount.toFixed(2), "120.00"); assert.equal(inventoryExpense.sourceSettlement?.paidAmount.toFixed(2), "50.00"); assert.equal(inventoryExpense.sourceSettlement?.outstandingAmount.toFixed(2), "70.00");
  assert.equal(await stock(branch.id, product.id), stockAfterReceipt); assert.equal(await prisma.businessExpense.count({ where: { businessId: business.id } }), expensesBefore + 1);
  await assert.rejects(prisma.supplierPayment.update({ where: { id: pay50.id }, data: { amount: 49 } }), /immutable/);

  await receivePurchaseOrder({ actor: actor(creator), businessId: business.id, lines: [{ purchaseOrderLineId: approved.lines[0].id, quantity: 4 }], operationKey: `AP:${token}:RECEIVE:0002`, purchaseOrderId: po.id });
  const second = await createSupplierBillDraft({ ...context(creator, "BILL2"), branchId: branch.id, dueDate: new Date("2026-09-10T00:00:00Z"), invoiceDate: new Date("2026-08-11T00:00:00Z"), lines: [{ purchaseOrderLineId: approved.lines[0].id, billedQuantity: 4, unitPrice: 20 }], purchaseOrderId: po.id, supplierInvoiceNumber: "INV-002" });
  await confirmSupplierBill({ ...context(reviewer, "CONFIRM2"), allowOwnerSelfConfirm: false, billId: second.id, expectedRevision: second.revision, priceVarianceAcknowledged: false });
  await synchronizeInventoryPurchaseExpense({ actor: actor(reviewer), businessId: business.id, supplierBillId: second.id }, prisma);
  const trace = (await getSupplierBillDetail({ businessId: business.id, billId: second.id, allowedBranchIds: [branch.id] })).trace[0]; assert.deepEqual({ ordered: trace.ordered, received: trace.received, billed: trace.billed }, { ordered: 10, received: 10, billed: 10 });
  await assert.rejects(createSupplierBillDraft({ ...context(creator, "OVERBILL"), branchId: branch.id, dueDate: new Date("2026-09-10T00:00:00Z"), invoiceDate: new Date("2026-08-11T00:00:00Z"), lines: [{ purchaseOrderLineId: approved.lines[0].id, billedQuantity: 1, unitPrice: 20 }], purchaseOrderId: po.id, supplierInvoiceNumber: "INV-003" }).then((bill) => confirmSupplierBill({ ...context(reviewer, "OVERCONFIRM"), allowOwnerSelfConfirm: false, billId: bill.id, expectedRevision: bill.revision, priceVarianceAcknowledged: false })), /Over-bill blocked/);
  await assert.rejects(createSupplierBillDraft({ ...context(creator, "DUPLICATE"), branchId: branch.id, dueDate: new Date("2026-09-10T00:00:00Z"), invoiceDate: new Date("2026-08-11T00:00:00Z"), lines: [{ purchaseOrderLineId: approved.lines[0].id, billedQuantity: 1, unitPrice: 20 }], purchaseOrderId: po.id, supplierInvoiceNumber: " inv-002 " }), /Duplicate supplier invoice/);
  await assert.rejects(getSupplierBillDetail({ businessId: business.id, billId: draft.id, allowedBranchIds: [otherBranch.id] }), SupplierApScopeError);

  await reverseGoodsReceiptLine({ actor: actor(reviewer), businessId: business.id, goodsReceiptLineId: receipt.lines[0].id, operationKey: `AP:${token}:GR-REV:0001`, quantity: 1, reason: "Post-bill damaged item reversal" });
  const reconciliation = await reconcileAccountsPayable({ businessId: business.id, allowedBranchIds: [branch.id] }); assert.ok(reconciliation.issues.some((issue) => issue.code === "RECEIPT_REVERSAL_AFTER_BILL"));
  const expenseReconciliation = await reconcileExpenseSources({ businessId: business.id }, prisma); assert.ok(expenseReconciliation.issues.some((issue) => issue.code === "SOURCE_AP_MATCH_ISSUE"));
  const dashboard = await getExpenseDashboard({ allowedBranchIds: [branch.id], businessId: business.id, dateFrom: "2026-08-01", dateTo: "2026-08-31", includeBusinessWide: true }, prisma); assert.equal(dashboard.bySource.find((row) => row.sourceType === "INVENTORY_PURCHASE")?.amount, "200.00"); assert.equal(dashboard.recorded, "200.00"); assert.equal(dashboard.paid, "50.00"); assert.equal(dashboard.unpaid, "150.00");

  const voidPo = await createPurchaseOrder({ actor: actor(creator), branchId: branch.id, businessId: business.id, lines: [{ expectedUnitCost: 15, orderedQuantity: 1, productId: product.id }], operationKey: `AP:${token}:VOID-PO:0001`, orderDate: new Date("2026-08-11T00:00:00Z"), supplierId: supplier.id });
  const approvedVoidPo = await approvePurchaseOrder({ actor: actor(reviewer), businessId: business.id, expectedRevision: voidPo.revision, operationKey: `AP:${token}:VOID-APPROVE:01`, purchaseOrderId: voidPo.id });
  await receivePurchaseOrder({ actor: actor(creator), businessId: business.id, lines: [{ purchaseOrderLineId: approvedVoidPo.lines[0].id, quantity: 1 }], operationKey: `AP:${token}:VOID-RECEIVE:01`, purchaseOrderId: voidPo.id });
  const voidDraft = await createSupplierBillDraft({ ...context(creator, "VOID-BILL"), branchId: branch.id, dueDate: new Date("2026-09-10T00:00:00Z"), invoiceDate: new Date("2026-08-11T00:00:00Z"), lines: [{ purchaseOrderLineId: approvedVoidPo.lines[0].id, billedQuantity: 1, unitPrice: 15 }], purchaseOrderId: voidPo.id, supplierInvoiceNumber: "INV-VOID-001" });
  const voidConfirmed = await confirmSupplierBill({ ...context(reviewer, "VOID-CONFIRM"), allowOwnerSelfConfirm: false, billId: voidDraft.id, expectedRevision: voidDraft.revision, priceVarianceAcknowledged: false });
  const voidExpense = await synchronizeInventoryPurchaseExpense({ actor: actor(reviewer), businessId: business.id, supplierBillId: voidDraft.id }, prisma);
  await (await import("../../src/lib/inventory/supplier-ap-service")).voidSupplierBill({ ...context(reviewer, "VOID-EXECUTE"), billId: voidDraft.id, expectedRevision: voidConfirmed.revision, reason: "Supplier invoice cancelled" });
  await synchronizeInventoryPurchaseExpense({ actor: actor(reviewer), businessId: business.id, supplierBillId: voidDraft.id }, prisma);
  const voidedRepresentation = await prisma.businessExpense.findUniqueOrThrow({ where: { id: voidExpense.expenseId }, include: { sourceSettlement: true } }); assert.equal(voidedRepresentation.status, "VOID"); assert.equal(voidedRepresentation.sourceSettlement?.settlementStatus, "VOID");

  const auto = await prisma.business.create({ data: { name: `AP Auto ${token}`, slug: `ap-auto-${token}`, industryType: "AUTO_DETAILING" } });
  assert.equal((await listSupplierBills({ businessId: auto.id, allowedBranchIds: null })).length, 0);
  assert.deepEqual(await synchronizeInventoryPurchaseExpense({ actor: actor(creator), businessId: auto.id, supplierBillId: draft.id }, prisma), { status: "SKIPPED", reason: "EXPENSE_MODULE_DISABLED" });
});

test("Concurrent confirmation and payment cannot over-bill or overpay", async () => {
  assertLocalDatabase(); const token = randomUUID().slice(0, 8);
  const business = await prisma.business.create({ data: { name: `AP Race ${token}`, slug: `ap-race-${token}` } });
  const branch = await prisma.branch.create({ data: { businessId: business.id, name: `Race ${token}` } });
  const [creator, reviewer] = await Promise.all([prisma.user.create({ data: { branchId: branch.id, businessId: business.id, name: "Creator", role: "BUSINESS_OWNER" } }), prisma.user.create({ data: { branchId: branch.id, businessId: business.id, name: "Reviewer", role: "BUSINESS_OWNER" } })]);
  const actor = (u: typeof creator) => ({ userId: u.id, name: u.name, email: u.email });
  const supplier = await createSupplier({ actor: actor(creator), businessId: business.id, name: `Race supplier ${token}`, operationKey: `APR:${token}:SUPPLIER:01` });
  const product = await prisma.product.create({ data: { businessId: business.id, name: `Race product ${token}`, price: 10, trackInventory: true } });
  const po = await createPurchaseOrder({ actor: actor(creator), branchId: branch.id, businessId: business.id, lines: [{ expectedUnitCost: 10, orderedQuantity: 2, productId: product.id }], operationKey: `APR:${token}:PO:00000001`, orderDate: new Date("2026-08-11T00:00:00Z"), supplierId: supplier.id });
  const approved = await approvePurchaseOrder({ actor: actor(reviewer), businessId: business.id, expectedRevision: po.revision, operationKey: `APR:${token}:APPROVE:001`, purchaseOrderId: po.id });
  await receivePurchaseOrder({ actor: actor(creator), businessId: business.id, lines: [{ purchaseOrderLineId: approved.lines[0].id, quantity: 2 }], operationKey: `APR:${token}:RECEIVE:001`, purchaseOrderId: po.id });
  const makeDraft = (suffix: string) => createSupplierBillDraft({ actor: actor(creator), allowedBranchIds: [branch.id], branchId: branch.id, businessId: business.id, dueDate: new Date("2026-09-01T00:00:00Z"), invoiceDate: new Date("2026-08-11T00:00:00Z"), lines: [{ purchaseOrderLineId: approved.lines[0].id, billedQuantity: 2, unitPrice: 10 }], operationKey: `APR:${token}:DRAFT:${suffix}:001`, purchaseOrderId: po.id, supplierInvoiceNumber: `RACE-${suffix}` });
  const [a, b] = await Promise.all([makeDraft("A"), makeDraft("B")]);
  const confirm = (bill: typeof a, suffix: string) => confirmSupplierBill({ actor: actor(reviewer), allowedBranchIds: [branch.id], allowOwnerSelfConfirm: false, billId: bill.id, businessId: business.id, expectedRevision: bill.revision, operationKey: `APR:${token}:CONFIRM:${suffix}`, priceVarianceAcknowledged: false });
  const confirmationRace = await Promise.allSettled([confirm(a, "A"), confirm(b, "B")]); assert.equal(confirmationRace.filter((result) => result.status === "fulfilled").length, 1); assert.equal(confirmationRace.filter((result) => result.status === "rejected").length, 1);
  const confirmed = await prisma.supplierBill.findFirstOrThrow({ where: { businessId: business.id, status: "CONFIRMED" } });
  const pay = (suffix: string) => recordSupplierPayment({ actor: actor(reviewer), allowedBranchIds: [branch.id], amount: 20, authorize: async () => ({ assurance: "MFA" }), billId: confirmed.id, businessId: business.id, operationKey: `APR:${token}:PAY:${suffix}:0001`, paymentDate: new Date("2026-08-11T00:00:00Z"), paymentMethod: "CASH" });
  const paymentRace = await Promise.allSettled([pay("A"), pay("B")]); assert.equal(paymentRace.filter((result) => result.status === "fulfilled").length, 1); assert.equal(paymentRace.filter((result) => result.status === "rejected").length, 1);
  const total = await prisma.supplierPayment.aggregate({ where: { businessId: business.id, supplierBillId: confirmed.id, status: "COMPLETED" }, _sum: { amount: true } }); assert.equal(total._sum.amount?.toFixed(2), "20.00");
});

async function stock(branchId: string, productId: string) { return (await prisma.productStock.findUniqueOrThrow({ where: { branchId_productId: { branchId, productId } } })).quantity; }
function assertLocalDatabase() { const url = process.env.DATABASE_URL ?? ""; const host = new URL(url).hostname; assert.ok(["localhost", "127.0.0.1", "::1"].includes(host), "Supplier AP integration tests require Local database."); }
