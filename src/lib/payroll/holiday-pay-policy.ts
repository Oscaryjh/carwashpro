import type { EmployeePayBasis } from "@prisma/client";

export type HolidayPayPreview = {
  amountCents: number;
  calculationBasis: string;
  explanation: string;
};

/**
 * Produces a business-policy preview from frozen payroll inputs.
 * This is deliberately not a statutory/legal rate engine. The configured
 * multiplier is snapshotted on the Payroll Run and a human must still confirm
 * the result before it becomes an earning component.
 */
export function calculateHolidayPayPreview(input: {
  payBasis: EmployeePayBasis;
  baseRateCents: number;
  workingDaysPerMonth: number;
  normalWorkMinutesPerDay: number;
  publicHolidayWorkedMinutes: number;
  publicHolidayExtraMultiplier: number;
}): HolidayPayPreview {
  assertWholeNumber(input.baseRateCents, "Base rate", true);
  assertWholeNumber(input.workingDaysPerMonth, "Working days per month");
  assertWholeNumber(input.normalWorkMinutesPerDay, "Normal work minutes per day");
  assertWholeNumber(input.publicHolidayWorkedMinutes, "Public holiday worked minutes", true);
  if (
    !Number.isFinite(input.publicHolidayExtraMultiplier) ||
    input.publicHolidayExtraMultiplier < 0 ||
    input.publicHolidayExtraMultiplier > 10
  ) {
    throw new Error("Public holiday multiplier is outside the supported range.");
  }

  if (input.publicHolidayWorkedMinutes === 0) {
    return {
      amountCents: 0,
      calculationBasis: "NO_PUBLIC_HOLIDAY_WORK",
      explanation: "No frozen public-holiday worked minutes were recorded.",
    };
  }

  const hourlyRateCents = input.payBasis === "MONTHLY"
    ? input.baseRateCents /
      input.workingDaysPerMonth /
      (input.normalWorkMinutesPerDay / 60)
    : input.payBasis === "DAILY"
      ? input.baseRateCents / (input.normalWorkMinutesPerDay / 60)
      : input.baseRateCents;
  const appliedMultiplier = input.payBasis === "MONTHLY"
    ? input.publicHolidayExtraMultiplier
    : 1 + input.publicHolidayExtraMultiplier;
  const amountCents = Math.round(
    hourlyRateCents *
      (input.publicHolidayWorkedMinutes / 60) *
      appliedMultiplier,
  );

  return {
    amountCents,
    calculationBasis: input.payBasis === "MONTHLY"
      ? "FROZEN_HOLIDAY_MINUTES_X_MONTHLY_ORDINARY_HOURLY_RATE_X_EXTRA_MULTIPLIER"
      : "FROZEN_HOLIDAY_MINUTES_X_ORDINARY_HOURLY_RATE_X_TOTAL_MULTIPLIER",
    explanation: `${input.publicHolidayWorkedMinutes} frozen minute(s) x ordinary hourly rate x ${appliedMultiplier.toFixed(2)} policy multiplier.`,
  };
}

function assertWholeNumber(value: number, label: string, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${label} is outside the supported range.`);
  }
}
