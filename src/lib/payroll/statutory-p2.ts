import { createHash } from "node:crypto";
import type {
  EmployeeSocsoCategory,
  EmployeeStatutoryNationality,
  Prisma,
  StatutoryComponentTreatment,
  StatutoryRuleReadiness,
  StatutoryRuleSetStatus,
  StatutoryScheme,
} from "@prisma/client";
import { buildStatutoryDeductionComponents } from "./component-calculation";
import { CP38_BLOCKERS, resolveCp38ForPeriod } from "./cp38-instruction";
import type { NormalizedContributionDataset } from "./statutory-artifact-pipeline";
import { effectiveClassificationTreatment } from "./statutory-classification-policy";
import {
  calculateEpf,
  calculateEis,
  calculateLindung24,
  calculateSocso,
  type EpfContributionCategory,
  type StatutoryTableCalculation,
} from "./statutory-p2c";
import {
  LINDUNG24_BLOCKERS,
  resolveLindung24ParticipationForPeriod,
  type Lindung24ParticipationEvidence,
} from "./lindung24-participation";
import { calculatePcb2026, type PCB2026CalculationResult } from "./pcb-2026";
import {
  assertPcbRuleCanCalculate,
  type PcbGovernedRule,
} from "./pcb-governance";
import {
  isGovernedEmployeePcbProfile,
  parseEmployeePcbProfile,
  resolvePcbProfileTaxRegimeForPeriod,
} from "./pcb-profile";
import { resolvePcbNonCashFactsForMonth } from "./pcb-correctness-foundation";
import {
  resolveStatutoryParticipationForPayrollPeriod,
  STATUTORY_PARTICIPATION_BLOCKERS,
  type StatutoryParticipationPeriod,
  type StatutoryParticipationResolution,
} from "./statutory-participation";
import {
  buildPcbTaxYearYtd,
  type PcbTaxYearLedgerRecord,
} from "./pcb-tax-year-ledger";

export const STATUTORY_P2_BLOCKERS = {
  EPF_RULE_NOT_READY: "EPF_RULE_NOT_READY",
  EPF_CATEGORY_REQUIRED: "EPF_CATEGORY_REQUIRED",
  SOCSO_RULE_NOT_READY: "SOCSO_RULE_NOT_READY",
  EIS_RULE_NOT_READY: "EIS_RULE_NOT_READY",
  LINDUNG24_RULE_NOT_READY: "LINDUNG24_RULE_NOT_READY",
  LINDUNG24_PROFILE_INCOMPLETE: LINDUNG24_BLOCKERS.PROFILE_INCOMPLETE,
  LINDUNG24_PARTICIPATION_REQUIRED: LINDUNG24_BLOCKERS.PARTICIPATION_REQUIRED,
  LINDUNG24_SELECTED_EMPLOYER_REQUIRED: LINDUNG24_BLOCKERS.SELECTED_EMPLOYER_REQUIRED,
  LINDUNG24_APPLICABILITY_INCOMPLETE: LINDUNG24_BLOCKERS.APPLICABILITY_INCOMPLETE,
  LINDUNG24_LOCAL_PARTICIPATION_DECISION_REQUIRED:
    LINDUNG24_BLOCKERS.LOCAL_PARTICIPATION_DECISION_REQUIRED,
  LINDUNG24_FOREIGN_MANDATORY_PROFILE_INCOMPLETE:
    LINDUNG24_BLOCKERS.FOREIGN_MANDATORY_PROFILE_INCOMPLETE,
  LINDUNG24_MULTIPLE_EMPLOYER_SELECTION_REQUIRED:
    LINDUNG24_BLOCKERS.SELECTED_EMPLOYER_REQUIRED,
  LINDUNG24_POLICY_TRANSITION_REVIEW_REQUIRED:
    LINDUNG24_BLOCKERS.POLICY_TRANSITION_REVIEW_REQUIRED,
  PCB_RULE_NOT_READY: "PCB_RULE_NOT_READY",
  PCB_PROFILE_INCOMPLETE: "PCB_PROFILE_INCOMPLETE",
  PCB_TAX_STATUS_TIMELINE_INCOMPLETE: "PCB_TAX_STATUS_TIMELINE_INCOMPLETE",
  PCB_TAX_STATUS_PERIOD_OVERLAP: "PCB_TAX_STATUS_PERIOD_OVERLAP",
  PCB_TAX_STATUS_MONTH_TRANSITION_REQUIRES_REVIEW:
    "PCB_TAX_STATUS_MONTH_TRANSITION_REQUIRES_REVIEW",
  PCB_SPECIAL_APPROVAL_EVIDENCE_INCOMPLETE:
    "PCB_SPECIAL_APPROVAL_EVIDENCE_INCOMPLETE",
  PCB_TP3_C2_INCOMPLETE: "PCB_TP3_C2_INCOMPLETE",
  PCB_TP3_C4II_INCOMPLETE: "PCB_TP3_C4II_INCOMPLETE",
  PCB_TP3_PREVIOUS_EMPLOYMENT_PERIOD_INCOMPLETE:
    "PCB_TP3_PREVIOUS_EMPLOYMENT_PERIOD_INCOMPLETE",
  PCB_BIK_VOLA_CLASSIFICATION_INCOMPLETE:
    "PCB_BIK_VOLA_CLASSIFICATION_INCOMPLETE",
  PCB_COMPONENT_CLASSIFICATION_INCOMPLETE:
    "PCB_COMPONENT_CLASSIFICATION_INCOMPLETE",
  PCB_TAX_REGIME_NOT_VERIFIED: "PCB_TAX_REGIME_NOT_VERIFIED",
  PCB_YTD_LEDGER_INCOMPLETE: "PCB_YTD_LEDGER_INCOMPLETE",
  PCB_ADDITIONAL_EPF_ALLOCATION_REQUIRED:
    "PCB_ADDITIONAL_EPF_ALLOCATION_REQUIRED",
  PCB_RULESET_GOVERNANCE_LINK_INCOMPLETE:
    "PCB_RULESET_GOVERNANCE_LINK_INCOMPLETE",
  PCB_RULE_NOT_APPROVED_FOR_PRODUCTION:
    "PCB_RULE_NOT_APPROVED_FOR_PRODUCTION",
  STATUTORY_PROFILE_INCOMPLETE: "STATUTORY_PROFILE_INCOMPLETE",
  STATUTORY_RULE_NOT_AVAILABLE: "STATUTORY_RULE_NOT_AVAILABLE",
  STATUTORY_CLASSIFICATION_REQUIRED: "STATUTORY_CLASSIFICATION_REQUIRED",
  STATUTORY_CALCULATION_NOT_READY: "STATUTORY_CALCULATION_NOT_READY",
  STATUTORY_PARTICIPATION_MISSING: STATUTORY_PARTICIPATION_BLOCKERS.MISSING,
  STATUTORY_PARTICIPATION_OVERLAP: STATUTORY_PARTICIPATION_BLOCKERS.OVERLAP,
  STATUTORY_PARTICIPATION_AMBIGUOUS: STATUTORY_PARTICIPATION_BLOCKERS.AMBIGUOUS,
} as const;

export type StatutoryRuleCandidate = {
  id: string;
  scheme: StatutoryScheme;
  version: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  readiness: StatutoryRuleReadiness;
  status: StatutoryRuleSetStatus;
  sourceDigest?: string | null;
  datasetDigest?: string | null;
  goldenFixtureDigest?: string | null;
  classificationVersion?: string | null;
  classificationDigest?: string | null;
  parserVersion?: string | null;
  calculatorVersion?: string | null;
  ruleData?: Prisma.JsonValue | null;
  verificationEvidence?: Prisma.JsonValue | null;
};

export function pcbRuleSupportsTaxRegime(
  rule: StatutoryRuleCandidate,
  taxRegime: string,
) {
  if (
    !rule.verificationEvidence ||
    typeof rule.verificationEvidence !== "object" ||
    Array.isArray(rule.verificationEvidence)
  ) {
    return false;
  }
  const supportedTaxRegimes = (
    rule.verificationEvidence as Record<string, unknown>
  ).supportedTaxRegimes;
  return (
    Array.isArray(supportedTaxRegimes) &&
    supportedTaxRegimes.every((value) => typeof value === "string") &&
    supportedTaxRegimes.includes(taxRegime)
  );
}

