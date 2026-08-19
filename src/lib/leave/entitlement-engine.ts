import type {
  EmployeeEmploymentType,
  LeaveEntitlementPeriodType,
  LeaveEntitlementRounding,
  LeaveEntitlementSemantics,
  LeaveProrationMethod,
} from "@prisma/client";

const DAY_MS = 86_400_000;

export type LeaveEligibilityResult = Readonly<{
  status: "ELIGIBLE" | "NOT_ELIGIBLE" | "REVIEW_REQUIRED";
  code:
    | "ELIGIBLE"
    | "NOT_JOINED"
    | "EMPLOYMENT_ENDED"
    | "EMPLOYMENT_TYPE_NOT_ELIGIBLE"
    | "EVENT_EVIDENCE_REQUIRED";
  explanation: string;
}>;

export type EntitlementTier = Readonly<{
  minServiceMonths: number;
  maxServiceMonths?: number | null;
  entitlementUnits: number;
}>;

export type LeaveEntitlementCalculation = Readonly<{
  eligibility: LeaveEligibilityResult;
  periodStart: Date;
  periodEnd: Date;
  serviceMonths: number;
  statutoryUnits: number;
  companyUnits: number;
  effectiveBaseUnits: number;
  overlapStart: Date | null;
  overlapEnd: Date | null;
  periodDays: number;
  eligibleDays: number;
  prorationFactor: number;
  rawEntitledUnits: number;
  entitledUnits: number;
  rounding: LeaveEntitlementRounding;
  explanation: readonly string[];
}>;

function utcDate(year: number, monthIndex: number, day: number) {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex, Math.min(day, lastDay)));
}

