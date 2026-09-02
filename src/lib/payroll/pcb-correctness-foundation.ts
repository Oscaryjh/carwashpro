import { z } from "zod";

const cents = z.number().int().min(0).max(999_999_999_999);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const reference = z.string().trim().min(3).max(500);

export const pcbTaxRegimeSchema = z.enum([
  "RESIDENT_STANDARD",
  "NON_RESIDENT",
  "RETURNING_EXPERT_PROGRAM",
  "KNOWLEDGE_WORKER",
  "C_SUITE_NON_CITIZEN",
]);

export const pcbTaxRegimePeriodSchema = z.object({
  taxYear: z.literal(2026),
  regime: pcbTaxRegimeSchema,
  effectiveFrom: dateOnly,
  effectiveTo: dateOnly.nullable(),
  approvalStatus: z.enum(["NOT_REQUIRED", "CONFIRMED"]),
  officialSourceReference: reference,
  evidenceReference: reference.nullable(),
  approvalReference: reference.nullable(),
  approvedCompany: z.string().trim().min(2).max(240).nullable(),
  approvedActivity: z.string().trim().min(2).max(240).nullable(),
  approvedPosition: z.string().trim().min(2).max(240).nullable(),
  reviewedByUserId: z.string().trim().min(1).max(128).nullable(),
  confirmedAt: z.string().datetime({ offset: true }),
  revision: z.number().int().min(1),
}).superRefine((period, context) => {
  if (period.effectiveTo && period.effectiveFrom > period.effectiveTo) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "The tax-treatment end date must not precede its start date.",
      path: ["effectiveTo"],
    });
  }
  if (!period.effectiveFrom.startsWith(`${period.taxYear}-`) ||
      (period.effectiveTo && !period.effectiveTo.startsWith(`${period.taxYear}-`))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "The effective period must stay within the PCB tax year.",
      path: ["effectiveFrom"],
    });
  }
  const special = period.regime === "RETURNING_EXPERT_PROGRAM" ||
    period.regime === "KNOWLEDGE_WORKER" ||
    period.regime === "C_SUITE_NON_CITIZEN";
  if (special && period.approvalStatus !== "CONFIRMED") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Special tax treatment requires confirmed approval evidence.",
      path: ["approvalStatus"],
    });
  }
  if (special && (!period.approvalReference || !period.evidenceReference)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Add the special-regime approval and evidence references.",
      path: ["approvalReference"],
    });
  }
});

export const pcbTaxRegimeTimelineSchema = z.array(pcbTaxRegimePeriodSchema)
  .min(1)
  .max(24)
  .superRefine((periods, context) => {
    const ordered = periods
      .map((period, index) => ({ period, index }))
      .sort((left, right) => left.period.effectiveFrom.localeCompare(right.period.effectiveFrom));
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1].period;
      const current = ordered[index].period;
      if (!previous.effectiveTo || current.effectiveFrom <= previous.effectiveTo) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Tax-treatment effective periods must not overlap.",
          path: [ordered[index].index, "effectiveFrom"],
        });
      }
    }
  });

export const pcbTp3ExemptIncomeItemSchema = z.object({
  taxYear: z.literal(2026),
  category: z.enum([
    "EXEMPT_ALLOWANCE",
    "EXEMPT_PERQUISITE",
    "EXEMPT_BENEFIT_IN_KIND",
    "OTHER_EXEMPT_INCOME",
  ]),
  description: z.string().trim().min(3).max(240),
  amountCents: cents,
  sourceReference: reference,
  reviewStatus: z.literal("REVIEWED"),
  revision: z.number().int().min(1),
});

export const pcbPreviousEmploymentPeriodSchema = z.object({
  taxYear: z.literal(2026),
  employmentStart: dateOnly,
  employmentEnd: dateOnly,
  employerReference: z.string().trim().min(2).max(240).nullable(),
  sourceReference: reference,
  reviewStatus: z.literal("REVIEWED"),
  revision: z.number().int().min(1),
}).superRefine((period, context) => {
  if (period.employmentStart > period.employmentEnd) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Previous employment end must not precede its start.",
      path: ["employmentEnd"],
    });
  }
  if (!period.employmentStart.startsWith(`${period.taxYear}-`) ||
      !period.employmentEnd.startsWith(`${period.taxYear}-`)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Previous employment must be within the TP3 tax year.",
      path: ["employmentStart"],
    });
  }
});