export type MaterializedStatutoryRuleCandidate = StatutoryRuleCandidate & {
  classifications: Array<{
    id: string;
    componentCode: string;
    sourceType: string | null;
    treatment: StatutoryComponentTreatment;
    rationale: string;
    reviewDecisions?: Array<{
      decision: "INCLUDED" | "ADDITIONAL_REMUNERATION" | "EXCLUDED" | "KEEP_UNKNOWN";
      decisionRevision: number;
    }>;
  }>;
};

export function resolveApplicableStatutoryRule<T extends StatutoryRuleCandidate>(
  rules: readonly T[],
  scheme: StatutoryScheme,
  statutoryPeriod: Date,
): T | null {
  const applicable = rules.filter(
    (rule) =>
      rule.scheme === scheme &&
      rule.status === "ACTIVE" &&
      rule.readiness === "CALCULATION_VERIFIED" &&
      rule.effectiveFrom.getTime() <= statutoryPeriod.getTime() &&
      (!rule.effectiveTo || rule.effectiveTo.getTime() > statutoryPeriod.getTime()),
  );
  if (applicable.length > 1) {
    throw new Error("STATUTORY_RULE_EFFECTIVE_DATE_OVERLAP");
  }
  return applicable[0] ?? null;
}

export function resolveComponentTreatment(input: {
  componentCode: string;
  componentSourceType: string;
  componentType?: "EARNING" | "DEDUCTION";
  classifications: ReadonlyArray<{
    id: string;
    componentCode: string;
    sourceType: string | null;
    treatment: StatutoryComponentTreatment;
    rationale: string;
    reviewDecisions?: ReadonlyArray<{
      decision: "INCLUDED" | "ADDITIONAL_REMUNERATION" | "EXCLUDED" | "KEEP_UNKNOWN";
      decisionRevision: number;
    }>;
  }>;
}) {
  const exact = input.classifications.find(
    (item) =>
      item.componentCode === input.componentCode &&
      item.sourceType === input.componentSourceType,
  );
  const generic = input.classifications.find(
    (item) =>
      item.componentCode === input.componentCode && item.sourceType === null,
  );
  const matched = exact ?? generic ?? null;
  if (input.componentType === "DEDUCTION") {
    return {
      id: matched?.id ?? null,
      componentCode: input.componentCode,
      sourceType: input.componentSourceType,
      treatment: "EXCLUDED" as const,
      rationale:
        matched?.rationale ??
        "Payroll deductions affect net pay and cannot increase a statutory remuneration base.",
      reviewDecisions: matched?.reviewDecisions ?? [],
    };
  }
  if (!matched) return null;
  const latestDecision = [...(matched.reviewDecisions ?? [])]
    .sort((left, right) => right.decisionRevision - left.decisionRevision)[0]?.decision ?? null;
  return {
    ...matched,
    treatment: effectiveClassificationTreatment({
      currentTreatment: matched.treatment,
      latestDecision,
    }),
  };
}

type MaterializeDatabase = Pick<
  Prisma.TransactionClient,
  | "statutoryRuleSet"
  | "employeeStatutoryProfileVersion"
  | "payrollEntryComponent"
  | "payrollComponentStatutoryTreatmentSnapshot"
  | "payrollEntryStatutorySnapshot"
  | "payrollEntry"
  | "employeeLindung24ParticipationVersion"
  | "employeeStatutoryParticipationPeriod"
  | "employeeCp38Instruction"
>;

type FrozenProfile = {
  dateOfBirth: Date | null;
  statutoryNationality: EmployeeStatutoryNationality | null;
  epfEnabled: boolean;
  epfMemberBeforeAug1998: boolean;
  socsoEnabled: boolean;
  socsoCategory: EmployeeSocsoCategory | null;
  eisEnabled: boolean;
  eisPreviouslyContributed: boolean;
  lindung24OptIn: boolean;
  statutoryProfileRevision: number;
  taxProfileRevision: number;
  taxIdentificationNumber: string | null;
  pcbProfile?: Prisma.JsonValue | null;
};

export function resolveStatutorySchemeEligibility(input: {
  scheme: StatutoryScheme;
  statutoryPeriod: Date;
  profile: FrozenProfile;
}):
  | { status: "APPLICABLE"; epfCategory?: EpfContributionCategory }
  | { status: "NOT_APPLICABLE"; reason: string }
  | { status: "PROFILE_INCOMPLETE"; missing: string[] } {
  const { profile, scheme } = input;
  if (scheme === "LINDUNG24") {
    return { status: "PROFILE_INCOMPLETE", missing: ["lindung24ParticipationVersion"] };
  }
  if (!schemeRequired(scheme, profile)) {
    return { status: "NOT_APPLICABLE", reason: "SCHEME_DISABLED_FROM_FROZEN_PROFILE" };
  }
  if (scheme === "EPF") {
    const missing = [
      !profile.dateOfBirth ? "dateOfBirth" : null,
      !profile.statutoryNationality ? "statutoryNationality" : null,
    ].filter((value): value is string => Boolean(value));
    if (missing.length) return { status: "PROFILE_INCOMPLETE", missing };
    const age = ageAtEndOfMonth(profile.dateOfBirth!, input.statutoryPeriod);
    if (age < 14) {
      return { status: "NOT_APPLICABLE", reason: "EPF_BELOW_MINIMUM_AGE_14" };
    }
    if (age >= 75) {
      return { status: "NOT_APPLICABLE", reason: "EPF_AGE_75_OR_ABOVE" };
    }
    if (profile.statutoryNationality === "NON_MALAYSIAN") {
      return {
        status: "APPLICABLE",
        epfCategory: profile.epfMemberBeforeAug1998
          ? age >= 60 ? "PART_C" : "PART_A"
          : "PART_F",
      };
    }
    if (profile.statutoryNationality === "PERMANENT_RESIDENT") {
      return { status: "APPLICABLE", epfCategory: age >= 60 ? "PART_C" : "PART_A" };
    }
    if (profile.statutoryNationality === "MALAYSIAN") {
      return { status: "APPLICABLE", epfCategory: age >= 60 ? "PART_E" : "PART_A" };
    }
    return { status: "PROFILE_INCOMPLETE", missing: ["epfCategory"] };
  }
  if (scheme === "SOCSO") {
    return profile.socsoCategory
      ? { status: "APPLICABLE" }
      : { status: "PROFILE_INCOMPLETE", missing: ["socsoCategory"] };
  }
  if (scheme === "EIS") {
    const missing = [
      !profile.dateOfBirth ? "dateOfBirth" : null,
      !profile.statutoryNationality ? "statutoryNationality" : null,
    ].filter((value): value is string => Boolean(value));
    if (missing.length) return { status: "PROFILE_INCOMPLETE", missing };
    if (profile.statutoryNationality === "NON_MALAYSIAN") {
      return { status: "NOT_APPLICABLE", reason: "EIS_NON_MALAYSIAN" };
    }
    const age = ageAtEndOfMonth(profile.dateOfBirth!, input.statutoryPeriod);
    if (age < 18 || age >= 60) {
      return { status: "NOT_APPLICABLE", reason: "EIS_AGE_OUTSIDE_18_TO_59" };
    }
    if (age >= 57 && !profile.eisPreviouslyContributed) {
      return { status: "NOT_APPLICABLE", reason: "EIS_AGE_57_PLUS_NO_PRIOR_CONTRIBUTION" };
    }
  }
  return { status: "APPLICABLE" };
}

