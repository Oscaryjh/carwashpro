import { Prisma, type PrismaClient } from "@prisma/client";
import { validateClaimAttachment } from "@/lib/claim/attachment-policy";
import { getClaimPrivateAttachmentStore, type ClaimPrivateAttachmentStore } from "@/lib/claim/private-attachment-storage";
import { writeAuditLog, type AuditRequestContext } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import type { ExpenseActor } from "@/lib/expense/service";
import { getExpenseDocumentAiConfiguration } from "./config";
import { createExpenseDocumentProvider, type ExpenseDocumentProvider } from "./provider";
import { normalizeExpenseDocumentExtraction } from "./normalization";
import { EXPENSE_DOCUMENT_EXTRACTION_VERSION, type ExpenseDocumentExtraction } from "./schema";

export type ExpenseDuplicateCandidate = Readonly<{
  recordType: "EXPENSE" | "SUPPLIER_BILL" | "CLAIM";
  recordId: string;
  label: string;
  payee: string | null;
  date: string | null;
  amount: string | null;
  status: string;
  href: string;
  reason: "SAME_FILE" | "MATCHING_FACTS";
}>;

export type ExpenseDocumentScanDto = Readonly<{
  id: string;
  expiresAt: string;
  documentType: "EXPENSE_RECEIPT" | "SUPPLIER_INVOICE" | "CLAIM_RECEIPT" | "UNKNOWN";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  rawDocumentDate: string | null;
  fieldConfidence: {
    merchantName: number | null;
    documentDate: number | null;
    totalAmount: number | null;
    paymentStatus: number | null;
    paymentDate: number | null;
  };
  suggested: {
    expenseDate: string | null;
    payeeName: string | null;
    amount: string | null;
    description: string | null;
    categoryId: string | null;
    categoryName: string | null;
    categoryConfidence: "HIGH" | "MEDIUM" | null;
    paymentStatus: "PAID" | "UNPAID";
    paymentMethod: "CASH" | "BANK_TRANSFER" | "CARD" | "EWALLET" | "OTHER" | null;
    paymentDate: string | null;
    paymentReference: string | null;
    invoiceNumber: string | null;
  };
  warnings: string[];
  duplicateCandidates: ExpenseDuplicateCandidate[];
}>;

export class ExpenseDocumentScanError extends Error {
  constructor(message: string, readonly code = "EXPENSE_DOCUMENT_SCAN_INVALID") {
    super(message);
    this.name = "ExpenseDocumentScanError";
  }
}

