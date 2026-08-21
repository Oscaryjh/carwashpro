import { createHash } from "node:crypto";
import type { EmployeePayBasis } from "@prisma/client";
import type { PayrollComponentLine } from "@/lib/payroll/component-calculation";

export const OVERTIME_APPROVAL_SOURCE_NOT_READY =
  "OVERTIME_APPROVAL_SOURCE_NOT_READY";
export const OVERTIME_RATE_POLICY_NOT_READY =
  "OVERTIME_RATE_POLICY_NOT_READY";
export const CROSS_MIDNIGHT_STATUTORY_SEGMENTATION_NOT_READY =
  "CROSS_MIDNIGHT_STATUTORY_SEGMENTATION_NOT_READY";

export type AttendancePayPolicyBlocker =
  | "APPROVED_ATTENDANCE_INPUT_NOT_MATERIALISED"
  | "PAYROLL_ABSENCE_RATE_POLICY_NOT_READY"
  | "AUTHORIZED_ABSENCE_PAY_POLICY_NOT_READY"
  | "REST_DAY_RATE_POLICY_NOT_READY"
  | "PUBLIC_HOLIDAY_RATE_POLICY_NOT_READY"
  | "HOURLY_PAID_LEAVE_UNIT_POLICY_NOT_READY"
  | "NOT_SCHEDULED_WORK_POLICY_NOT_READY"
  | "APPROVED_LEAVE_EVIDENCE_INCOMPLETE"
  | "LEAVE_PAY_TREATMENT_MISMATCH"
  | "LEAVE_STATUTORY_RULE_NOT_ACTIVE"
  | "MATERNITY_ALLOWANCE_REVIEW_REQUIRED"
  | "OVERTIME_APPROVAL_SOURCE_NOT_READY"
  | "OVERTIME_RATE_POLICY_NOT_READY"
  | "CROSS_MIDNIGHT_STATUTORY_SEGMENTATION_NOT_READY";

export type FrozenPayrollAttendanceDay = {
  id: string;
  workDate: Date;
  outcome:
    | "PRESENT"
    | "PRESENT_LATE_AUTHORIZED"
    | "PRESENT_LATE_UNAUTHORIZED"
    | "PRESENT_EARLY_AUTHORIZED"
    | "PRESENT_EARLY_UNAUTHORIZED"
    | "AUTHORIZED_ABSENCE"
    | "UNAUTHORIZED_ABSENCE"
    | "APPROVED_PAID_LEAVE"
    | "APPROVED_UNPAID_LEAVE"
    | "AUTHORIZED_EMERGENCY_LEAVE"
    | "NOT_SCHEDULED"
    | "REST_DAY"
    | "PUBLIC_HOLIDAY"
    | "EXCLUDED";
  expectedDayKindSnapshot:
    | "WORKDAY"
    | "NOT_SCHEDULED"
    | "REST_DAY"
    | "PUBLIC_HOLIDAY"
    | null;
  leaveDayFractionSnapshot: { toString(): string } | number | null;
  leaveRequestIdSnapshot?: string | null;
  leaveRequestRevisionSnapshot?: number | null;
  leaveRequestDigestSnapshot?: string | null;
  leavePolicyIdSnapshot?: string | null;
  leavePolicyVersionIdSnapshot?: string | null;
  leavePolicyNameSnapshot?: string | null;
  leavePayTreatmentSnapshot?: "PAID" | "UNPAID" | null;
  leaveUnitSnapshot?: "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | null;
  leaveLegalStatusSnapshot?: string | null;
  leaveJurisdictionCodeSnapshot?: string | null;
  leaveStatutoryRuleSetVersionSnapshot?: string | null;
  leaveStatutoryRuleSetStatusSnapshot?: string | null;
  leaveStatutoryCategorySnapshot?: string | null;
  leaveStatutoryEligibilitySnapshot?: unknown;
  leaveStatutoryPayTreatmentSnapshot?: unknown;
  leaveComplianceStatusSnapshot?: string | null;
  expectedStartAt?: Date | null;
  expectedEndAt?: Date | null;
  actualClockInAt?: Date | null;
  actualClockOutAt?: Date | null;
  timezoneSnapshot?: string | null;
  crossMidnightSnapshot?: boolean;
  potentialOtMinutes?: number;
  approvedOtMinutes?: number;
  otContext?: "NORMAL" | "REST_DAY" | "PUBLIC_HOLIDAY" | null;
  otApprovalStatus?:
    | "PENDING_REVIEW"
    | "APPROVED"
    | "REJECTED"
    | "ADJUSTED"
    | "NOT_APPLICABLE";
  otApprovalRef?: string | null;
  otApprovalRevision?: number | null;
  totalWorkedMinutes: number;
  sourceDigest: string;
};

