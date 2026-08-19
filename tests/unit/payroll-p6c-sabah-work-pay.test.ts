import assert from "node:assert/strict";
import test from "node:test";
import type { FrozenPayrollSegmentFact } from "../../src/lib/payroll/attendance-integration";
import { calculateSabahStatutoryWorkPay } from "../../src/lib/payroll/sabah-work-pay-calculation";

const emptyBuckets = {
  normalOtMinutes: 0,
  restDayWorkMinutes: 0,
  restDayOtMinutes: 0,
  publicHolidayWorkMinutes: 0,
  publicHolidayOtMinutes: 0,
  segmentFacts: [] as FrozenPayrollSegmentFact[],
};

test("P6C calculates Sabah monthly OT, Rest Day and Public Holiday pay from frozen P6B facts", () => {
  const attendance = {
    normalOtMinutes: 60,
    restDayWorkMinutes: 240,
    restDayOtMinutes: 60,
    publicHolidayWorkMinutes: 480,
    publicHolidayOtMinutes: 60,
    segmentFacts: [
      segment("normal", "2026-08-03", "NORMAL", 60, 60),
      segment("rest-work", "2026-08-09", "REST_DAY", 240, 0),
      segment("rest-ot", "2026-08-09", "REST_DAY", 60, 60, { segmentIndex: 1 }),
      segment("holiday-work", "2026-08-31", "PUBLIC_HOLIDAY", 480, 0),
      segment("holiday-ot", "2026-08-31", "PUBLIC_HOLIDAY", 60, 60, { segmentIndex: 1 }),
    ],
  };

  const result = calculateSabahStatutoryWorkPay(baseInput(attendance));

  assert.equal(result.coverageStatus, "ELIGIBLE");
  assert.deepEqual(result.blockerCodes, []);
  assert.equal(result.ordinaryDailyRate, "100.00000000");
  assert.equal(result.hourlyRate, "12.50000000");
  assert.deepEqual(
    result.lines.map((line) => [line.classification, line.amountCents]),
    [
      ["NORMAL_OT", 1_875],
      ["REST_DAY_WORK", 5_000],
      ["REST_DAY_OT", 2_500],
      ["PUBLIC_HOLIDAY_WORK", 20_000],
      ["PUBLIC_HOLIDAY_OT", 3_750],
    ],
  );
  assert.equal(result.totalAmountCents, 33_125);
  assert.ok(result.lines.every((line) => line.lineKey.startsWith("SYSTEM:STATUTORY:")));
});

test("P6C does not create another monthly base component for normal work or paid leave", () => {
  const result = calculateSabahStatutoryWorkPay(baseInput(emptyBuckets));

  assert.equal(result.coverageStatus, "ELIGIBLE");
  assert.deepEqual(result.lines, []);
  assert.equal(result.totalAmountCents, 0);
});

test("P6C fails closed for daily/hourly pay without frozen prior-period wage facts", () => {
  for (const payBasis of ["DAILY", "HOURLY"] as const) {
    const result = calculateSabahStatutoryWorkPay({
      ...baseInput(emptyBuckets),
      payBasis,
    });
    assert.equal(result.coverageStatus, "REVIEW_REQUIRED");
    assert.ok(result.blockerCodes.includes("STATUTORY_WORK_PAY_DAILY_HOURLY_PRIOR_PERIOD_FACTS_REQUIRED"));
    assert.deepEqual(result.lines, []);
  }
});

test("P6C requires legal employment-category review above RM4,000", () => {
  const result = calculateSabahStatutoryWorkPay({
    ...baseInput(emptyBuckets),
    baseRateCents: 400_001,
  });

  assert.equal(result.coverageStatus, "REVIEW_REQUIRED");
  assert.ok(result.blockerCodes.includes("STATUTORY_WORK_PAY_COVERAGE_CLASS_REVIEW_REQUIRED"));
});

test("P6C permits verified high-wage manual labour coverage", () => {
  const attendance = {
    ...emptyBuckets,
    normalOtMinutes: 60,
    segmentFacts: [segment("manual-ot", "2026-08-03", "NORMAL", 60, 60)],
  };
  const result = calculateSabahStatutoryWorkPay({
    ...baseInput(attendance),
    baseRateCents: 500_000,
    coverageClass: "MANUAL_LABOUR",
  });

  assert.equal(result.coverageStatus, "ELIGIBLE");
  assert.equal(result.lines[0]?.classification, "NORMAL_OT");
});

