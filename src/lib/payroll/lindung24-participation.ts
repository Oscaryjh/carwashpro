import { createHash } from "node:crypto";
import type {
  EmployeeStatutoryNationality,
  Lindung24EmployerContext,
  Lindung24ParticipationSourceType,
  Lindung24ParticipationStatus,
  Lindung24SelectedEmployer,
  StatutoryEvidenceEnvironment,
  StatutoryEvidenceNature,
  StatutoryFixturePurpose,
} from "@prisma/client";
import type { RuntimeEnvironmentMap } from "@/lib/release/environment";
import {
  assertStatutoryEvidenceReadAllowed,
  validateStatutoryEvidenceProvenance,
} from "./statutory-evidence";

export const LINDUNG24_BLOCKERS = {
  APPLICABILITY_INCOMPLETE: "LINDUNG24_APPLICABILITY_INCOMPLETE",
  LOCAL_PARTICIPATION_DECISION_REQUIRED:
    "LINDUNG24_LOCAL_PARTICIPATION_DECISION_REQUIRED",
  FOREIGN_MANDATORY_PROFILE_INCOMPLETE:
    "LINDUNG24_FOREIGN_MANDATORY_PROFILE_INCOMPLETE",
  POLICY_TRANSITION_REVIEW_REQUIRED:
    "LINDUNG24_POLICY_TRANSITION_REVIEW_REQUIRED",
  PROFILE_INCOMPLETE: "LINDUNG24_APPLICABILITY_INCOMPLETE",
  PARTICIPATION_REQUIRED: "LINDUNG24_LOCAL_PARTICIPATION_DECISION_REQUIRED",
  PARTICIPATION_OVERLAP: "LINDUNG24_PARTICIPATION_PERIOD_OVERLAP",
  PARTICIPATION_INVALID: "LINDUNG24_PARTICIPATION_INVALID",
  SELECTED_EMPLOYER_REQUIRED:
    "LINDUNG24_MULTIPLE_EMPLOYER_SELECTION_REQUIRED",
  LEGACY_REVIEW_REQUIRED: "LEGACY_LINDUNG24_PARTICIPATION_REVIEW_REQUIRED",
  REFUND_REVIEW_REQUIRED: "LINDUNG24_REFUND_REVIEW_REQUIRED",
} as const;

export const LINDUNG24_POLICY_DATES = {
  initialMandatoryFrom: "2026-06-01",
  localVoluntaryAnnouncement: "2026-07-08",
  localTransitionReviewMonth: "2026-07-01",
  currentMonthlyPolicyFrom: "2026-08-01",
  transitionOptOutFrom: "2026-07-13",
  transitionOptOutUntil: "2026-08-31T15:59:59.999Z",
  phase2From: "2028-06-01",
  phase3From: "2031-06-01",
} as const;

export type Lindung24PolicyEra =
  | "NOT_STARTED"
  | "INITIAL_MANDATORY"
  | "LOCAL_TRANSITION_REVIEW"
  | "CURRENT_LOCAL_VOLUNTARY_FOREIGN_MANDATORY";

export function resolveLindung24PolicyEra(statutoryPeriod: Date): Lindung24PolicyEra {
  const period = monthStart(statutoryPeriod).getTime();
  if (period < Date.parse(LINDUNG24_POLICY_DATES.initialMandatoryFrom)) {
    return "NOT_STARTED";
  }
  if (period < Date.parse(LINDUNG24_POLICY_DATES.localTransitionReviewMonth)) {
    return "INITIAL_MANDATORY";
  }
  if (period < Date.parse(LINDUNG24_POLICY_DATES.currentMonthlyPolicyFrom)) {
    return "LOCAL_TRANSITION_REVIEW";
  }
  return "CURRENT_LOCAL_VOLUNTARY_FOREIGN_MANDATORY";
}

export type Lindung24ParticipationEvidence = {
  id: string;
  businessId: string;
  membershipId: string;
  revision: number;
  effectiveFromMonth: Date;
  effectiveToMonth: Date | null;
  status: Lindung24ParticipationStatus;
  employerContext: Lindung24EmployerContext;
  selectedEmployer: Lindung24SelectedEmployer;
  act4Covered: boolean;
  officialSubmittedAt: Date | null;
  sourceType: Lindung24ParticipationSourceType | null;
  sourceReference: string | null;
  evidenceNature: StatutoryEvidenceNature;
  evidenceEnvironment: StatutoryEvidenceEnvironment | null;
  fixturePurpose: StatutoryFixturePurpose | null;
  officialExportEligible: boolean;
  statutoryNationalitySnapshot: EmployeeStatutoryNationality | null;
  sourceDigest: string;
};

