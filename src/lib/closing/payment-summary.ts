import { classifyPaymentFact, classifyRefundFact, type Method, type Purpose } from "../payments/fact-classification";
import { fromCents, toCents } from "../validation/pos";

/** Inputs are already scoped to one shift; never attach unassigned refunds here. */
export function summarizePayments(
  payments: { amount: unknown; method: Method; purpose: Purpose; packageUses: number }[],
  refunds: {
    amount: unknown;
    method: Method;
    packageUsesRestored: number;
    payment: { purpose: Purpose; method: Method };
  }[],
) {
  let grossCollectedCents = 0;
  let refundedCents = 0;
  let grossCashCents = 0;
  let refundedCashCents = 0;
  let walletSettledCents = 0;
  let walletRefundedCents = 0;
  let packageUses = 0;
  let packageUsesRestored = 0;
  let paymentCount = 0;

  for (const payment of payments) {
    const fact = classifyPaymentFact(payment);
    if (payment.method === "PACKAGE") {
      packageUses += payment.packageUses;
      continue;
    }
    const amountCents = toCents(payment.amount ?? 0);
    paymentCount += 1;
    if (fact.externalCollection) grossCollectedCents += amountCents;
    if (fact.cashMovement) grossCashCents += amountCents;
    if (fact.walletMovement === "DEBIT") walletSettledCents += amountCents;
  }
  for (const refund of refunds) {
    const fact = classifyRefundFact({ originalPayment: refund.payment, refundMethod: refund.method });
    if (refund.method === "PACKAGE") {
      packageUsesRestored += refund.packageUsesRestored;
      continue;
    }
    const amountCents = toCents(refund.amount ?? 0);
    if (fact.externalRefund) refundedCents += amountCents;
    if (fact.cashMovement) refundedCashCents += amountCents;
    if (fact.walletRefund) walletRefundedCents += amountCents;
  }
  return {
    cashAmount: fromCents(grossCashCents - refundedCashCents),
    collected: fromCents(grossCollectedCents - refundedCents),
    grossCollected: fromCents(grossCollectedCents),
    packageUses: Math.max(0, packageUses - packageUsesRestored),
    paymentCount,
    refunded: fromCents(refundedCents),
    walletSettled: fromCents(walletSettledCents),
    walletRefunded: fromCents(walletRefundedCents),
  };
}