export async function materializeStatutoryP2(
  database: MaterializeDatabase,
  input: {
    businessId: string;
    payrollRunId: string;
    payrollEntryId: string;
    membershipId: string;
    statutoryPeriod: Date;
    actorUserId: string;
    profile: FrozenProfile;
    preloadedRules?: readonly MaterializedStatutoryRuleCandidate[];
    preloadedLindung24Participation?: readonly Lindung24ParticipationEvidence[];
    preloadedStatutoryParticipation?: readonly StatutoryParticipationPeriod[];
  },
) {
  const schemes: StatutoryScheme[] = ["EPF", "SOCSO", "EIS", "LINDUNG24", "PCB"];
  const statutoryParticipation =
    input.preloadedStatutoryParticipation ??
    (await database.employeeStatutoryParticipationPeriod?.findMany({
      where: { businessId: input.businessId, membershipId: input.membershipId },
      orderBy: [
        { scheme: "asc" },
        { effectiveFromMonth: "asc" },
        { revision: "asc" },
      ],
    })) ??
    [];
  const epfParticipation = resolveStatutoryParticipationForPayrollPeriod({
    businessId: input.businessId,
    membershipId: input.membershipId,
    scheme: "EPF",
    statutoryPeriod: input.statutoryPeriod,
    records: statutoryParticipation,
    legacyEnabled: input.profile.epfEnabled,
  });
  const effectiveEpfEnabled =
    epfParticipation.status === "RESOLVED" &&
    epfParticipation.participationStatus === "PARTICIPATING";
  const lindung24Participation = input.preloadedLindung24Participation ??
    await database.employeeLindung24ParticipationVersion.findMany({
      where: { businessId: input.businessId, membershipId: input.membershipId },
      orderBy: [{ effectiveFromMonth: "asc" }, { revision: "asc" }],
    });
  const requiredSchemes = schemes.filter((scheme) =>
    scheme === "LINDUNG24"
      ? input.profile.socsoEnabled ||
        input.profile.lindung24OptIn ||
        input.profile.statutoryNationality === "NON_MALAYSIAN" ||
        lindung24Participation.length > 0
      : scheme === "EPF"
        ? statutoryParticipation.some((record) => record.scheme === "EPF") ||
          effectiveEpfEnabled
        : schemeRequired(scheme, input.profile),
  );
  const profileDigest = sha256({
    membershipId: input.membershipId,
    revision: input.profile.statutoryProfileRevision,
    taxProfileRevision: input.profile.taxProfileRevision,
    dateOfBirth: input.profile.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    statutoryNationality: input.profile.statutoryNationality,
    epfEnabled: input.profile.epfEnabled,
    epfMemberBeforeAug1998: input.profile.epfMemberBeforeAug1998,
    socsoEnabled: input.profile.socsoEnabled,
    socsoCategory: input.profile.socsoCategory,
    eisEnabled: input.profile.eisEnabled,
    eisPreviouslyContributed: input.profile.eisPreviouslyContributed,
    lindung24OptIn: input.profile.lindung24OptIn,
    // Preserve the digest of legacy statutory-profile revisions that predate
    // the annual PCB profile. Once a PCB profile exists, its frozen payload is
    // part of the revision digest and cannot change silently.
    ...(input.profile.pcbProfile === null || input.profile.pcbProfile === undefined
      ? {}
      : { pcbProfile: input.profile.pcbProfile }),
  });
  const pcbProfile = parseEmployeePcbProfile(input.profile.pcbProfile);
  const pcbTaxRegimeResolution = pcbProfile && isGovernedEmployeePcbProfile(pcbProfile)
    ? resolvePcbProfileTaxRegimeForPeriod(pcbProfile, input.statutoryPeriod)
    : null;
  const frozenProfileRevision = pcbProfile
    ? input.profile.statutoryProfileRevision * 1_000_000 +
      input.profile.taxProfileRevision
    : input.profile.statutoryProfileRevision;
  let profileVersionId: string | null = null;
  if (requiredSchemes.length) {
    const existingProfile = await database.employeeStatutoryProfileVersion.findUnique({
      where: {
        membershipId_revision: {
          membershipId: input.membershipId,
          revision: frozenProfileRevision,
        },
      },
    });
    if (existingProfile && existingProfile.sourceDigest !== profileDigest) {
      throw new Error("STATUTORY_PROFILE_REVISION_DIGEST_MISMATCH");
    }
    const profileVersion = existingProfile ??
      await database.employeeStatutoryProfileVersion.create({
        data: {
          businessId: input.businessId,
          membershipId: input.membershipId,
          revision: frozenProfileRevision,
          dateOfBirth: input.profile.dateOfBirth,
          statutoryNationality: input.profile.statutoryNationality,
          epfEnabled: input.profile.epfEnabled,
          epfMemberBeforeAug1998: input.profile.epfMemberBeforeAug1998,
          socsoEnabled: input.profile.socsoEnabled,
          socsoCategory: input.profile.socsoCategory,
          eisEnabled: input.profile.eisEnabled,
          eisPreviouslyContributed: input.profile.eisPreviouslyContributed,
          lindung24OptIn: input.profile.lindung24OptIn,
          taxProfileRevision: input.profile.taxProfileRevision,
          pcbProfileSnapshot:
            input.profile.pcbProfile === null ||
            input.profile.pcbProfile === undefined
              ? undefined
              : (input.profile.pcbProfile as Prisma.InputJsonValue),
          sourceDigest: profileDigest,
          createdById: input.actorUserId,
        },
      });
    profileVersionId = profileVersion.id;
  }

  const rules = input.preloadedRules ?? (requiredSchemes.length
    ? await database.statutoryRuleSet.findMany({
        where: {
          scheme: { in: requiredSchemes },
          status: "ACTIVE",
          effectiveFrom: { lte: input.statutoryPeriod },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: input.statutoryPeriod } }],
        },
        include: {
          classifications: {
            include: { reviewDecisions: { orderBy: { decisionRevision: "asc" } } },
          },
        },
        orderBy: [{ scheme: "asc" }, { effectiveFrom: "desc" }],
      })
    : []);
  const components = await database.payrollEntryComponent.findMany({
    where: {
      businessId: input.businessId,
      payrollEntryId: input.payrollEntryId,
      sourceType: { not: "STATUTORY" },
    },
    orderBy: [{ sortOrder: "asc" }, { lineKey: "asc" }],
  });
  const cp38Records = await database.employeeCp38Instruction.findMany({
    where: {
      businessId: input.businessId,
      membershipId: input.membershipId,
      status: "ACTIVE",
      effectiveFromMonth: { lte: input.statutoryPeriod },
      OR: [
        { effectiveToMonth: null },
        { effectiveToMonth: { gte: input.statutoryPeriod } },
      ],
    },
    orderBy: [
      { instructionReference: "asc" },
      { revision: "desc" },
    ],
  });
  const cp38Resolution = resolveCp38ForPeriod(cp38Records, input.statutoryPeriod);

  await database.payrollComponentStatutoryTreatmentSnapshot.deleteMany({
    where: { businessId: input.businessId, payrollEntryId: input.payrollEntryId },
  });
  await database.payrollEntryStatutorySnapshot.deleteMany({
    where: { businessId: input.businessId, payrollEntryId: input.payrollEntryId },
  });
  await database.payrollEntryComponent.deleteMany({
    where: {
      businessId: input.businessId,
      payrollEntryId: input.payrollEntryId,
      sourceType: "STATUTORY",
      origin: "SYSTEM",
    },
  });

  const schemeBlockers: Partial<Record<StatutoryScheme, string>> = {};
  const schemeResults: Partial<
    Record<"EPF" | "SOCSO" | "EIS" | "LINDUNG24", { wageBaseCents: number; calculation: StatutoryTableCalculation | null }>
  > = {};
  let epfAllocationContext: {
    dataset: NormalizedContributionDataset;
    category: EpfContributionCategory;
    includedComponentIds: ReadonlySet<string>;
  } | null = null;
  let pcbResult: Extract<PCB2026CalculationResult, { status: "CALCULATED" }> | null = null;
  for (const scheme of schemes) {
    const applicable = resolveApplicableStatutoryRule(rules, scheme, input.statutoryPeriod);
    const classifications = applicable?.classifications ?? [];
    let unknownClassification = false;
    const treatments: Array<{
      component: (typeof components)[number];
      treatment: StatutoryComponentTreatment;
      classificationId: string | null;
    }> = [];
    for (const component of components) {
      const classification = applicable
        ? resolveComponentTreatment({
            componentCode: component.code,
            componentSourceType: component.sourceType,
            componentType: component.type,
            classifications,
          })
        : null;
      const treatment = classification?.treatment ?? "UNKNOWN";
      if (treatment === "UNKNOWN") unknownClassification = true;
      treatments.push({
        component,
        treatment,
        classificationId: classification?.id ?? null,
      });
      await database.payrollComponentStatutoryTreatmentSnapshot.create({
        data: {
          businessId: input.businessId,
          payrollEntryId: input.payrollEntryId,
          componentId: component.id,
          scheme,
          treatment,
          classificationId: classification?.id ?? null,
          ruleVersionSnapshot: applicable?.version ?? null,
          rationaleSnapshot:
            classification?.rationale ??
            "No verified scheme-specific classification applies to this frozen component.",
        },
      });
    }

    const lindungResolution = scheme === "LINDUNG24"
      ? resolveLindung24ParticipationForPeriod({
          businessId: input.businessId,
          membershipId: input.membershipId,
          statutoryPeriod: input.statutoryPeriod,
          statutoryNationality: input.profile.statutoryNationality,
          act4Covered: input.profile.socsoEnabled,
          records: lindung24Participation,
        })
      : null;
    const eligibility = scheme === "LINDUNG24"
      ? null
      : resolveStatutorySchemeEligibility({
          scheme,
          statutoryPeriod: input.statutoryPeriod,
          profile:
            scheme === "EPF"
              ? { ...input.profile, epfEnabled: effectiveEpfEnabled }
              : input.profile,
        });
    let blocker: string | null = null;
    if (scheme === "EPF" && epfParticipation.status === "BLOCKED") {
      blocker = epfParticipation.blockerCode;
    } else if (
      scheme === "EPF" &&
      epfParticipation.status === "RESOLVED" &&
      epfParticipation.participationStatus === "NOT_PARTICIPATING"
    ) {
      await createSnapshot(database, input, {
        scheme,
        status: "NOT_APPLICABLE",
        calculationSource: "NOT_APPLICABLE",
        blockerCode: null,
        rule: applicable,
        profileVersionId,
        statutoryParticipation: epfParticipation,
        metadata: {
          eligibility: "EPF_NOT_PARTICIPATING_FOR_PAYROLL_MONTH",
          participationSource: epfParticipation.source,
          participationStatus: epfParticipation.participationStatus,
        },
      });
      continue;
    }
    if (!blocker && (lindungResolution?.status === "NOT_APPLICABLE" || lindungResolution?.status === "NO_CONTRIBUTION")) {
      await createSnapshot(database, input, {
        scheme,
        status: "NOT_APPLICABLE",
        calculationSource: "NOT_APPLICABLE",
        blockerCode: null,
        rule: applicable,
        profileVersionId,
        lindung24Participation: lindungResolution.participation,
        metadata: {
          eligibility: lindungResolution.reason,
          participationStatus: lindungResolution.participation?.status ?? null,
          contributionRequired: false,
        },
      });
      continue;
    }
    if (!blocker && lindungResolution?.status === "BLOCKED") {
      blocker =
        input.profile.lindung24OptIn && !lindungResolution.participation
          ? LINDUNG24_BLOCKERS.LEGACY_REVIEW_REQUIRED
          : lindungResolution.blockerCode;
    } else if (!blocker && eligibility?.status === "NOT_APPLICABLE") {
      await createSnapshot(database, input, {
        scheme,
        status: "NOT_APPLICABLE",
        calculationSource: "NOT_APPLICABLE",
        blockerCode: null,
        rule: applicable,
        profileVersionId,
        statutoryParticipation:
          scheme === "EPF" ? epfParticipation : null,
        metadata: { eligibility: eligibility.reason },
      });
      continue;
    } else if (!blocker && eligibility?.status === "PROFILE_INCOMPLETE") {
      blocker = STATUTORY_P2_BLOCKERS.STATUTORY_PROFILE_INCOMPLETE;
    } else if (!blocker && scheme === "PCB" && !pcbProfile) {
      blocker = STATUTORY_P2_BLOCKERS.PCB_PROFILE_INCOMPLETE;
    } else if (!blocker && scheme === "PCB" && pcbProfile && !isGovernedEmployeePcbProfile(pcbProfile)) {
      blocker = STATUTORY_P2_BLOCKERS.PCB_PROFILE_INCOMPLETE;
    } else if (!blocker && scheme === "PCB" && pcbTaxRegimeResolution?.status === "BLOCKED") {
      blocker = pcbTaxRegimeResolution.blocker;
    } else if (!blocker && !applicable) {
      blocker = STATUTORY_P2_BLOCKERS.STATUTORY_RULE_NOT_AVAILABLE;
    } else if (
      !blocker &&
      applicable &&
      applicable.readiness !== "CALCULATION_VERIFIED"
    ) {
      blocker = ruleNotReadyCode(scheme);
    } else if (
      !blocker &&
      applicable &&
      scheme === "PCB" &&
      pcbProfile &&
      pcbTaxRegimeResolution?.status === "RESOLVED" &&
      !pcbRuleSupportsTaxRegime(applicable, pcbTaxRegimeResolution.regime)
    ) {
      blocker = STATUTORY_P2_BLOCKERS.PCB_TAX_REGIME_NOT_VERIFIED;
    } else if (!blocker && unknownClassification) {
      // Keep the established payroll-readiness contract stable. PCB profile
      // readiness exposes the more specific P1 classification issue, while
      // the cross-scheme payroll gate remains the canonical generic blocker.
      blocker = STATUTORY_P2_BLOCKERS.STATUTORY_CLASSIFICATION_REQUIRED;
    } else if (!blocker && scheme === "PCB") {
      let governanceBinding: ReturnType<typeof assertPcbRuleCanCalculate>;
      try {
        governanceBinding = assertPcbRuleCanCalculate(applicable as PcbGovernedRule);
      } catch (error) {
        blocker = error instanceof Error
          ? error.message
          : STATUTORY_P2_BLOCKERS.PCB_RULESET_GOVERNANCE_LINK_INCOMPLETE;
        governanceBinding = null as never;
      }
      if (blocker) {
        // The common blocked-snapshot path below records the exact governance
        // blocker and prevents the calculator from running.
      } else {
        const totalEpfEmployeeCents =
          schemeResults.EPF?.calculation?.employeeCents ?? 0;
        const frozenEpfAllocation = epfAllocationContext;
        const normalEpfWageCents = frozenEpfAllocation
          ? treatments.reduce(
              (total, item) =>
                total +
                (item.component.type === "EARNING" &&
                item.treatment === "INCLUDED" &&
                frozenEpfAllocation.includedComponentIds.has(item.component.id)
                  ? moneyToCents(item.component.amount)
                  : 0),
              0,
            )
          : 0;
        const normalEpfEmployeeCents = frozenEpfAllocation
          ? normalEpfWageCents === 0
            ? 0
            : calculateEpf({
                dataset: frozenEpfAllocation.dataset,
                wageCents: normalEpfWageCents,
                category: frozenEpfAllocation.category,
              }).employeeCents
          : effectiveEpfEnabled
            ? null
            : 0;
        const pcbMaterialization = await calculatePcbForEntry(database, input, {
          pcbProfile: pcbProfile!,
          treatments,
          epfEmployeeCents: totalEpfEmployeeCents,
          normalEpfEmployeeCents,
          governanceBinding,
        });
        if (pcbMaterialization.status === "BLOCKED") {
          blocker = pcbMaterialization.blocker;
        } else {
          pcbResult = pcbMaterialization.calculation;
          await createSnapshot(database, input, {
            scheme,
            status: "CALCULATED",
            calculationSource: "CALCULATED",
            blockerCode: null,
            rule: applicable,
            profileVersionId,
            wageBaseCents: pcbMaterialization.wageBaseCents,
            employeeContributionCents: pcbResult.amountCents,
            employerContributionCents: 0,
            matchedRuleKey: "PCB_2026_MONTHLY_TAX_DEDUCTION",
            calculationInputDigest: pcbMaterialization.calculationInputDigest,
            metadata: {
              ...pcbMaterialization.metadata,
              cp38: {
                status: cp38Resolution.status,
                amountCents:
                  cp38Resolution.status === "BLOCKED"
                    ? 0
                    : cp38Resolution.amountCents,
                instructions:
                  cp38Resolution.status === "APPLICABLE"
                    ? cp38Resolution.instructions
                    : [],
              },
            },
          });
          continue;
        }
      }
    } else if (
      !blocker &&
      applicable &&
      (scheme === "EPF" ||
        scheme === "SOCSO" ||
        scheme === "EIS" ||
        scheme === "LINDUNG24")
    ) {
      const wageBaseCents = treatments.reduce(
        (total, item) =>
          total +
          (item.component.type === "EARNING" &&
          (item.treatment === "INCLUDED" ||
            item.treatment === "ADDITIONAL_REMUNERATION")
            ? moneyToCents(item.component.amount)
            : 0),
        0,
      );
      const dataset = contributionDatasetFromRule(applicable, scheme);
      const calculation = wageBaseCents === 0
        ? null
        : scheme === "EPF"
          ? calculateEpf({
              dataset,
              wageCents: wageBaseCents,
              category: requiredEpfCategory(
                eligibility?.status === "APPLICABLE" ? eligibility.epfCategory : undefined,
              ),
            })
          : scheme === "SOCSO"
          ? calculateSocso({
              dataset,
              wageCents: wageBaseCents,
              category: requiredSocsoCategory(input.profile.socsoCategory),
            })
          : scheme === "EIS"
          ? calculateEis({ dataset, wageCents: wageBaseCents })
          : calculateLindung24({ dataset, wageCents: wageBaseCents });
      if (scheme === "EPF") {
        epfAllocationContext = {
          dataset,
          category: requiredEpfCategory(
            eligibility?.status === "APPLICABLE" ? eligibility.epfCategory : undefined,
          ),
          includedComponentIds: new Set(
            treatments
              .filter(
                (item) =>
                  item.component.type === "EARNING" &&
                  (item.treatment === "INCLUDED" ||
                    item.treatment === "ADDITIONAL_REMUNERATION"),
              )
              .map((item) => item.component.id),
          ),
        };
      }
      const treatmentDigest = sha256(
        treatments.map((item) => ({
          componentId: item.component.id,
          code: item.component.code,
          sourceType: item.component.sourceType,
          type: item.component.type,
          treatment: item.treatment,
          classificationId: item.classificationId,
        })),
      );
      schemeResults[scheme] = { wageBaseCents, calculation };
      await createSnapshot(database, input, {
        scheme,
        status: "CALCULATED",
        calculationSource: "CALCULATED",
        blockerCode: null,
        rule: applicable,
        profileVersionId,
        statutoryParticipation:
          scheme === "EPF" ? epfParticipation : null,
        lindung24Participation:
          lindungResolution?.status === "CONTRIBUTION_REQUIRED"
            ? lindungResolution.participation
            : null,
        wageBaseCents,
        employeeContributionCents: calculation?.employeeCents ?? 0,
        employerContributionCents: calculation?.employerCents ?? 0,
        matchedRuleKey: calculation?.matchedRowKey ?? null,
        calculationInputDigest:
          calculation?.calculationInputDigest ??
          sha256({ scheme, wageBaseCents, ruleVersion: applicable.version }),
        metadata: {
          componentCount: components.length,
          includedEarningCount: treatments.filter(
            (item) => item.component.type === "EARNING" && item.treatment === "INCLUDED",
          ).length,
          excludedCount: treatments.filter((item) => item.treatment === "EXCLUDED").length,
          treatmentDigest,
          epfCategory:
            eligibility?.status === "APPLICABLE" ? eligibility.epfCategory ?? null : null,
          statutoryParticipationSource:
            scheme === "EPF" && epfParticipation.status === "RESOLVED"
              ? epfParticipation.source
              : null,
          lindung24EmployeeCategory:
            lindungResolution?.status === "CONTRIBUTION_REQUIRED"
              ? lindungResolution.employeeCategory
              : null,
          participationRevision:
            lindungResolution?.status === "CONTRIBUTION_REQUIRED"
              ? lindungResolution.participation.revision
              : null,
          selectedEmployer:
            lindungResolution?.status === "CONTRIBUTION_REQUIRED"
              ? lindungResolution.participation.selectedEmployer
              : null,
          calculationProvenanceDigest: calculation?.provenanceDigest ?? null,
        },
      });
      continue;
    } else if (!blocker) {
      blocker = STATUTORY_P2_BLOCKERS.STATUTORY_CALCULATION_NOT_READY;
    }
    schemeBlockers[scheme] = blocker;
    await createSnapshot(database, input, {
      scheme,
      status: "BLOCKED",
      calculationSource: "BLOCKED",
      blockerCode: blocker,
      rule: applicable,
      profileVersionId,
      statutoryParticipation:
        scheme === "EPF" ? epfParticipation : null,
      lindung24Participation: lindungResolution?.participation ?? null,
      metadata: {
        componentCount: components.length,
        unknownClassification,
        eligibility: eligibility ?? lindungResolution,
        taxIdentificationPresent: Boolean(input.profile.taxIdentificationNumber),
      },
    });
  }

  const blockers = Object.entries(schemeBlockers)
    .map(([scheme, code]) => `${scheme}:${code}`)
    .concat(
      cp38Resolution.status === "BLOCKED"
        ? [`CP38:${CP38_BLOCKERS.AMBIGUOUS_ACTIVE_REVISION}`]
        : [],
    )
    .sort();
  const socso = schemeResults.SOCSO;
  const eis = schemeResults.EIS;
  if (socso && eis && socso.wageBaseCents !== eis.wageBaseCents) {
    throw new Error("STATUTORY_PERKESO_WAGE_BASE_DIVERGENCE");
  }
  const statutoryLines = buildStatutoryDeductionComponents({
    epfEmployeeCents: schemeResults.EPF?.calculation?.employeeCents ?? 0,
    socsoEmployeeCents: socso?.calculation?.employeeCents ?? 0,
    eisEmployeeCents: eis?.calculation?.employeeCents ?? 0,
    lindung24EmployeeCents:
      schemeResults.LINDUNG24?.calculation?.employeeCents ?? 0,
    pcbCents: pcbResult?.amountCents ?? 0,
    cp38Cents:
      cp38Resolution.status === "APPLICABLE" ? cp38Resolution.amountCents : 0,
  });
  if (statutoryLines.length) {
    await database.payrollEntryComponent.createMany({
      data: statutoryLines.map((line) => ({
        businessId: input.businessId,
        payrollRunId: input.payrollRunId,
        payrollEntryId: input.payrollEntryId,
        membershipId: input.membershipId,
        lineKey: line.lineKey,
        type: line.type,
        code: line.code,
        name: line.name,
        amount: centsToMoney(line.amountCents),
        currency: line.currency,
        sourceType: line.sourceType,
        sourceId: line.sourceId,
        sourceVersionId: line.sourceVersionId,
        sourceRevision: line.sourceRevision,
        effectiveFromMonth: line.effectiveFromMonth,
        calculationBasis: line.calculationBasis,
        origin: line.origin,
        reason: line.reason,
        sortOrder: line.sortOrder,
        createdById: input.actorUserId,
      })),
    });
  }
  const calculatedRules = (["EPF", "SOCSO", "EIS", "LINDUNG24", "PCB"] as const)
    .filter((scheme) => scheme === "PCB" ? pcbResult : schemeResults[scheme])
    .map((scheme) => {
      const rule = resolveApplicableStatutoryRule(rules, scheme, input.statutoryPeriod);
      return `${scheme}:${rule?.version ?? ""}`;
    });
  await database.payrollEntry.update({
    where: { id: input.payrollEntryId },
    data: {
      epfWageBase: centsToMoney(schemeResults.EPF?.wageBaseCents ?? 0),
      perkesoWageBase: centsToMoney(socso?.wageBaseCents ?? eis?.wageBaseCents ?? 0),
      epfEmployee: centsToMoney(schemeResults.EPF?.calculation?.employeeCents ?? 0),
      employerEpf: centsToMoney(schemeResults.EPF?.calculation?.employerCents ?? 0),
      socsoEmployee: centsToMoney(socso?.calculation?.employeeCents ?? 0),
      employerSocso: centsToMoney(socso?.calculation?.employerCents ?? 0),
      eisEmployee: centsToMoney(eis?.calculation?.employeeCents ?? 0),
      employerEis: centsToMoney(eis?.calculation?.employerCents ?? 0),
      lindung24Employee: centsToMoney(
        schemeResults.LINDUNG24?.calculation?.employeeCents ?? 0,
      ),
      pcb: centsToMoney(pcbResult?.amountCents ?? 0),
      cp38: centsToMoney(
        cp38Resolution.status === "APPLICABLE" ? cp38Resolution.amountCents : 0,
      ),
      statutoryStatus: blockers.length
        ? "REVIEW_REQUIRED"
        : calculatedRules.length
          ? "AUTO_CALCULATED"
          : "NOT_CONFIGURED",
      statutoryRuleVersion: calculatedRules.join("|") || null,
      statutoryCalculatedAt: calculatedRules.length ? new Date() : null,
      statutoryWarning: blockers.join("; ") || null,
    },
  });
  return { blockers, cp38Resolution, pcbResult, profileVersionId, schemeResults };
}

