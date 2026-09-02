import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import {
  assertCashierShiftAcceptsActivity,
  calculateShiftExpectedCashCents,
  CashierShiftBusinessDayCrossedError,
  DAILY_CLOSING_OPEN_SHIFT_MESSAGE,
  DailyClosingOpenShiftError,
  getCashierShiftBusinessDate,
} from "../../src/lib/closing/shift-control";
import { calculateDailyClosingReport } from "../../src/lib/daily-closing/calculator";
import { getExpectedCashCents } from "../../src/lib/daily-closing/snapshot";

const settings = {
  businessDayCutoffTime: "02:00",
  timezone: "Asia/Kuching",
};

test("cashier shift business date follows the configured cutoff", () => {
  assert.equal(
    getCashierShiftBusinessDate(new Date("2026-08-27T17:30:00.000Z"), settings),
    "2026-08-27",
  );
  assert.equal(
    getCashierShiftBusinessDate(new Date("2026-08-27T18:00:00.000Z"), settings),
    "2026-08-28",
  );
});

test("post-cutoff financial activity cannot attach to a previous-day open shift", async () => {
  const tx = {
    business: {
      findUniqueOrThrow: async () => settings,
    },
  } as unknown as Prisma.TransactionClient;

  await assert.rejects(
    assertCashierShiftAcceptsActivity(tx, {
      activityAt: new Date("2026-08-27T18:15:00.000Z"),
      businessId: "business-1",
      shift: {
        id: "shift-1",
        startedAt: new Date("2026-08-27T17:30:00.000Z"),
      },
    }),
    (error: unknown) => error instanceof CashierShiftBusinessDayCrossedError,
  );
});

test("manual daily close open-shift error has stable user-facing wording", () => {
  const error = new DailyClosingOpenShiftError(1);
  assert.equal(error.openShiftCount, 1);
  assert.equal(error.message, DAILY_CLOSING_OPEN_SHIFT_MESSAGE);
});

test("shift and daily closing keep opening float out of daily movement", () => {
  assert.equal(calculateShiftExpectedCashCents({
    cashPaymentCents: 2_000,
    cashRefundCents: 0,
    expensePayoutCents: 0,
    openingFloatCents: 5_000,
  }), 7_000);

  const daily = calculateDailyClosingReport({
    appointments: [],
    customers: [],
    drawerExpensePayouts: [],
    invoices: [],
    packagePurchases: [],
    payments: [{ amountCents: 2_000, method: "CASH", packageUses: 0 }],
    refunds: [],
    shifts: [],
    workOrders: [],
  }, new Date("2026-08-27T18:00:00.000Z"));
  assert.equal(getExpectedCashCents(daily), 2_000);
});

test("refunds and drawer payouts remain part of shift expected cash", () => {
  assert.equal(calculateShiftExpectedCashCents({
    cashPaymentCents: 10_000,
    cashRefundCents: 2_000,
    expensePayoutCents: 1_500,
    openingFloatCents: 5_000,
  }), 11_500);
});
