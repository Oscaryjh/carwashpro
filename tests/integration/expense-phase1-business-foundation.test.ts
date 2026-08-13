import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import type { ClaimPrivateAttachmentStore, StoredPrivateClaimAttachment } from "../../src/lib/claim/private-attachment-storage";
import {
  confirmBusinessExpense,
  createBusinessExpense,
  createExpenseCategory,
  createRecurringExpenseTemplate,
  ensureStarterExpenseCategories,
  generateRecurringExpense,
  getAuthorizedExpenseAttachment,
  getExpenseDashboard,
  markBusinessExpensePaid,
  materializeSourceExpense,
  updateExpenseCategory,
  updateDraftBusinessExpense,
  voidBusinessExpense,
} from "../../src/lib/expense/service";
import { createPurchaseOrder, createSupplier } from "../../src/lib/inventory/purchasing-service";
import { requireBusinessModule } from "../../src/lib/modules/entitlements";

const prisma = new PrismaClient();
after(async () => prisma.$disconnect());

test("manual Expense lifecycle, payment, dashboard, receipt and recurring generation are safe", async () => {
  assertLocalDatabase();
  const token = randomUUID().slice(0, 8);
  const business = await prisma.business.create({ data: { industryType: "SALON_BEAUTY", name: `Expense P1 ${token}`, slug: `expense-p1-${token}` } });
  const [branch, secondBranch] = await Promise.all([
    prisma.branch.create({ data: { businessId: business.id, name: `Lintas ${token}` } }),
    prisma.branch.create({ data: { businessId: business.id, name: `City ${token}` } }),
  ]);
  const [owner, manager] = await Promise.all([
    prisma.user.create({ data: { branchId: branch.id, businessId: business.id, email: `expense.owner.${token}@local.test`, name: "Expense Owner", role: "BUSINESS_OWNER" } }),
    prisma.user.create({ data: { branchId: branch.id, businessId: business.id, email: `expense.manager.${token}@local.test`, name: "Expense Manager", role: "BUSINESS_OWNER" } }),
  ]);
  await prisma.businessModuleEntitlement.createMany({ data: [
    { businessId: business.id, moduleKey: "EXPENSE", status: "ENABLED", enabledFrom: new Date(), source: "MANUAL", createdById: owner.id, updatedById: owner.id },
    { businessId: business.id, moduleKey: "POS", status: "ENABLED", enabledFrom: new Date(), source: "MANUAL", createdById: owner.id, updatedById: owner.id },
    { businessId: business.id, moduleKey: "INVENTORY", status: "ENABLED", enabledFrom: new Date(), source: "MANUAL", createdById: owner.id, updatedById: owner.id },
  ] });
  await ensureStarterExpenseCategories(business.id, prisma);
  const marketing = await prisma.expenseCategory.findFirstOrThrow({ where: { businessId: business.id, name: "Marketing" } });
  const utilities = await prisma.expenseCategory.findFirstOrThrow({ where: { businessId: business.id, name: "Utilities" } });
  const rental = await prisma.expenseCategory.findFirstOrThrow({ where: { businessId: business.id, name: "Rental" } });
  const ownerActor = actor(owner); const managerActor = actor(manager);
  const store = new MemoryStore();
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  const paid = await createBusinessExpense({ actor: ownerActor, amount: "1500.00", branchId: branch.id, businessId: business.id, categoryId: marketing.id, description: "Local QA Meta campaign", desiredStatus: "CONFIRMED", expenseDate: "2026-08-11", operationKey: `EXPENSE:CREATE:PAID:${token}:0001`, payeeName: "Meta", paymentDate: "2026-08-11", paymentMethod: "CARD", paymentReference: "LOCAL-CARD-REF", paymentStatus: "PAID", receipt: { bytes: png, claimedMimeType: "image/png", originalFileName: "meta receipt.png" } }, prisma, store);
  assert.match(paid.expenseNumber, /^EXP-\d{6}$/); assert.equal(paid.attachments.length, 1); assert.equal(paid.status, "CONFIRMED"); assert.equal(paid.paymentStatus, "PAID");
  const paidReplay = await createBusinessExpense({ actor: ownerActor, amount: "1500.00", branchId: branch.id, businessId: business.id, categoryId: marketing.id, description: "Local QA Meta campaign", desiredStatus: "CONFIRMED", expenseDate: "2026-08-11", operationKey: `EXPENSE:CREATE:PAID:${token}:0001`, payeeName: "Meta", paymentDate: "2026-08-11", paymentMethod: "CARD", paymentReference: "LOCAL-CARD-REF", paymentStatus: "PAID", receipt: { bytes: png, claimedMimeType: "image/png", originalFileName: "meta receipt.png" } }, prisma, store); assert.equal(paidReplay.id, paid.id); assert.equal(store.putCount, 1);

  const unpaid = await createBusinessExpense({ actor: ownerActor, amount: "800.00", branchId: branch.id, businessId: business.id, categoryId: utilities.id, description: "Electricity", desiredStatus: "CONFIRMED", expenseDate: "2026-08-11", operationKey: `EXPENSE:CREATE:UNPAID:${token}`, payeeName: "Sabah Electricity", paymentStatus: "UNPAID" }, prisma);
  let dashboard = await getExpenseDashboard({ allowedBranchIds: [branch.id, secondBranch.id], businessId: business.id, dateFrom: "2026-08-01", dateTo: "2026-08-31", includeBusinessWide: true }, prisma);
  assert.equal(dashboard.recorded, "2300.00"); assert.equal(dashboard.paid, "1500.00"); assert.equal(dashboard.unpaid, "800.00");
  const payRace = await Promise.allSettled(["A", "B"].map((suffix) => markBusinessExpensePaid({ actor: managerActor, businessId: business.id, expenseId: unpaid.id, expectedRevision: unpaid.revision, operationKey: `EXPENSE:PAY:${token}:${suffix}`, paymentDate: "2026-08-12", paymentMethod: "BANK_TRANSFER", paymentReference: "LOCAL-ELECTRIC" }, prisma)));
  assert.equal(payRace.filter((result) => result.status === "fulfilled").length, 1);
  dashboard = await getExpenseDashboard({ allowedBranchIds: [branch.id], businessId: business.id, dateFrom: "2026-08-01", dateTo: "2026-08-31", includeBusinessWide: true }, prisma);
  assert.equal(dashboard.recorded, "2300.00"); assert.equal(dashboard.paid, "2300.00"); assert.equal(dashboard.unpaid, "0.00");
  const paidCurrent = await prisma.businessExpense.findUniqueOrThrow({ where: { id: unpaid.id } });
  await assert.rejects(voidBusinessExpense({ actor: ownerActor, businessId: business.id, expenseId: unpaid.id, expectedRevision: paidCurrent.revision, operationKey: `EXPENSE:VOID:PAID:${token}`, reason: "Should require reviewed correction" }, prisma), /cannot be voided directly/);

  const voidable = await createBusinessExpense({ actor: ownerActor, amount: "500", branchId: null, businessId: business.id, categoryId: rental.id, description: "Incorrect company fee", desiredStatus: "CONFIRMED", expenseDate: "2026-08-11", operationKey: `EXPENSE:CREATE:VOID:${token}`, paymentStatus: "UNPAID" }, prisma);
  await voidBusinessExpense({ actor: managerActor, businessId: business.id, expenseId: voidable.id, expectedRevision: voidable.revision, operationKey: `EXPENSE:VOID:${token}`, reason: "Confirmed duplicate test record" }, prisma);
  dashboard = await getExpenseDashboard({ allowedBranchIds: [branch.id, secondBranch.id], businessId: business.id, dateFrom: "2026-08-01", dateTo: "2026-08-31", includeBusinessWide: true }, prisma);
  assert.equal(dashboard.recorded, "2300.00"); assert.equal(await prisma.businessExpense.count({ where: { id: voidable.id, status: "VOID" } }), 1);

  const draft = await createBusinessExpense({ actor: ownerActor, amount: "100", branchId: secondBranch.id, businessId: business.id, categoryId: utilities.id, description: "Draft edit", expenseDate: "2026-08-11", operationKey: `EXPENSE:CREATE:DRAFT:${token}` }, prisma);
  const edited = await updateDraftBusinessExpense({ actor: managerActor, amount: "125.50", branchId: secondBranch.id, businessId: business.id, categoryId: utilities.id, description: "Draft edited", expenseDate: "2026-08-12", expenseId: draft.id, expectedRevision: draft.revision, operationKey: `EXPENSE:EDIT:${token}` }, prisma);
  await assert.rejects(updateDraftBusinessExpense({ actor: ownerActor, amount: "130", branchId: secondBranch.id, businessId: business.id, categoryId: utilities.id, description: "Stale draft", expenseDate: "2026-08-12", expenseId: draft.id, expectedRevision: draft.revision, operationKey: `EXPENSE:EDIT:STALE:${token}` }, prisma), /Refresh required/);
  const confirmed = await confirmBusinessExpense({ actor: managerActor, businessId: business.id, expenseId: draft.id, expectedRevision: edited.revision, operationKey: `EXPENSE:CONFIRM:${token}` }, prisma); assert.equal(confirmed.status, "CONFIRMED");

  const receiptRequired = await createExpenseCategory({ actor: ownerActor, businessId: business.id, group: "OPERATIONS", name: `Receipt Required ${token}`, operationKey: `EXPENSE:CATEGORY:RECEIPT:${token}`, requiresReceipt: true }, prisma);
  await assert.rejects(createBusinessExpense({ actor: ownerActor, amount: "25", branchId: branch.id, businessId: business.id, categoryId: receiptRequired.id, description: "Missing receipt", desiredStatus: "CONFIRMED", expenseDate: "2026-08-11", operationKey: `EXPENSE:MISSING:RECEIPT:${token}` }, prisma), /requires a receipt/);
  const attachment = paid.attachments[0];
  await assert.rejects(getAuthorizedExpenseAttachment({ allowedBranchIds: [branch.id], attachmentId: attachment.id, businessId: business.id }, prisma, store), /clean malware scan/);
  await prisma.businessExpenseAttachment.update({ where: { id: attachment.id }, data: { malwareStatus: "CLEAN", privacyMetadataStatus: "SAFE" } });
  const released = await getAuthorizedExpenseAttachment({ allowedBranchIds: [branch.id], attachmentId: attachment.id, businessId: business.id }, prisma, store); assert.deepEqual(released.bytes, Buffer.from(png));
  await assert.rejects(getAuthorizedExpenseAttachment({ allowedBranchIds: [secondBranch.id], attachmentId: attachment.id, businessId: business.id }, prisma, store), /authorised scope/);

  const recurring = await createRecurringExpenseTemplate({ actor: ownerActor, amount: "5000", branchId: branch.id, businessId: business.id, categoryId: rental.id, description: "Monthly rent", operationKey: `EXPENSE:RECURRING:CREATE:${token}`, payeeName: "Landlord", startDate: "2026-08-01" }, prisma);
  const august = await generateRecurringExpense({ actor: ownerActor, businessId: business.id, operationKey: `EXPENSE:RECURRING:AUG:${token}:A`, period: "2026-08", templateId: recurring.id }, prisma);
  const augustReplay = await generateRecurringExpense({ actor: ownerActor, businessId: business.id, operationKey: `EXPENSE:RECURRING:AUG:${token}:B`, period: "2026-08", templateId: recurring.id }, prisma);
  const september = await generateRecurringExpense({ actor: ownerActor, businessId: business.id, operationKey: `EXPENSE:RECURRING:SEP:${token}`, period: "2026-09", templateId: recurring.id }, prisma);
  assert.equal(august.id, augustReplay.id); assert.notEqual(august.id, september.id); assert.equal(august.status, "DRAFT"); assert.equal(august.paymentStatus, "UNPAID");

  const system = await materializeSourceExpense({ actor: ownerActor, amount: "75", branchId: branch.id, businessId: business.id, categoryId: utilities.id, description: "QA canonical source", expenseDate: "2026-08-11", operationKey: `EXPENSE:SOURCE:${token}:A`, sourceId: `QA-SOURCE-${token}`, sourceRevision: "1", sourceType: "SYSTEM" }, prisma);
  assert.equal(system.sourceType, "SYSTEM");
  await assert.rejects(materializeSourceExpense({ actor: ownerActor, amount: "75", branchId: branch.id, businessId: business.id, categoryId: utilities.id, description: "QA canonical source", expenseDate: "2026-08-11", operationKey: `EXPENSE:SOURCE:${token}:B`, sourceId: `QA-SOURCE-${token}`, sourceRevision: "1", sourceType: "SYSTEM" }, prisma), /already has an Expense representation/);

  await updateExpenseCategory({ active: false, actor: ownerActor, businessId: business.id, categoryId: marketing.id, code: marketing.code, description: marketing.description, group: marketing.group, name: marketing.name, operationKey: `EXPENSE:CATEGORY:DEACTIVATE:${token}`, requiresReceipt: marketing.requiresReceipt, sortOrder: marketing.sortOrder }, prisma);
  assert.equal(await prisma.businessExpense.count({ where: { categoryId: marketing.id } }), 1);
  await assert.rejects(createBusinessExpense({ actor: ownerActor, amount: "10", branchId: branch.id, businessId: business.id, categoryId: marketing.id, description: "Inactive category", expenseDate: "2026-08-11", operationKey: `EXPENSE:INACTIVE:${token}` }, prisma), /active expense category/);
  const revision = await prisma.businessExpenseRevision.findFirstOrThrow({ where: { expenseId: paid.id } });
  await assert.rejects(prisma.businessExpenseRevision.update({ where: { id: revision.id }, data: { amount: 1 } }), /immutable/);

  const beforeBoundary = await prisma.businessExpense.count({ where: { businessId: business.id } });
  const supplier = await createSupplier({ actor: ownerActor, businessId: business.id, name: `Expense Boundary Supplier ${token}`, operationKey: `EXPENSE:BOUNDARY:SUPPLIER:${token}` });
  const product = await prisma.product.create({ data: { businessId: business.id, name: `Boundary Product ${token}`, price: 10, trackInventory: true } });
  await createPurchaseOrder({ actor: ownerActor, branchId: branch.id, businessId: business.id, lines: [{ expectedUnitCost: 3, orderedQuantity: 2, productId: product.id }], operationKey: `EXPENSE:BOUNDARY:PO:${token}:0001`, orderDate: new Date("2026-08-11T00:00:00Z"), supplierId: supplier.id });
  await prisma.invoice.create({ data: { balance: 0, branchId: branch.id, businessId: business.id, invoiceNumber: `EXPENSE-BOUNDARY-${token}`, paidAmount: 10, status: "PAID", subtotal: 10, total: 10 } });
  assert.equal(await prisma.businessExpense.count({ where: { businessId: business.id } }), beforeBoundary);
});