type PcbEntryTreatment = {
  component: {
    id: string;
    type: "EARNING" | "DEDUCTION";
    amount: { toString(): string };
  };
  treatment: StatutoryComponentTreatment;
};

export async function calculatePcbForEntry(
  database: MaterializeDatabase,
  input: Parameters<typeof materializeStatutoryP2>[1],
  context: {
    pcbProfile: NonNullable<ReturnType<typeof parseEmployeePcbProfile>>;
    treatments: readonly PcbEntryTreatment[];
    epfEmployeeCents: number;
    normalEpfEmployeeCents: number | null;
    governanceBinding: ReturnType<typeof assertPcbRuleCanCalculate>;
  },
): Promise<
  | { status: "BLOCKED"; blocker: string }
  | {
      status: "CALCULATED";
      calculation: Extract<PCB2026CalculationResult, { status: "CALCULATED" }>;
      calculationInputDigest: string;
      wageBaseCents: number;
      metadata: Record<string, unknown>;
    }
> {
  const calculationMonth = input.statutoryPeriod.getUTCMonth() + 1;
  const taxYear = input.statutoryPeriod.getUTCFullYear();
  if (context.pcbProfile.taxYear !== taxYear) {
    return { status: "BLOCKED", blocker: STATUTORY_P2_BLOCKERS.PCB_PROFILE_INCOMPLETE };
  }
  if (!isGovernedEmployeePcbProfile(context.pcbProfile)) {
    return {
      status: "BLOCKED",
      blocker: STATUTORY_P2_BLOCKERS.PCB_PROFILE_INCOMPLETE,
    };
  }

  const taxRegimeResolution = resolvePcbProfileTaxRegimeForPeriod(
    context.pcbProfile,
    input.statutoryPeriod,
  );
  if (taxRegimeResolution.status === "BLOCKED") {
    return { status: "BLOCKED", blocker: taxRegimeResolution.blocker };
  }

  const payrollMonth = `${taxYear}-${String(calculationMonth).padStart(2, "0")}`;
  const nonCashResolution = context.pcbProfile.version === 4
    ? resolvePcbNonCashFactsForMonth(
        context.pcbProfile.nonCashRemunerationFacts,
        payrollMonth,
      )
    : { facts: [], pcbOnlyNormalRemunerationCents: 0, exemptEvidenceCents: 0 };

  const currentCashNormalRemunerationCents = context.treatments.reduce(
    (total, item) =>
      total +
      (item.component.type === "EARNING" && item.treatment === "INCLUDED"
        ? moneyToCents(item.component.amount)
        : 0),
    0,
  );
  const currentNormalRemunerationCents =
    currentCashNormalRemunerationCents +
    nonCashResolution.pcbOnlyNormalRemunerationCents;
  const currentAdditionalRemunerationCents = context.treatments.reduce(
    (total, item) =>
      total +
      (item.component.type === "EARNING" &&
      item.treatment === "ADDITIONAL_REMUNERATION"
        ? moneyToCents(item.component.amount)
        : 0),
    0,
  );
  if (
    currentAdditionalRemunerationCents > 0 &&
    context.normalEpfEmployeeCents === null
  ) {
    return {
      status: "BLOCKED",
      blocker: STATUTORY_P2_BLOCKERS.PCB_ADDITIONAL_EPF_ALLOCATION_REQUIRED,
    };
  }
  const currentNormalEpfCents = context.normalEpfEmployeeCents ?? 0;
  if (currentNormalEpfCents > context.epfEmployeeCents) {
    return {
      status: "BLOCKED",
      blocker: STATUTORY_P2_BLOCKERS.PCB_ADDITIONAL_EPF_ALLOCATION_REQUIRED,
    };
  }
  const currentAdditionalEpfCents = Math.max(
    0,
    context.epfEmployeeCents - currentNormalEpfCents,
  );

  const priorSnapshots = await database.payrollEntryStatutorySnapshot.findMany({
    where: {
      businessId: input.businessId,
      membershipId: input.membershipId,
      scheme: "PCB",
      status: "CALCULATED",
      payrollRun: {
        status: "FINALIZED",
        periodStart: {
          gte: new Date(Date.UTC(taxYear, 0, 1)),
          lt: input.statutoryPeriod,
        },
      },
    },
    select: {
      id: true,
      calculationMetadata: true,
      sourceDigest: true,
      payrollRun: { select: { periodStart: true } },
    },
  });
  const records: PcbTaxYearLedgerRecord[] = [];
  for (const snapshot of priorSnapshots) {
    const metadata = parsePcbSnapshotLedgerMetadata(snapshot.calculationMetadata);
    if (!metadata) {
      return {
        status: "BLOCKED",
        blocker: STATUTORY_P2_BLOCKERS.PCB_YTD_LEDGER_INCOMPLETE,
      };
    }
    records.push({
      sourceId: snapshot.id,
      sourceRevision: 1,
      sourceType: "CURRENT_EMPLOYER_FINALIZED_PAYROLL",
      sourceStatus: "FINALIZED",
      businessId: input.businessId,
      membershipId: input.membershipId,
      taxYear,
      effectiveMonth: snapshot.payrollRun.periodStart.getUTCMonth() + 1,
      ...metadata,
    });
  }

  const priorEmployerTotal =
    context.pcbProfile.priorEmployerGrossRemunerationCents +
    context.pcbProfile.priorEmployerEpfCents +
    context.pcbProfile.priorEmployerPcbCents +
    context.pcbProfile.priorEmployerAllowableDeductionsCents +
    context.pcbProfile.priorEmployerZakatCents +
    (context.pcbProfile.version === 4
      ? context.pcbProfile.tp3Declaration.religiousTravelLevyCents +
        context.pcbProfile.tp3Declaration.exemptIncomeItems.reduce(
          (total, item) => total + item.amountCents,
          0,
        )
      : 0);
  if (priorEmployerTotal > 0) {
    if (calculationMonth === 1) {
      return {
        status: "BLOCKED",
        blocker: STATUTORY_P2_BLOCKERS.PCB_YTD_LEDGER_INCOMPLETE,
      };
    }
    records.push({
      sourceId: `TP3:${context.pcbProfile.confirmedAt}`,
      sourceRevision: context.pcbProfile.profileRevision,
      sourceType: "PREVIOUS_EMPLOYER_TP3",
      sourceStatus: "ACCEPTED",
      businessId: input.businessId,
      membershipId: input.membershipId,
      taxYear,
      effectiveMonth: calculationMonth - 1,
      normalRemunerationCents:
        context.pcbProfile.priorEmployerGrossRemunerationCents,
      additionalRemunerationCents: 0,
      approvedSchemeContributionCents:
        context.pcbProfile.priorEmployerEpfCents,
      pcbCents: context.pcbProfile.priorEmployerPcbCents,
      allowableDeductionsCents:
        context.pcbProfile.priorEmployerAllowableDeductionsCents,
      zakatCents:
        context.pcbProfile.priorEmployerZakatCents +
        (context.pcbProfile.version === 4
          ? context.pcbProfile.tp3Declaration.religiousTravelLevyCents
          : 0),
    });
  }

  const ytd = buildPcbTaxYearYtd({
    businessId: input.businessId,
    membershipId: input.membershipId,
    taxYear,
    calculationMonth,
    records,
  });
  if (ytd.status === "BLOCKED") {
    return {
      status: "BLOCKED",
      blocker: STATUTORY_P2_BLOCKERS.PCB_YTD_LEDGER_INCOMPLETE,
    };
  }
  const calculationInput = {
    taxYear,
    calculationMonth,
    taxRegime: taxRegimeResolution.regime,
    employeeCategory: context.pcbProfile.employeeCategory,
    individualDisabled: context.pcbProfile.individualDisabled,
    spouseDisabled: context.pcbProfile.spouseDisabled,
    children: context.pcbProfile.children,
    priorGrossRemunerationCents: ytd.state.grossRemunerationCents,
    priorEpfCents: ytd.state.approvedSchemeContributionCents,
    priorPcbCents: ytd.state.pcbCents,
    accumulatedAllowableDeductionsCents:
      ytd.state.allowableDeductionsCents,
    accumulatedZakatCents: ytd.state.zakatCents,
    currentNormalRemunerationCents,
    currentNormalEpfCents,
    currentAdditionalRemunerationCents,
    currentAdditionalEpfCents,
    currentAllowableDeductionsCents:
      context.pcbProfile.currentAllowableDeductionsCents,
    currentZakatCents: context.pcbProfile.currentZakatCents,
    currentReligiousTravelLevyCents:
      context.pcbProfile.currentReligiousTravelLevyCents,
  } as const;
  const calculation = calculatePcb2026(calculationInput);
  if (calculation.status === "BLOCKED") {
    return {
      status: "BLOCKED",
      blocker:
        calculation.blockers[0] ??
        STATUTORY_P2_BLOCKERS.STATUTORY_CALCULATION_NOT_READY,
    };
  }
  const calculationInputDigest = sha256({ calculationInput, ytd: ytd.state });
  return {
    status: "CALCULATED",
    calculation,
    calculationInputDigest,
    wageBaseCents:
      currentCashNormalRemunerationCents + currentAdditionalRemunerationCents,
    metadata: {
      taxYear,
      calculationMonth,
      taxRegime: taxRegimeResolution.regime,
      taxRegimeResolutionSource: taxRegimeResolution.source,
      taxRegimePeriod: taxRegimeResolution.period,
      taxRegimeRevision: taxRegimeResolution.period?.revision ??
        context.pcbProfile.profileRevision,
      employeeCategory: context.pcbProfile.employeeCategory,
      normalRemunerationCents: currentNormalRemunerationCents,
      cashNormalRemunerationCents: currentCashNormalRemunerationCents,
      pcbOnlyNormalRemunerationCents:
        nonCashResolution.pcbOnlyNormalRemunerationCents,
      nonCashRemunerationFacts: nonCashResolution.facts,
      exemptBenefitEvidenceCents: nonCashResolution.exemptEvidenceCents,
      additionalRemunerationCents: currentAdditionalRemunerationCents,
      currentEmployerYtdRemunerationCents:
        ytd.state.grossRemunerationCents -
        context.pcbProfile.priorEmployerGrossRemunerationCents,
      previousEmployerRemunerationCents:
        context.pcbProfile.priorEmployerGrossRemunerationCents,
      previousEmployerEpfCents: context.pcbProfile.priorEmployerEpfCents,
      previousEmployerPcbCents: context.pcbProfile.priorEmployerPcbCents,
      previousEmployerExemptIncomeCents:
        context.pcbProfile.version === 4
          ? context.pcbProfile.tp3Declaration.exemptIncomeItems.reduce(
              (total, item) => total + item.amountCents,
              0,
            )
          : 0,
      previousEmployerReligiousTravelLevyCents:
        context.pcbProfile.version === 4
          ? context.pcbProfile.tp3Declaration.religiousTravelLevyCents
          : 0,
      previousEmployerReligiousTravelLevySourceReference:
        context.pcbProfile.version === 4
          ? context.pcbProfile.tp3Declaration.religiousTravelLevySourceReference
          : null,
      previousEmploymentPeriods:
        context.pcbProfile.version === 4
          ? context.pcbProfile.tp3Declaration.previousEmploymentPeriods
          : [],
      tp3Revision: context.pcbProfile.profileRevision,
      componentClassificationFacts:
        context.pcbProfile.version === 4
          ? context.pcbProfile.componentClassificationFacts
          : [],
      ytdPcbCents: ytd.state.pcbCents,
      approvedSchemeContributionCents: context.epfEmployeeCents,
      normalEpfCents: currentNormalEpfCents,
      additionalEpfCents: currentAdditionalEpfCents,
      pcbCents: calculation.amountCents,
      allowableDeductionsCents:
        context.pcbProfile.currentAllowableDeductionsCents,
      zakatCents: context.pcbProfile.currentZakatCents,
      religiousTravelLevyCents:
        context.pcbProfile.currentReligiousTravelLevyCents,
      ytdDigest: ytd.state.digest,
      ytdSourceCount: ytd.state.sourceCount,
      calculatorTrace: calculation.trace,
      governanceBinding: context.governanceBinding,
    },
  };
}