export type FrozenPayrollAttendanceSegment = {
  id: string;
  sourceDaySnapshotId: string;
  sourceFinalResultId: string;
  sourceAttendanceId?: string | null;
  branchId: string;
  segmentIndex: number;
  localDate: Date;
  startAt: Date;
  endAt: Date;
  timezoneSnapshot: string;
  context: "NORMAL" | "REST_DAY" | "PUBLIC_HOLIDAY";
  expectedDayKindSnapshot?:
    | "WORKDAY"
    | "NOT_SCHEDULED"
    | "REST_DAY"
    | "PUBLIC_HOLIDAY"
    | null;
  expectedStartAt?: Date | null;
  expectedEndAt?: Date | null;
  isRestDay: boolean;
  isPublicHoliday: boolean;
  isUnscheduled: boolean;
  holidayContextSnapshot?: unknown;
  leaveRequestIdSnapshot?: string | null;
  leaveDayFractionSnapshot?: { toString(): string } | number | null;
  grossMinutes: number;
  breakMinutes: number;
  workedMinutes: number;
  potentialOtMinutes: number;
  approvedOtMinutes: number;
  sourceDigest: string;
};

export type FrozenPayrollSegmentFact = {
  id: string;
  sourceDaySnapshotId: string;
  sourceFinalResultId: string;
  sourceAttendanceId: string | null;
  branchId: string;
  segmentIndex: number;
  localDate: string;
  startAt: string;
  endAt: string;
  timezone: string;
  context: "NORMAL" | "REST_DAY" | "PUBLIC_HOLIDAY";
  expectedDayKind: string | null;
  expectedStartAt: string | null;
  expectedEndAt: string | null;
  isRestDay: boolean;
  isPublicHoliday: boolean;
  isUnscheduled: boolean;
  holidayContext: unknown;
  leaveRequestId: string | null;
  leaveDayFraction: string | null;
  grossMinutes: number;
  breakMinutes: number;
  workedMinutes: number;
  potentialOtMinutes: number;
  approvedOtMinutes: number;
  sourceDigest: string;
};

export type FrozenPayrollLeaveFact = {
  workDate: string;
  leaveRequestId: string;
  leaveRequestRevision: number;
  leaveRequestDigest: string;
  policyId: string;
  policyVersionId: string;
  policyName: string;
  payTreatment: "PAID" | "UNPAID";
  leaveUnit: "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM";
  leaveDayHundredths: number;
  workedMinutes: number;
  legalStatus: string;
  jurisdictionCode: string | null;
  statutoryRuleSetVersion: string | null;
  statutoryRuleSetStatus: string | null;
  statutoryCategory: string | null;
  statutoryEligibility: unknown;
  statutoryPayTreatment: unknown;
  complianceStatus: string | null;
};

export type PayrollLeaveCategoryBreakdown = {
  category: string;
  payTreatment: "PAID" | "UNPAID";
  dayHundredths: number;
  requestCount: number;
};

export type PayrollAttendanceInput = {
  regularDayHundredths: number;
  regularMinutes: number;
  paidLeaveDayHundredths: number;
  unpaidLeaveDayHundredths: number;
  unauthorizedAbsenceDayHundredths: number;
  authorizedAbsenceDayHundredths: number;
  restDayWorkedMinutes: number;
  publicHolidayWorkedMinutes: number;
  approvedOvertimeMinutes: number;
  regularNormalMinutes: number;
  normalOtMinutes: number;
  restDayWorkMinutes: number;
  restDayOtMinutes: number;
  publicHolidayWorkMinutes: number;
  publicHolidayOtMinutes: number;
  segmentFacts: FrozenPayrollSegmentFact[];
  sourceDayCount: number;
  legacyCompatibility: boolean;
  leaveFacts: FrozenPayrollLeaveFact[];
  leaveCategoryBreakdown: PayrollLeaveCategoryBreakdown[];
  policyBlockers: AttendancePayPolicyBlocker[];
  sourceDigest: string;
};

const PRESENT_OUTCOMES = new Set<FrozenPayrollAttendanceDay["outcome"]>([
  "PRESENT",
  "PRESENT_LATE_AUTHORIZED",
  "PRESENT_LATE_UNAUTHORIZED",
  "PRESENT_EARLY_AUTHORIZED",
  "PRESENT_EARLY_UNAUTHORIZED",
]);

/**
 * Converts immutable Timesheet day snapshots into the small payroll-facing DTO.
 * It intentionally has no access to punches, GPS, current Leave or current roster.
 */