export const pcbPreviousEmploymentPeriodsSchema = z.array(pcbPreviousEmploymentPeriodSchema)
  .max(12)
  .superRefine((periods, context) => {
    const ordered = periods
      .map((period, index) => ({ period, index }))
      .sort((left, right) => left.period.employmentStart.localeCompare(right.period.employmentStart));
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index].period.employmentStart <= ordered[index - 1].period.employmentEnd) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Previous-employment periods must not overlap.",
          path: [ordered[index].index, "employmentStart"],
        });
      }
    }
  });

export const pcbNonCashRemunerationFactSchema = z.object({
  id: z.string().trim().min(1).max(128),
  taxYear: z.literal(2026),
  kind: z.enum([
    "BIK",
    "VOLA",
    "EXEMPT_ALLOWANCE",
    "EXEMPT_PERQUISITE",
    "EXEMPT_BENEFIT",
  ]),
  inputBasis: z.enum(["MONTHLY_VALUE", "ANNUAL_VALUE"]),
  valueCents: cents,
  effectiveFrom: dateOnly,
  effectiveTo: dateOnly.nullable(),
  officialSourceReference: reference,
  evidenceReference: reference,
  reviewStatus: z.literal("REVIEWED"),
  revision: z.number().int().min(1),
}).superRefine((fact, context) => {
  if (fact.effectiveTo && fact.effectiveFrom > fact.effectiveTo) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "The remuneration-fact end date must not precede its start.",
      path: ["effectiveTo"],
    });
  }
  if (!fact.effectiveFrom.startsWith(`${fact.taxYear}-`) ||
      (fact.effectiveTo && !fact.effectiveTo.startsWith(`${fact.taxYear}-`))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "The remuneration fact must stay within its tax year.",
      path: ["effectiveFrom"],
    });
  }
});

export const pcbComponentClassificationFactSchema = z.object({
  componentCode: z.string().trim().min(2).max(64),
  sourceType: z.string().trim().min(2).max(64).nullable(),
  nature: z.enum([
    "NORMAL_TAXABLE",
    "ADDITIONAL_TAXABLE",
    "PCB_ONLY_BIK",
    "PCB_ONLY_VOLA",
    "TAX_EXEMPT",
    "EXCLUDED",
    "UNKNOWN",
  ]),
  paymentNature: z.enum([
    "DIRECTOR_FEE",
    "COMMISSION",
    "ALLOWANCE",
    "ARREARS",
    "OTHER",
  ]),
  recurrence: z.enum(["MONTHLY", "IRREGULAR", "QUARTERLY"]).nullable(),
  originalEarningNature: z.string().trim().min(2).max(120).nullable(),
  originalEarningPeriodStart: dateOnly.nullable(),
  originalEarningPeriodEnd: dateOnly.nullable(),
  effectiveFrom: dateOnly,
  effectiveTo: dateOnly.nullable(),
  officialSourceReference: reference,
  evidenceReference: reference,
  reviewStatus: z.enum(["REVIEWED", "NEEDS_EVIDENCE"]),
  revision: z.number().int().min(1),
}).superRefine((fact, context) => {
  if (fact.effectiveTo && fact.effectiveFrom > fact.effectiveTo) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid classification period.", path: ["effectiveTo"] });
  }
  if (fact.paymentNature === "COMMISSION" && !fact.recurrence) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Commission frequency is required.", path: ["recurrence"] });
  }
  if (fact.paymentNature === "DIRECTOR_FEE" && !fact.recurrence) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Director-fee payment timing is required.", path: ["recurrence"] });
  }
  if (fact.paymentNature === "ARREARS" &&
      (!fact.originalEarningNature || !fact.originalEarningPeriodStart || !fact.originalEarningPeriodEnd)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Arrears require the original earning nature and earning period.",
      path: ["originalEarningNature"],
    });
  }
  if (fact.nature === "UNKNOWN" && fact.reviewStatus === "REVIEWED") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "An unresolved classification cannot be marked reviewed.",
      path: ["reviewStatus"],
    });
  }
});