function parsePcbSnapshotLedgerMetadata(value: Prisma.JsonValue) {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const fields = [
    "normalRemunerationCents",
    "additionalRemunerationCents",
    "approvedSchemeContributionCents",
    "pcbCents",
    "allowableDeductionsCents",
    "zakatCents",
  ] as const;
  if (
    fields.some(
      (field) =>
        !Number.isSafeInteger(record[field]) || Number(record[field]) < 0,
    )
  ) {
    return null;
  }
  return Object.fromEntries(
    fields.map((field) => [field, Number(record[field])]),
  ) as Pick<
    PcbTaxYearLedgerRecord,
    | "normalRemunerationCents"
    | "additionalRemunerationCents"
    | "approvedSchemeContributionCents"
    | "pcbCents"
    | "allowableDeductionsCents"
    | "zakatCents"
  >;
}

function schemeRequired(scheme: StatutoryScheme, profile: FrozenProfile) {
  if (scheme === "EPF") return profile.epfEnabled;
  if (scheme === "SOCSO") return profile.socsoEnabled;
  if (scheme === "EIS") return profile.eisEnabled;
  if (scheme === "LINDUNG24") {
    return (
      profile.socsoEnabled &&
      (profile.statutoryNationality === "NON_MALAYSIAN" || profile.lindung24OptIn)
    );
  }
  return profile.taxProfileRevision > 0 || Boolean(profile.taxIdentificationNumber);
}