export function buildPayrollAttendanceInput(input: {
  membershipId: string;
  payBasis: EmployeePayBasis;
  days: readonly FrozenPayrollAttendanceDay[];
  segments?: readonly FrozenPayrollAttendanceSegment[];
  publicHolidayPayPolicyReady?: boolean;
  statutoryWorkPayPolicyReady?: boolean;
  monthlyAbsencePolicyReady?: boolean;
}): PayrollAttendanceInput {
  let regularDayHundredths = 0;
  let regularMinutes = 0;
  let paidLeaveDayHundredths = 0;
  let unpaidLeaveDayHundredths = 0;
  let unauthorizedAbsenceDayHundredths = 0;
  let authorizedAbsenceDayHundredths = 0;
  let restDayWorkedMinutes = 0;
  let publicHolidayWorkedMinutes = 0;
  let approvedOvertimeMinutes = 0;
  let regularNormalMinutes = 0;
  let normalOtMinutes = 0;
  let restDayWorkMinutes = 0;
  let restDayOtMinutes = 0;
  let publicHolidayWorkMinutes = 0;
  let publicHolidayOtMinutes = 0;
  const leaveFacts: FrozenPayrollLeaveFact[] = [];
  const blockers = new Set<AttendancePayPolicyBlocker>();
  const ordered = [...input.days].sort(
    (left, right) =>
      left.workDate.getTime() - right.workDate.getTime() ||
      left.id.localeCompare(right.id),
  );
  const orderedSegments = [...(input.segments ?? [])].sort(
    (left, right) =>
      left.localDate.getTime() - right.localDate.getTime() ||
      left.startAt.getTime() - right.startAt.getTime() ||
      left.segmentIndex - right.segmentIndex ||
      left.id.localeCompare(right.id),
  );
  const segmentedDayIds = new Set(
    orderedSegments.map((segment) => segment.sourceDaySnapshotId),
  );
  const segmentFacts = orderedSegments.map(toFrozenSegmentFact);
  const dayById = new Map(ordered.map((day) => [day.id, day]));
  const segmentTotalsByDay = new Map<string, {
    workedMinutes: number;
    potentialOtMinutes: number;
    approvedOtMinutes: number;
    indexes: Set<number>;
  }>();

  for (const segment of orderedSegments) {
    assertFrozenSegment(segment);
    const sourceDay = dayById.get(segment.sourceDaySnapshotId);
    if (!sourceDay) {
      throw new Error("Frozen Attendance segment references an unknown day snapshot.");
    }
    const totals = segmentTotalsByDay.get(segment.sourceDaySnapshotId) ?? {
      workedMinutes: 0,
      potentialOtMinutes: 0,
      approvedOtMinutes: 0,
      indexes: new Set<number>(),
    };
    if (totals.indexes.has(segment.segmentIndex)) {
      throw new Error("Frozen Attendance segment indexes must be unique per day snapshot.");
    }
    totals.indexes.add(segment.segmentIndex);
    totals.workedMinutes += segment.workedMinutes;
    totals.potentialOtMinutes += segment.potentialOtMinutes;
    totals.approvedOtMinutes += segment.approvedOtMinutes;
    segmentTotalsByDay.set(segment.sourceDaySnapshotId, totals);

    const nonOtMinutes = segment.workedMinutes - segment.approvedOtMinutes;
    approvedOvertimeMinutes += segment.approvedOtMinutes;
    if (segment.context === "PUBLIC_HOLIDAY") {
      publicHolidayWorkMinutes += nonOtMinutes;
      publicHolidayOtMinutes += segment.approvedOtMinutes;
      publicHolidayWorkedMinutes += segment.workedMinutes;
    } else if (segment.context === "REST_DAY") {
      restDayWorkMinutes += nonOtMinutes;
      restDayOtMinutes += segment.approvedOtMinutes;
      restDayWorkedMinutes += segment.workedMinutes;
    } else {
      regularNormalMinutes += nonOtMinutes;
      normalOtMinutes += segment.approvedOtMinutes;
    }
  }
  for (const [dayId, totals] of segmentTotalsByDay) {
    const sourceDay = dayById.get(dayId)!;
    if (
      totals.workedMinutes !== sourceDay.totalWorkedMinutes ||
      totals.potentialOtMinutes !== (sourceDay.potentialOtMinutes ?? 0) ||
      totals.approvedOtMinutes !== (sourceDay.approvedOtMinutes ?? 0)
    ) {
      throw new Error("Frozen Attendance segments do not reconcile to the frozen day total.");
    }
  }
  if (orderedSegments.length > 0) regularMinutes = regularNormalMinutes;

  for (const day of ordered) {
    assertMinutes(day.totalWorkedMinutes);
    const fraction = leaveFractionHundredths(day);
    const kind = day.expectedDayKindSnapshot;
    const crossMidnight = day.crossMidnightSnapshot === true;
    const potentialOtMinutes = day.potentialOtMinutes ?? 0;
    const approvedOtMinutes = day.approvedOtMinutes ?? 0;
    const hasFrozenSegments = segmentedDayIds.has(day.id);
    assertMinutes(potentialOtMinutes);
    assertMinutes(approvedOtMinutes);
    if (approvedOtMinutes > potentialOtMinutes) {
      throw new Error("Frozen approved OT minutes cannot exceed potential OT minutes.");
    }

    if (crossMidnight && !hasFrozenSegments) {
      blockers.add(CROSS_MIDNIGHT_STATUTORY_SEGMENTATION_NOT_READY);
    }
    if (
      potentialOtMinutes > 0 &&
      (day.otApprovalStatus === "PENDING_REVIEW" ||
        day.otApprovalStatus === "NOT_APPLICABLE" ||
        !day.otApprovalStatus)
    ) {
      blockers.add(OVERTIME_APPROVAL_SOURCE_NOT_READY);
    }
    if (
      !hasFrozenSegments &&
      (day.otApprovalStatus === "APPROVED" ||
        day.otApprovalStatus === "ADJUSTED")
    ) {
      approvedOvertimeMinutes += approvedOtMinutes;
    }
    if (
      potentialOtMinutes === 0 &&
      hasPotentialOvertime(day) &&
      day.otApprovalStatus !== "REJECTED"
    ) {
      // Historical locked snapshots created before P6A have no frozen OT facts.
      // They must be reopened and reviewed; never infer an approval.
      blockers.add(OVERTIME_APPROVAL_SOURCE_NOT_READY);
    }

    if (day.outcome === "APPROVED_PAID_LEAVE") {
      if (fraction === null) {
        blockers.add("APPROVED_ATTENDANCE_INPUT_NOT_MATERIALISED");
      } else {
        paidLeaveDayHundredths += fraction;
        addFrozenLeaveFact(day, fraction, "PAID", leaveFacts, blockers);
        if (!crossMidnight && !hasFrozenSegments) addPartialWorkedDay(day, fraction);
      }
      continue;
    }
    if (day.outcome === "APPROVED_UNPAID_LEAVE") {
      if (fraction === null) {
        blockers.add("APPROVED_ATTENDANCE_INPUT_NOT_MATERIALISED");
      } else {
        unpaidLeaveDayHundredths += fraction;
        addFrozenLeaveFact(day, fraction, "UNPAID", leaveFacts, blockers);
        if (!crossMidnight && !hasFrozenSegments) addPartialWorkedDay(day, fraction);
      }
      continue;
    }
    if (hasFrozenSegments) {
      if (PRESENT_OUTCOMES.has(day.outcome)) regularDayHundredths += 100;
      continue;
    }
    if (crossMidnight) {
      // A cross-midnight shift can span normal, Rest Day and Public Holiday
      // dates. Until Attendance freezes minute segments per local legal day,
      // do not place the whole shift into any one payroll bucket.
      continue;
    }
    if (
      day.outcome === "AUTHORIZED_ABSENCE" ||
      day.outcome === "AUTHORIZED_EMERGENCY_LEAVE"
    ) {
      authorizedAbsenceDayHundredths += fraction ?? 100;
      continue;
    }
    if (day.outcome === "UNAUTHORIZED_ABSENCE") {
      unauthorizedAbsenceDayHundredths += 100;
      continue;
    }
    if (day.outcome === "REST_DAY" || kind === "REST_DAY") {
      restDayWorkedMinutes += day.totalWorkedMinutes;
      continue;
    }
    if (day.outcome === "PUBLIC_HOLIDAY" || kind === "PUBLIC_HOLIDAY") {
      publicHolidayWorkedMinutes += day.totalWorkedMinutes;
      continue;
    }
    if (kind === "NOT_SCHEDULED" && day.totalWorkedMinutes > 0) {
      blockers.add("NOT_SCHEDULED_WORK_POLICY_NOT_READY");
      continue;
    }
    if (PRESENT_OUTCOMES.has(day.outcome)) {
      regularDayHundredths += 100;
      // Potential OT is never ordinary time. Pending, rejected and the
      // unapproved portion of an adjusted review must not leak back into the
      // regular-pay bucket.
      regularMinutes += Math.max(0, day.totalWorkedMinutes - potentialOtMinutes);
    }
  }

  const legacyCompatibility = ordered.length === 0 && input.payBasis === "MONTHLY";
  if (ordered.length === 0 && input.payBasis !== "MONTHLY") {
    blockers.add("APPROVED_ATTENDANCE_INPUT_NOT_MATERIALISED");
  }
  if (
    input.payBasis === "MONTHLY" &&
    (unpaidLeaveDayHundredths > 0 || unauthorizedAbsenceDayHundredths > 0) &&
    input.monthlyAbsencePolicyReady !== true
  ) {
    blockers.add("PAYROLL_ABSENCE_RATE_POLICY_NOT_READY");
  }
  if (authorizedAbsenceDayHundredths > 0) {
    blockers.add("AUTHORIZED_ABSENCE_PAY_POLICY_NOT_READY");
  }
  if (
    restDayWorkedMinutes > 0 &&
    input.statutoryWorkPayPolicyReady !== true
  ) blockers.add("REST_DAY_RATE_POLICY_NOT_READY");
  if (
    publicHolidayWorkedMinutes > 0 &&
    input.publicHolidayPayPolicyReady !== true &&
    input.statutoryWorkPayPolicyReady !== true
  ) {
    blockers.add("PUBLIC_HOLIDAY_RATE_POLICY_NOT_READY");
  }
  if (input.payBasis === "HOURLY" && paidLeaveDayHundredths > 0) {
    blockers.add("HOURLY_PAID_LEAVE_UNIT_POLICY_NOT_READY");
  }
  if (
    approvedOvertimeMinutes > 0 &&
    input.statutoryWorkPayPolicyReady !== true
  ) {
    blockers.add(OVERTIME_RATE_POLICY_NOT_READY);
  }

  const leaveCategoryBreakdown = buildLeaveCategoryBreakdown(leaveFacts);

  const policyBlockers = [...blockers].sort();
  const sourceDigest = digest({
    membershipId: input.membershipId,
    days: ordered.map((day) => [
      day.id,
      day.workDate.toISOString().slice(0, 10),
      day.outcome,
      day.expectedDayKindSnapshot,
      day.leaveDayFractionSnapshot?.toString() ?? null,
      day.totalWorkedMinutes,
      day.sourceDigest,
      day.leaveRequestIdSnapshot ?? null,
      day.leaveRequestRevisionSnapshot ?? null,
      day.leaveRequestDigestSnapshot ?? null,
      day.leavePolicyVersionIdSnapshot ?? null,
      day.leavePayTreatmentSnapshot ?? null,
      day.leaveStatutoryRuleSetVersionSnapshot ?? null,
      day.leaveStatutoryRuleSetStatusSnapshot ?? null,
      day.leaveStatutoryCategorySnapshot ?? null,
      day.expectedStartAt?.toISOString() ?? null,
      day.expectedEndAt?.toISOString() ?? null,
      day.actualClockInAt?.toISOString() ?? null,
      day.actualClockOutAt?.toISOString() ?? null,
      day.timezoneSnapshot ?? null,
      day.crossMidnightSnapshot ?? false,
      day.potentialOtMinutes ?? 0,
      day.approvedOtMinutes ?? 0,
      day.otContext ?? null,
      day.otApprovalStatus ?? null,
      day.otApprovalRef ?? null,
      day.otApprovalRevision ?? null,
    ]),
    totals: {
      regularDayHundredths,
      regularMinutes,
      paidLeaveDayHundredths,
      unpaidLeaveDayHundredths,
      unauthorizedAbsenceDayHundredths,
      authorizedAbsenceDayHundredths,
      restDayWorkedMinutes,
      publicHolidayWorkedMinutes,
      approvedOvertimeMinutes,
      regularNormalMinutes,
      normalOtMinutes,
      restDayWorkMinutes,
      restDayOtMinutes,
      publicHolidayWorkMinutes,
      publicHolidayOtMinutes,
    },
    segmentFacts,
    policyBlockers,
    leaveFacts,
    leaveCategoryBreakdown,
  });

  return {
    regularDayHundredths,
    regularMinutes,
    paidLeaveDayHundredths,
    unpaidLeaveDayHundredths,
    unauthorizedAbsenceDayHundredths,
    authorizedAbsenceDayHundredths,
    restDayWorkedMinutes,
    publicHolidayWorkedMinutes,
    approvedOvertimeMinutes,
    regularNormalMinutes,
    normalOtMinutes,
    restDayWorkMinutes,
    restDayOtMinutes,
    publicHolidayWorkMinutes,
    publicHolidayOtMinutes,
    segmentFacts,
    sourceDayCount: ordered.length,
    legacyCompatibility,
    leaveFacts,
    leaveCategoryBreakdown,
    policyBlockers,
    sourceDigest,
  };

  function addPartialWorkedDay(day: FrozenPayrollAttendanceDay, fraction: number) {
    if (fraction < 100 && day.totalWorkedMinutes > 0) {
      regularDayHundredths += 100 - fraction;
      regularMinutes += Math.max(0, day.totalWorkedMinutes - (day.potentialOtMinutes ?? 0));
    }
  }
}

