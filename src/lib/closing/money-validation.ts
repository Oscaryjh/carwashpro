import { z } from "zod";

export const CLOSING_MONEY_MAX = 21_474_836.47;

export const closingMoneySchema = z.preprocess(
  (value) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed === "" ? Number.NaN : Number(trimmed);
    }
    return value;
  },
  z
    .number()
    .finite("Enter a valid amount.")
    .min(0, "Amount cannot be negative.")
    .max(CLOSING_MONEY_MAX, "Amount is too large.")
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
      "Enter an amount with no more than 2 decimal places.",
    ),
);

export function requireDailyClosingDifferenceReason(input: {
  actualCashCents: number;
  expectedCashCents: number;
  reason?: string | null;
}) {
  const reason = input.reason?.trim() || null;
  if (reason && reason.length > 1000) {
    throw new DailyClosingDifferenceReasonError("Closing reason is too long.");
  }
  if (input.actualCashCents !== input.expectedCashCents && !reason) {
    throw new DailyClosingDifferenceReasonError(
      "Explain the cash difference before confirming Daily Closing.",
    );
  }
  return reason;
}

export class DailyClosingDifferenceReasonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DailyClosingDifferenceReasonError";
  }
}
