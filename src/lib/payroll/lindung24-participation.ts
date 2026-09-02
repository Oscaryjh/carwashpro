import { createHash } from "node:crypto";
import type {
  EmployeeStatutoryNationality,
  Lindung24EmployerContext,
  Lindung24ParticipationSourceType,
  Lindung24ParticipationStatus,
  Lindung24SelectedEmployer,
} from "@prisma/client";

export const LINDUNG24_BLOCKERS = {
  PROFILE_INCOMPLETE: "LINDUNG24_PROFILE_INCOMPLETE",
  PARTICIPATION_REQUIRED: "LINDUNG24_PARTICIPATION_REQUIRED",
  PARTICIPATION_OVERLAP: "LINDUNG24_PARTICIPATION_PERIOD_OVERLAP",
  PARTICIPATION_INVALID: "LINDUNG24_PARTICIPATION_INVALID",
  SELECTED_EMPLOYER_REQUIRED: "LINDUNG24_SELECTED_EMPLOYER_REQUIRED",
  LEGACY_REVIEW_REQUIRED: "LEGACY_LINDUNG24_PARTICIPATION_REVIEW_REQUIRED",
  REFUND_REVIEW_REQUIRED: "LINDUNG24_REFUND_REVIEW_REQUIRED",
} as const;

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
  // Testing's canonical fixture-evidence migration permits these fields to be
  // null only for explicitly synthetic evidence. The legacy payroll reader
  // does not consume synthetic evidence, so nullable rows must fail closed.
  sourceType: Lindung24ParticipationSourceType | null;
  sourceReference: string | null;
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
  records: readonly Lindung24ParticipationEvidence[];
}):
  | { status: "NOT_APPLICABLE"; reason: string; participation: Lindung24ParticipationEvidence | null }
  | { status: "NO_CONTRIBUTION"; reason: string; participation: Lindung24ParticipationEvidence }
  | { status: "CONTRIBUTION_REQUIRED"; participation: Lindung24ParticipationEvidence; employeeCategory: "LOCAL" | "FOREIGN" }
  | { status: "BLOCKED"; blockerCode: string; participation: Lindung24ParticipationEvidence | null } {
  const period = monthStart(input.statutoryPeriod);
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
  const eligibility = resolveLindung24Eligibility({
    act4Covered: participation?.act4Covered ?? null,
    isEmployee: true,
    statutoryNationality: input.statutoryNationality,
  });
  if (eligibility.status === "INSUFFICIENT_PROFILE") {
    return { status: "BLOCKED", blockerCode: LINDUNG24_BLOCKERS.PROFILE_INCOMPLETE, participation };
  }
  if (eligibility.status === "NOT_ELIGIBLE") {
    return { status: "NOT_APPLICABLE", reason: eligibility.reason, participation };
  }
  if (!participation) {
    return { status: "BLOCKED", blockerCode: LINDUNG24_BLOCKERS.PARTICIPATION_REQUIRED, participation: null };
  }
  if (!participation.sourceType || !participation.sourceReference?.trim()) {
    return {
      status: "BLOCKED",
      blockerCode: LINDUNG24_BLOCKERS.PARTICIPATION_INVALID,
      participation,
    };
  }
  if (participation.sourceType === "LEGACY_REVIEW") {
    return { status: "BLOCKED", blockerCode: LINDUNG24_BLOCKERS.LEGACY_REVIEW_REQUIRED, participation };
  }
  if (!isOfficiallyValidState(participation, eligibility.employeeCategory, period)) {
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
  if (next.employerContext === "SINGLE_EMPLOYER" && next.selectedEmployer !== "CURRENT_BUSINESS") {
    throw new Error(LINDUNG24_BLOCKERS.SELECTED_EMPLOYER_REQUIRED);
  }
  if (next.status === "VOLUNTARY_OPT_IN" || next.status === "VOLUNTARY_OPT_OUT") {
    if (!next.officialSubmittedAt) throw new Error(LINDUNG24_BLOCKERS.PARTICIPATION_INVALID);
  }
  if (next.status === "VOLUNTARY_OPT_OUT") {
    if (input.employeeCategory !== "LOCAL" || next.sourceType !== "EMPLOYEE_OPT_OUT") {
      throw new Error(LINDUNG24_BLOCKERS.PARTICIPATION_INVALID);
    }
    if (input.previous?.status === "VOLUNTARY_OPT_IN") {
      throw new Error("LINDUNG24_ONCE_IN_ALWAYS_IN");
    }
    const transitionDeadline = new Date("2026-08-31T15:59:59.999Z");
    if (next.officialSubmittedAt!.getTime() > transitionDeadline.getTime() && input.hasPriorCalculatedContribution) {
      throw new Error("LINDUNG24_ONCE_IN_ALWAYS_IN");
    }
  }
  if (input.employeeCategory === "FOREIGN" && next.status !== "MANDATORY") {
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
  period: Date,
) {
  const juneStart = new Date("2026-06-01T00:00:00.000Z");
  const julyStart = new Date("2026-07-01T00:00:00.000Z");
  if (period.getTime() < juneStart.getTime()) return false;
  if (period.getTime() < julyStart.getTime()) return participation.status === "MANDATORY";
  if (employeeCategory === "FOREIGN") return participation.status === "MANDATORY";
  if (participation.status === "MANDATORY") return false;
  if (
    participation.status === "VOLUNTARY_OPT_IN" ||
    participation.status === "VOLUNTARY_OPT_OUT"
  ) {
    return Boolean(participation.officialSubmittedAt);
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