function assertFrozenSegment(segment: FrozenPayrollAttendanceSegment) {
  assertMinutes(segment.grossMinutes);
  assertMinutes(segment.breakMinutes);
  assertMinutes(segment.workedMinutes);
  assertMinutes(segment.potentialOtMinutes);
  assertMinutes(segment.approvedOtMinutes);
  if (segment.endAt.getTime() <= segment.startAt.getTime()) {
    throw new Error("Frozen Attendance segment interval is invalid.");
  }
  if (segment.breakMinutes + segment.workedMinutes !== segment.grossMinutes) {
    throw new Error("Frozen Attendance segment minutes do not reconcile.");
  }
  if (
    segment.approvedOtMinutes > segment.potentialOtMinutes ||
    segment.potentialOtMinutes > segment.workedMinutes
  ) {
    throw new Error("Frozen Attendance segment OT minutes are invalid.");
  }
  if (!segment.timezoneSnapshot.trim()) {
    throw new Error("Frozen Attendance segment timezone is required.");
  }
}

function toFrozenSegmentFact(
  segment: FrozenPayrollAttendanceSegment,
): FrozenPayrollSegmentFact {
  return {
    id: segment.id,
    sourceDaySnapshotId: segment.sourceDaySnapshotId,
    sourceFinalResultId: segment.sourceFinalResultId,
    sourceAttendanceId: segment.sourceAttendanceId ?? null,
    branchId: segment.branchId,
    segmentIndex: segment.segmentIndex,
    localDate: segment.localDate.toISOString().slice(0, 10),
    startAt: segment.startAt.toISOString(),
    endAt: segment.endAt.toISOString(),
    timezone: segment.timezoneSnapshot,
    context: segment.context,
    expectedDayKind: segment.expectedDayKindSnapshot ?? null,
    expectedStartAt: segment.expectedStartAt?.toISOString() ?? null,
    expectedEndAt: segment.expectedEndAt?.toISOString() ?? null,
    isRestDay: segment.isRestDay,
    isPublicHoliday: segment.isPublicHoliday,
    isUnscheduled: segment.isUnscheduled,
    holidayContext: segment.holidayContextSnapshot ?? null,
    leaveRequestId: segment.leaveRequestIdSnapshot ?? null,
    leaveDayFraction: segment.leaveDayFractionSnapshot?.toString() ?? null,
    grossMinutes: segment.grossMinutes,
    breakMinutes: segment.breakMinutes,
    workedMinutes: segment.workedMinutes,
    potentialOtMinutes: segment.potentialOtMinutes,
    approvedOtMinutes: segment.approvedOtMinutes,
    sourceDigest: segment.sourceDigest,
  };
}

