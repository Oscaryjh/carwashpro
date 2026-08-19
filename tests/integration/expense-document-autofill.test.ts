import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import type { ClaimPrivateAttachmentStore, StoredPrivateClaimAttachment } from "../../src/lib/claim/private-attachment-storage";
import { createExpenseDocumentScan } from "../../src/lib/expense/document-ai/service";
import type { ExpenseDocumentProvider } from "../../src/lib/expense/document-ai/provider";
import { createBusinessExpense, ensureStarterExpenseCategories } from "../../src/lib/expense/service";

const prisma = new PrismaClient();
after(async () => prisma.$disconnect());

test("private document staging requires human creation, is one-time and blocks duplicate/routing mistakes", async () => {
  assertLocalDatabase();
  const previous = { enabled: process.env.EXPENSE_RECEIPT_AUTOFILL_ENABLED, ai: process.env.EXPENSE_DOCUMENT_AI_ENABLED, provider: process.env.EXPENSE_DOCUMENT_AI_PROVIDER };
  process.env.EXPENSE_RECEIPT_AUTOFILL_ENABLED = "true";
  process.env.EXPENSE_DOCUMENT_AI_ENABLED = "true";
  process.env.EXPENSE_DOCUMENT_AI_PROVIDER = "mock";
  try {
    const token = randomUUID().slice(0, 8);
    const business = await prisma.business.create({ data: { industryType: "SALON_BEAUTY", name: `Expense Scan ${token}`, slug: `expense-scan-${token}` } });
    const branch = await prisma.branch.create({ data: { businessId: business.id, name: `Scan Branch ${token}` } });
    const owner = await prisma.user.create({ data: { branchId: branch.id, businessId: business.id, email: `expense.scan.${token}@local.test`, name: "Expense Scan Owner", role: "BUSINESS_OWNER" } });
    await ensureStarterExpenseCategories(business.id, prisma);
    const category = await prisma.expenseCategory.findFirstOrThrow({ where: { businessId: business.id, name: "Utilities" } });
    const store = new MemoryStore();
    const actor = { email: owner.email!, name: owner.name, userId: owner.id };
    const receiptProvider = provider({ documentType: "EXPENSE_RECEIPT", evidenceSignals: ["Card approved"], paymentStatus: "PAID", paymentMethod: "CARD" });
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

    const scan = await createExpenseDocumentScan({ actor, businessId: business.id, branchId: branch.id, file: { bytes: png, claimedMimeType: "image/png", originalFileName: "paid-utility-receipt.png" } }, prisma, store, receiptProvider);
    assert.equal(scan.documentType, "EXPENSE_RECEIPT");
    assert.equal(scan.suggested.paymentStatus, "PAID");
    assert.equal(await prisma.businessExpense.count({ where: { businessId: business.id } }), 0, "scanning must not create an Expense");

    const expense = await createBusinessExpense({ actor, amount: scan.suggested.amount!, branchId: branch.id, businessId: business.id, categoryId: category.id, description: scan.suggested.description!, desiredStatus: "CONFIRMED", documentScanId: scan.id, expenseDate: scan.suggested.expenseDate!, operationKey: `SCAN:CREATE:${token}:1`, payeeName: scan.suggested.payeeName, paymentStatus: "UNPAID" }, prisma, store);
    assert.equal(expense.attachments.length, 1);
    assert.equal((await prisma.expenseDocumentScan.findUniqueOrThrow({ where: { id: scan.id } })).expenseId, expense.id);
    await assert.rejects(createBusinessExpense({ actor, amount: "120.00", branchId: branch.id, businessId: business.id, categoryId: category.id, description: "Reuse blocked", documentScanId: scan.id, expenseDate: "2026-08-14", operationKey: `SCAN:REUSE:${token}`, paymentStatus: "UNPAID" }, prisma, store), /already been used/);

    const duplicate = await createExpenseDocumentScan({ actor, businessId: business.id, branchId: branch.id, file: { bytes: png, claimedMimeType: "image/png", originalFileName: "same-receipt.png" } }, prisma, store, receiptProvider);
    assert.ok(duplicate.duplicateCandidates.some((item) => item.recordId === expense.id && item.reason === "SAME_FILE"));
    await assert.rejects(createBusinessExpense({ actor, amount: "120.00", branchId: branch.id, businessId: business.id, categoryId: category.id, description: "Duplicate review", documentScanId: duplicate.id, expenseDate: "2026-08-14", operationKey: `SCAN:DUPLICATE:${token}:A`, paymentStatus: "UNPAID" }, prisma, store), /explicitly choose Continue anyway/);
    const continued = await createBusinessExpense({ actor, amount: "120.00", branchId: branch.id, businessId: business.id, categoryId: category.id, description: "Duplicate reviewed by human", documentScanId: duplicate.id, duplicateOverride: true, expenseDate: "2026-08-14", operationKey: `SCAN:DUPLICATE:${token}:B`, paymentStatus: "UNPAID" }, prisma, store);
    assert.equal(continued.status, "DRAFT");

    const supplierScan = await createExpenseDocumentScan({ actor, businessId: business.id, branchId: branch.id, file: { bytes: Uint8Array.from([...png, 4]), claimedMimeType: "image/png", originalFileName: "supplier-invoice.png" } }, prisma, store, provider({ documentType: "SUPPLIER_INVOICE", dueDate: "2026-09-14", evidenceSignals: ["Payment terms: 30 days"] }));
    await assert.rejects(createBusinessExpense({ actor, amount: "120.00", branchId: branch.id, businessId: business.id, categoryId: category.id, description: "Wrong workflow", documentScanId: supplierScan.id, expenseDate: "2026-08-14", operationKey: `SCAN:SUPPLIER:${token}`, paymentStatus: "UNPAID" }, prisma, store), /Supplier Bills/);

    const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF");
    const pdfScan = await createExpenseDocumentScan({ actor, businessId: business.id, branchId: branch.id, file: { bytes: pdf, claimedMimeType: "application/pdf", originalFileName: "supplier-invoice.pdf" } }, prisma, store, provider({ documentType: "SUPPLIER_INVOICE", dueDate: "2026-09-14", evidenceSignals: ["Tax invoice", "Balance due"] }));
    assert.equal(pdfScan.documentType, "SUPPLIER_INVOICE");

    const failed = await createExpenseDocumentScan({ actor, businessId: business.id, branchId: branch.id, file: { bytes: Uint8Array.from([...png, 5]), claimedMimeType: "image/png", originalFileName: "unreadable.png" } }, prisma, store, { name: "failed-test", async extract() { throw new Error("provider unavailable"); } });
    assert.equal(failed.documentType, "UNKNOWN");
    assert.equal(failed.confidence, "LOW");
    assert.ok(failed.warnings.some((warning) => warning.includes("manual entry")));
    assert.equal(await prisma.businessExpense.count({ where: { businessId: business.id } }), 2, "provider failure must not create an Expense");
  } finally {
    restore("EXPENSE_RECEIPT_AUTOFILL_ENABLED", previous.enabled);
    restore("EXPENSE_DOCUMENT_AI_ENABLED", previous.ai);
    restore("EXPENSE_DOCUMENT_AI_PROVIDER", previous.provider);
  }
});