function startOfUtcDate(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addUtcYears(value: Date, years: number) {
  return utcDate(value.getUTCFullYear() + years, value.getUTCMonth(), value.getUTCDate());
}

function previousDay(value: Date) {
  return new Date(value.getTime() - DAY_MS);
}

export function completedServiceMonths(joinedAt: Date, asOf: Date) {
  const joined = startOfUtcDate(joinedAt);
  const date = startOfUtcDate(asOf);
  if (date < joined) return 0;
  let months = (date.getUTCFullYear() - joined.getUTCFullYear()) * 12
    + date.getUTCMonth() - joined.getUTCMonth();
  if (date.getUTCDate() < joined.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

export function resolveEntitlementPeriod(input: {
  type: LeaveEntitlementPeriodType;
  asOf: Date;
  joinedAt: Date;
  customYearStartMonth?: number | null;
  customYearStartDay?: number | null;
}) {
  const asOf = startOfUtcDate(input.asOf);
  if (input.type === "CALENDAR_YEAR") {
    return {
      start: new Date(Date.UTC(asOf.getUTCFullYear(), 0, 1)),
      end: new Date(Date.UTC(asOf.getUTCFullYear(), 11, 31)),
    };
  }

  const monthIndex = input.type === "SERVICE_ANNIVERSARY"
    ? input.joinedAt.getUTCMonth()
    : (input.customYearStartMonth ?? 0) - 1;
  const day = input.type === "SERVICE_ANNIVERSARY"
    ? input.joinedAt.getUTCDate()
    : input.customYearStartDay ?? 0;
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) {
    throw new Error("A valid custom entitlement year start is required.");
  }

  let start = utcDate(asOf.getUTCFullYear(), monthIndex, day);
  if (start > asOf) start = utcDate(asOf.getUTCFullYear() - 1, monthIndex, day);
  return { start, end: previousDay(addUtcYears(start, 1)) };
}

export function evaluateLeaveEligibility(input: {
  joinedAt: Date;
  terminatedAt?: Date | null;
  employmentType: EmployeeEmploymentType;
  eligibleEmploymentTypes?: readonly EmployeeEmploymentType[];
  periodStart: Date;
  periodEnd: Date;
  entitlementSemantics?: LeaveEntitlementSemantics;
}): LeaveEligibilityResult {
  if (startOfUtcDate(input.joinedAt) > input.periodEnd) {
    return { status: "NOT_ELIGIBLE", code: "NOT_JOINED", explanation: "Employment starts after this entitlement period." };
  }
  if (input.terminatedAt && startOfUtcDate(input.terminatedAt) < input.periodStart) {
    return { status: "NOT_ELIGIBLE", code: "EMPLOYMENT_ENDED", explanation: "Employment ended before this entitlement period." };
  }
  if ((input.eligibleEmploymentTypes?.length ?? 0) > 0
    && !input.eligibleEmploymentTypes!.includes(input.employmentType)) {
    return { status: "NOT_ELIGIBLE", code: "EMPLOYMENT_TYPE_NOT_ELIGIBLE", explanation: "Employment type is not included by the reviewed rule or company policy." };
  }
  if (input.entitlementSemantics === "EVENT_BASED") {
    return { status: "REVIEW_REQUIRED", code: "EVENT_EVIDENCE_REQUIRED", explanation: "This leave is event-based and requires human-reviewed eligibility evidence." };
  }
  return { status: "ELIGIBLE", code: "ELIGIBLE", explanation: "Employment dates and configured employment-type rules are satisfied." };
}

export function resolveTierUnits(tiers: readonly EntitlementTier[], serviceMonths: number) {
  const tier = [...tiers]
    .sort((left, right) => right.minServiceMonths - left.minServiceMonths)
    .find((candidate) => serviceMonths >= candidate.minServiceMonths
      && (candidate.maxServiceMonths == null || serviceMonths <= candidate.maxServiceMonths));
  return tier?.entitlementUnits ?? 0;
}

export function roundLeaveUnits(value: number, method: LeaveEntitlementRounding) {
  if (method === "STATUTORY_WHOLE_DAY") {
    const whole = Math.floor(value);
    return whole + (value - whole >= 0.5 ? 1 : 0);
  }
  if (method === "DOWN_TO_HALF_DAY") return Math.floor(value * 2) / 2;
  if (method === "NEAREST_HALF_DAY") return Math.round(value * 2) / 2;
  if (method === "UP_TO_HALF_DAY") return Math.ceil(value * 2) / 2;
  return Math.round(value * 10_000) / 10_000;
}

function maxDate(left: Date, right: Date) {
  return left > right ? left : right;
}

function minDate(left: Date, right: Date) {
  return left < right ? left : right;
}

function inclusiveDays(start: Date, end: Date) {
  return Math.floor((startOfUtcDate(end).getTime() - startOfUtcDate(start).getTime()) / DAY_MS) + 1;
}

export function calculateLeaveEntitlement(input: {
  periodStart: Date;
  periodEnd: Date;
  joinedAt: Date;
  terminatedAt?: Date | null;
  policyEffectiveFrom?: Date | null;
  eligibility: LeaveEligibilityResult;
  serviceTiers: readonly EntitlementTier[];
  statutoryTiers?: readonly EntitlementTier[];
  prorationMethod: LeaveProrationMethod;
  rounding: LeaveEntitlementRounding;
}) : LeaveEntitlementCalculation {
  const periodStart = startOfUtcDate(input.periodStart);
  const periodEnd = startOfUtcDate(input.periodEnd);
  const serviceMonths = completedServiceMonths(input.joinedAt, periodEnd);
  const companyUnits = resolveTierUnits(input.serviceTiers, serviceMonths);
  const statutoryUnits = resolveTierUnits(input.statutoryTiers ?? [], serviceMonths);
  const effectiveBaseUnits = Math.max(companyUnits, statutoryUnits);
  const explanation = [
    `Company policy base: ${companyUnits}.`,
    `Active reviewed statutory minimum: ${statutoryUnits}.`,
    `Effective compliant base: ${effectiveBaseUnits}.`,
  ];

  if (input.eligibility.status !== "ELIGIBLE") {
    return {
      eligibility: input.eligibility,
      periodStart,
      periodEnd,
      serviceMonths,
      statutoryUnits,
      companyUnits,
      effectiveBaseUnits,
      overlapStart: null,
      overlapEnd: null,
      periodDays: inclusiveDays(periodStart, periodEnd),
      eligibleDays: 0,
      prorationFactor: 0,
      rawEntitledUnits: 0,
      entitledUnits: 0,
      rounding: input.rounding,
      explanation: [...explanation, input.eligibility.explanation],
    };
  }

  const overlapStart = [periodStart, startOfUtcDate(input.joinedAt), input.policyEffectiveFrom ? startOfUtcDate(input.policyEffectiveFrom) : periodStart]
    .reduce(maxDate);
  const overlapEnd = input.terminatedAt
    ? minDate(periodEnd, startOfUtcDate(input.terminatedAt))
    : periodEnd;
  const periodDays = inclusiveDays(periodStart, periodEnd);
  const eligibleDays = overlapEnd < overlapStart ? 0 : inclusiveDays(overlapStart, overlapEnd);
  const completedEligibleMonths = eligibleDays > 0
    ? Math.min(12, completedServiceMonths(overlapStart, new Date(overlapEnd.getTime() + DAY_MS)))
    : 0;
  const prorationFactor = input.prorationMethod === "CALENDAR_DAY_RATIO"
    ? eligibleDays / periodDays
    : input.prorationMethod === "COMPLETED_MONTHS"
      ? completedEligibleMonths / 12
      : eligibleDays > 0 ? 1 : 0;
  const rawEntitledUnits = effectiveBaseUnits * prorationFactor;
  const entitledUnits = roundLeaveUnits(rawEntitledUnits, input.rounding);

  return {
    eligibility: input.eligibility,
    periodStart,
    periodEnd,
    serviceMonths,
    statutoryUnits,
    companyUnits,
    effectiveBaseUnits,
    overlapStart,
    overlapEnd,
    periodDays,
    eligibleDays,
    prorationFactor,
    rawEntitledUnits,
    entitledUnits,
    rounding: input.rounding,
    explanation: [
      ...explanation,
      input.prorationMethod === "CALENDAR_DAY_RATIO"
        ? `Eligible ${eligibleDays} of ${periodDays} calendar days; factor ${prorationFactor.toFixed(6)}.`
        : input.prorationMethod === "COMPLETED_MONTHS"
          ? `${completedEligibleMonths} completed eligible month(s); factor ${prorationFactor.toFixed(6)}.`
          : "No proration configured; full effective base applies.",
      `Rounded with ${input.rounding}: ${entitledUnits}.`,
    ],
  };
}
