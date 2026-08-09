import { canonicalDigest } from "./statutory-artifact-pipeline";

export const PCB_YTD_BLOCKERS = {
  INVALID_RECORD: "PCB_YTD_LEDGER_RECORD_INVALID",
  SCOPE_MISMATCH: "PCB_YTD_LEDGER_SCOPE_MISMATCH",
  DUPLICATE_SOURCE: "PCB_YTD_DUPLICATE_SOURCE",
  UNFINALIZED_SOURCE: "PCB_YTD_UNFINALIZED_SOURCE",
  CURRENT_MONTH_CIRCULARITY: "PCB_YTD_CURRENT_MONTH_CIRCULARITY",
} as const;

export type PcbYtdSourceType =
  | "CURRENT_EMPLOYER_FINALIZED_PAYROLL"
  | "PREVIOUS_EMPLOYER_TP3"
  | "IMPORTED_OFFICIAL"
  | "TAX_CORRECTION";

export type PcbYtdSourceStatus = "FINALIZED" | "ACCEPTED" | "APPLIED" | "DRAFT" | "REVIEW";

export type PcbTaxYearLedgerRecord = Readonly<{
  sourceId: string;
  sourceRevision: number;
  sourceType: PcbYtdSourceType;
  sourceStatus: PcbYtdSourceStatus;
  businessId: string;
  membershipId: string;
  taxYear: number;
  effectiveMonth: number;
  normalRemunerationCents: number;
  additionalRemunerationCents: number;
  approvedSchemeContributionCents: number;
  pcbCents: number;
  allowableDeductionsCents: number;
  zakatCents: number;
}>;

export type PcbTaxYearYtdState = Readonly<{
  businessId: string;
  membershipId: string;
  taxYear: number;
  throughMonth: number;
  normalRemunerationCents: number;
  additionalRemunerationCents: number;
  grossRemunerationCents: number;
  approvedSchemeContributionCents: number;
  pcbCents: number;
  allowableDeductionsCents: number;
  zakatCents: number;
  sourceCount: number;
  sourceKeys: readonly string[];
  digest: string;
}>;

export type PcbTaxYearYtdResult =
  | Readonly<{ status: "READY"; blockers: readonly []; state: PcbTaxYearYtdState }>
  | Readonly<{ status: "BLOCKED"; blockers: readonly string[]; state: null }>;

const amountFields = [
  "normalRemunerationCents",
  "additionalRemunerationCents",
  "approvedSchemeContributionCents",
  "pcbCents",
  "allowableDeductionsCents",
  "zakatCents",
] as const satisfies ReadonlyArray<keyof PcbTaxYearLedgerRecord>;

function requiredStatus(record: PcbTaxYearLedgerRecord) {
  if (record.sourceType === "CURRENT_EMPLOYER_FINALIZED_PAYROLL") return "FINALIZED";
  if (record.sourceType === "TAX_CORRECTION") return "APPLIED";
  return "ACCEPTED";
}

function sourceKey(record: PcbTaxYearLedgerRecord) {
  return `${record.sourceType}:${record.sourceId}:r${record.sourceRevision}`;
}

export function buildPcbTaxYearYtd(input: Readonly<{
  businessId: string;
  membershipId: string;
  taxYear: number;
  calculationMonth: number;
  records: readonly PcbTaxYearLedgerRecord[];
}>): PcbTaxYearYtdResult {
  const blockers = new Set<string>();
  if (!input.businessId || !input.membershipId || !Number.isInteger(input.taxYear) || !Number.isInteger(input.calculationMonth) || input.calculationMonth < 1 || input.calculationMonth > 12) {
    blockers.add(PCB_YTD_BLOCKERS.INVALID_RECORD);
  }
  const seen = new Set<string>();
  for (const record of input.records) {
    const key = sourceKey(record);
    if (seen.has(key)) blockers.add(PCB_YTD_BLOCKERS.DUPLICATE_SOURCE);
    seen.add(key);
    if (record.businessId !== input.businessId || record.membershipId !== input.membershipId || record.taxYear !== input.taxYear) {
      blockers.add(PCB_YTD_BLOCKERS.SCOPE_MISMATCH);
    }
    if (!record.sourceId || !Number.isInteger(record.sourceRevision) || record.sourceRevision < 1 || !Number.isInteger(record.effectiveMonth) || record.effectiveMonth < 1 || record.effectiveMonth > 12 || amountFields.some((field) => !Number.isSafeInteger(record[field]) || record[field] < 0)) {
      blockers.add(PCB_YTD_BLOCKERS.INVALID_RECORD);
    }
    if (record.sourceStatus !== requiredStatus(record)) blockers.add(PCB_YTD_BLOCKERS.UNFINALIZED_SOURCE);
    if (record.effectiveMonth >= input.calculationMonth) blockers.add(PCB_YTD_BLOCKERS.CURRENT_MONTH_CIRCULARITY);
  }
  if (blockers.size > 0) return { status: "BLOCKED", blockers: [...blockers].sort(), state: null };

  const ordered = [...input.records].sort((left, right) =>
    left.effectiveMonth - right.effectiveMonth || sourceKey(left).localeCompare(sourceKey(right)),
  );
  const totals = ordered.reduce(
    (sum, record) => ({
      normalRemunerationCents: sum.normalRemunerationCents + record.normalRemunerationCents,
      additionalRemunerationCents: sum.additionalRemunerationCents + record.additionalRemunerationCents,
      approvedSchemeContributionCents: sum.approvedSchemeContributionCents + record.approvedSchemeContributionCents,
      pcbCents: sum.pcbCents + record.pcbCents,
      allowableDeductionsCents: sum.allowableDeductionsCents + record.allowableDeductionsCents,
      zakatCents: sum.zakatCents + record.zakatCents,
    }),
    { normalRemunerationCents: 0, additionalRemunerationCents: 0, approvedSchemeContributionCents: 0, pcbCents: 0, allowableDeductionsCents: 0, zakatCents: 0 },
  );
  const sourceKeys = ordered.map(sourceKey);
  const withoutDigest = {
    businessId: input.businessId,
    membershipId: input.membershipId,
    taxYear: input.taxYear,
    throughMonth: input.calculationMonth - 1,
    ...totals,
    grossRemunerationCents: totals.normalRemunerationCents + totals.additionalRemunerationCents,
    sourceCount: ordered.length,
    sourceKeys,
  };
  return { status: "READY", blockers: [], state: { ...withoutDigest, digest: canonicalDigest({ ...withoutDigest, records: ordered }) } };
}