export type Lindung24EligibilityResult =
  | { status: "ELIGIBLE"; employeeCategory: "LOCAL" | "FOREIGN" }
  | { status: "NOT_ELIGIBLE"; reason: string }
  | { status: "INSUFFICIENT_PROFILE"; missing: string[] };

export function resolveLindung24Eligibility(input: {
  act4Covered: boolean | null;
  isEmployee: boolean;
  statutoryNationality: EmployeeStatutoryNationality | null;
}): Lindung24EligibilityResult {
  if (!input.isEmployee) {
    return { status: "NOT_ELIGIBLE", reason: "NOT_AN_EMPLOYEE_UNDER_CONTRACT_OF_SERVICE" };
  }
  const missing = [
    input.act4Covered === null ? "act4Covered" : null,
    input.statutoryNationality === null ? "statutoryNationality" : null,
  ].filter((value): value is string => Boolean(value));
  if (missing.length) return { status: "INSUFFICIENT_PROFILE", missing };
  if (!input.act4Covered) {
    return { status: "NOT_ELIGIBLE", reason: "NOT_COVERED_BY_EMPLOYEES_SOCIAL_SECURITY_ACT_1969" };
  }
  return {
    status: "ELIGIBLE",
    employeeCategory:
      input.statutoryNationality === "NON_MALAYSIAN" ? "FOREIGN" : "LOCAL",
  };
}

