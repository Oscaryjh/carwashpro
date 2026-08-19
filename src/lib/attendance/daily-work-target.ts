export type AttendanceWorkTargetSource =
  | "PUBLISHED_ROSTER"
  | "EMPLOYEE_PROFILE"
  | "BRANCH_POLICY";

type ExpectedDayForWorkTarget = {
  expectedEndAt: Date | null;
  expectedStartAt: Date | null;
  kind: string;
  policySnapshot: unknown;
  source: string;
} | null;

export type AttendanceDailyWorkTarget = {
  expectedBreakMinutes: number;
  expectedBreakSource: AttendanceWorkTargetSource;
  normalWorkMinutesPerDay: number;
  normalWorkMinutesSource: AttendanceWorkTargetSource;
};

export function resolveAttendanceDailyWorkTarget(input: {
  branchNormalWorkMinutesPerDay: number;
  branchTargetBreakMinutes: number;
  employeeNormalWorkMinutesPerDay: number | null;
  employeeTargetBreakMinutes: number | null;
  expectedDay: ExpectedDayForWorkTarget;
}): AttendanceDailyWorkTarget {
  const rosterTarget = resolvePublishedRosterTarget(input.expectedDay);
  if (rosterTarget) return rosterTarget;

  return {
    expectedBreakMinutes:
      input.employeeTargetBreakMinutes ?? input.branchTargetBreakMinutes,
    expectedBreakSource:
      input.employeeTargetBreakMinutes !== null
        ? "EMPLOYEE_PROFILE"
        : "BRANCH_POLICY",
    normalWorkMinutesPerDay:
      input.employeeNormalWorkMinutesPerDay ??
      input.branchNormalWorkMinutesPerDay,
    normalWorkMinutesSource:
      input.employeeNormalWorkMinutesPerDay !== null
        ? "EMPLOYEE_PROFILE"
        : "BRANCH_POLICY",
  };
}

function resolvePublishedRosterTarget(
  expectedDay: ExpectedDayForWorkTarget,
): AttendanceDailyWorkTarget | null {
  if (
    !expectedDay ||
    expectedDay.source !== "ROSTER" ||
    expectedDay.kind !== "WORKDAY" ||
    !expectedDay.expectedStartAt ||
    !expectedDay.expectedEndAt
  ) {
    return null;
  }

  const scheduledBreakMinutes = readScheduledBreakMinutes(
    expectedDay.policySnapshot,
  );
  if (scheduledBreakMinutes === null) return null;

  const shiftSpanMinutes = Math.round(
    (expectedDay.expectedEndAt.getTime() -
      expectedDay.expectedStartAt.getTime()) /
      60_000,
  );
  if (
    shiftSpanMinutes <= 0 ||
    shiftSpanMinutes > 24 * 60 ||
    scheduledBreakMinutes >= shiftSpanMinutes
  ) {
    return null;
  }

  return {
    expectedBreakMinutes: scheduledBreakMinutes,
    expectedBreakSource: "PUBLISHED_ROSTER",
    normalWorkMinutesPerDay: shiftSpanMinutes - scheduledBreakMinutes,
    normalWorkMinutesSource: "PUBLISHED_ROSTER",
  };
}

function readScheduledBreakMinutes(policySnapshot: unknown) {
  if (
    !policySnapshot ||
    typeof policySnapshot !== "object" ||
    Array.isArray(policySnapshot)
  ) {
    return null;
  }

  const value = Reflect.get(policySnapshot, "scheduledBreakMinutes");
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 720
    ? Number(value)
    : null;
}