test("P6C candidate rules are verification-only and never silently treated as active", () => {
  const blocked = calculateSabahStatutoryWorkPay({
    ...baseInput(emptyBuckets),
    ruleStatus: "READY_FOR_HUMAN_SIGN_OFF",
  });
  assert.ok(blocked.blockerCodes.includes("STATUTORY_MONEY_RULE_NOT_ACTIVE"));

  const verified = calculateSabahStatutoryWorkPay({
    ...baseInput(emptyBuckets),
    ruleStatus: "READY_FOR_HUMAN_SIGN_OFF",
    allowCandidateForVerification: true,
  });
  assert.deepEqual(verified.blockerCodes, []);
});

test("P6C rejects unresolved jurisdiction and Rest Day/Public Holiday overlap", () => {
  const wrongJurisdiction = calculateSabahStatutoryWorkPay({
    ...baseInput(emptyBuckets),
    jurisdictionCode: "MY-SARAWAK",
  });
  assert.ok(wrongJurisdiction.blockerCodes.includes("STATUTORY_WORK_PAY_JURISDICTION_NOT_SUPPORTED"));

  const overlapAttendance = {
    ...emptyBuckets,
    publicHolidayWorkMinutes: 60,
    segmentFacts: [segment("overlap", "2026-08-31", "PUBLIC_HOLIDAY", 60, 0, {
      isRestDay: true,
      isPublicHoliday: true,
    })],
  };
  const overlap = calculateSabahStatutoryWorkPay(baseInput(overlapAttendance));
  assert.ok(overlap.blockerCodes.includes("STATUTORY_WORK_PAY_REST_PUBLIC_HOLIDAY_OVERLAP"));
  assert.deepEqual(overlap.lines, []);
});

test("P6C rejects aggregate facts that do not reconcile to date-level segments", () => {
  const result = calculateSabahStatutoryWorkPay(baseInput({
    ...emptyBuckets,
    normalOtMinutes: 60,
  }));

  assert.ok(result.blockerCodes.includes("STATUTORY_WORK_PAY_INPUT_RECONCILIATION_FAILED"));
  assert.deepEqual(result.lines, []);
});

test("P6C calculation and line digests are deterministic", () => {
  const attendance = {
    ...emptyBuckets,
    normalOtMinutes: 31,
    segmentFacts: [segment("rounding", "2026-08-04", "NORMAL", 31, 31)],
  };
  const first = calculateSabahStatutoryWorkPay({
    ...baseInput(attendance),
    baseRateCents: 300_100,
  });
  const second = calculateSabahStatutoryWorkPay({
    ...baseInput(attendance),
    baseRateCents: 300_100,
  });

  assert.equal(first.calculationDigest, second.calculationDigest);
  assert.equal(first.lines[0]?.lineDigest, second.lines[0]?.lineDigest);
  assert.equal(first.totalAmountCents, first.lines[0]?.amountCents);
});

function baseInput(attendance: typeof emptyBuckets) {
  return {
    payBasis: "MONTHLY" as const,
    baseRateCents: 260_000,
    normalWorkMinutes: 480,
    jurisdictionCode: "MY-SABAH",
    ruleStatus: "ACTIVE" as const,
    attendance,
  };
}

function segment(
  id: string,
  localDate: string,
  context: FrozenPayrollSegmentFact["context"],
  workedMinutes: number,
  approvedOtMinutes: number,
  overrides: Partial<FrozenPayrollSegmentFact> = {},
): FrozenPayrollSegmentFact {
  const isRestDay = context === "REST_DAY";
  const isPublicHoliday = context === "PUBLIC_HOLIDAY";
  return {
    id,
    sourceDaySnapshotId: `day-${id}`,
    sourceFinalResultId: `result-${id}`,
    sourceAttendanceId: `attendance-${id}`,
    branchId: "branch-sabah",
    segmentIndex: 0,
    localDate,
    startAt: `${localDate}T01:00:00.000Z`,
    endAt: `${localDate}T02:00:00.000Z`,
    timezone: "Asia/Kuala_Lumpur",
    context,
    expectedDayKind: null,
    expectedStartAt: null,
    expectedEndAt: null,
    isRestDay,
    isPublicHoliday,
    isUnscheduled: false,
    holidayContext: isPublicHoliday ? { occurrenceId: `holiday-${id}` } : null,
    leaveRequestId: null,
    leaveDayFraction: null,
    grossMinutes: workedMinutes,
    breakMinutes: 0,
    workedMinutes,
    potentialOtMinutes: approvedOtMinutes,
    approvedOtMinutes,
    sourceDigest: `digest-${id}`,
    ...overrides,
  };
}
