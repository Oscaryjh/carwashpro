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

export function calculateLoyaltyRedemption(input: {
  availablePoints: number;
  maximumDiscountCents: number;
  minimumPoints: number;
  pointsPerRinggit: number;
  requestedPoints: number;
}) {
  const values = [
    input.availablePoints,
    input.maximumDiscountCents,
    input.minimumPoints,
    input.pointsPerRinggit,
    input.requestedPoints,
  ];

  if (values.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error("Invalid loyalty redemption values.");
  }

  if (input.pointsPerRinggit < 1) {
    throw new Error("Redemption points per ringgit must be at least 1.");
  }

  if (input.requestedPoints === 0) {
    return { discountCents: 0, points: 0 };
  }

  if (input.requestedPoints < input.minimumPoints) {
    throw new Error(`Redeem at least ${input.minimumPoints} points.`);
  }

  const requestedWholeRinggitPoints =
    Math.floor(input.requestedPoints / input.pointsPerRinggit) *
    input.pointsPerRinggit;
  const maximumWholeRinggitPoints =
    Math.floor(input.maximumDiscountCents / 100) * input.pointsPerRinggit;
  const points = Math.min(
    requestedWholeRinggitPoints,
    input.availablePoints,
    maximumWholeRinggitPoints,
  );

  if (points < input.minimumPoints) {
    throw new Error("The available points cannot be applied to this sale.");
  }

  return {
    discountCents: Math.floor(points / input.pointsPerRinggit) * 100,
    points,
  };
}

export function calculateRedemptionRefundPoints(input: {
  paymentCents: number;
  previouslyRestoredPoints: number;
  redeemedPoints: number;
  totalRefundedCents: number;
}) {
  const values = [
    input.paymentCents,
    input.previouslyRestoredPoints,
    input.redeemedPoints,
    input.totalRefundedCents,
  ];

  if (
    values.some((value) => !Number.isInteger(value) || value < 0) ||
    input.paymentCents <= 0
  ) {
    throw new Error("Invalid loyalty redemption refund values.");
  }

  const cappedRefundCents = Math.min(
    input.paymentCents,
    input.totalRefundedCents,
  );
  const targetRestore =
    cappedRefundCents === input.paymentCents
      ? input.redeemedPoints
      : Math.floor(
          (input.redeemedPoints * cappedRefundCents) / input.paymentCents,
        );

  return Math.max(0, targetRestore - input.previouslyRestoredPoints);
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
