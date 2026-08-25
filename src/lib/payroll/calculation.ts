export type PayrollPayBasis = "MONTHLY" | "DAILY" | "HOURLY";

export type PayrollWorkDay = {
  minutes: number;
  publicHoliday: boolean;
};

export type PayrollCalculationInput = {
  payBasis: PayrollPayBasis;
  baseRateCents: number;
  workingDaysPerMonth: number;
  normalWorkMinutesPerDay: number;
  overtimeMultiplier: number;
  publicHolidayExtraMultiplier: number;
  days: readonly PayrollWorkDay[];
  paidLeaveDays?: number;
  unpaidLeaveDays?: number;
};

export type PayrollCalculation = {
  attendanceDays: number;
  regularMinutes: number;
  overtimeMinutes: number;
  publicHolidayMinutes: number;
  basicPayCents: number;
  overtimePayCents: number;
  publicHolidayPayCents: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  leavePayCents: number;
  unpaidLeaveDeductionCents: number;
  grossPayCents: number;
};

export const MID_PERIOD_PRORATION_NOT_READY = "MID_PERIOD_PRORATION_NOT_READY";

export function assertSupportedPayrollProration(input: {
  payBasis: PayrollPayBasis;
  joinedAt: Date;
  terminatedAt: Date | null;
  periodStart: Date;
  periodEnd: Date;
}) {
  if (input.payBasis !== "MONTHLY") return;
  const finalPeriodDay = new Date(input.periodEnd.getTime() - 24 * 60 * 60 * 1000);
  if (
    input.joinedAt > input.periodStart ||
    (input.terminatedAt !== null && input.terminatedAt < finalPeriodDay)
  ) {
    throw new Error(
      `${MID_PERIOD_PRORATION_NOT_READY}: Monthly employees who join or terminate mid-period require an approved proration policy.`,
    );
  }
}

