import { z } from "zod";

export const EXPENSE_DOCUMENT_EXTRACTION_VERSION = "expense-document-v2";

const decimalMoneySchema = z.string().regex(/^(0|[1-9]\d{0,9})\.\d{2}$/).refine((value) => BigInt(value.replace(".", "")) <= 999_999_999_999n, "Amount is outside the supported range");
const confidenceValueSchema = z.number().min(0).max(1).nullable();

export const expenseDocumentFieldConfidenceSchema = z.object({
  merchantName: confidenceValueSchema,
  invoiceNumber: confidenceValueSchema,
  documentDate: confidenceValueSchema,
  dueDate: confidenceValueSchema,
  currency: confidenceValueSchema,
  subtotal: confidenceValueSchema,
  taxAmount: confidenceValueSchema,
  totalAmount: confidenceValueSchema,
  paymentStatus: confidenceValueSchema,
  paymentDate: confidenceValueSchema,
});

export const expenseDocumentExtractionSchema = z.object({
  documentType: z.enum(["EXPENSE_RECEIPT", "SUPPLIER_INVOICE", "CLAIM_RECEIPT", "UNKNOWN"]),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  merchantName: z.string().trim().max(160).nullable(),
  invoiceNumber: z.string().trim().max(120).nullable(),
  rawDocumentDate: z.string().trim().max(80).nullable(),
  documentDate: z.string().date().nullable(),
  rawDueDate: z.string().trim().max(80).nullable(),
  dueDate: z.string().date().nullable(),
  currency: z.string().trim().length(3).nullable(),
  subtotal: decimalMoneySchema.nullable(),
  taxAmount: decimalMoneySchema.nullable(),
  totalAmount: decimalMoneySchema.refine((value) => value !== "0.00", "Total must be positive").nullable(),
  description: z.string().trim().max(500).nullable(),
  categoryHint: z.string().trim().max(120).nullable(),
  paymentStatus: z.enum(["PAID", "UNPAID", "UNKNOWN"]),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CARD", "EWALLET", "OTHER", "UNKNOWN"]),
  rawPaymentDate: z.string().trim().max(80).nullable(),
  paymentDate: z.string().date().nullable(),
  paymentReference: z.string().trim().max(160).nullable(),
  fieldConfidence: expenseDocumentFieldConfidenceSchema,
  evidenceSignals: z.array(z.string().trim().min(1).max(80)).max(12),
  warnings: z.array(z.string().trim().min(1).max(240)).max(12),
});

export type ExpenseDocumentExtraction = z.infer<typeof expenseDocumentExtractionSchema>;

const nullableString = { type: ["string", "null"] } as const;
const nullableConfidence = { type: ["number", "null"], minimum: 0, maximum: 1 } as const;
const money = { type: ["string", "null"], pattern: "^(0|[1-9]\\d{0,9})\\.\\d{2}$" } as const;
const nullableCurrency = { type: ["string", "null"], minLength: 3, maxLength: 3, pattern: "^[A-Z]{3}$" } as const;

export const EXPENSE_DOCUMENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "documentType", "confidence", "merchantName", "invoiceNumber", "rawDocumentDate", "documentDate",
    "rawDueDate", "dueDate", "currency", "subtotal", "taxAmount", "totalAmount", "description", "categoryHint",
    "paymentStatus", "paymentMethod", "rawPaymentDate", "paymentDate", "paymentReference", "fieldConfidence",
    "evidenceSignals", "warnings",
  ],
  properties: {
    documentType: { type: "string", enum: ["EXPENSE_RECEIPT", "SUPPLIER_INVOICE", "CLAIM_RECEIPT", "UNKNOWN"] },
    confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
    merchantName: nullableString,
    invoiceNumber: nullableString,
    rawDocumentDate: nullableString,
    documentDate: nullableString,
    rawDueDate: nullableString,
    dueDate: nullableString,
    currency: nullableCurrency,
    subtotal: money,
    taxAmount: money,
    totalAmount: money,
    description: nullableString,
    categoryHint: nullableString,
    paymentStatus: { type: "string", enum: ["PAID", "UNPAID", "UNKNOWN"] },
    paymentMethod: { type: "string", enum: ["CASH", "BANK_TRANSFER", "CARD", "EWALLET", "OTHER", "UNKNOWN"] },
    rawPaymentDate: nullableString,
    paymentDate: nullableString,
    paymentReference: nullableString,
    fieldConfidence: {
      type: "object",
      additionalProperties: false,
      required: ["merchantName", "invoiceNumber", "documentDate", "dueDate", "currency", "subtotal", "taxAmount", "totalAmount", "paymentStatus", "paymentDate"],
      properties: {
        merchantName: nullableConfidence,
        invoiceNumber: nullableConfidence,
        documentDate: nullableConfidence,
        dueDate: nullableConfidence,
        currency: nullableConfidence,
        subtotal: nullableConfidence,
        taxAmount: nullableConfidence,
        totalAmount: nullableConfidence,
        paymentStatus: nullableConfidence,
        paymentDate: nullableConfidence,
      },
    },
    evidenceSignals: { type: "array", maxItems: 12, items: { type: "string", maxLength: 80 } },
    warnings: { type: "array", maxItems: 12, items: { type: "string", maxLength: 240 } },
  },
} as const;