export function resolveLindung24ParticipationForPeriod(input: {
  businessId: string;
  membershipId: string;
  statutoryPeriod: Date;
  statutoryNationality: EmployeeStatutoryNationality | null;
  act4Covered?: boolean | null;
  records: readonly Lindung24ParticipationEvidence[];
  environment?: RuntimeEnvironmentMap;
}):
  | { status: "NOT_APPLICABLE"; reason: string; participation: Lindung24ParticipationEvidence | null }
  | { status: "NO_CONTRIBUTION"; reason: string; participation: Lindung24ParticipationEvidence }
  | { status: "CONTRIBUTION_REQUIRED"; participation: Lindung24ParticipationEvidence; employeeCategory: "LOCAL" | "FOREIGN" }
  | { status: "BLOCKED"; blockerCode: string; participation: Lindung24ParticipationEvidence | null } {
  const period = monthStart(input.statutoryPeriod);
  const policyEra = resolveLindung24PolicyEra(period);
  const applicable = input.records.filter(
    (record) =>
      record.businessId === input.businessId &&
      record.membershipId === input.membershipId &&
      record.effectiveFromMonth.getTime() <= period.getTime() &&
      (!record.effectiveToMonth || record.effectiveToMonth.getTime() > period.getTime()),
  );
  if (applicable.length > 1) {
    return { status: "BLOCKED", blockerCode: LINDUNG24_BLOCKERS.PARTICIPATION_OVERLAP, participation: null };
  }
  const participation = applicable[0] ?? null;
  if (participation) {
    assertStatutoryEvidenceReadAllowed(participation, input.environment);
    validateStatutoryEvidenceProvenance(participation);
  }
  if (policyEra === "NOT_STARTED") {
    return {
      status: "NOT_APPLICABLE",
      reason: "LINDUNG24_NOT_EFFECTIVE_FOR_PERIOD",
      participation,
    };
  }
  const eligibility = resolveLindung24Eligibility({
    act4Covered: participation?.act4Covered ?? input.act4Covered ?? null,
    isEmployee: true,
    statutoryNationality:
      participation?.evidenceNature === "SYNTHETIC_TESTING"
        ? participation.statutoryNationalitySnapshot
        : input.statutoryNationality,
  });
  if (eligibility.status === "INSUFFICIENT_PROFILE") {
    return {
      status: "BLOCKED",
      blockerCode:
        (participation?.evidenceNature === "SYNTHETIC_TESTING"
          ? participation.statutoryNationalitySnapshot
          : input.statutoryNationality) === "NON_MALAYSIAN"
          ? LINDUNG24_BLOCKERS.FOREIGN_MANDATORY_PROFILE_INCOMPLETE
          : LINDUNG24_BLOCKERS.APPLICABILITY_INCOMPLETE,
      participation,
    };
  }
  if (eligibility.status === "NOT_ELIGIBLE") {
    return { status: "NOT_APPLICABLE", reason: eligibility.reason, participation };
  }
  if (!participation) {
    return {
      status: "BLOCKED",
      blockerCode:
        eligibility.employeeCategory === "FOREIGN"
          ? LINDUNG24_BLOCKERS.FOREIGN_MANDATORY_PROFILE_INCOMPLETE
          : LINDUNG24_BLOCKERS.LOCAL_PARTICIPATION_DECISION_REQUIRED,
      participation: null,
    };
  }
  if (participation.sourceType === "LEGACY_REVIEW") {
    return {
      status: "BLOCKED",
      blockerCode:
        eligibility.employeeCategory === "LOCAL" &&
        policyEra === "CURRENT_LOCAL_VOLUNTARY_FOREIGN_MANDATORY"
          ? LINDUNG24_BLOCKERS.LOCAL_PARTICIPATION_DECISION_REQUIRED
          : LINDUNG24_BLOCKERS.LEGACY_REVIEW_REQUIRED,
      participation,
    };
  }
  if (
    eligibility.employeeCategory === "LOCAL" &&
    policyEra === "LOCAL_TRANSITION_REVIEW"
  ) {
    return {
      status: "BLOCKED",
      blockerCode: LINDUNG24_BLOCKERS.POLICY_TRANSITION_REVIEW_REQUIRED,
      participation,
    };
  }
  if (!isOfficiallyValidState(participation, eligibility.employeeCategory, policyEra)) {
    return { status: "BLOCKED", blockerCode: LINDUNG24_BLOCKERS.PARTICIPATION_INVALID, participation };
  }
  if (participation.status === "VOLUNTARY_OPT_OUT") {
    return { status: "NO_CONTRIBUTION", reason: "OFFICIAL_LOCAL_EMPLOYEE_OPT_OUT", participation };
  }
  if (participation.employerContext === "SINGLE_EMPLOYER") {
    if (participation.selectedEmployer !== "CURRENT_BUSINESS") {
      return { status: "BLOCKED", blockerCode: LINDUNG24_BLOCKERS.SELECTED_EMPLOYER_REQUIRED, participation };
    }
  } else if (participation.selectedEmployer === "PERKESO_SELECTION_PENDING") {
    return { status: "BLOCKED", blockerCode: LINDUNG24_BLOCKERS.SELECTED_EMPLOYER_REQUIRED, participation };
  } else if (participation.selectedEmployer === "OTHER_EMPLOYER") {
    return { status: "NO_CONTRIBUTION", reason: "OTHER_EMPLOYER_SELECTED_BY_OFFICIAL_EVIDENCE", participation };
  }
  return { status: "CONTRIBUTION_REQUIRED", participation, employeeCategory: eligibility.employeeCategory };
}

