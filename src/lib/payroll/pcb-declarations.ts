import { z } from "zod";

const RELIEF_LIMITS_CENTS = [
  800_000, 600_000, 700_000, 1_000_000, 250_000, 100_000,
  100_000, 300_000, 800_000, 400_000, 700_000, 300_000,
  400_000, 35_000, 250_000, 700_000, 100_000,
] as const;

const RELIEF_LABELS = [
  "Parents / grandparents medical care",
  "Basic support equipment",
  "Education fees",
  "Medical and special-needs expenses",
  "Lifestyle expenses",
  "Sports expenses",
  "Breastfeeding equipment",
  "Childcare fees",
  "SSPN net savings",
  "Alimony to former wife",
  "Life insurance and EPF",
  "Private retirement / deferred annuity",
  "Education and medical insurance",
  "SOCSO contribution",
  "Eligible green / security equipment",
  "First-home loan interest",
  "Domestic tourism and cultural arts",
] as const;

export type Pcb2026Tp1Category =
  | "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7" | "C8" | "C9"
  | "C10" | "C11" | "C12" | "C13" | "C14" | "C15" | "C16" | "C17" | "D1";

export type Pcb2026Tp3Category =
  | "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7" | "D8" | "D9"
  | "D10" | "D11" | "D12" | "D13" | "D14" | "D15" | "D16" | "D17";

export const PCB_2026_TP1_LIMITS_CENTS = Object.fromEntries([
  ...RELIEF_LIMITS_CENTS.map((limit, index) => [`C${index + 1}`, limit]),
  ["D1", 999_999_999_999],
]) as Record<Pcb2026Tp1Category, number>;

export const PCB_2026_TP1_LABELS = Object.fromEntries([
  ...RELIEF_LABELS.map((label, index) => [`C${index + 1}`, label]),
  ["D1", "Zakat paid"],
]) as Record<Pcb2026Tp1Category, string>;

export const PCB_2026_TP3_LIMITS_CENTS = Object.fromEntries(
  RELIEF_LIMITS_CENTS.map((limit, index) => [`D${index + 1}`, limit]),
) as Record<Pcb2026Tp3Category, number>;

export const PCB_2026_TP3_LABELS = Object.fromEntries(
  RELIEF_LABELS.map((label, index) => [`D${index + 1}`, label]),
) as Record<Pcb2026Tp3Category, string>;

export const PCB_2026_TP1_CATEGORIES = Object.freeze(
  Object.entries(PCB_2026_TP1_LIMITS_CENTS).map(([code, limitCents]) => ({
    code: code as Pcb2026Tp1Category,
    label: PCB_2026_TP1_LABELS[code as Pcb2026Tp1Category],
    limitCents,
  })),
);

export const PCB_2026_TP3_CATEGORIES = Object.freeze(
  Object.entries(PCB_2026_TP3_LIMITS_CENTS).map(([code, limitCents]) => ({
    code: code as Pcb2026Tp3Category,
    label: PCB_2026_TP3_LABELS[code as Pcb2026Tp3Category],
    limitCents,
  })),
);

const tp1CategoryCode = z.enum([
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9",
  "C10", "C11", "C12", "C13", "C14", "C15", "C16", "C17", "D1",
]);
const tp3CategoryCode = z.enum([
  "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9",
  "D10", "D11", "D12", "D13", "D14", "D15", "D16", "D17",
]);

function entrySchema<T extends z.ZodTypeAny>(
  categoryCode: T,
  sourceForm: "HASIL_TP1_1_2026_BM" | "HASIL_TP3_1_2026_BM",
  officialLimits: Record<string, number>,
) {
  return z.object({
    taxYear: z.literal(2026),
    categoryCode,
    amountCents: z.number().int().min(0).max(999_999_999_999),
    categoryLimitCents: z.number().int().min(0).max(999_999_999_999),
    sourceForm: z.literal(sourceForm),
    sourceReference: z.string().trim().min(3).max(240),
    declarationStatus: z.literal("CONFIRMED"),
    reviewStatus: z.literal("REVIEWED"),
    revision: z.number().int().min(1),
  }).superRefine((entry, context) => {
    const code = String(entry.categoryCode);
    const officialLimit = officialLimits[code];
    if (entry.categoryLimitCents !== officialLimit) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The declaration category limit does not match the retained YA 2026 form.",
        path: ["categoryLimitCents"],
      });
    }
    if (!(sourceForm === "HASIL_TP1_1_2026_BM" && code === "D1") && entry.amountCents > officialLimit) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${code} exceeds the retained YA 2026 category limit.`,
        path: ["amountCents"],
      });
    }
  });
}

function uniqueEntries<T extends z.ZodTypeAny>(schema: T, maximum: number) {
  return z.array(schema).max(maximum).superRefine((entries, context) => {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      const code = String((entry as { categoryCode: string }).categoryCode);
      if (seen.has(code)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate declaration category ${code}.`,
          path: [index, "categoryCode"],
        });
      }
      seen.add(code);
    });
  });
}

export const pcbTp1DeclarationEntrySchema = entrySchema(
  tp1CategoryCode,
  "HASIL_TP1_1_2026_BM",
  PCB_2026_TP1_LIMITS_CENTS,
);
export const pcbTp3DeclarationEntrySchema = entrySchema(
  tp3CategoryCode,
  "HASIL_TP3_1_2026_BM",
  PCB_2026_TP3_LIMITS_CENTS,
);
export const pcbTp1DeclarationEntriesSchema = uniqueEntries(pcbTp1DeclarationEntrySchema, 18);
export const pcbTp3DeclarationEntriesSchema = uniqueEntries(pcbTp3DeclarationEntrySchema, 17);

export function sumPcbTp1Deductions(
  entries: readonly z.infer<typeof pcbTp1DeclarationEntrySchema>[],
) {
  return entries.reduce(
    (total, entry) => total + (entry.categoryCode === "D1" ? 0 : entry.amountCents),
    0,
  );
}

export function sumPcbTp1Zakat(
  entries: readonly z.infer<typeof pcbTp1DeclarationEntrySchema>[],
) {
  return entries.reduce(
    (total, entry) => total + (entry.categoryCode === "D1" ? entry.amountCents : 0),
    0,
  );
}

export function sumPcbTp3Deductions(
  entries: readonly z.infer<typeof pcbTp3DeclarationEntrySchema>[],
) {
  return entries.reduce((total, entry) => total + entry.amountCents, 0);
}
