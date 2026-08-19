import assert from "node:assert/strict";
import test from "node:test";
import { calculateHolidayPayPreview } from "../../src/lib/payroll/holiday-pay-policy";

test("monthly holiday preview adds only the configured extra multiplier", () => {
  const result = calculateHolidayPayPreview({
    payBasis: "MONTHLY",
    baseRateCents: 260_000,
    workingDaysPerMonth: 26,
    normalWorkMinutesPerDay: 480,
    publicHolidayWorkedMinutes: 480,
    publicHolidayExtraMultiplier: 2,
  });
  assert.equal(result.amountCents, 20_000);
  assert.match(result.calculationBasis, /MONTHLY_ORDINARY_HOURLY_RATE/);
});

test("daily and hourly previews include ordinary pay plus the configured extra", () => {
  const daily = calculateHolidayPayPreview({
    payBasis: "DAILY",
    baseRateCents: 10_000,
    workingDaysPerMonth: 26,
    normalWorkMinutesPerDay: 480,
    publicHolidayWorkedMinutes: 240,
    publicHolidayExtraMultiplier: 2,
  });
  const hourly = calculateHolidayPayPreview({
    payBasis: "HOURLY",
    baseRateCents: 2_000,
    workingDaysPerMonth: 26,
    normalWorkMinutesPerDay: 480,
    publicHolidayWorkedMinutes: 120,
    publicHolidayExtraMultiplier: 2,
  });
  assert.equal(daily.amountCents, 15_000);
  assert.equal(hourly.amountCents, 12_000);
});

test("zero frozen holiday minutes always produces a zero preview", () => {
  const result = calculateHolidayPayPreview({
    payBasis: "MONTHLY",
    baseRateCents: 260_000,
    workingDaysPerMonth: 26,
    normalWorkMinutesPerDay: 480,
    publicHolidayWorkedMinutes: 0,
    publicHolidayExtraMultiplier: 2,
  });
  assert.equal(result.amountCents, 0);
  assert.equal(result.calculationBasis, "NO_PUBLIC_HOLIDAY_WORK");
});

test("invalid rates and multipliers fail closed", () => {
  assert.throws(() => calculateHolidayPayPreview({
    payBasis: "HOURLY",
    baseRateCents: 2_000,
    workingDaysPerMonth: 26,
    normalWorkMinutesPerDay: 480,
    publicHolidayWorkedMinutes: 60,
    publicHolidayExtraMultiplier: 11,
  }), /outside the supported range/);
});
