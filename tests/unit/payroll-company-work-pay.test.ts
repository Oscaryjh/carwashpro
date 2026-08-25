import assert from "node:assert/strict";
import test from "node:test";
import { calculateCompanyWorkPay } from "../../src/lib/payroll/company-work-pay";

test("HR company multipliers calculate normal OT, rest-day and holiday pay", () => {
  const result = calculateCompanyWorkPay({
    payBasis: "MONTHLY",
    baseRateCents: 260_000,
    workingDaysPerMonth: 26,
    normalWorkMinutesPerDay: 480,
    normalOtMinutes: 180,
    restDayWorkMinutes: 480,
    restDayOtMinutes: 180,
    publicHolidayWorkMinutes: 480,
    publicHolidayOtMinutes: 180,
    overtimeMultiplier: 1.5,
    restDayWorkMultiplier: 1,
    restDayOvertimeMultiplier: 2,
    publicHolidayWorkMultiplier: 2,
    publicHolidayOvertimeMultiplier: 3,
    publicHolidayPayEnabled: true,
  });

  assert.deepEqual(result, {
    hourlyRateCents: 1_250,
    normalOvertimePayCents: 5_625,
    restDayWorkPayCents: 10_000,
    restDayOvertimePayCents: 7_500,
    publicHolidayWorkPayCents: 20_000,
    publicHolidayOvertimePayCents: 11_250,
    overtimePayCents: 23_125,
    publicHolidayPayCents: 31_250,
  });
});

test("turning holiday work pay off does not disable HR normal and rest-day rules", () => {
  const result = calculateCompanyWorkPay({
    payBasis: "HOURLY",
    baseRateCents: 1_000,
    workingDaysPerMonth: 26,
    normalWorkMinutesPerDay: 480,
    normalOtMinutes: 60,
    restDayWorkMinutes: 60,
    restDayOtMinutes: 60,
    publicHolidayWorkMinutes: 480,
    publicHolidayOtMinutes: 180,
    overtimeMultiplier: 1.5,
    restDayWorkMultiplier: 1,
    restDayOvertimeMultiplier: 2,
    publicHolidayWorkMultiplier: 2,
    publicHolidayOvertimeMultiplier: 3,
    publicHolidayPayEnabled: false,
  });

  assert.equal(result.normalOvertimePayCents, 1_500);
  assert.equal(result.restDayWorkPayCents, 1_000);
  assert.equal(result.restDayOvertimePayCents, 2_000);
  assert.equal(result.overtimePayCents, 4_500);
  assert.equal(result.publicHolidayPayCents, 0);
});

test("company work-pay calculation rejects invalid HR multipliers", () => {
  assert.throws(
    () =>
      calculateCompanyWorkPay({
        payBasis: "DAILY",
        baseRateCents: 10_000,
        workingDaysPerMonth: 26,
        normalWorkMinutesPerDay: 480,
        normalOtMinutes: 0,
        restDayWorkMinutes: 0,
        restDayOtMinutes: 0,
        publicHolidayWorkMinutes: 0,
        publicHolidayOtMinutes: 0,
        overtimeMultiplier: 11,
        restDayWorkMultiplier: 1,
        restDayOvertimeMultiplier: 2,
        publicHolidayWorkMultiplier: 2,
        publicHolidayOvertimeMultiplier: 3,
        publicHolidayPayEnabled: true,
      }),
    /multiplier is invalid/,
  );
});
