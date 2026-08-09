import {
  STATUTORY_ARTIFACT_ERRORS,
  canonicalDigest,
  lookupContributionRow,
  validateContributionDataset,
  type NormalizedContributionDataset,
} from "./statutory-artifact-pipeline";

export const STATUTORY_P2C_CALCULATOR_VERSION = "statutory-p2c-calculators/1.0.0";
export const EPF_CALCULATOR_VERSION = "statutory-p2c-epf-calculator/1.0.0";

export type EpfContributionCategory = "PART_A" | "PART_C" | "PART_E" | "PART_F";

export type StatutoryTableCalculation = {
  employeeCents: number;
  employerCents: number;
  totalCents: number;
  matchedRowKey: string;
  calculationInputDigest: string;
  provenanceDigest: string;
};

export type StatutoryRuleSnapshotIdentity = {
  scheme: "EPF" | "SOCSO" | "EIS" | "LINDUNG24";
  ruleVersion: string;
  artifactDigest: string;
  datasetDigest: string;
  fixtureDigest: string;
  classificationVersion: string;
  calculatorVersion: string;
};

export function calculateEpf(input: {
  dataset: NormalizedContributionDataset;
  wageCents: number;
  category: EpfContributionCategory;
}): StatutoryTableCalculation {
  assertVerifiedDataset(input.dataset, "EPF");
  if (!Number.isSafeInteger(input.wageCents) || input.wageCents <= 0) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.WAGE_REQUIRED);
  }
  const rules = input.dataset.categoryRules?.[input.category];
  if (!rules || input.dataset.rounding !== "EACH_SHARE_CEIL_TO_NEXT_RINGGIT") {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.UNVERIFIED_ACTIVATION);
  }

  if (rules.table && input.wageCents <= (input.dataset.formulaAboveCents ?? -1)) {
    const row = requiredContributionRow(input.dataset, input.wageCents);
    const prefix = {
      PART_A: "epfPartA",
      PART_C: "epfPartC",
      PART_E: "epfPartE",
      PART_F: "epfPartF",
    }[input.category];
    return calculationResult({
      scheme: "EPF",
      dataset: input.dataset,
      wageCents: input.wageCents,
      employeeCategory: input.category,
      matchedRowKey: row.key,
      employeeCents: requiredContribution(row.contributions, `${prefix}EmployeeCents`),
      employerCents: requiredContribution(row.contributions, `${prefix}EmployerCents`),
    });
  }

  const employeeBasisPoints = rules.table
    ? rules.employeeBasisPointsAboveThreshold
    : rules.employeeBasisPoints;
  const employerBasisPoints = rules.table
    ? rules.employerBasisPointsAboveThreshold
    : rules.employerBasisPoints;
  if (
    !Number.isSafeInteger(employeeBasisPoints) ||
    !Number.isSafeInteger(employerBasisPoints) ||
    employeeBasisPoints! < 0 ||
    employerBasisPoints! < 0
  ) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.MALFORMED_AMOUNT);
  }
  return calculationResult({
    scheme: "EPF",
    dataset: input.dataset,
    wageCents: input.wageCents,
    employeeCategory: input.category,
    matchedRowKey: `EPF-${input.category}-FORMULA`,
    employeeCents: ceilBasisPointsToNextRinggit(input.wageCents, employeeBasisPoints!),
    employerCents: ceilBasisPointsToNextRinggit(input.wageCents, employerBasisPoints!),
  });
}

export function calculateSocso(input: {
  dataset: NormalizedContributionDataset;
  wageCents: number;
  category: "FIRST" | "SECOND";
}): StatutoryTableCalculation {
  assertVerifiedDataset(input.dataset, "SOCSO");
  const row = requiredContributionRow(input.dataset, input.wageCents);
  const employeeCents =
    input.category === "FIRST"
      ? requiredContribution(row.contributions, "socsoEmployeeFirstCents")
      : 0;
  const employerCents = requiredContribution(
    row.contributions,
    input.category === "FIRST"
      ? "socsoEmployerFirstCents"
      : "socsoEmployerSecondCents",
  );
  return calculationResult({
    scheme: "SOCSO",
    dataset: input.dataset,
    wageCents: input.wageCents,
    employeeCategory: input.category,
    matchedRowKey: row.key,
    employeeCents,
    employerCents,
  });
}

