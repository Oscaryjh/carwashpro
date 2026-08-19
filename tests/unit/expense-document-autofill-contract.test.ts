import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getExpenseDocumentAiConfiguration } from "../../src/lib/expense/document-ai/config";
import { normalizeExpenseDocumentExtraction, normalizeMalaysianDate } from "../../src/lib/expense/document-ai/normalization";
import { createExpenseDocumentProvider, MockExpenseDocumentProvider, OpenAiExpenseDocumentProvider } from "../../src/lib/expense/document-ai/provider";
import { expenseDocumentExtractionSchema } from "../../src/lib/expense/document-ai/schema";
import { applyExpenseDocumentSafetyRules, matchExpenseCategory } from "../../src/lib/expense/document-ai/service";

const base = {
  documentType: "EXPENSE_RECEIPT" as const,
  confidence: "HIGH" as const,
  merchantName: "Local Merchant",
  invoiceNumber: "INV-1",
  rawDocumentDate: "14/08/2026",
  documentDate: "2026-08-14",
  rawDueDate: null,
  dueDate: null,
  currency: "MYR",
  subtotal: "100.00",
  taxAmount: "0.00",
  totalAmount: "100.00",
  description: "Testing receipt",
  categoryHint: "Utilities",
  paymentStatus: "PAID" as const,
  paymentMethod: "CARD" as const,
  rawPaymentDate: "14/08/2026",
  paymentDate: "2026-08-14",
  paymentReference: "AUTH-1",
  fieldConfidence: { merchantName: 0.9, invoiceNumber: 0.9, documentDate: 0.9, dueDate: null, currency: 0.9, subtotal: 0.9, taxAmount: 0.9, totalAmount: 0.9, paymentStatus: 0.8, paymentDate: 0.8 },
  evidenceSignals: [] as string[],
  warnings: [] as string[],
};

test("receipt safety rules do not infer Paid without strong visible evidence", () => {
  assert.deepEqual(applyExpenseDocumentSafetyRules(base), { ...base, paymentStatus: "UNPAID", paymentMethod: "UNKNOWN", paymentDate: null });
  const paid = applyExpenseDocumentSafetyRules({ ...base, evidenceSignals: ["Card approved"] });
  assert.equal(paid.paymentStatus, "PAID");
  assert.equal(paid.paymentMethod, "CARD");

  const settledDuitNow = applyExpenseDocumentSafetyRules({
    ...base,
    paymentStatus: "UNPAID",
    paymentMethod: "UNKNOWN",
    evidenceSignals: ["Restaurant receipt", "Total shown", "Balance 0.00", "Duit now"],
  });
  assert.equal(settledDuitNow.paymentStatus, "PAID");
  assert.equal(settledDuitNow.paymentMethod, "EWALLET");

  const methodOnly = applyExpenseDocumentSafetyRules({ ...base, paymentStatus: "UNPAID", paymentMethod: "UNKNOWN", evidenceSignals: ["Duit now"] });
  assert.equal(methodOnly.paymentStatus, "UNPAID", "a payment-method label without settlement evidence is insufficient");

  const supplier = applyExpenseDocumentSafetyRules({ ...base, documentType: "SUPPLIER_INVOICE", paymentStatus: "PAID", paymentMethod: "EWALLET", evidenceSignals: ["Balance 0.00", "Duit now", "Supplier invoice"] });
  assert.equal(supplier.paymentStatus, "UNPAID", "Supplier Invoice routing must remain Accounts Payable even when payment-like text is visible");
});

test("money stays an exact decimal string and JSON numbers are rejected", () => {
  assert.equal(expenseDocumentExtractionSchema.parse(base).totalAmount, "100.00");
  assert.throws(() => expenseDocumentExtractionSchema.parse({ ...base, totalAmount: 100 }));
  assert.throws(() => expenseDocumentExtractionSchema.parse({ ...base, totalAmount: "1e2" }));
});

test("provider normalization maps Malaysian RM to MYR and preserves the remaining extraction", () => {
  const normalized = normalizeExpenseDocumentExtraction({ ...base, currency: "RM" });
  assert.equal(normalized.currency, "MYR");
  assert.equal(normalized.merchantName, base.merchantName);
  assert.equal(normalized.totalAmount, base.totalAmount);
});