function hasPotentialOvertime(day: FrozenPayrollAttendanceDay) {
  if (day.totalWorkedMinutes <= 0) return false;
  return Boolean(
    (day.expectedStartAt &&
      day.actualClockInAt &&
      day.actualClockInAt.getTime() < day.expectedStartAt.getTime()) ||
      (day.expectedEndAt &&
        day.actualClockOutAt &&
        day.actualClockOutAt.getTime() > day.expectedEndAt.getTime()),
  );
}

function addFrozenLeaveFact(
  day: FrozenPayrollAttendanceDay,
  fraction: number,
  expectedPayTreatment: "PAID" | "UNPAID",
  facts: FrozenPayrollLeaveFact[],
  blockers: Set<AttendancePayPolicyBlocker>,
) {
  const complete = Boolean(
    day.leaveRequestIdSnapshot &&
      Number.isSafeInteger(day.leaveRequestRevisionSnapshot) &&
      day.leaveRequestDigestSnapshot &&
      day.leavePolicyIdSnapshot &&
      day.leavePolicyVersionIdSnapshot &&
      day.leavePolicyNameSnapshot &&
      day.leavePayTreatmentSnapshot &&
      day.leaveUnitSnapshot &&
      day.leaveLegalStatusSnapshot,
  );
  if (!complete) {
    blockers.add("APPROVED_LEAVE_EVIDENCE_INCOMPLETE");
    return;
  }
  if (day.leavePayTreatmentSnapshot !== expectedPayTreatment) {
    blockers.add("LEAVE_PAY_TREATMENT_MISMATCH");
  }
  if (
    day.leaveStatutoryRuleSetVersionSnapshot &&
    day.leaveStatutoryRuleSetStatusSnapshot !== "ACTIVE"
  ) {
    blockers.add("LEAVE_STATUTORY_RULE_NOT_ACTIVE");
  }
  if (
    day.leaveStatutoryCategorySnapshot === "MATERNITY_LEAVE" &&
    !maternityAllowanceConfirmed(day.leaveStatutoryEligibilitySnapshot)
  ) {
    blockers.add("MATERNITY_ALLOWANCE_REVIEW_REQUIRED");
  }
  facts.push({
    workDate: day.workDate.toISOString().slice(0, 10),
    leaveRequestId: day.leaveRequestIdSnapshot!,
    leaveRequestRevision: day.leaveRequestRevisionSnapshot!,
    leaveRequestDigest: day.leaveRequestDigestSnapshot!,
    policyId: day.leavePolicyIdSnapshot!,
    policyVersionId: day.leavePolicyVersionIdSnapshot!,
    policyName: day.leavePolicyNameSnapshot!,
    payTreatment: day.leavePayTreatmentSnapshot!,
    leaveUnit: day.leaveUnitSnapshot!,
    leaveDayHundredths: fraction,
    workedMinutes: day.totalWorkedMinutes,
    legalStatus: day.leaveLegalStatusSnapshot!,
    jurisdictionCode: day.leaveJurisdictionCodeSnapshot ?? null,
    statutoryRuleSetVersion: day.leaveStatutoryRuleSetVersionSnapshot ?? null,
    statutoryRuleSetStatus: day.leaveStatutoryRuleSetStatusSnapshot ?? null,
    statutoryCategory: day.leaveStatutoryCategorySnapshot ?? null,
    statutoryEligibility: day.leaveStatutoryEligibilitySnapshot ?? null,
    statutoryPayTreatment: day.leaveStatutoryPayTreatmentSnapshot ?? null,
    complianceStatus: day.leaveComplianceStatusSnapshot ?? null,
  });
}