export async function createExpenseDocumentScan(input: {
  actor: ExpenseActor;
  businessId: string;
  branchId?: string | null;
  file: { bytes: Uint8Array; claimedMimeType: string; originalFileName: string };
  request?: AuditRequestContext;
}, database: PrismaClient = prisma, store: ClaimPrivateAttachmentStore = getClaimPrivateAttachmentStore(), provider: ExpenseDocumentProvider = createExpenseDocumentProvider()) {
  const config = getExpenseDocumentAiConfiguration();
  if (!config.enabled || config.environment === "production") throw new ExpenseDocumentScanError("Receipt autofill is available only in enabled Local or Testing environments.", "EXPENSE_DOCUMENT_AI_DISABLED");

  const recentCount = await database.expenseDocumentScan.count({ where: { businessId: input.businessId, createdById: input.actor.userId, createdAt: { gte: new Date(Date.now() - 60_000) } } });
  if (recentCount >= 5) throw new ExpenseDocumentScanError("Too many receipt scans. Please wait one minute and try again.", "EXPENSE_DOCUMENT_SCAN_RATE_LIMITED");
  if (input.branchId) {
    const branch = await database.branch.findFirst({ where: { id: input.branchId, businessId: input.businessId, status: "ACTIVE" }, select: { id: true } });
    if (!branch) throw new ExpenseDocumentScanError("The selected branch is outside this business.", "EXPENSE_DOCUMENT_BRANCH_INVALID");
  }

  const validated = validateClaimAttachment({ bytes: input.file.bytes, claimedMimeType: input.file.claimedMimeType, originalFileName: input.file.originalFileName });
  const stored = await store.putQuarantined(validated);
  try {
    let providerResult: Awaited<ReturnType<ExpenseDocumentProvider["extract"]>>;
    const warnings: string[] = [];
    try {
      providerResult = await provider.extract({ bytes: validated.bytes, mimeType: validated.detectedMimeType, fileName: validated.sanitizedFileName });
    } catch {
      providerResult = {
        extraction: emptyExtraction(),
        provider: config.provider,
        model: config.model,
        providerRequestId: null,
      };
      warnings.push("The document could not be read automatically. Continue with manual entry.");
    }
    const extraction = applyExpenseDocumentSafetyRules(normalizeExpenseDocumentExtraction(providerResult.extraction));
    warnings.push(...buildWarnings(extraction));
    const [category, duplicateCandidates] = await Promise.all([
      suggestCategory(database, input.businessId, extraction.categoryHint, extraction.description),
      findDuplicateCandidates(database, input.businessId, validated.checksumSha256, extraction),
    ]);
    if (duplicateCandidates.length > 0) warnings.push("Possible duplicate found. Review the existing record before continuing.");
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    const scan = await database.$transaction(async (tx) => {
      const created = await tx.expenseDocumentScan.create({
        data: {
          businessId: input.businessId,
          branchId: input.branchId ?? null,
          createdById: input.actor.userId,
          objectKey: stored.objectKey,
          sanitizedFileName: stored.sanitizedFileName,
          mimeType: stored.mimeType,
          byteLength: stored.byteLength,
          checksumSha256: stored.checksumSha256,
          malwareStatus: validated.malwareStatus,
          privacyMetadataStatus: validated.privacyMetadataStatus,
          quarantineDisposition: stored.disposition,
          documentType: extraction.documentType,
          confidence: extraction.confidence,
          extraction: extraction as unknown as Prisma.InputJsonValue,
          warnings,
          duplicateCandidates: duplicateCandidates as unknown as Prisma.InputJsonValue,
          provider: providerResult.provider,
          providerModel: providerResult.model,
          providerRequestId: providerResult.providerRequestId,
          extractionVersion: EXPENSE_DOCUMENT_EXTRACTION_VERSION,
          expiresAt,
        },
      });
      await writeAuditLog({
        businessId: input.businessId,
        branchId: input.branchId ?? null,
        actor: input.actor,
        action: "EXPENSE_DOCUMENT_SCANNED",
        entityType: "ExpenseDocumentScan",
        entityId: created.id,
        summary: "Private expense document scanned for human-reviewed draft autofill.",
        after: { confidence: extraction.confidence, documentType: extraction.documentType, duplicateCount: duplicateCandidates.length, provider: providerResult.provider },
        metadata: { automaticConfirmation: false, extractionVersion: EXPENSE_DOCUMENT_EXTRACTION_VERSION },
        request: input.request,
      }, tx);
      return created;
    });
    return toDto(scan.id, expiresAt, extraction, category, warnings, duplicateCandidates);
  } catch (error) {
    await store.deleteQuarantined(stored.objectKey).catch(() => undefined);
    throw error;
  }
}

export function applyExpenseDocumentSafetyRules(value: ExpenseDocumentExtraction): ExpenseDocumentExtraction {
  const signals = value.evidenceSignals.join(" ").toLowerCase();
  const supplierEvidence = Boolean(value.dueDate) || /balance due|amount due|payment terms|outstanding|supplier invoice|tax invoice/.test(signals);
  const documentType = supplierEvidence ? "SUPPLIER_INVOICE" : value.documentType;
  const inferredPaymentMethod = inferPaymentMethod(signals);
  const unsupportedCashInference = value.paymentMethod === "CASH" && !hasExplicitCashPaymentEvidence(signals);
  const paymentMethod = inferredPaymentMethod !== "UNKNOWN"
    ? inferredPaymentMethod
    : unsupportedCashInference ? "UNKNOWN" : value.paymentMethod;
  const explicitPaidEvidence = /\b(?:paid|payment received|cash received|card approved|approved card|payment successful|payment completed|settled)\b/.test(signals);
  const explicitUnpaidEvidence = /\bunpaid\b|not paid|payment pending|balance outstanding/.test(signals);
  const zeroBalanceEvidence = /\b(?:balance|amount due|outstanding)\s*(?::|-)?\s*(?:rm|myr)?\s*0(?:\.00)?\b/.test(signals);
  const settledReceiptEvidence = documentType === "EXPENSE_RECEIPT" && zeroBalanceEvidence && paymentMethod !== "UNKNOWN";
  const paidEvidence = !explicitUnpaidEvidence && (explicitPaidEvidence || settledReceiptEvidence);
  const paymentStatus = documentType === "SUPPLIER_INVOICE" ? "UNPAID" : paidEvidence ? "PAID" : "UNPAID";
  return { ...value, documentType, paymentStatus, paymentMethod: paymentStatus === "PAID" ? paymentMethod : "UNKNOWN", paymentDate: paymentStatus === "PAID" ? value.paymentDate : null };
}