test("one unsupported provider field no longer discards all readable receipt facts", () => {
  const normalized = normalizeExpenseDocumentExtraction({ ...base, currency: "Ringgit Malaysia (RM)" });
  assert.equal(normalized.currency, null);
  assert.equal(normalized.merchantName, base.merchantName);
  assert.equal(normalized.totalAmount, base.totalAmount);
  assert.equal(normalized.confidence, "LOW");
  assert.ok(normalized.warnings.some((warning) => warning.includes("currency")));
});

test("Malaysia slash dates use DD/MM/YYYY without redundant confirmation", () => {
  assert.deepEqual(normalizeMalaysianDate("13/08/2026", null), { value: "2026-08-13", ambiguous: false, warning: null });
  assert.deepEqual(normalizeMalaysianDate("07/08/2026, 05:45 pm", "2026-07-08"), { value: "2026-08-07", ambiguous: false, warning: null });
  const normalized = normalizeExpenseDocumentExtraction({ ...base, rawDocumentDate: "07/08/2026", documentDate: "2026-07-08" });
  assert.equal(normalized.documentDate, "2026-08-07");
  assert.equal(normalized.confidence, "HIGH");
  assert.equal(normalized.fieldConfidence.documentDate, 0.9);
  assert.ok(!normalized.warnings.some((warning) => warning.includes("DD/MM/YYYY")));
});

test("provider configuration switches explicitly and never silently selects another provider", () => {
  const common: NodeJS.ProcessEnv = { NODE_ENV: "development", APP_ENVIRONMENT: "local", EXPENSE_RECEIPT_AUTOFILL_ENABLED: "true", EXPENSE_DOCUMENT_AI_ENABLED: "true" };
  assert.equal(getExpenseDocumentAiConfiguration({ ...common, EXPENSE_DOCUMENT_AI_PROVIDER: "mock" }).provider, "mock");
  assert.ok(createExpenseDocumentProvider({ ...common, EXPENSE_DOCUMENT_AI_PROVIDER: "mock" }) instanceof MockExpenseDocumentProvider);
  assert.ok(createExpenseDocumentProvider({ ...common, EXPENSE_DOCUMENT_AI_PROVIDER: "openai", OPENAI_API_KEY: "unit-test-only" }) instanceof OpenAiExpenseDocumentProvider);
  assert.throws(() => getExpenseDocumentAiConfiguration({ ...common, EXPENSE_DOCUMENT_AI_PROVIDER: "unknown" }), /PROVIDER_INVALID/);
  assert.throws(() => getExpenseDocumentAiConfiguration({ ...common, EXPENSE_DOCUMENT_AI_PROVIDER: "openai" }), /PROVIDER_UNAVAILABLE/);
});

test("OpenAI adapter requests strict structured output and validates the returned schema", async () => {
  let capturedRequest: unknown;
  const client = {
    responses: {
      create: async (request: unknown) => {
        capturedRequest = request;
        return { output_text: JSON.stringify(base), _request_id: "req_unit" };
      },
    },
  };
  const adapter = new OpenAiExpenseDocumentProvider({ apiKey: "unit-test-only", model: "gpt-5.4-mini", maxOutputTokens: 1200 }, client as never);
  const result = await adapter.extract({ bytes: Buffer.from("image"), fileName: "receipt.png", mimeType: "image/png" });
  assert.equal(result.extraction.totalAmount, "100.00");
  assert.equal(result.providerRequestId, "req_unit");
  assert.match(JSON.stringify(capturedRequest), /json_schema/);
  assert.match(JSON.stringify(capturedRequest), /strict/);
  assert.match(JSON.stringify(capturedRequest), /Normalize visible RM or Malaysian Ringgit to MYR/);

  const invalidClient = { responses: { create: async () => ({ output_text: JSON.stringify({ ...base, totalAmount: 100 }), _request_id: "req_invalid" }) } };
  const invalidAdapter = new OpenAiExpenseDocumentProvider({ apiKey: "unit-test-only", model: "gpt-5.4-mini", maxOutputTokens: 1200 }, invalidClient as never);
  const repaired = await invalidAdapter.extract({ bytes: Buffer.from("image"), fileName: "receipt.png", mimeType: "image/png" });
  assert.equal(repaired.extraction.totalAmount, null);
  assert.equal(repaired.extraction.merchantName, base.merchantName);
  assert.ok(repaired.extraction.warnings.some((warning) => warning.includes("totalAmount")));
});