test("EXPENSE module and tenant actor guards fail closed", async () => {
  assertLocalDatabase(); const token = randomUUID().slice(0, 8);
  const disabled = await prisma.business.create({ data: { name: `Expense Disabled ${token}`, slug: `expense-disabled-${token}` } });
  await assert.rejects(requireBusinessModule(disabled.id, "EXPENSE"), /not enabled/);
  const target = await prisma.business.create({ data: { name: `Expense Target ${token}`, slug: `expense-target-${token}` } });
  const branch = await prisma.branch.create({ data: { businessId: target.id, name: "Target branch" } });
  const targetUser = await prisma.user.create({ data: { branchId: branch.id, businessId: target.id, email: `expense.target.${token}@local.test`, name: "Target", role: "BUSINESS_OWNER" } });
  const outsiderBusiness = await prisma.business.create({ data: { name: `Expense Outsider ${token}`, slug: `expense-outsider-${token}` } });
  const outsider = await prisma.user.create({ data: { businessId: outsiderBusiness.id, email: `expense.outsider.${token}@local.test`, name: "Outsider", role: "BUSINESS_OWNER" } });
  await prisma.businessModuleEntitlement.create({ data: { businessId: target.id, moduleKey: "EXPENSE", status: "ENABLED", enabledFrom: new Date(), source: "MANUAL", createdById: targetUser.id, updatedById: targetUser.id } });
  await ensureStarterExpenseCategories(target.id, prisma); const category = await prisma.expenseCategory.findFirstOrThrow({ where: { businessId: target.id } });
  await assert.rejects(createBusinessExpense({ actor: actor(outsider), amount: "10", branchId: branch.id, businessId: target.id, categoryId: category.id, description: "Cross tenant", expenseDate: "2026-08-11", operationKey: `EXPENSE:CROSS:${token}` }, prisma), /outside business scope/);
});

