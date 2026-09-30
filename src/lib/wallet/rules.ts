import { Prisma } from "@prisma/client";
import { MAX_PAYMENT_CENTS, WalletRuleError, type WalletBalances } from "./types";

function cents(value: number, positive = false): number {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) throw new WalletRuleError("Invalid wallet cents");
  return value;
}
function sum(a: number, b: number): number { return cents(cents(a) + cents(b)); }
function payment(value: number): number {
  cents(value, true);
  if (value > MAX_PAYMENT_CENTS) throw new WalletRuleError("Payment amount out of range");
  return value;
}

export function parseWalletAmount(value: string | Prisma.Decimal): number {
  if (typeof value !== "string" && !Prisma.Decimal.isDecimal(value)) throw new WalletRuleError("Use decimal text");
  const text = value.toString();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new WalletRuleError("Invalid wallet amount");
  const [whole, fraction = ""] = text.split(".");
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (result > BigInt(MAX_PAYMENT_CENTS)) throw new WalletRuleError("Payment amount out of range");
  return Number(result);
}

export function planWalletDebit(input: WalletBalances & { amountCents: number }) {
  const available = sum(input.paidCents, input.bonusCents);
  payment(input.amountCents);
  if (input.amountCents > available) throw new WalletRuleError("Insufficient wallet balance");
  const bonusUsedCents = Math.min(input.bonusCents, input.amountCents);
  return { paidUsedCents: input.amountCents - bonusUsedCents, bonusUsedCents };
}

export function planWalletRefund(input: {
  originalPaidCents: number; originalBonusCents: number;
  refundedPaidCents: number; refundedBonusCents: number; refundCents: number;
}) {
  const original = sum(input.originalPaidCents, input.originalBonusCents);
  const prior = sum(input.refundedPaidCents, input.refundedBonusCents);
  payment(input.refundCents);
  if (prior > original || input.refundedPaidCents !== Math.min(input.originalPaidCents, prior)) throw new WalletRuleError("Invalid prior refund composition");
  const cumulative = sum(prior, input.refundCents);
  if (cumulative > original) throw new WalletRuleError("Refund exceeds original redemption");
  const paid = Math.min(input.originalPaidCents, cumulative);
  return { paidCents: paid - input.refundedPaidCents, bonusCents: cumulative - paid - input.refundedBonusCents };
}
