export type RefundedPaymentState =
  | "UNPAID"
  | "PARTIAL"
  | "PAID"
  | "REFUNDED";

export function getRefundableCents(
  paymentAmountCents: number,
  refundedAmountsCents: number[],
) {
  const refundedCents = refundedAmountsCents.reduce(
    (total, amount) => total + amount,
    0,
  );

  return Math.max(0, paymentAmountCents - refundedCents);
}

export function getRefundedPaymentState(
  totalCents: number,
  netPaidCents: number,
  hasRefunds: boolean,
): RefundedPaymentState {
  if (netPaidCents <= 0) {
    return hasRefunds ? "REFUNDED" : "UNPAID";
  }

  return netPaidCents >= totalCents ? "PAID" : "PARTIAL";
}