export function calculatePayroll(
  input: PayrollCalculationInput,
): PayrollCalculation {
  assertPositiveInteger(input.baseRateCents, "Base rate", true);
  assertPositiveInteger(input.workingDaysPerMonth, "Working days");
  assertPositiveInteger(input.normalWorkMinutesPerDay, "Normal work minutes");
  assertMultiplier(input.overtimeMultiplier, "Overtime multiplier", 1);
  assertMultiplier(
    input.publicHolidayExtraMultiplier,
    "Public holiday extra multiplier",
    0,
  );
  const paidLeaveDays = input.paidLeaveDays ?? 0;
  const unpaidLeaveDays = input.unpaidLeaveDays ?? 0;
  assertLeaveDays(paidLeaveDays, "Paid leave days");
  assertLeaveDays(unpaidLeaveDays, "Unpaid leave days");
  if (paidLeaveDays + unpaidLeaveDays > 366) {
    throw new Error("Leave days are outside the supported range.");
  }

  const days = input.days.filter((day) => day.minutes > 0);
  days.forEach((day) => assertPositiveInteger(day.minutes, "Worked minutes"));
  const normalDays = days.filter((day) => !day.publicHoliday);
  const holidayDays = days.filter((day) => day.publicHoliday);
  const regularMinutes = normalDays.reduce(
    (sum, day) => sum + Math.min(day.minutes, input.normalWorkMinutesPerDay),
    0,
  );
  const overtimeMinutes = normalDays.reduce(
    (sum, day) => sum + Math.max(0, day.minutes - input.normalWorkMinutesPerDay),
    0,
  );
  const publicHolidayMinutes = holidayDays.reduce(
    (sum, day) => sum + day.minutes,
    0,
  );
  const ordinaryDailyRateCents =
    input.payBasis === "MONTHLY"
      ? input.baseRateCents / input.workingDaysPerMonth
      : input.payBasis === "DAILY"
        ? input.baseRateCents
        : (input.baseRateCents * input.normalWorkMinutesPerDay) / 60;
  const hourlyRateCents =
    ordinaryDailyRateCents / (input.normalWorkMinutesPerDay / 60);

  let basicPayCents: number;
  let publicHolidayPayCents: number;
  let leavePayCents = 0;
  let unpaidLeaveDeductionCents = 0;
  if (input.payBasis === "MONTHLY") {
    unpaidLeaveDeductionCents = ordinaryDailyRateCents * unpaidLeaveDays;
    basicPayCents = Math.max(0, input.baseRateCents - unpaidLeaveDeductionCents);
    publicHolidayPayCents =
      ordinaryDailyRateCents *
      input.publicHolidayExtraMultiplier *
      holidayDays.length;
  } else if (input.payBasis === "DAILY") {
    basicPayCents = input.baseRateCents * normalDays.length;
    leavePayCents = input.baseRateCents * paidLeaveDays;
    publicHolidayPayCents =
      input.baseRateCents *
      (1 + input.publicHolidayExtraMultiplier) *
      holidayDays.length;
  } else {
    basicPayCents = (hourlyRateCents * regularMinutes) / 60;
    leavePayCents = ordinaryDailyRateCents * paidLeaveDays;
    publicHolidayPayCents =
      (hourlyRateCents *
        publicHolidayMinutes *
        (1 + input.publicHolidayExtraMultiplier)) /
      60;
  }

  const overtimePayCents =
    (hourlyRateCents * overtimeMinutes * input.overtimeMultiplier) / 60;
  const roundedBasicPay = roundCents(basicPayCents);
  const roundedOvertimePay = roundCents(overtimePayCents);
  const roundedPublicHolidayPay = roundCents(publicHolidayPayCents);
  const roundedLeavePay = roundCents(leavePayCents);
  const roundedUnpaidDeduction = roundCents(unpaidLeaveDeductionCents);

  return {
    attendanceDays: days.length,
    regularMinutes,
    overtimeMinutes,
    publicHolidayMinutes,
    basicPayCents: roundedBasicPay,
    overtimePayCents: roundedOvertimePay,
    publicHolidayPayCents: roundedPublicHolidayPay,
    paidLeaveDays,
    unpaidLeaveDays,
    leavePayCents: roundedLeavePay,
    unpaidLeaveDeductionCents: roundedUnpaidDeduction,
    grossPayCents:
      roundedBasicPay + roundedLeavePay + roundedOvertimePay + roundedPublicHolidayPay,
  };
}

export function calculatePayrollTotals(input: {
  basicPayCents: number;
  overtimePayCents: number;
  publicHolidayPayCents: number;
  leavePayCents?: number;
  allowancesCents: number;
  otherDeductionsCents: number;
  epfEmployeeCents: number;
  socsoEmployeeCents: number;
  eisEmployeeCents: number;
  lindung24EmployeeCents: number;
  pcbCents: number;
  cp38Cents?: number;
}) {
  const normalized = { ...input, leavePayCents: input.leavePayCents ?? 0 };
  Object.entries(normalized).forEach(([label, value]) =>
    assertPositiveInteger(value, label, true),
  );
  const grossPayCents =
    input.basicPayCents +
    normalized.leavePayCents +
    input.overtimePayCents +
    input.publicHolidayPayCents +
    input.allowancesCents;
  const deductionsCents =
    input.otherDeductionsCents +
    input.epfEmployeeCents +
    input.socsoEmployeeCents +
    input.eisEmployeeCents +
    input.lindung24EmployeeCents +
    input.pcbCents +
    (input.cp38Cents ?? 0);
  return {
    grossPayCents,
    deductionsCents,
    netPayCents: Math.max(0, grossPayCents - deductionsCents),
  };
}

function assertPositiveInteger(value: number, label: string, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${label} must be a safe non-negative amount.`);
  }
}

function assertMultiplier(value: number, label: string, minimum: number) {
  if (!Number.isFinite(value) || value < minimum || value > 10) {
    throw new Error(`${label} is outside the supported range.`);
  }
}

function roundCents(value: number) {
  return Math.round(value);
}

function assertLeaveDays(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0 || value > 366 || Math.round(value * 2) !== value * 2) {
    throw new Error(`${label} must use whole-day or half-day increments.`);
  }
}
