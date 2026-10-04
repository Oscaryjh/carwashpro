import { calculateRedemptionRefundPoints, calculateRefundReversalPoints } from "./rules";

export type NormalRefundSequence = {
  baseBalance: number; baseRestored: number; baseReversed: number;
  balance: number; restored: number; reversed: number; activityCount: number;
};

/** Payment-scoped cumulative targets, using original ledger points only. */
export function planNormalRefundLoyalty(input: {
  balance: number; redeemed: number; earned: number; paymentCents: number;
  refundedCents: number; restored: number; reversed: number; activityCount: number;
  previous?: NormalRefundSequence;
}) {
  const { previous, ...values } = input;
  if (Object.values(values).some(v => !Number.isSafeInteger(v) || v < 0) || input.paymentCents === 0 || input.refundedCents > input.paymentCents) {
    throw new Error("Invalid loyalty refund evidence.");
  }
  const restored = calculateRedemptionRefundPoints({ paymentCents: input.paymentCents,
    redeemedPoints: input.redeemed, totalRefundedCents: input.refundedCents, previouslyRestoredPoints: 0 });
  const reversed = calculateRefundReversalPoints({ paymentCents: input.paymentCents,
    earnedPoints: input.earned, totalRefundedCents: input.refundedCents, previouslyReversedPoints: 0 });
  if (input.restored > restored || input.reversed > reversed || (previous &&
      (previous.restored !== input.restored || previous.reversed !== input.reversed))) {
    throw new Error("Loyalty refund compensation evidence mismatch.");
  }
  const restoreDelta = restored - input.restored, reverseDelta = reversed - input.reversed;
  // A contiguous sequence must clamp its combined effect, not every rounded
  // slice (e.g. redeem=3/earn=10, refunds 30% then 4%). Other points activity
  // breaks the sequence: apply ONLY the new delta to the current balance,
  // never collect previously clamped points as debt from later income.
  const continuous = previous && previous.activityCount === input.activityCount && previous.balance === input.balance;
  const baseBalance = continuous ? previous.baseBalance : input.balance;
  const baseRestored = continuous ? previous.baseRestored : input.restored;
  const baseReversed = continuous ? previous.baseReversed : input.reversed;
  const balance = Math.max(0, baseBalance + (restored - baseRestored) - (reversed - baseReversed));
  if (!Number.isSafeInteger(balance)) throw new Error("Invalid loyalty refund balance.");
  const sequence: NormalRefundSequence = { baseBalance, baseRestored, baseReversed, balance, restored, reversed,
    activityCount: input.activityCount + Number(restoreDelta > 0) + Number(reverseDelta > 0) };
  return { balance, restoreDelta, reverseDelta, sequence };
}