function provider(overrides: Partial<Awaited<ReturnType<ExpenseDocumentProvider["extract"]>>["extraction"]>): ExpenseDocumentProvider {
  return { name: "test", async extract() { return { extraction: { documentType: "EXPENSE_RECEIPT", confidence: "HIGH", merchantName: "Sabah Electricity", invoiceNumber: "R-100", rawDocumentDate: "14/08/2026", documentDate: "2026-08-14", rawDueDate: null, dueDate: null, currency: "MYR", subtotal: "120.00", taxAmount: "0.00", totalAmount: "120.00", description: "Electricity payment", categoryHint: "Utilities", paymentStatus: "UNPAID", paymentMethod: "UNKNOWN", rawPaymentDate: null, paymentDate: null, paymentReference: null, fieldConfidence: { merchantName: 0.9, invoiceNumber: 0.9, documentDate: 0.9, dueDate: null, currency: 0.9, subtotal: 0.9, taxAmount: 0.9, totalAmount: 0.9, paymentStatus: 0.9, paymentDate: null }, evidenceSignals: [], warnings: [], ...overrides }, provider: "test", model: "test-extractor", providerRequestId: "test-request" }; } };
}

class MemoryStore implements ClaimPrivateAttachmentStore {
  readonly values = new Map<string, { bytes: Buffer; mimeType: "image/png"; checksum: string; fileName: string }>();
  async putQuarantined(attachment: Parameters<ClaimPrivateAttachmentStore["putQuarantined"]>[0]): Promise<StoredPrivateClaimAttachment> { const objectKey = `claim-receipts/2026/08/${randomUUID()}.png`; this.values.set(objectKey, { bytes: attachment.bytes, checksum: attachment.checksumSha256, fileName: attachment.sanitizedFileName, mimeType: "image/png" }); return { byteLength: attachment.byteLength, checksumSha256: attachment.checksumSha256, disposition: "QUARANTINED", mimeType: "image/png", objectKey, publicUrl: null, sanitizedFileName: attachment.sanitizedFileName, signedUrl: null }; }
  async getQuarantinedMetadata(objectKey: string) { const value = this.values.get(objectKey)!; return { byteLength: value.bytes.length, checksumSha256: value.checksum, disposition: "QUARANTINED" as const, mimeType: value.mimeType, objectKey }; }
  async readQuarantined(input: { objectKey: string; expectedChecksumSha256: string }) { const value = this.values.get(input.objectKey)!; assert.equal(createHash("sha256").update(value.bytes).digest("hex"), input.expectedChecksumSha256); return value.bytes; }
  async deleteQuarantined(objectKey: string) { this.values.delete(objectKey); }
}

function restore(key: string, value: string | undefined) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
function assertLocalDatabase() { const host = new URL(process.env.DATABASE_URL ?? "").hostname; assert.ok(["localhost", "127.0.0.1", "::1"].includes(host), "Expense document integration requires Local database."); }