function inferPaymentMethod(signals: string): ExpenseDocumentExtraction["paymentMethod"] {
  if (/\b(?:maybank|merchant|bank|duit\s*now)\s*(?:type\s*)?qr\b|\bqr\s*(?:payment|transfer)\b/.test(signals)) return "BANK_TRANSFER";
  if (/\b(?:duit\s*now|e-?wallet|touch\s*n\s*go|tng|grabpay|boost|shopeepay)\b/.test(signals)) return "EWALLET";
  if (/\b(?:bank transfer|online transfer|fpx)\b/.test(signals)) return "BANK_TRANSFER";
  if (/\b(?:credit card|debit card|visa|mastercard|card approved|approved card|card rm)\b/.test(signals)) return "CARD";
  if (hasExplicitCashPaymentEvidence(signals)) return "CASH";
  return "UNKNOWN";
}

function hasExplicitCashPaymentEvidence(signals: string) {
  return /\b(?:paid in cash|cash received|cash tendered|tender\s*:\s*cash|payment method\s*:\s*cash)\b/.test(signals);
}

function buildWarnings(value: ExpenseDocumentExtraction) {
  const warnings: string[] = [...value.warnings];
  if (value.documentType === "SUPPLIER_INVOICE") warnings.push("This looks like a Supplier Invoice. Create a Supplier Bill instead of a manual expense.");
  if (value.documentType === "CLAIM_RECEIPT") warnings.push("This looks like an employee Claim receipt. Submit it through My Claims instead of manual expenses.");
  if (value.documentType === "UNKNOWN" || value.confidence === "LOW") warnings.push("Low-confidence extraction. Verify every field before saving.");
  if (!value.totalAmount) warnings.push("Total amount was not confidently detected.");
  if (!value.documentDate) warnings.push("Document date was not confidently detected.");
  return [...new Set(warnings)];
}

function emptyExtraction(): ExpenseDocumentExtraction {
  return {
    documentType: "UNKNOWN", confidence: "LOW", merchantName: null, invoiceNumber: null,
    rawDocumentDate: null, documentDate: null, rawDueDate: null, dueDate: null, currency: null,
    subtotal: null, taxAmount: null, totalAmount: null, description: null, categoryHint: null,
    paymentStatus: "UNKNOWN", paymentMethod: "UNKNOWN", rawPaymentDate: null, paymentDate: null,
    paymentReference: null,
    fieldConfidence: { merchantName: null, invoiceNumber: null, documentDate: null, dueDate: null, currency: null, subtotal: null, taxAmount: null, totalAmount: null, paymentStatus: null, paymentDate: null },
    evidenceSignals: [], warnings: [],
  };
}

async function suggestCategory(database: PrismaClient, businessId: string, categoryHint: string | null, description: string | null) {
  const categories = await database.expenseCategory.findMany({ where: { businessId, active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } });
  return matchExpenseCategory(categories, categoryHint, description);
}

type ExpenseCategoryCandidate = Readonly<{ id: string; name: string }>;
type ExpenseCategoryMatch = ExpenseCategoryCandidate & Readonly<{ matchConfidence: "HIGH" | "MEDIUM" }>;