function buildLeaveCategoryBreakdown(facts: readonly FrozenPayrollLeaveFact[]) {
  const grouped = new Map<string, PayrollLeaveCategoryBreakdown>();
  for (const fact of facts) {
    const category =
      fact.statutoryCategory ??
      (fact.payTreatment === "PAID" ? "COMPANY_PAID_LEAVE" : "COMPANY_UNPAID_LEAVE");
    const key = `${category}:${fact.payTreatment}`;
    const current = grouped.get(key) ?? {
      category,
      payTreatment: fact.payTreatment,
      dayHundredths: 0,
      requestCount: 0,
    };
    current.dayHundredths += fact.leaveDayHundredths;
    current.requestCount += 1;
    grouped.set(key, current);
  }
  return [...grouped.values()].sort(
    (left, right) =>
      left.category.localeCompare(right.category) ||
      left.payTreatment.localeCompare(right.payTreatment),
  );
}

function maternityAllowanceConfirmed(value: unknown) {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const status = (value as Record<string, unknown>).allowanceEligibility;
  return status === "ELIGIBLE" || status === "APPROVED" || status === "CONFIRMED";
}

export function buildAttendancePayrollComponents(input: {
  snapshotId: string;
  timesheetRevision: number;
  periodStart: Date;
  payBasis: EmployeePayBasis;
  baseRateCents: number;
  workingDaysPerMonth?: number;
  attendance: PayrollAttendanceInput;
}): PayrollComponentLine[] {
  if (input.attendance.policyBlockers.length) return [];
  const lines: PayrollComponentLine[] = [];
  if (input.payBasis === "MONTHLY") {
    const absenceDayHundredths =
      input.attendance.unpaidLeaveDayHundredths +
      input.attendance.unauthorizedAbsenceDayHundredths;
    if (absenceDayHundredths > 0) {
      const workingDaysPerMonth = input.workingDaysPerMonth;
      if (
        workingDaysPerMonth === undefined ||
        !Number.isSafeInteger(workingDaysPerMonth) ||
        workingDaysPerMonth <= 0
      ) {
        throw new Error("Monthly absence deduction requires valid working days per month.");
      }
      addAttendanceLine(lines, input, {
        type: "DEDUCTION",
        code: "UNPAID_ABSENCE_DEDUCTION",
        name: "Unpaid Absence Deduction",
        amountCents: divideAndRound(
          input.baseRateCents * absenceDayHundredths,
          workingDaysPerMonth * 100,
        ),
        basis: "MONTHLY_SALARY_DIVIDED_BY_WORKING_DAYS_X_UNPAID_ABSENCE",
        sourceReason: `${formatHundredths(absenceDayHundredths)} unpaid absence day(s) deducted using the employee's monthly working-day rule.`,
        sortOrder: 710,
      });
    }
  } else if (input.payBasis === "DAILY") {
    addAttendanceLine(lines, input, {
      code: "REGULAR_DAILY_PAY",
      name: "Regular Daily Pay",
      amountCents: multiplyHundredths(
        input.baseRateCents,
        input.attendance.regularDayHundredths,
      ),
      basis: "LOCKED_TIMESHEET_DAYS_X_DAILY_RATE",
      sourceReason: `${formatHundredths(input.attendance.regularDayHundredths)} approved regular day(s) × ${formatMoney(input.baseRateCents)} daily rate.`,
      sortOrder: 110,
    });
    addAttendanceLine(lines, input, {
      code: "PAID_LEAVE_PAY",
      name: "Paid Leave Pay",
      amountCents: multiplyHundredths(
        input.baseRateCents,
        input.attendance.paidLeaveDayHundredths,
      ),
      basis: "FROZEN_PAID_LEAVE_DAYS_X_DAILY_RATE",
      sourceReason: `${formatHundredths(input.attendance.paidLeaveDayHundredths)} approved paid leave day(s) × ${formatMoney(input.baseRateCents)} daily rate.`,
      sortOrder: 210,
    });
  } else if (input.payBasis === "HOURLY") {
    addAttendanceLine(lines, input, {
      code: "REGULAR_HOURLY_PAY",
      name: "Regular Hourly Pay",
      amountCents: divideAndRound(
        input.baseRateCents * input.attendance.regularMinutes,
        60,
      ),
      basis: "LOCKED_TIMESHEET_MINUTES_X_HOURLY_RATE",
      sourceReason: `${input.attendance.regularMinutes} approved regular minute(s) × ${formatMoney(input.baseRateCents)} hourly rate ÷ 60.`,
      sortOrder: 110,
    });
  }
  return lines;
}

