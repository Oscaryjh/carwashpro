import { createHash } from "node:crypto";
import type { EmployeePayBasis } from "@prisma/client";
import type { PayrollComponentLine } from "@/lib/payroll/component-calculation";

export const OVERTIME_APPROVAL_SOURCE_NOT_READY =
  "OVERTIME_APPROVAL_SOURCE_NOT_READY";

export type AttendancePayPolicyBlocker =
  | "APPROVED_ATTENDANCE_INPUT_NOT_MATERIALISED"
  | "PAYROLL_ABSENCE_RATE_POLICY_NOT_READY"
  | "AUTHORIZED_ABSENCE_PAY_POLICY_NOT_READY"
  | "REST_DAY_RATE_POLICY_NOT_READY"
  | "PUBLIC_HOLIDAY_RATE_POLICY_NOT_READY"
  | "HOURLY_PAID_LEAVE_UNIT_POLICY_NOT_READY"
  | "NOT_SCHEDULED_WORK_POLICY_NOT_READY";

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
  totalWorkedMinutes: number;
  sourceDigest: string;
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
  sourceDayCount: number;
  legacyCompatibility: boolean;
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
}): PayrollAttendanceInput {
  let regularDayHundredths = 0;
  let regularMinutes = 0;
  let paidLeaveDayHundredths = 0;
  let unpaidLeaveDayHundredths = 0;
  let unauthorizedAbsenceDayHundredths = 0;
  let authorizedAbsenceDayHundredths = 0;
  let restDayWorkedMinutes = 0;
  let publicHolidayWorkedMinutes = 0;
  const blockers = new Set<AttendancePayPolicyBlocker>();
  const ordered = [...input.days].sort(
    (left, right) =>
      left.workDate.getTime() - right.workDate.getTime() ||
      left.id.localeCompare(right.id),
  );

  for (const day of ordered) {
    assertMinutes(day.totalWorkedMinutes);
    const fraction = leaveFractionHundredths(day);
    const kind = day.expectedDayKindSnapshot;

    if (day.outcome === "APPROVED_PAID_LEAVE") {
      if (fraction === null) {
        blockers.add("APPROVED_ATTENDANCE_INPUT_NOT_MATERIALISED");
      } else {
        paidLeaveDayHundredths += fraction;
      }
      continue;
    }
    if (day.outcome === "APPROVED_UNPAID_LEAVE") {
      if (fraction === null) {
        blockers.add("APPROVED_ATTENDANCE_INPUT_NOT_MATERIALISED");
      } else {
        unpaidLeaveDayHundredths += fraction;
      }
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
      regularMinutes += day.totalWorkedMinutes;
    }
  }

  const legacyCompatibility = ordered.length === 0 && input.payBasis === "MONTHLY";
  if (ordered.length === 0 && input.payBasis !== "MONTHLY") {
    blockers.add("APPROVED_ATTENDANCE_INPUT_NOT_MATERIALISED");
  }
  if (
    input.payBasis === "MONTHLY" &&
    (unpaidLeaveDayHundredths > 0 || unauthorizedAbsenceDayHundredths > 0)
  ) {
    blockers.add("PAYROLL_ABSENCE_RATE_POLICY_NOT_READY");
  }
  if (authorizedAbsenceDayHundredths > 0) {
    blockers.add("AUTHORIZED_ABSENCE_PAY_POLICY_NOT_READY");
  }
  if (restDayWorkedMinutes > 0) blockers.add("REST_DAY_RATE_POLICY_NOT_READY");
  if (publicHolidayWorkedMinutes > 0) {
    blockers.add("PUBLIC_HOLIDAY_RATE_POLICY_NOT_READY");
  }
  if (input.payBasis === "HOURLY" && paidLeaveDayHundredths > 0) {
    blockers.add("HOURLY_PAID_LEAVE_UNIT_POLICY_NOT_READY");
  }

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
      approvedOvertimeMinutes: 0,
    },
    policyBlockers,
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
    approvedOvertimeMinutes: 0,
    sourceDayCount: ordered.length,
    legacyCompatibility,
    policyBlockers,
    sourceDigest,
  };
}

export function buildAttendancePayrollComponents(input: {
  snapshotId: string;
  timesheetRevision: number;
  periodStart: Date;
  payBasis: EmployeePayBasis;
  baseRateCents: number;
  attendance: PayrollAttendanceInput;
}): PayrollComponentLine[] {
  if (input.attendance.policyBlockers.length) return [];
  const lines: PayrollComponentLine[] = [];
  if (input.payBasis === "DAILY") {
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
    type: "EARNING",
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