function ruleNotReadyCode(scheme: StatutoryScheme) {
  return STATUTORY_P2_BLOCKERS[`${scheme}_RULE_NOT_READY` as keyof typeof STATUTORY_P2_BLOCKERS];
}

export function contributionDatasetFromRule(
  rule: StatutoryRuleCandidate,
  scheme: "EPF" | "SOCSO" | "EIS" | "LINDUNG24",
) {
  if (!rule.ruleData || Array.isArray(rule.ruleData) || typeof rule.ruleData !== "object") {
    throw new Error("STATUTORY_RULE_DATASET_NOT_RETAINED");
  }
  const retained = rule.ruleData as unknown as NormalizedContributionDataset;
  const dataset: NormalizedContributionDataset = {
    schemaVersion: retained.schemaVersion,
    id: retained.id,
    schemes: retained.schemes,
    artifactId: retained.artifactId,
    artifactSha256: retained.artifactSha256,
    parserName: retained.parserName,
    parserVersion: retained.parserVersion,
    extractionMode: retained.extractionMode,
    verificationStatus: retained.verificationStatus,
    expectedRowCount: retained.expectedRowCount,
    calculationMode: retained.calculationMode,
    formulaAboveCents: retained.formulaAboveCents,
    categoryRules: retained.categoryRules,
    rounding: retained.rounding,
    effectiveFrom: retained.effectiveFrom,
    effectiveTo: retained.effectiveTo,
    datasetDigest: retained.datasetDigest,
    rows: retained.rows,
  };
  if (
    dataset.datasetDigest !== rule.datasetDigest ||
    dataset.artifactSha256 !== rule.sourceDigest ||
    !dataset.schemes?.includes(scheme)
  ) {
    throw new Error("STATUTORY_RULE_DATASET_PROVENANCE_MISMATCH");
  }
  return dataset;
}

