import assert from "node:assert/strict";
import test from "node:test";
import {
  calculatePayroll,
  calculatePayrollTotals,
} from "../../src/lib/payroll/calculation";

test("monthly payroll uses the Malaysia ordinary-rate 26-day divisor", () => {
  const result = calculatePayroll({
    payBasis: "MONTHLY",
    baseRateCents: 260_000,
    workingDaysPerMonth: 26,
    normalWorkMinutesPerDay: 480,
    overtimeMultiplier: 1.5,
    publicHolidayExtraMultiplier: 2,
    days: [
      { minutes: 480, publicHoliday: false },
      { minutes: 540, publicHoliday: false },
      { minutes: 480, publicHoliday: true },
    ],
  });

  assert.deepEqual(result, {
    attendanceDays: 3,
    regularMinutes: 960,
    overtimeMinutes: 60,
    publicHolidayMinutes: 480,
    basicPayCents: 260_000,
    overtimePayCents: 1_875,
    publicHolidayPayCents: 20_000,
    grossPayCents: 281_875,
  });
});

test("daily payroll pays normal attendance days and a worked holiday separately", () => {
  const result = calculatePayroll({
    payBasis: "DAILY",
    baseRateCents: 9_000,
    workingDaysPerMonth: 26,
    normalWorkMinutesPerDay: 480,
    overtimeMultiplier: 1.5,
    publicHolidayExtraMultiplier: 2,
    days: [
      { minutes: 480, publicHoliday: false },
      { minutes: 480, publicHoliday: true },
    ],
  });

  assert.equal(result.basicPayCents, 9_000);
  assert.equal(result.publicHolidayPayCents, 27_000);
  assert.equal(result.grossPayCents, 36_000);
});

test("hourly payroll does not double count overtime or holiday minutes", () => {
  const result = calculatePayroll({
    payBasis: "HOURLY",
    baseRateCents: 1_250,
    workingDaysPerMonth: 26,
    normalWorkMinutesPerDay: 480,
    overtimeMultiplier: 1.5,
    publicHolidayExtraMultiplier: 2,
    days: [
      { minutes: 540, publicHoliday: false },
      { minutes: 120, publicHoliday: true },
    ],
  });

  assert.equal(result.basicPayCents, 10_000);
  assert.equal(result.overtimePayCents, 1_875);
  assert.equal(result.publicHolidayPayCents, 7_500);
  assert.equal(result.grossPayCents, 19_375);
});

test("manual statutory deductions are explicit and net pay never becomes negative", () => {
  assert.deepEqual(
    calculatePayrollTotals({
      basicPayCents: 200_000,
      overtimePayCents: 10_000,
      publicHolidayPayCents: 0,
      allowancesCents: 5_000,
      otherDeductionsCents: 2_000,
      epfEmployeeCents: 22_000,
      socsoEmployeeCents: 1_000,
      eisEmployeeCents: 400,
        lindung24EmployeeCents: 0,
      pcbCents: 3_000,
    }),
    {
      grossPayCents: 215_000,
      deductionsCents: 28_400,
      netPayCents: 186_600,
    },
  );
});