test("Cashsale title is not cash evidence and visible Malaysian QR wins", () => {
  const titleOnly = applyExpenseDocumentSafetyRules({
    ...base,
    paymentStatus: "PAID",
    paymentMethod: "CASH",
    evidenceSignals: ["Document title: CASHSALE", "Payment completed"],
  });
  assert.equal(titleOnly.paymentMethod, "UNKNOWN");

  const maybankQr = applyExpenseDocumentSafetyRules({
    ...base,
    paymentStatus: "PAID",
    paymentMethod: "CASH",
    evidenceSignals: ["Document title: CASHSALE", "Merchant Type: MAYBANK QR", "Card RM: 589.00", "Payment completed"],
  });
  assert.equal(maybankQr.paymentStatus, "PAID");
  assert.equal(maybankQr.paymentMethod, "BANK_TRANSFER");
});

test("supplier evidence overrides provider classification and never marks payment", () => {
  const result = applyExpenseDocumentSafetyRules({ ...base, dueDate: "2026-09-14", evidenceSignals: ["Payment terms: 30 days"] });
  assert.equal(result.documentType, "SUPPLIER_INVOICE");
  assert.equal(result.paymentStatus, "UNPAID");
  assert.equal(result.paymentMethod, "UNKNOWN");
});

test("semantic category aliases resolve only to an existing category", () => {
  const categories = [
    { id: "meals", name: "Meals & Entertainment" },
    { id: "transport", name: "Transport" },
    { id: "other", name: "Other" },
  ];
  assert.deepEqual(
    matchExpenseCategory(categories, "Food and beverage", "Restaurant order receipt with items and charges."),
    { ...categories[0], matchConfidence: "MEDIUM" },
  );
  assert.deepEqual(matchExpenseCategory(categories, "Taxi", "Grab ride to supplier"), { ...categories[1], matchConfidence: "MEDIUM" });
  assert.deepEqual(matchExpenseCategory(categories, "Meals & Entertainment", "Restaurant receipt"), { ...categories[0], matchConfidence: "HIGH" });
  assert.equal(matchExpenseCategory(categories, "Medical equipment", "Unmapped specialist purchase"), null);
  assert.equal(matchExpenseCategory(categories.filter((category) => category.id !== "meals"), "Restaurant", "Dining receipt"), null, "aliases must never create or substitute a missing category");
});

test("document scan remains private, Local/Testing gated, human reviewed and workflow-routed", () => {
  const config = readFileSync("src/lib/expense/document-ai/config.ts", "utf8");
  const route = readFileSync("src/app/api/expenses/document-scans/route.ts", "utf8");
  const service = readFileSync("src/lib/expense/document-ai/service.ts", "utf8");
  const form = readFileSync("src/components/expense-document-autofill-form.tsx", "utf8");
  assert.match(config, /environment === "production"/);
  assert.match(route, /assertSameOrigin/);
  assert.match(route, /requireBusinessUserForModule\("EXPENSE", "CREATE_EXPENSE"\)/);
  assert.match(service, /putQuarantined/);
  assert.match(service, /automaticConfirmation: false/);
  assert.match(service, /businessId.*checksumSha256/);
  assert.match(form, /Create Supplier Bill/);
  assert.match(form, /Open My Claims/);
  assert.match(form, /Review before saving/);
  assert.match(form, /This is a separate expense/);
  assert.match(form, /Additional scan notes/);
  assert.match(form, /reviewSecondaryButton/);
  assert.match(form, /setScan\(null\)/, "manual fallback must dismiss the failed scan so submit is no longer blocked");
  assert.match(form, /retainReceiptForManualEntry\(receiptFile, manualReceiptRef\.current\)/, "manual fallback must retain the selected receipt as an attachment");
  assert.match(form, /Enter details/);
  assert.doesNotMatch(route, /objectKey|signedUrl|publicUrl|output_text/);
});

test("migration creates one-time expiring staging records with tenant foreign keys", () => {
  const migration = readFileSync("prisma/migrations/20260814070000_expense_document_autofill/migration.sql", "utf8");
  assert.match(migration, /expense_document_scans_expiry_check/);
  assert.match(migration, /expense_document_scans_consumed_check/);
  assert.match(migration, /expense_id_business_id_fkey/);
  assert.match(migration, /branch_id_business_id_fkey/);
  assert.match(migration, /checksum_sha256/);
});