const EXPENSE_CATEGORY_SEMANTIC_ALIASES = [
  { names: ["meals and entertainment", "meal and entertainment", "food and beverage"], aliases: ["food and beverage", "restaurant", "dining", "meal", "cafe", "coffee shop", "catering", "breakfast", "lunch", "dinner"] },
  { names: ["utilities", "utility"], aliases: ["electricity", "electric bill", "power bill", "water bill", "internet bill", "broadband", "telephone bill", "utility bill"] },
  { names: ["transport", "transportation", "travel"], aliases: ["taxi", "grab ride", "fuel", "petrol", "diesel", "parking", "toll", "public transport"] },
  { names: ["technology and software", "software and technology", "technology", "software"], aliases: ["software", "saas", "cloud hosting", "web hosting", "domain renewal", "software subscription"] },
  { names: ["office supplies", "office supply", "stationery"], aliases: ["stationery", "office supplies", "printer ink", "printer toner", "printing paper"] },
  { names: ["repairs and maintenance", "repair and maintenance", "maintenance"], aliases: ["repair", "maintenance", "equipment servicing", "premise servicing"] },
  { names: ["marketing", "advertising and marketing"], aliases: ["advertising", "advertisement", "digital ads", "social media ads", "promotion", "marketing"] },
  { names: ["professional fees", "professional services"], aliases: ["legal fee", "accounting fee", "audit fee", "consultancy fee", "professional fee"] },
  { names: ["bank fees", "bank charges"], aliases: ["bank fee", "bank charge", "transaction fee", "merchant fee"] },
  { names: ["insurance"], aliases: ["insurance", "insurance premium"] },
  { names: ["training"], aliases: ["training", "course fee", "workshop", "seminar"] },
  { names: ["rental", "rent"], aliases: ["property rent", "premise rent", "office rent", "shop rent", "lease payment", "tenancy"] },
  { names: ["staff welfare", "employee welfare"], aliases: ["staff welfare", "employee welfare", "team meal", "staff event"] },
  { names: ["inventory purchases", "inventory purchase", "stock purchases"], aliases: ["inventory purchase", "stock purchase", "goods for resale", "products for resale"] },
] as const;

export function matchExpenseCategory(categories: readonly ExpenseCategoryCandidate[], categoryHint: string | null, description: string | null): ExpenseCategoryMatch | null {
  const hint = normalizeCategoryText(categoryHint);
  const detail = normalizeCategoryText(description);
  if (!hint && !detail) return null;

  const directMatches = categories.filter((category) => {
    const name = normalizeCategoryText(category.name);
    return Boolean(name) && (containsCategoryPhrase(hint, name) || containsCategoryPhrase(detail, name));
  });
  if (directMatches.length === 1) return { ...directMatches[0], matchConfidence: "HIGH" };
  if (directMatches.length > 1) return null;

  const scored = categories.map((category) => {
    const normalizedName = normalizeCategoryText(category.name);
    const profile = EXPENSE_CATEGORY_SEMANTIC_ALIASES.find(({ names }) => names.some((name) => name === normalizedName));
    if (!profile) return { category, score: 0 };
    const hintMatches = profile.aliases.filter((alias) => containsCategoryPhrase(hint, alias)).length;
    const detailMatches = profile.aliases.filter((alias) => containsCategoryPhrase(detail, alias)).length;
    return { category, score: hintMatches * 100 + detailMatches * 40 };
  }).filter(({ score }) => score > 0).sort((left, right) => right.score - left.score);

  if (!scored.length || (scored[1] && scored[0].score === scored[1].score)) return null;
  return { ...scored[0].category, matchConfidence: "MEDIUM" };
}

function normalizeCategoryText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function containsCategoryPhrase(text: string, phrase: string) {
  return Boolean(text && phrase) && ` ${text} `.includes(` ${normalizeCategoryText(phrase)} `);
}

