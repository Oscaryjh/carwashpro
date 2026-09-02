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