/**
 * P4C bridge foundation. This only proposes an explainable delta; it never
 * creates or approves a PayrollCorrection and never mutates finalized payroll.
 */
export function proposeAttendancePayrollCorrection(input: {
  payBasis: EmployeePayBasis;
  baseRateCents: number;
  periodStart: Date;
  oldRevision: number;
  newRevision: number;
  oldAttendance: PayrollAttendanceInput;
  newAttendance: PayrollAttendanceInput;
}) {
  const amountFor = (attendance: PayrollAttendanceInput, revision: number) =>
    buildAttendancePayrollComponents({
      snapshotId: "00000000-0000-4000-8000-000000000000",
      timesheetRevision: revision,
      periodStart: input.periodStart,
      payBasis: input.payBasis,
      baseRateCents: input.baseRateCents,
      attendance,
    }).reduce((sum, line) => sum + line.amountCents, 0);
  if (
    input.oldAttendance.policyBlockers.length ||
    input.newAttendance.policyBlockers.length
  ) {
    return {
      status: "POLICY_BLOCKED" as const,
      oldAmountCents: null,
      newAmountCents: null,
      deltaType: null,
      deltaAmountCents: null,
    };
  }
  const oldAmountCents = amountFor(input.oldAttendance, input.oldRevision);
  const newAmountCents = amountFor(input.newAttendance, input.newRevision);
  const signedDelta = newAmountCents - oldAmountCents;
  return {
    status: signedDelta === 0 ? ("NO_CHANGE" as const) : ("PROPOSED" as const),
    oldAmountCents,
    newAmountCents,
    deltaType:
      signedDelta === 0
        ? null
        : signedDelta > 0
          ? ("EARNING" as const)
          : ("DEDUCTION" as const),
    deltaAmountCents: Math.abs(signedDelta),
  };
}