function requiredEpfCategory(value: EpfContributionCategory | undefined) {
  if (!value) throw new Error(STATUTORY_P2_BLOCKERS.EPF_CATEGORY_REQUIRED);
  return value;
}

function requiredSocsoCategory(value: EmployeeSocsoCategory | null) {
  if (!value) throw new Error(STATUTORY_P2_BLOCKERS.STATUTORY_PROFILE_INCOMPLETE);
  return value;
}

function ageAtEndOfMonth(dateOfBirth: Date, statutoryPeriod: Date) {
  const at = new Date(
    Date.UTC(statutoryPeriod.getUTCFullYear(), statutoryPeriod.getUTCMonth() + 1, 0),
  );
  let age = at.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    at.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (at.getUTCMonth() === dateOfBirth.getUTCMonth() &&
      at.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function moneyToCents(value: { toString(): string }) {
  const text = value.toString();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new Error("STATUTORY_COMPONENT_AMOUNT_INVALID");
  }
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error("STATUTORY_COMPONENT_AMOUNT_INVALID");
  }
  return cents;
}

function centsToMoney(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error("STATUTORY_COMPONENT_AMOUNT_INVALID");
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

async function createSnapshot(
  database: MaterializeDatabase,
  input: Parameters<typeof materializeStatutoryP2>[1],
  snapshot: {
    scheme: StatutoryScheme;
    status: "CALCULATED" | "BLOCKED" | "NOT_APPLICABLE";
    calculationSource: "CALCULATED" | "BLOCKED" | "NOT_APPLICABLE";
    blockerCode: string | null;
    rule: StatutoryRuleCandidate | null;
    profileVersionId: string | null;
    statutoryParticipation?: StatutoryParticipationResolution | null;
    lindung24Participation?: Lindung24ParticipationEvidence | null;
    metadata: Record<string, unknown>;
    wageBaseCents?: number;
    employeeContributionCents?: number;
    employerContributionCents?: number;
    matchedRuleKey?: string | null;
    calculationInputDigest?: string;
  },
) {
  const evidenceProvenance = snapshot.lindung24Participation
    ? {
        evidenceNature: snapshot.lindung24Participation.evidenceNature,
        evidenceEnvironment: snapshot.lindung24Participation.evidenceEnvironment,
        fixturePurpose: snapshot.lindung24Participation.fixturePurpose,
        officialExportEligible:
          snapshot.lindung24Participation.officialExportEligible,
        statutoryNationalitySnapshot:
          snapshot.lindung24Participation.statutoryNationalitySnapshot,
      }
    : {
        evidenceNature: "REAL" as const,
        evidenceEnvironment: null,
        fixturePurpose: null,
        officialExportEligible: true,
        statutoryNationalitySnapshot: input.profile.statutoryNationality,
      };
  const sourceDigest = sha256({
    entryId: input.payrollEntryId,
    scheme: snapshot.scheme,
    status: snapshot.status,
    blockerCode: snapshot.blockerCode,
    ruleVersion: snapshot.rule?.version ?? null,
    artifactDigest: snapshot.rule?.sourceDigest ?? null,
    datasetDigest: snapshot.rule?.datasetDigest ?? null,
    fixtureDigest: snapshot.rule?.goldenFixtureDigest ?? null,
    classificationVersion: snapshot.rule?.classificationVersion ?? null,
    calculatorVersion: snapshot.rule?.calculatorVersion ?? null,
    matchedRuleKey: snapshot.matchedRuleKey ?? null,
    calculationInputDigest: snapshot.calculationInputDigest ?? null,
    profileRevision: input.profile.statutoryProfileRevision,
    taxProfileRevision: input.profile.taxProfileRevision,
    lindung24ParticipationVersionId: snapshot.lindung24Participation?.id ?? null,
    lindung24ParticipationRevision: snapshot.lindung24Participation?.revision ?? null,
    lindung24SelectedEmployer: snapshot.lindung24Participation?.selectedEmployer ?? null,
    statutoryParticipationStatus:
      snapshot.statutoryParticipation?.status === "RESOLVED"
        ? snapshot.statutoryParticipation.participationStatus
        : null,
    statutoryParticipationSource:
      snapshot.statutoryParticipation?.status === "RESOLVED"
        ? snapshot.statutoryParticipation.source
        : null,
    statutoryParticipationPeriodId:
      snapshot.statutoryParticipation?.status === "RESOLVED"
        ? snapshot.statutoryParticipation.period?.id ?? null
        : null,
    statutoryParticipationRevision:
      snapshot.statutoryParticipation?.status === "RESOLVED"
        ? snapshot.statutoryParticipation.period?.revision ?? null
        : null,
    ...evidenceProvenance,
    metadata: snapshot.metadata,
  });
  return database.payrollEntryStatutorySnapshot.create({
    data: {
      businessId: input.businessId,
      payrollRunId: input.payrollRunId,
      payrollEntryId: input.payrollEntryId,
      membershipId: input.membershipId,
      scheme: snapshot.scheme,
      status: snapshot.status,
      calculationSource: snapshot.calculationSource,
      ruleSetId: snapshot.rule?.id ?? null,
      ruleVersionSnapshot: snapshot.rule?.version ?? null,
      artifactDigestSnapshot: snapshot.rule?.sourceDigest ?? null,
      datasetDigestSnapshot: snapshot.rule?.datasetDigest ?? null,
      fixtureDigestSnapshot: snapshot.rule?.goldenFixtureDigest ?? null,
      classificationVersionSnapshot: snapshot.rule?.classificationVersion ?? null,
      parserVersionSnapshot: snapshot.rule?.parserVersion ?? null,
      calculatorVersionSnapshot: snapshot.rule?.calculatorVersion ?? null,
      matchedRuleKey: snapshot.matchedRuleKey ?? null,
      calculationInputDigest:
        snapshot.calculationInputDigest ??
        sha256({
          scheme: snapshot.scheme,
          payrollEntryId: input.payrollEntryId,
          profileRevision: input.profile.statutoryProfileRevision,
          taxProfileRevision: input.profile.taxProfileRevision,
          metadata: snapshot.metadata,
        }),
      profileVersionId: snapshot.profileVersionId,
      statutoryParticipationPeriodId:
        snapshot.statutoryParticipation?.status === "RESOLVED"
          ? snapshot.statutoryParticipation.period?.id ?? null
          : null,
      statutoryParticipationStatusSnapshot:
        snapshot.statutoryParticipation?.status === "RESOLVED"
          ? snapshot.statutoryParticipation.participationStatus
          : null,
      statutoryParticipationFromSnapshot:
        snapshot.statutoryParticipation?.status === "RESOLVED"
          ? snapshot.statutoryParticipation.period?.effectiveFromMonth ?? null
          : null,
      statutoryParticipationToSnapshot:
        snapshot.statutoryParticipation?.status === "RESOLVED"
          ? snapshot.statutoryParticipation.period?.effectiveToMonth ?? null
          : null,
      statutoryParticipationRevisionSnapshot:
        snapshot.statutoryParticipation?.status === "RESOLVED"
          ? snapshot.statutoryParticipation.period?.revision ?? null
          : null,
      statutoryParticipationSourceSnapshot:
        snapshot.statutoryParticipation?.status === "RESOLVED"
          ? snapshot.statutoryParticipation.period?.sourceReference ??
            snapshot.statutoryParticipation.source
          : null,
      lindung24ParticipationVersionId: snapshot.lindung24Participation?.id ?? null,
      lindung24ParticipationRevisionSnapshot:
        snapshot.lindung24Participation?.revision ?? null,
      lindung24EmployerSelectionSnapshot:
        snapshot.lindung24Participation?.selectedEmployer ?? null,
      ...evidenceProvenance,
      profileRevisionSnapshot: input.profile.statutoryProfileRevision,
      taxProfileRevisionSnapshot: input.profile.taxProfileRevision,
      wageBase: centsToMoney(snapshot.wageBaseCents ?? 0),
      employeeContribution: centsToMoney(snapshot.employeeContributionCents ?? 0),
      employerContribution: centsToMoney(snapshot.employerContributionCents ?? 0),
      blockerCode: snapshot.blockerCode,
      calculationMetadata: snapshot.metadata as Prisma.InputJsonValue,
      sourceDigest,
    },
  });
}

function sha256(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