export type PcbTaxRegimePeriod = z.infer<typeof pcbTaxRegimePeriodSchema>;
export type PcbNonCashRemunerationFact = z.infer<typeof pcbNonCashRemunerationFactSchema>;
export type PcbComponentClassificationFact = z.infer<typeof pcbComponentClassificationFactSchema>;

export function resolvePcbTaxRegimeForMonth(
  periods: readonly PcbTaxRegimePeriod[],
  payrollMonth: string,
) {
  const monthStart = `${payrollMonth}-01`;
  const monthEnd = monthEndDate(payrollMonth);
  const matches = periods.filter((period) =>
    period.effectiveFrom <= monthEnd && (!period.effectiveTo || period.effectiveTo >= monthStart));
  if (matches.length > 1) {
    const ordered = [...matches].sort((left, right) =>
      left.effectiveFrom.localeCompare(right.effectiveFrom));
    const overlaps = ordered.some((current, index) => {
      if (index === 0) return false;
      const previous = ordered[index - 1];
      return !previous.effectiveTo || current.effectiveFrom <= previous.effectiveTo;
    });
    return {
      status: "BLOCKED" as const,
      blocker: overlaps
        ? "PCB_TAX_STATUS_PERIOD_OVERLAP"
        : "PCB_TAX_STATUS_MONTH_TRANSITION_REQUIRES_REVIEW",
    };
  }
  if (matches.length === 0) {
    return { status: "BLOCKED" as const, blocker: "PCB_TAX_STATUS_TIMELINE_INCOMPLETE" };
  }
  const period = matches[0];
  if (period.effectiveFrom > monthStart || (period.effectiveTo && period.effectiveTo < monthEnd)) {
    return { status: "BLOCKED" as const, blocker: "PCB_TAX_STATUS_MONTH_TRANSITION_REQUIRES_REVIEW" };
  }
  return { status: "RESOLVED" as const, period };
}

export function resolvePcbNonCashFactsForMonth(
  facts: readonly PcbNonCashRemunerationFact[],
  payrollMonth: string,
) {
  const monthStart = `${payrollMonth}-01`;
  const monthEnd = monthEndDate(payrollMonth);
  const resolved = facts
    .filter((fact) => fact.effectiveFrom <= monthEnd && (!fact.effectiveTo || fact.effectiveTo >= monthStart))
    .map((fact) => {
      const taxable = fact.kind === "BIK" || fact.kind === "VOLA";
      const valueCents = fact.inputBasis === "MONTHLY_VALUE"
        ? fact.valueCents
        : allocateAnnualPcbValueCents(fact.valueCents, Number(fact.effectiveFrom.slice(5, 7)));
      return {
        ...fact,
        allocatedValueCents: valueCents,
        pcbTaxableCents: taxable ? valueCents : 0,
        cashSalaryCents: 0,
        payslipGrossCents: 0,
      };
    });
  return {
    facts: resolved,
    pcbOnlyNormalRemunerationCents: resolved.reduce((sum, fact) => sum + fact.pcbTaxableCents, 0),
    exemptEvidenceCents: resolved.reduce((sum, fact) => sum + (fact.pcbTaxableCents === 0 ? fact.allocatedValueCents : 0), 0),
  };
}

/** Official 2026 BIK/VOLA annual-value path: divide by remaining working months,
 * including the effective month, then disregard sen. */
export function allocateAnnualPcbValueCents(annualValueCents: number, effectiveMonth: number) {
  if (!Number.isSafeInteger(annualValueCents) || annualValueCents < 0) {
    throw new Error("PCB_ANNUAL_VALUE_INVALID");
  }
  if (!Number.isInteger(effectiveMonth) || effectiveMonth < 1 || effectiveMonth > 12) {
    throw new Error("PCB_EFFECTIVE_MONTH_INVALID");
  }
  const remainingMonths = 13 - effectiveMonth;
  return Math.floor(annualValueCents / remainingMonths / 100) * 100;
}

export function resolvePcbComponentClassification(
  fact: PcbComponentClassificationFact | null | undefined,
) {
  if (!fact || fact.reviewStatus !== "REVIEWED" || fact.nature === "UNKNOWN") {
    return { status: "BLOCKED" as const, blocker: "PCB_COMPONENT_CLASSIFICATION_INCOMPLETE" };
  }
  return { status: "RESOLVED" as const, fact };
}

function monthEndDate(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("PCB_PAYROLL_MONTH_INVALID");
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}
