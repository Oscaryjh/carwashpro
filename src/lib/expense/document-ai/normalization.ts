import { expenseDocumentExtractionSchema, type ExpenseDocumentExtraction } from "./schema";

type DateField = "documentDate" | "dueDate" | "paymentDate";
type RawDateField = "rawDocumentDate" | "rawDueDate" | "rawPaymentDate";
type ExtractionRecord = Record<string, unknown>;

const NULLABLE_EXTRACTION_FIELDS = new Set([
  "merchantName", "invoiceNumber", "rawDocumentDate", "documentDate", "rawDueDate", "dueDate",
  "currency", "subtotal", "taxAmount", "totalAmount", "description", "categoryHint",
  "rawPaymentDate", "paymentDate", "paymentReference",
]);

const EMPTY_FIELD_CONFIDENCE: ExpenseDocumentExtraction["fieldConfidence"] = {
  merchantName: null,
  invoiceNumber: null,
  documentDate: null,
  dueDate: null,
  currency: null,
  subtotal: null,
  taxAmount: null,
  totalAmount: null,
  paymentStatus: null,
  paymentDate: null,
};

export function normalizeExpenseDocumentExtraction(input: unknown): ExpenseDocumentExtraction {
  const parsed = parseProviderExtraction(input);
  const warnings = [...parsed.warnings];
  let confidence = parsed.confidence;
  let fieldConfidence = { ...parsed.fieldConfidence };
  let normalized = { ...parsed, currency: parsed.currency?.toUpperCase() ?? null };

  for (const [field, rawField] of [
    ["documentDate", "rawDocumentDate"],
    ["dueDate", "rawDueDate"],
    ["paymentDate", "rawPaymentDate"],
  ] as const satisfies ReadonlyArray<readonly [DateField, RawDateField]>) {
    const result = normalizeMalaysianDate(normalized[rawField], normalized[field]);
    normalized = { ...normalized, [field]: result.value };
    if (result.warning) warnings.push(result.warning);
    if (result.ambiguous) {
      confidence = "LOW";
      fieldConfidence = { ...fieldConfidence, [field]: Math.min(fieldConfidence[field] ?? 1, 0.49) };
    }
  }

  return expenseDocumentExtractionSchema.parse({
    ...normalized,
    confidence,
    fieldConfidence,
    warnings: [...new Set(warnings)].slice(0, 12),
  });
}

function parseProviderExtraction(input: unknown): ExpenseDocumentExtraction {
  if (!isRecord(input)) return expenseDocumentExtractionSchema.parse(input);

  const candidate: ExtractionRecord = {
    documentType: input.documentType,
    confidence: input.confidence,
    merchantName: input.merchantName,
    invoiceNumber: input.invoiceNumber,
    rawDocumentDate: input.rawDocumentDate,
    documentDate: input.documentDate,
    rawDueDate: input.rawDueDate,
    dueDate: input.dueDate,
    currency: normalizeCurrency(input.currency),
    subtotal: input.subtotal,
    taxAmount: input.taxAmount,
    totalAmount: input.totalAmount,
    description: input.description,
    categoryHint: input.categoryHint,
    paymentStatus: input.paymentStatus,
    paymentMethod: input.paymentMethod,
    rawPaymentDate: input.rawPaymentDate,
    paymentDate: input.paymentDate,
    paymentReference: input.paymentReference,
    fieldConfidence: isRecord(input.fieldConfidence) ? { ...input.fieldConfidence } : input.fieldConfidence,
    evidenceSignals: input.evidenceSignals,
    warnings: input.warnings,
  };
  const firstPass = expenseDocumentExtractionSchema.safeParse(candidate);
  if (firstPass.success) return firstPass.data;

  const repairedFields = new Set<string>();
  for (const issue of firstPass.error.issues) {
    const [field, nestedField] = issue.path;
    if (typeof field !== "string") throw firstPass.error;
    if (NULLABLE_EXTRACTION_FIELDS.has(field)) {
      candidate[field] = null;
      repairedFields.add(field);
      continue;
    }
    if (field === "documentType") {
      candidate.documentType = "UNKNOWN";
      repairedFields.add(field);
      continue;
    }
    if (field === "confidence") {
      candidate.confidence = "LOW";
      repairedFields.add(field);
      continue;
    }
    if (field === "paymentStatus") {
      candidate.paymentStatus = "UNKNOWN";
      repairedFields.add(field);
      continue;
    }
    if (field === "paymentMethod") {
      candidate.paymentMethod = "UNKNOWN";
      repairedFields.add(field);
      continue;
    }
    if (field === "fieldConfidence") {
      if (!isRecord(candidate.fieldConfidence)) candidate.fieldConfidence = { ...EMPTY_FIELD_CONFIDENCE };
      else if (typeof nestedField === "string" && nestedField in EMPTY_FIELD_CONFIDENCE) candidate.fieldConfidence[nestedField] = null;
      else candidate.fieldConfidence = { ...EMPTY_FIELD_CONFIDENCE };
      repairedFields.add(typeof nestedField === "string" ? `fieldConfidence.${nestedField}` : field);
      continue;
    }
    if (field === "evidenceSignals" || field === "warnings") {
      candidate[field] = [];
      repairedFields.add(field);
      continue;
    }
    throw firstPass.error;
  }

  candidate.confidence = "LOW";
  const existingWarnings = Array.isArray(candidate.warnings)
    ? candidate.warnings.filter((value): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 240)
    : [];
  const repairedFieldList = [...repairedFields];
  const repairSummary = `${repairedFieldList.slice(0, 8).join(", ")}${repairedFieldList.length > 8 ? ` and ${repairedFieldList.length - 8} more` : ""}`;
  candidate.warnings = [
    ...existingWarnings,
    `Ignored unsupported extracted field${repairedFields.size === 1 ? "" : "s"}: ${repairSummary}. Verify manually.`,
  ].slice(0, 12);
  return expenseDocumentExtractionSchema.parse(candidate);
}

function normalizeCurrency(value: unknown) {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toUpperCase();
  if (["RM", "RINGGIT", "MALAYSIAN RINGGIT"].includes(normalized)) return "MYR";
  return normalized;
}

function isRecord(value: unknown): value is ExtractionRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeMalaysianDate(raw: string | null, iso: string | null): { value: string | null; ambiguous: boolean; warning: string | null } {
  const visible = raw?.trim() ?? "";
  const match = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?=$|[\s,])/.exec(visible);
  if (!match) {
    return iso
      ? { value: iso, ambiguous: false, warning: null }
      : { value: null, ambiguous: false, warning: visible ? `Could not safely normalize visible date “${visible}”. Verify it manually.` : null };
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!isValidDate(year, month, day)) return { value: null, ambiguous: false, warning: `Visible date “${visible}” is invalid. Verify it manually.` };
  const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    value,
    ambiguous: false,
    warning: null,
  };
}

function isValidDate(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