export function calculateEis(input: {
  dataset: NormalizedContributionDataset;
  wageCents: number;
}): StatutoryTableCalculation {
  assertVerifiedDataset(input.dataset, "EIS");
  const row = requiredContributionRow(input.dataset, input.wageCents);
  const employeeCents = requiredContribution(row.contributions, "eisEmployeeCents");
  const employerCents = requiredContribution(row.contributions, "eisEmployerCents");
  return calculationResult({
    scheme: "EIS",
    dataset: input.dataset,
    wageCents: input.wageCents,
    employeeCategory: null,
    matchedRowKey: row.key,
    employeeCents,
    employerCents,
  });
}

/** Amount lookup only. Callers must resolve eligibility, participation and the
 * selected-employer context before invoking this function. */
export function calculateLindung24(input: {
  dataset: NormalizedContributionDataset;
  wageCents: number;
}): StatutoryTableCalculation {
  assertVerifiedDataset(input.dataset, "LINDUNG24");
  const row = requiredContributionRow(input.dataset, input.wageCents);
  const employeeCents = requiredContribution(
    row.contributions,
    "lindung24EmployeeCents",
  );
  return calculationResult({
    scheme: "LINDUNG24",
    dataset: input.dataset,
    wageCents: input.wageCents,
    employeeCategory: null,
    matchedRowKey: row.key,
    employeeCents,
    employerCents: 0,
  });
}

export function assessDraftStatutoryRefresh(input: {
  payrollStatus: "DRAFT" | "REVIEW" | "FINALIZED";
  snapshot: StatutoryRuleSnapshotIdentity | null;
  currentRule: StatutoryRuleSnapshotIdentity | null;
}) {
  if (input.payrollStatus !== "DRAFT") {
    return { state: "HISTORICAL_LOCKED" as const, blockerCode: null };
  }
  if (
    !input.snapshot ||
    !input.currentRule ||
    canonicalDigest(input.snapshot) !== canonicalDigest(input.currentRule)
  ) {
    return {
      state: "REFRESH_REQUIRED" as const,
      blockerCode: "STATUTORY_RULE_CHANGED" as const,
    };
  }
  return { state: "CURRENT" as const, blockerCode: null };
}

function assertVerifiedDataset(
  dataset: NormalizedContributionDataset,
  scheme: "EPF" | "SOCSO" | "EIS" | "LINDUNG24",
) {
  validateContributionDataset(dataset);
  if (dataset.verificationStatus !== "VERIFIED" || !dataset.schemes.includes(scheme)) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.UNVERIFIED_ACTIVATION);
  }
}

function requiredContributionRow(dataset: NormalizedContributionDataset, wageCents: number) {
  if (!Number.isSafeInteger(wageCents) || wageCents <= 0) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.WAGE_REQUIRED);
  }
  const row = lookupContributionRow(dataset, wageCents);
  if (!row) throw new Error(STATUTORY_ARTIFACT_ERRORS.RULE_NOT_AVAILABLE);
  return row;
}

function requiredContribution(contributions: Record<string, number>, key: string) {
  const amount = contributions[key];
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.MALFORMED_AMOUNT);
  }
  return amount;
}

function calculationResult(input: {
  scheme: "EPF" | "SOCSO" | "EIS" | "LINDUNG24";
  dataset: NormalizedContributionDataset;
  wageCents: number;
  employeeCategory: EpfContributionCategory | "FIRST" | "SECOND" | null;
  matchedRowKey: string;
  employeeCents: number;
  employerCents: number;
}): StatutoryTableCalculation {
  const calculatorVersion =
    input.scheme === "EPF" ? EPF_CALCULATOR_VERSION : STATUTORY_P2C_CALCULATOR_VERSION;
  const calculationInputDigest = canonicalDigest({
    scheme: input.scheme,
    wageCents: input.wageCents,
    employeeCategory: input.employeeCategory,
    datasetDigest: input.dataset.datasetDigest,
    calculatorVersion,
  });
  const result = {
    employeeCents: input.employeeCents,
    employerCents: input.employerCents,
    totalCents: input.employeeCents + input.employerCents,
    matchedRowKey: input.matchedRowKey,
    calculationInputDigest,
  };
  return {
    ...result,
    provenanceDigest: canonicalDigest({
      ...result,
      scheme: input.scheme,
      artifactDigest: input.dataset.artifactSha256,
      datasetDigest: input.dataset.datasetDigest,
      calculatorVersion,
    }),
  };
}

function ceilBasisPointsToNextRinggit(wageCents: number, basisPoints: number) {
  const numerator = BigInt(wageCents) * BigInt(basisPoints);
  const ringgitDenominator = 1_000_000n;
  const ringgit = (numerator + ringgitDenominator - 1n) / ringgitDenominator;
  const cents = ringgit * 100n;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.MALFORMED_AMOUNT);
  }
  return Number(cents);
}
