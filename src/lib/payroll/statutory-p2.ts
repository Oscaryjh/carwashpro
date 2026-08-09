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
import type { NormalizedContributionDataset } from "./statutory-artifact-pipeline";
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

export const STATUTORY_P2_BLOCKERS = {
  EPF_RULE_NOT_READY: "EPF_RULE_NOT_READY",
  EPF_CATEGORY_REQUIRED: "EPF_CATEGORY_REQUIRED",
  SOCSO_RULE_NOT_READY: "SOCSO_RULE_NOT_READY",
  EIS_RULE_NOT_READY: "EIS_RULE_NOT_READY",
  LINDUNG24_RULE_NOT_READY: "LINDUNG24_RULE_NOT_READY",
  LINDUNG24_PROFILE_INCOMPLETE: LINDUNG24_BLOCKERS.PROFILE_INCOMPLETE,
  LINDUNG24_PARTICIPATION_REQUIRED: LINDUNG24_BLOCKERS.PARTICIPATION_REQUIRED,
  LINDUNG24_SELECTED_EMPLOYER_REQUIRED: LINDUNG24_BLOCKERS.SELECTED_EMPLOYER_REQUIRED,
  PCB_RULE_NOT_READY: "PCB_RULE_NOT_READY",
  PCB_PROFILE_INCOMPLETE: "PCB_PROFILE_INCOMPLETE",
  STATUTORY_PROFILE_INCOMPLETE: "STATUTORY_PROFILE_INCOMPLETE",
  STATUTORY_RULE_NOT_AVAILABLE: "STATUTORY_RULE_NOT_AVAILABLE",
  STATUTORY_CLASSIFICATION_REQUIRED: "STATUTORY_CLASSIFICATION_REQUIRED",
  STATUTORY_CALCULATION_NOT_READY: "STATUTORY_CALCULATION_NOT_READY",
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
  parserVersion?: string | null;
  calculatorVersion?: string | null;
  ruleData?: Prisma.JsonValue | null;
};

export type MaterializedStatutoryRuleCandidate = StatutoryRuleCandidate & {
  classifications: Array<{
    id: string;
    componentCode: string;
    sourceType: string | null;
    treatment: StatutoryComponentTreatment;
    rationale: string;
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
  classifications: ReadonlyArray<{
    id: string;
    componentCode: string;
    sourceType: string | null;
    treatment: StatutoryComponentTreatment;
    rationale: string;
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
  return exact ?? generic ?? null;
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
  },
) {
  const schemes: StatutoryScheme[] = ["EPF", "SOCSO", "EIS", "LINDUNG24", "PCB"];
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
  });
  let profileVersionId: string | null = null;
  if (requiredSchemes.length) {
    const existingProfile = await database.employeeStatutoryProfileVersion.findUnique({
      where: {
        membershipId_revision: {
          membershipId: input.membershipId,
          revision: input.profile.statutoryProfileRevision,
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
          revision: input.profile.statutoryProfileRevision,
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
        include: { classifications: true },
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
          records: lindung24Participation,
        })
      : null;
    const eligibility = scheme === "LINDUNG24"
      ? null
      : resolveStatutorySchemeEligibility({
          scheme,
          statutoryPeriod: input.statutoryPeriod,
          profile: input.profile,
        });
    let blocker: string | null = null;
    if (lindungResolution?.status === "NOT_APPLICABLE" || lindungResolution?.status === "NO_CONTRIBUTION") {
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
    if (lindungResolution?.status === "BLOCKED") {
      blocker =
        input.profile.lindung24OptIn && !lindungResolution.participation
          ? LINDUNG24_BLOCKERS.LEGACY_REVIEW_REQUIRED
          : lindungResolution.blockerCode;
    } else if (eligibility?.status === "NOT_APPLICABLE") {
      await createSnapshot(database, input, {
        scheme,
        status: "NOT_APPLICABLE",
        calculationSource: "NOT_APPLICABLE",
        blockerCode: null,
        rule: applicable,
        profileVersionId,
        metadata: { eligibility: eligibility.reason },
      });
      continue;
    } else if (eligibility?.status === "PROFILE_INCOMPLETE") {
      blocker = STATUTORY_P2_BLOCKERS.STATUTORY_PROFILE_INCOMPLETE;
    } else if (scheme === "PCB" && input.profile.taxProfileRevision === 0) {
      blocker = STATUTORY_P2_BLOCKERS.PCB_PROFILE_INCOMPLETE;
    } else if (!applicable) {
      blocker = STATUTORY_P2_BLOCKERS.STATUTORY_RULE_NOT_AVAILABLE;
    } else if (applicable.readiness !== "CALCULATION_VERIFIED") {
      blocker = ruleNotReadyCode(scheme);
    } else if (unknownClassification) {
      blocker = STATUTORY_P2_BLOCKERS.STATUTORY_CLASSIFICATION_REQUIRED;
    } else if (scheme === "EPF" || scheme === "SOCSO" || scheme === "EIS" || scheme === "LINDUNG24") {
      const wageBaseCents = treatments.reduce(
        (total, item) =>
          total +
          (item.component.type === "EARNING" && item.treatment === "INCLUDED"
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
    } else {
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
    pcbCents: 0,
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
  const calculatedRules = (["EPF", "SOCSO", "EIS", "LINDUNG24"] as const)
    .filter((scheme) => schemeResults[scheme])
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
      pcb: "0.00",
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
  return { blockers, profileVersionId, schemeResults };
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

function contributionDatasetFromRule(
  rule: StatutoryRuleCandidate,
  scheme: "EPF" | "SOCSO" | "EIS" | "LINDUNG24",
) {
  if (!rule.ruleData || Array.isArray(rule.ruleData) || typeof rule.ruleData !== "object") {
    throw new Error("STATUTORY_RULE_DATASET_NOT_RETAINED");
  }
  const dataset = rule.ruleData as unknown as NormalizedContributionDataset;
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
    lindung24Participation?: Lindung24ParticipationEvidence | null;
    metadata: Record<string, unknown>;
    wageBaseCents?: number;
    employeeContributionCents?: number;
    employerContributionCents?: number;
    matchedRuleKey?: string | null;
    calculationInputDigest?: string;
  },
) {
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
      lindung24ParticipationVersionId: snapshot.lindung24Participation?.id ?? null,
      lindung24ParticipationRevisionSnapshot:
        snapshot.lindung24Participation?.revision ?? null,
      lindung24EmployerSelectionSnapshot:
        snapshot.lindung24Participation?.selectedEmployer ?? null,
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