class MemoryStore implements ClaimPrivateAttachmentStore {
  readonly values = new Map<string, { bytes: Buffer; mimeType: "image/png"; checksum: string; fileName: string }>();
  putCount = 0;
  async putQuarantined(attachment: Parameters<ClaimPrivateAttachmentStore["putQuarantined"]>[0]): Promise<StoredPrivateClaimAttachment> { this.putCount += 1; const objectKey = `claim-receipts/2026/08/${randomUUID()}.png`; this.values.set(objectKey, { bytes: attachment.bytes, checksum: attachment.checksumSha256, fileName: attachment.sanitizedFileName, mimeType: "image/png" }); return { byteLength: attachment.byteLength, checksumSha256: attachment.checksumSha256, disposition: "QUARANTINED", mimeType: "image/png", objectKey, publicUrl: null, sanitizedFileName: attachment.sanitizedFileName, signedUrl: null }; }
  async getQuarantinedMetadata(objectKey: string) { const value = this.values.get(objectKey)!; return { byteLength: value.bytes.length, checksumSha256: value.checksum, disposition: "QUARANTINED" as const, mimeType: value.mimeType, objectKey }; }
  async readQuarantined(input: { objectKey: string; expectedChecksumSha256: string }) { const value = this.values.get(input.objectKey)!; assert.equal(createHash("sha256").update(value.bytes).digest("hex"), input.expectedChecksumSha256); return value.bytes; }
  async deleteQuarantined(objectKey: string) { this.values.delete(objectKey); }
}
function actor(user: { email: string | null; id: string; name: string }) { return { email: user.email ?? "local@test.invalid", name: user.name, userId: user.id }; }
function assertLocalDatabase() { const host = new URL(process.env.DATABASE_URL ?? "").hostname; assert.ok(["localhost", "127.0.0.1", "::1"].includes(host), "Expense Phase 1 integration requires Local database."); }