function addAttendanceLine(
  lines: PayrollComponentLine[],
  input: Parameters<typeof buildAttendancePayrollComponents>[0],
  line: {
    type?: "EARNING" | "DEDUCTION";
    code: string;
    name: string;
    amountCents: number;
    basis: string;
    sourceReason: string;
    sortOrder: number;
  },
) {
  if (line.amountCents === 0) return;
  assertMoney(line.amountCents);
  lines.push({
    lineKey: `ATTENDANCE:${line.code}`,
    type: line.type ?? "EARNING",
    code: line.code,
    name: line.name,
    amountCents: line.amountCents,
    currency: "MYR",
    sourceType: "ATTENDANCE",
    sourceId: input.snapshotId,
    sourceVersionId: input.snapshotId,
    sourceRevision: input.timesheetRevision,
    effectiveFromMonth: input.periodStart,
    calculationBasis: line.basis,
    origin: "SYSTEM",
    reason: null,
    sourceReason: line.sourceReason,
    sortOrder: line.sortOrder,
  });
}

function leaveFractionHundredths(day: FrozenPayrollAttendanceDay) {
  if (
    day.outcome !== "APPROVED_PAID_LEAVE" &&
    day.outcome !== "APPROVED_UNPAID_LEAVE" &&
    day.outcome !== "AUTHORIZED_EMERGENCY_LEAVE"
  ) {
    return 100;
  }
  if (day.leaveDayFractionSnapshot === null) return null;
  const hundredths = Math.round(
    Number(day.leaveDayFractionSnapshot.toString()) * 100,
  );
  if (!Number.isSafeInteger(hundredths) || hundredths <= 0 || hundredths > 100) {
    throw new Error("Frozen Attendance leave units are outside the supported range.");
  }
  return hundredths;
}

function multiplyHundredths(cents: number, hundredths: number) {
  assertMoney(cents);
  return divideAndRound(cents * hundredths, 100);
}

function divideAndRound(numerator: number, denominator: number) {
  if (!Number.isSafeInteger(numerator) || numerator < 0) {
    throw new Error("Payroll attendance calculation exceeds safe integer precision.");
  }
  return Math.round(numerator / denominator);
}

function assertMoney(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error("Payroll attendance amount must use safe integer cents.");
  }
}

function assertMinutes(minutes: number) {
  if (!Number.isSafeInteger(minutes) || minutes < 0) {
    throw new Error("Frozen Attendance minutes are invalid.");
  }
}

function formatHundredths(value: number) {
  return (value / 100).toFixed(value % 100 === 0 ? 0 : 2);
}

function formatMoney(cents: number) {
  return `RM${(cents / 100).toFixed(2)}`;
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
