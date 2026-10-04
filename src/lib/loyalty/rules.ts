export function calculateEarnedPoints(
  amountCents: number,
  pointsPerRinggit: number | string,
) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new Error("Payment amount must be a non-negative number of cents.");
  }

  // Stored Prisma Decimal rates arrive as their original decimal string.
  // Keep number callers compatible, but never multiply binary floats.
  const rate = String(pointsPerRinggit);
  const parts = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(rate);
  const exponent = Number(parts?.[3] ?? 0);
  if (!parts || rate.length > 400 || !Number.isInteger(exponent) || Math.abs(exponent) > 324) {
    throw new Error("Points per ringgit must be a non-negative number.");
  }
  const fraction = parts[2] ?? "";
  const scale = fraction.length - exponent;
  let numerator = BigInt(parts[1] + fraction);
  let denominator = BigInt(100); // input is cents, rate is per ringgit
  if (scale >= 0) denominator *= BigInt(10) ** BigInt(scale);
  else numerator *= BigInt(10) ** BigInt(-scale);
  // All operands are nonnegative, so integer division is exact floor.
  const points = BigInt(amountCents) * numerator / denominator;
  if (points > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Earned points exceed the safe integer range.");
  return Number(points);
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
  const availableWholeRinggitPoints =
    Math.floor(input.availablePoints / input.pointsPerRinggit) * input.pointsPerRinggit;
  // The existing `points` result is the canonical normalized quantity used
  // by preview, Apply, request payload and the authoritative server path.
  const points = Math.min(
    requestedWholeRinggitPoints,
    availableWholeRinggitPoints,
    maximumWholeRinggitPoints,
  );

  // No full RM1 block means no monetary redemption, never a fractional debit.
  if (points === 0) return { discountCents: 0, points: 0 };
  if (points < input.minimumPoints) {
    throw new Error("The available points cannot be applied to this sale.");
  }

  return {
    discountCents: (points / input.pointsPerRinggit) * 100,
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
