import { createHash } from "node:crypto";
import type { FrozenPayrollSegmentFact, PayrollAttendanceInput } from "./attendance-integration";
import {
  assertSabahWorkPayRuleUsable,
  SABAH_WORK_PAY_JURISDICTION,
  SABAH_WORK_PAY_RULE_VERSION,
  SABAH_WORK_PAY_SOURCE_DIGEST,
  type SabahWorkPayRuleStatus,
} from "./sabah-work-pay-rule-pack";

export type WorkPayCoverageClass =
  | "MANUAL_LABOUR"
  | "DOMESTIC_EMPLOYEE"
  | "SEAFARER"
  | "OTHER_VERIFIED_COVERED"
  | "NOT_COVERED";

export type WorkPayBlockerCode =
  | "STATUTORY_MONEY_RULE_NOT_ACTIVE"
  | "STATUTORY_WORK_PAY_JURISDICTION_NOT_SUPPORTED"
  | "STATUTORY_WORK_PAY_DAILY_HOURLY_PRIOR_PERIOD_FACTS_REQUIRED"
  | "STATUTORY_WORK_PAY_COVERAGE_CLASS_REVIEW_REQUIRED"
  | "STATUTORY_WORK_PAY_NOT_COVERED"
  | "STATUTORY_WORK_PAY_REST_PUBLIC_HOLIDAY_OVERLAP"
  | "STATUTORY_WORK_PAY_INPUT_RECONCILIATION_FAILED"
  | "STATUTORY_WORK_PAY_NORMAL_HOURS_INVALID";

export type WorkPayClassification =
  | "NORMAL_OT"
  | "REST_DAY_WORK"
  | "REST_DAY_OT"
  | "PUBLIC_HOLIDAY_WORK"
  | "PUBLIC_HOLIDAY_OT";

export type WorkPayLine = {
  lineKey: string;
  localDate: string;
  classification: WorkPayClassification;
  minutes: number;
  multiplier: string;
  rate: string;
  amountCents: number;
  ruleSection: "103" | "104" | "104C";
  trace: Record<string, unknown>;
  lineDigest: string;
};

export type SabahWorkPayCalculation = {
  jurisdictionCode: typeof SABAH_WORK_PAY_JURISDICTION;
  ruleVersion: string;
  sourceDigest: string;
  coverageStatus: "ELIGIBLE" | "NOT_ELIGIBLE" | "REVIEW_REQUIRED";
  coverageReason: string;
  blockerCodes: WorkPayBlockerCode[];
  ordinaryDailyRate: string | null;
  hourlyRate: string | null;
  totalAmountCents: number;
  lines: WorkPayLine[];
  inputDigest: string;
  calculationDigest: string;
};

type Input = {
  payBasis: "MONTHLY" | "DAILY" | "HOURLY";
  baseRateCents: number;
  normalWorkMinutes: number;
  jurisdictionCode: string | null;
  ruleStatus: SabahWorkPayRuleStatus;
  ruleVersion?: string;
  sourceDigest?: string;
  coverageClass?: WorkPayCoverageClass | null;
  attendance: Pick<
    PayrollAttendanceInput,
    | "normalOtMinutes"
    | "restDayWorkMinutes"
    | "restDayOtMinutes"
    | "publicHolidayWorkMinutes"
    | "publicHolidayOtMinutes"
    | "segmentFacts"
  >;
  allowCandidateForVerification?: boolean;
};

type DayFacts = {
  localDate: string;
  normalOtMinutes: number;
  restDayWorkMinutes: number;
  restDayOtMinutes: number;
  publicHolidayWorkMinutes: number;
  publicHolidayOtMinutes: number;
  hasRestHolidayOverlap: boolean;
  segmentDigests: string[];
};