export function validateLindung24ParticipationChange(input: {
  next: Omit<Lindung24ParticipationEvidence, "id" | "revision" | "sourceDigest">;
  previous: Lindung24ParticipationEvidence | null;
  hasPriorCalculatedContribution: boolean;
  employeeCategory: "LOCAL" | "FOREIGN";
}) {
  const next = input.next;
  validateStatutoryEvidenceProvenance(next);
  if (next.evidenceNature === "REAL") {
    if (!next.sourceType || !next.sourceReference?.trim()) {
      throw new Error(LINDUNG24_BLOCKERS.PARTICIPATION_INVALID);
    }
  } else if (
    next.sourceType !== null ||
    next.sourceReference !== null ||
    next.officialSubmittedAt !== null
  ) {
    throw new Error(LINDUNG24_BLOCKERS.PARTICIPATION_INVALID);
  }
  const policyEra = resolveLindung24PolicyEra(next.effectiveFromMonth);
  if (next.employerContext === "SINGLE_EMPLOYER" && next.selectedEmployer !== "CURRENT_BUSINESS") {
    throw new Error(LINDUNG24_BLOCKERS.SELECTED_EMPLOYER_REQUIRED);
  }
  if (
    next.evidenceNature === "REAL" &&
    (next.status === "VOLUNTARY_OPT_IN" || next.status === "VOLUNTARY_OPT_OUT")
  ) {
    if (!next.officialSubmittedAt) throw new Error(LINDUNG24_BLOCKERS.PARTICIPATION_INVALID);
  }
  if (next.status === "VOLUNTARY_OPT_OUT") {
    if (
      input.employeeCategory !== "LOCAL" ||
      (next.evidenceNature === "REAL" && next.sourceType !== "EMPLOYEE_OPT_OUT")
    ) {
      throw new Error(LINDUNG24_BLOCKERS.PARTICIPATION_INVALID);
    }
    if (input.previous?.status === "VOLUNTARY_OPT_IN") {
      throw new Error("LINDUNG24_ONCE_IN_ALWAYS_IN");
    }
    const transitionDeadline = new Date(LINDUNG24_POLICY_DATES.transitionOptOutUntil);
    if (
      next.officialSubmittedAt &&
      next.officialSubmittedAt.getTime() > transitionDeadline.getTime() &&
      input.hasPriorCalculatedContribution
    ) {
      throw new Error("LINDUNG24_ONCE_IN_ALWAYS_IN");
    }
  }
  if (input.employeeCategory === "FOREIGN" && next.status !== "MANDATORY") {
    throw new Error(LINDUNG24_BLOCKERS.PARTICIPATION_INVALID);
  }
  if (
    input.employeeCategory === "LOCAL" &&
    policyEra === "CURRENT_LOCAL_VOLUNTARY_FOREIGN_MANDATORY" &&
    next.status === "MANDATORY"
  ) {
    throw new Error(LINDUNG24_BLOCKERS.PARTICIPATION_INVALID);
  }
  if (policyEra === "INITIAL_MANDATORY" && next.status !== "MANDATORY") {
    throw new Error(LINDUNG24_BLOCKERS.PARTICIPATION_INVALID);
  }
  if (input.previous) {
    const previousStart = monthStart(input.previous.effectiveFromMonth);
    const nextStart = monthStart(next.effectiveFromMonth);
    if (nextStart.getTime() <= previousStart.getTime()) {
      throw new Error(LINDUNG24_BLOCKERS.PARTICIPATION_OVERLAP);
    }
  }
}

export function lindung24ParticipationDigest(input: {
  businessId: string;
  membershipId: string;
  revision: number;
  effectiveFromMonth: Date;
  effectiveToMonth: Date | null;
  status: Lindung24ParticipationStatus;
  employerContext: Lindung24EmployerContext;
  selectedEmployer: Lindung24SelectedEmployer;
  act4Covered: boolean;
  officialSubmittedAt: Date | null;
  sourceType: Lindung24ParticipationSourceType | null;
  sourceReference: string | null;
  evidenceNature: StatutoryEvidenceNature;
  evidenceEnvironment: StatutoryEvidenceEnvironment | null;
  fixturePurpose: StatutoryFixturePurpose | null;
  officialExportEligible: boolean;
  statutoryNationalitySnapshot: EmployeeStatutoryNationality | null;
  reason: string;
}) {
  return createHash("sha256")
    .update(stableJson({
      ...input,
      effectiveFromMonth: monthKey(input.effectiveFromMonth),
      effectiveToMonth: input.effectiveToMonth ? monthKey(input.effectiveToMonth) : null,
      officialSubmittedAt: input.officialSubmittedAt?.toISOString() ?? null,
    }))
    .digest("hex");
}

export function monthStart(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function monthKey(value: Date) {
  return monthStart(value).toISOString().slice(0, 10);
}

function isOfficiallyValidState(
  participation: Lindung24ParticipationEvidence,
  employeeCategory: "LOCAL" | "FOREIGN",
  policyEra: Lindung24PolicyEra,
) {
  if (policyEra === "NOT_STARTED") return false;
  if (policyEra === "INITIAL_MANDATORY") return participation.status === "MANDATORY";
  if (policyEra === "LOCAL_TRANSITION_REVIEW") {
    return employeeCategory === "FOREIGN" && participation.status === "MANDATORY";
  }
  if (employeeCategory === "FOREIGN") return participation.status === "MANDATORY";
  if (participation.status === "MANDATORY") return false;
  if (
    participation.status === "VOLUNTARY_OPT_IN" ||
    participation.status === "VOLUNTARY_OPT_OUT"
  ) {
    return participation.evidenceNature === "SYNTHETIC_TESTING" ||
      Boolean(participation.officialSubmittedAt);
  }
  return participation.status === "DEFAULT_PARTICIPATING";
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
