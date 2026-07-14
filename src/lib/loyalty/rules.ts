export function calculateEarnedPoints(
  amountCents: number,
  pointsPerRinggit: number,
) {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error("Payment amount must be a non-negative number of cents.");
  }

  if (!Number.isFinite(pointsPerRinggit) || pointsPerRinggit < 0) {
    throw new Error("Points per ringgit must be a non-negative number.");
  }

  return Math.floor((amountCents / 100) * pointsPerRinggit);
}

type RefundReversalInput = {
  earnedPoints: number;
  paymentCents: number;
  totalRefundedCents: number;
  previouslyReversedPoints: number;
};

export function calculateRefundReversalPoints({
  earnedPoints,
  paymentCents,
  totalRefundedCents,
  previouslyReversedPoints,
}: RefundReversalInput) {
  if (
    !Number.isInteger(earnedPoints) ||
    !Number.isInteger(paymentCents) ||
    !Number.isInteger(totalRefundedCents) ||
    !Number.isInteger(previouslyReversedPoints) ||
    earnedPoints < 0 ||
    paymentCents <= 0 ||
    totalRefundedCents < 0 ||
    previouslyReversedPoints < 0
  ) {
    throw new Error("Invalid loyalty refund values.");
  }

  const cappedRefundCents = Math.min(paymentCents, totalRefundedCents);
  const targetReversal =
    cappedRefundCents === paymentCents
      ? earnedPoints
      : Math.floor((earnedPoints * cappedRefundCents) / paymentCents);

  return Math.max(0, targetReversal - previouslyReversedPoints);
}