async function findDuplicateCandidates(database: PrismaClient, businessId: string, checksumSha256: string, extraction: ExpenseDocumentExtraction): Promise<ExpenseDuplicateCandidate[]> {
  const [expenseFiles, supplierFiles, claimFiles] = await Promise.all([
    database.businessExpenseAttachment.findMany({ where: { businessId, checksumSha256 }, take: 4, include: { expense: { select: { id: true, expenseNumber: true, expenseDate: true, amount: true, payeeName: true, status: true } } } }),
    database.supplierBillAttachment.findMany({ where: { businessId, checksumSha256 }, take: 4, include: { supplierBill: { select: { id: true, billNumber: true, invoiceDate: true, totalAmount: true, status: true, supplier: { select: { name: true } } } } } }),
    database.claimAttachment.findMany({ where: { businessId, checksumSha256 }, take: 4, include: { claim: { select: { id: true, claimNumber: true, createdAt: true, submittedTotal: true, status: true, lines: { take: 1, select: { merchant: true } } } } } }),
  ]);
  const candidates: ExpenseDuplicateCandidate[] = [
    ...expenseFiles.map(({ expense }) => candidate("EXPENSE", expense.id, expense.expenseNumber, expense.payeeName, expense.expenseDate, expense.amount.toFixed(2), expense.status, `/expenses/${expense.id}`, "SAME_FILE")),
    ...supplierFiles.map(({ supplierBill }) => candidate("SUPPLIER_BILL", supplierBill.id, supplierBill.billNumber, supplierBill.supplier.name, supplierBill.invoiceDate, supplierBill.totalAmount.toFixed(2), supplierBill.status, `/inventory/supplier-bills/${supplierBill.id}`, "SAME_FILE")),
    ...claimFiles.map(({ claim }) => candidate("CLAIM", claim.id, claim.claimNumber, claim.lines[0]?.merchant ?? null, claim.createdAt, claim.submittedTotal.toFixed(2), claim.status, "/team/claims", "SAME_FILE")),
  ];
  if (extraction.totalAmount && extraction.documentDate && candidates.length < 10) {
    const from = new Date(`${extraction.documentDate}T00:00:00.000Z`);
    const to = new Date(from); to.setUTCDate(to.getUTCDate() + 1);
    const matching = await database.businessExpense.findMany({
      where: { businessId, expenseDate: { gte: from, lt: to }, amount: new Prisma.Decimal(extraction.totalAmount), ...(extraction.merchantName ? { payeeName: { equals: extraction.merchantName, mode: "insensitive" } } : {}) },
      take: 4, select: { id: true, expenseNumber: true, expenseDate: true, amount: true, status: true },
    });
    for (const expense of matching) if (!candidates.some((item) => item.recordId === expense.id)) candidates.push(candidate("EXPENSE", expense.id, expense.expenseNumber, extraction.merchantName, expense.expenseDate, expense.amount.toFixed(2), expense.status, `/expenses/${expense.id}`, "MATCHING_FACTS"));
  }
  if (extraction.invoiceNumber && candidates.length < 10) {
    const bills = await database.supplierBill.findMany({ where: { businessId, supplierInvoiceNumber: { equals: extraction.invoiceNumber, mode: "insensitive" } }, take: 4, select: { id: true, billNumber: true, invoiceDate: true, totalAmount: true, status: true, supplier: { select: { name: true } } } });
    for (const bill of bills) if (!candidates.some((item) => item.recordId === bill.id)) candidates.push(candidate("SUPPLIER_BILL", bill.id, bill.billNumber, bill.supplier.name, bill.invoiceDate, bill.totalAmount.toFixed(2), bill.status, `/inventory/supplier-bills/${bill.id}`, "MATCHING_FACTS"));
  }
  return candidates.slice(0, 10);
}

function candidate(recordType: ExpenseDuplicateCandidate["recordType"], recordId: string, label: string, payee: string | null, date: Date | null, amount: string | null, status: string, href: string, reason: ExpenseDuplicateCandidate["reason"]): ExpenseDuplicateCandidate {
  return { recordType, recordId, label, payee, date: date ? date.toISOString().slice(0, 10) : null, amount, status, href, reason };
}

function toDto(id: string, expiresAt: Date, extraction: ExpenseDocumentExtraction, category: ExpenseCategoryMatch | null, warnings: string[], duplicateCandidates: ExpenseDuplicateCandidate[]): ExpenseDocumentScanDto {
  return {
    id, expiresAt: expiresAt.toISOString(), documentType: extraction.documentType, confidence: extraction.confidence,
    rawDocumentDate: extraction.rawDocumentDate,
    fieldConfidence: {
      merchantName: extraction.fieldConfidence.merchantName,
      documentDate: extraction.fieldConfidence.documentDate,
      totalAmount: extraction.fieldConfidence.totalAmount,
      paymentStatus: extraction.fieldConfidence.paymentStatus,
      paymentDate: extraction.fieldConfidence.paymentDate,
    },
    suggested: {
      expenseDate: extraction.documentDate,
      payeeName: extraction.merchantName,
      amount: extraction.totalAmount,
      description: extraction.description,
      categoryId: category?.id ?? null,
      categoryName: category?.name ?? null,
      categoryConfidence: category?.matchConfidence ?? null,
      paymentStatus: extraction.paymentStatus === "PAID" ? "PAID" : "UNPAID",
      paymentMethod: extraction.paymentStatus === "PAID" && extraction.paymentMethod !== "UNKNOWN" ? extraction.paymentMethod : null,
      paymentDate: extraction.paymentStatus === "PAID" ? extraction.paymentDate ?? extraction.documentDate : null,
      paymentReference: extraction.paymentReference,
      invoiceNumber: extraction.invoiceNumber,
    },
    warnings, duplicateCandidates,
  };
}