export function calculateSabahStatutoryWorkPay(input: Input): SabahWorkPayCalculation {
  const inputDigest = digest(normalizeInput(input));
  const blockers = new Set<WorkPayBlockerCode>();
  try {
    assertSabahWorkPayRuleUsable({
      jurisdictionCode: input.jurisdictionCode,
      status: input.ruleStatus,
      allowCandidateForVerification: input.allowCandidateForVerification,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "STATUTORY_MONEY_RULE_NOT_ACTIVE";
    blockers.add(code as WorkPayBlockerCode);
  }
  assertWholeNonNegative(input.baseRateCents, "baseRateCents");
  assertWholeNonNegative(input.normalWorkMinutes, "normalWorkMinutes");
  if (input.normalWorkMinutes <= 0) blockers.add("STATUTORY_WORK_PAY_NORMAL_HOURS_INVALID");

  const coverage = resolveCoverage(input);
  if (coverage.blocker) blockers.add(coverage.blocker);

  const days = groupSegmentFacts(input.attendance.segmentFacts);
  if (!reconciles(days, input.attendance)) {
    blockers.add("STATUTORY_WORK_PAY_INPUT_RECONCILIATION_FAILED");
  }
  if (days.some((day) => day.hasRestHolidayOverlap)) {
    blockers.add("STATUTORY_WORK_PAY_REST_PUBLIC_HOLIDAY_OVERLAP");
  }

  const ordinaryDailyRate = input.payBasis === "MONTHLY"
    ? fraction(input.baseRateCents, 26)
    : null;
  const hourlyRate = ordinaryDailyRate && input.normalWorkMinutes > 0
    ? divide(ordinaryDailyRate, fraction(input.normalWorkMinutes, 60))
    : null;
  const hardBlocked = blockers.size > 0 || coverage.status !== "ELIGIBLE" || !hourlyRate;
  const lines = hardBlocked ? [] : buildLines(days, ordinaryDailyRate!, hourlyRate, input.normalWorkMinutes);
  const totalAmountCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const resultBase = {
    jurisdictionCode: SABAH_WORK_PAY_JURISDICTION,
    ruleVersion: input.ruleVersion ?? SABAH_WORK_PAY_RULE_VERSION,
    sourceDigest: input.sourceDigest ?? SABAH_WORK_PAY_SOURCE_DIGEST,
    coverageStatus: coverage.status,
    coverageReason: coverage.reason,
    blockerCodes: [...blockers].sort(),
    ordinaryDailyRate: ordinaryDailyRate ? moneyDecimal(ordinaryDailyRate, 8) : null,
    hourlyRate: hourlyRate ? moneyDecimal(hourlyRate, 8) : null,
    totalAmountCents,
    lines,
    inputDigest,
  };
  return { ...resultBase, calculationDigest: digest(resultBase) };
}

function resolveCoverage(input: Input): {
  status: SabahWorkPayCalculation["coverageStatus"];
  reason: string;
  blocker: WorkPayBlockerCode | null;
} {
  if (input.payBasis !== "MONTHLY") {
    return {
      status: "REVIEW_REQUIRED",
      reason: "Daily/hourly ordinary-rate calculation requires frozen prior wage-period facts not present in P6C.",
      blocker: "STATUTORY_WORK_PAY_DAILY_HOURLY_PRIOR_PERIOD_FACTS_REQUIRED",
    };
  }
  if (input.coverageClass === "NOT_COVERED") {
    return {
      status: "NOT_ELIGIBLE",
      reason: "A verified legal employment classification marks this employee outside the covered provisions.",
      blocker: "STATUTORY_WORK_PAY_NOT_COVERED",
    };
  }
  const verifiedHighWageCoverage =
    input.coverageClass === "MANUAL_LABOUR" ||
    input.coverageClass === "OTHER_VERIFIED_COVERED";
  if (input.baseRateCents > 400_000 && !verifiedHighWageCoverage) {
    return {
      status: "REVIEW_REQUIRED",
      reason: "Monthly wages exceed RM4,000 and no supported frozen legal employment category establishes coverage.",
      blocker: "STATUTORY_WORK_PAY_COVERAGE_CLASS_REVIEW_REQUIRED",
    };
  }
  return {
    status: "ELIGIBLE",
    reason: input.baseRateCents <= 400_000
      ? "Monthly wages do not exceed RM4,000 under the candidate Sabah coverage rule."
      : "Coverage is supported by a frozen verified employment category.",
    blocker: null,
  };
}

function groupSegmentFacts(segments: readonly FrozenPayrollSegmentFact[]): DayFacts[] {
  const map = new Map<string, DayFacts>();
  for (const segment of segments) {
    for (const value of [segment.workedMinutes, segment.approvedOtMinutes]) {
      assertWholeNonNegative(value, "segment minutes");
    }
    if (segment.approvedOtMinutes > segment.workedMinutes) {
      throw new Error("STATUTORY_WORK_PAY_SEGMENT_OT_EXCEEDS_WORKED");
    }
    const day = map.get(segment.localDate) ?? {
      localDate: segment.localDate,
      normalOtMinutes: 0,
      restDayWorkMinutes: 0,
      restDayOtMinutes: 0,
      publicHolidayWorkMinutes: 0,
      publicHolidayOtMinutes: 0,
      hasRestHolidayOverlap: false,
      segmentDigests: [],
    };
    const nonOt = segment.workedMinutes - segment.approvedOtMinutes;
    day.hasRestHolidayOverlap ||= segment.isRestDay && segment.isPublicHoliday;
    day.segmentDigests.push(segment.sourceDigest);
    if (segment.context === "PUBLIC_HOLIDAY") {
      day.publicHolidayWorkMinutes += nonOt;
      day.publicHolidayOtMinutes += segment.approvedOtMinutes;
    } else if (segment.context === "REST_DAY") {
      day.restDayWorkMinutes += nonOt;
      day.restDayOtMinutes += segment.approvedOtMinutes;
    } else {
      day.normalOtMinutes += segment.approvedOtMinutes;
    }
    map.set(segment.localDate, day);
  }
  return [...map.values()].sort((a, b) => a.localDate.localeCompare(b.localDate));
}

function reconciles(days: DayFacts[], attendance: Input["attendance"]) {
  const total = (key: keyof Omit<DayFacts, "localDate" | "hasRestHolidayOverlap" | "segmentDigests">) =>
    days.reduce((sum, day) => sum + day[key], 0);
  return total("normalOtMinutes") === attendance.normalOtMinutes &&
    total("restDayWorkMinutes") === attendance.restDayWorkMinutes &&
    total("restDayOtMinutes") === attendance.restDayOtMinutes &&
    total("publicHolidayWorkMinutes") === attendance.publicHolidayWorkMinutes &&
    total("publicHolidayOtMinutes") === attendance.publicHolidayOtMinutes;
}

function buildLines(days: DayFacts[], orp: Fraction, hourly: Fraction, normalMinutes: number) {
  const lines: WorkPayLine[] = [];
  for (const day of days) {
    addHourly(lines, day, "NORMAL_OT", day.normalOtMinutes, hourly, 3, 2, "104");
    if (day.restDayWorkMinutes > 0) {
      const halfDay = day.restDayWorkMinutes <= normalMinutes / 2;
      addOrp(lines, day, "REST_DAY_WORK", day.restDayWorkMinutes, orp, halfDay ? 1 : 1, halfDay ? 2 : 1, "104C");
    }
    addHourly(lines, day, "REST_DAY_OT", day.restDayOtMinutes, hourly, 2, 1, "104C");
    if (day.publicHolidayWorkMinutes + day.publicHolidayOtMinutes > 0) {
      addOrp(lines, day, "PUBLIC_HOLIDAY_WORK", day.publicHolidayWorkMinutes, orp, 2, 1, "103");
    }
    addHourly(lines, day, "PUBLIC_HOLIDAY_OT", day.publicHolidayOtMinutes, hourly, 3, 1, "103");
  }
  return lines;
}

function addHourly(lines: WorkPayLine[], day: DayFacts, classification: WorkPayClassification, minutes: number, hourly: Fraction, mulNum: bigint | number, mulDen: bigint | number, section: WorkPayLine["ruleSection"]) {
  if (minutes <= 0) return;
  const amount = multiply(multiply(hourly, fraction(minutes, 60)), fraction(mulNum, mulDen));
  pushLine(lines, day, classification, minutes, fraction(mulNum, mulDen), hourly, amount, section);
}

function addOrp(lines: WorkPayLine[], day: DayFacts, classification: WorkPayClassification, minutes: number, orp: Fraction, mulNum: bigint | number, mulDen: bigint | number, section: WorkPayLine["ruleSection"]) {
  const multiplier = fraction(mulNum, mulDen);
  pushLine(lines, day, classification, minutes, multiplier, orp, multiply(orp, multiplier), section);
}

function pushLine(lines: WorkPayLine[], day: DayFacts, classification: WorkPayClassification, minutes: number, multiplier: Fraction, rate: Fraction, amount: Fraction, ruleSection: WorkPayLine["ruleSection"]) {
  const base = {
    lineKey: `SYSTEM:STATUTORY:${classification}:${day.localDate}`,
    localDate: day.localDate,
    classification,
    minutes,
    multiplier: decimal(multiplier, 4),
    rate: moneyDecimal(rate, 8),
    amountCents: roundHalfUp(amount),
    ruleSection,
    trace: { segmentDigests: [...day.segmentDigests].sort(), rounding: "FINAL_LINE_HALF_UP_TO_CENT" },
  };
  lines.push({ ...base, lineDigest: digest(base) });
}

type Fraction = { numerator: bigint; denominator: bigint };
const fraction = (numerator: bigint | number, denominator: bigint | number): Fraction => {
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  if (d <= 0n) throw new Error("STATUTORY_WORK_PAY_INVALID_DIVISOR");
  return { numerator: n, denominator: d };
};
const multiply = (a: Fraction, b: Fraction): Fraction => fraction(a.numerator * b.numerator, a.denominator * b.denominator);
const divide = (a: Fraction, b: Fraction): Fraction => fraction(a.numerator * b.denominator, a.denominator * b.numerator);
const roundHalfUp = (value: Fraction) => Number((value.numerator * 2n + value.denominator) / (value.denominator * 2n));
function decimal(value: Fraction, scale: number) {
  const factor = 10n ** BigInt(scale);
  const scaled = (value.numerator * factor) / value.denominator;
  const whole = scaled / factor;
  const rest = (scaled % factor).toString().padStart(scale, "0");
  return `${whole}.${rest}`;
}
function moneyDecimal(valueInCents: Fraction, scale: number) {
  return decimal(divide(valueInCents, fraction(100, 1)), scale);
}
function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function normalizeInput(input: Input) {
  return { ...input, attendance: { ...input.attendance, segmentFacts: [...input.attendance.segmentFacts].sort((a, b) => a.id.localeCompare(b.id)) } };
}
function assertWholeNonNegative(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`STATUTORY_WORK_PAY_INVALID_${label.toUpperCase()}`);
}
