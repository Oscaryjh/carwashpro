export type CompanyWorkPayInput = {
  payBasis: "MONTHLY" | "DAILY" | "HOURLY";
  baseRateCents: number;
  workingDaysPerMonth: number;
  normalWorkMinutesPerDay: number;
  normalOtMinutes: number;
  restDayWorkMinutes: number;
  restDayOtMinutes: number;
  publicHolidayWorkMinutes: number;
  publicHolidayOtMinutes: number;
  overtimeMultiplier: number;
  restDayWorkMultiplier: number;
  restDayOvertimeMultiplier: number;
  publicHolidayWorkMultiplier: number;
  publicHolidayOvertimeMultiplier: number;
  publicHolidayPayEnabled: boolean;
};

export type CompanyWorkPayResult = {
  hourlyRateCents: number;
  normalOvertimePayCents: number;
  restDayWorkPayCents: number;
  restDayOvertimePayCents: number;
  publicHolidayWorkPayCents: number;
  publicHolidayOvertimePayCents: number;
  overtimePayCents: number;
  publicHolidayPayCents: number;
};

export function calculateCompanyWorkPay(
  input: CompanyWorkPayInput,
): CompanyWorkPayResult {
  assertPositiveInteger(input.baseRateCents, "base rate");
  assertPositiveInteger(input.workingDaysPerMonth, "working days per month");
  assertPositiveInteger(input.normalWorkMinutesPerDay, "paid work minutes");
  [
    input.normalOtMinutes,
    input.restDayWorkMinutes,
    input.restDayOtMinutes,
    input.publicHolidayWorkMinutes,
    input.publicHolidayOtMinutes,
  ].forEach((minutes) => assertMinutes(minutes));
  [
    input.overtimeMultiplier,
    input.restDayWorkMultiplier,
    input.restDayOvertimeMultiplier,
    input.publicHolidayWorkMultiplier,
    input.publicHolidayOvertimeMultiplier,
  ].forEach(assertMultiplier);

  const ordinaryDailyRateCents =
    input.payBasis === "MONTHLY"
      ? input.baseRateCents / input.workingDaysPerMonth
      : input.payBasis === "DAILY"
        ? input.baseRateCents
        : (input.baseRateCents * input.normalWorkMinutesPerDay) / 60;
  const hourlyRateCents =
    (ordinaryDailyRateCents * 60) / input.normalWorkMinutesPerDay;
  const payFor = (minutes: number, multiplier: number) =>
    Math.round((hourlyRateCents * minutes * multiplier) / 60);

  const normalOvertimePayCents = payFor(
    input.normalOtMinutes,
    input.overtimeMultiplier,
  );
  const restDayWorkPayCents = payFor(
    input.restDayWorkMinutes,
    input.restDayWorkMultiplier,
  );
  const restDayOvertimePayCents = payFor(
    input.restDayOtMinutes,
    input.restDayOvertimeMultiplier,
  );
  const publicHolidayWorkPayCents = input.publicHolidayPayEnabled
    ? payFor(
        input.publicHolidayWorkMinutes,
        input.publicHolidayWorkMultiplier,
      )
    : 0;
  const publicHolidayOvertimePayCents = input.publicHolidayPayEnabled
    ? payFor(
        input.publicHolidayOtMinutes,
        input.publicHolidayOvertimeMultiplier,
      )
    : 0;

  return {
    hourlyRateCents: Math.round(hourlyRateCents),
    normalOvertimePayCents,
    restDayWorkPayCents,
    restDayOvertimePayCents,
    publicHolidayWorkPayCents,
    publicHolidayOvertimePayCents,
    overtimePayCents:
      normalOvertimePayCents + restDayWorkPayCents + restDayOvertimePayCents,
    publicHolidayPayCents:
      publicHolidayWorkPayCents + publicHolidayOvertimePayCents,
  };
}

function assertPositiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Company work-pay ${label} is invalid.`);
  }
}

function assertMinutes(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Company work-pay minutes are invalid.");
  }
}

function assertMultiplier(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 10) {
    throw new Error("Company work-pay multiplier is invalid.");
  }
}
