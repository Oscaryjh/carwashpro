import type { PaymentMethod, Prisma } from "@prisma/client";
import {
  calculateEarnedPoints,
  calculateRedemptionRefundPoints,
  calculateRefundReversalPoints,
} from "@/lib/loyalty/rules";
import { toCents } from "@/lib/validation/pos";

type LoyaltyTransactionClient = Prisma.TransactionClient;

export async function getOrCreateLoyaltyProgram(
  tx: LoyaltyTransactionClient,
  businessId: string,
) {
  return tx.loyaltyProgram.upsert({
    where: { businessId },
    update: {},
    create: { businessId },
  });
}

export async function ensureCustomerMembership(
  tx: LoyaltyTransactionClient,
  input: {
    businessId: string;
    customerId: string;
    createdById?: string | null;
  },
) {
  const existing = await tx.customerMembership.findFirst({
    where: {
      businessId: input.businessId,
      customerId: input.customerId,
    },
  });

  if (existing) {
    return existing;
  }

  const program = await getOrCreateLoyaltyProgram(tx, input.businessId);
  const welcomePoints = program.enabled ? Math.max(0, program.welcomePoints) : 0;
  const membership = await tx.customerMembership.create({
    data: {
      businessId: input.businessId,
      customerId: input.customerId,
      pointsBalance: welcomePoints,
      lifetimePointsEarned: welcomePoints,
    },
  });

  if (welcomePoints > 0) {
    await tx.loyaltyTransaction.create({
      data: {
        businessId: input.businessId,
        membershipId: membership.id,
        customerId: input.customerId,
        createdById: input.createdById ?? null,
        type: "WELCOME_BONUS",
        points: welcomePoints,
        description: "Welcome bonus",
      },
    });
  }

  return membership;
}

export async function awardLoyaltyPointsForPayment(
  tx: LoyaltyTransactionClient,
  input: {
    businessId: string;
    branchId?: string | null;
    customerId: string;
    paymentId: string;
    amountCents: number;
    paymentMethod: PaymentMethod;
    createdById?: string | null;
  },
) {
  if (input.paymentMethod === "PACKAGE" || input.amountCents <= 0) {
    return null;
  }

  const existing = await tx.loyaltyTransaction.findFirst({
    where: {
      businessId: input.businessId,
      paymentId: input.paymentId,
      type: "EARN",
    },
  });

  if (existing) {
    return existing;
  }

  const program = await getOrCreateLoyaltyProgram(tx, input.businessId);
  if (!program.enabled) {
    return null;
  }

  const membership = await ensureCustomerMembership(tx, {
    businessId: input.businessId,
    customerId: input.customerId,
    createdById: input.createdById,
  });

  if (membership.status !== "ACTIVE") {
    return null;
  }

  const points = calculateEarnedPoints(
    input.amountCents,
    Number(program.pointsPerRinggit),
  );

  if (points <= 0) {
    return null;
  }

  const transaction = await tx.loyaltyTransaction.create({
    data: {
      businessId: input.businessId,
      branchId: input.branchId ?? null,
      membershipId: membership.id,
      customerId: input.customerId,
      paymentId: input.paymentId,
      createdById: input.createdById ?? null,
      type: "EARN",
      points,
      description: "Points earned from payment",
    },
  });

  await tx.customerMembership.update({
    where: { id: membership.id },
    data: {
      pointsBalance: { increment: points },
      lifetimePointsEarned: { increment: points },
    },
  });

  return transaction;
}

export async function redeemLoyaltyPointsForPayment(
  tx: LoyaltyTransactionClient,
  input: {
    branchId?: string | null;
    businessId: string;
    createdById?: string | null;
    customerId: string;
    paymentId: string;
    points: number;
  },
) {
  if (input.points <= 0) return null;

  const existing = await tx.loyaltyTransaction.findFirst({
    where: {
      businessId: input.businessId,
      paymentId: input.paymentId,
      type: "REDEEM",
    },
  });
  if (existing) return existing;

  const [program, membership] = await Promise.all([
    getOrCreateLoyaltyProgram(tx, input.businessId),
    tx.customerMembership.findFirst({
      where: {
        businessId: input.businessId,
        customerId: input.customerId,
        status: "ACTIVE",
      },
    }),
  ]);

  if (!program.enabled || !program.redemptionEnabled) {
    throw new Error("Loyalty point redemption is not enabled.");
  }
  if (!membership) {
    throw new Error("This customer does not have an active loyalty membership.");
  }
  if (input.points < program.minimumRedemptionPoints) {
    throw new Error(`Redeem at least ${program.minimumRedemptionPoints} points.`);
  }
  if (input.points % program.redemptionPointsPerRinggit !== 0) {
    throw new Error(
      `Points must be redeemed in multiples of ${program.redemptionPointsPerRinggit}.`,
    );
  }

  const updated = await tx.customerMembership.updateMany({
    where: {
      id: membership.id,
      pointsBalance: { gte: input.points },
    },
    data: { pointsBalance: { decrement: input.points } },
  });
  if (updated.count !== 1) {
    throw new Error("The customer does not have enough loyalty points.");
  }

  return tx.loyaltyTransaction.create({
    data: {
      businessId: input.businessId,
      branchId: input.branchId ?? null,
      membershipId: membership.id,
      customerId: input.customerId,
      paymentId: input.paymentId,
      createdById: input.createdById ?? null,
      type: "REDEEM",
      points: -input.points,
      description: "Points redeemed at checkout",
    },
  });
}

export async function reverseLoyaltyPointsForRefund(
  tx: LoyaltyTransactionClient,
  input: {
    businessId: string;
    branchId?: string | null;
    paymentId: string;
    refundId: string;
    paymentAmountCents: number;
    createdById?: string | null;
  },
) {
  const existing = await tx.loyaltyTransaction.findFirst({
    where: {
      businessId: input.businessId,
      refundId: input.refundId,
      type: "REFUND_REVERSAL",
    },
  });

  if (existing) {
    return existing;
  }

  const earned = await tx.loyaltyTransaction.findFirst({
    where: {
      businessId: input.businessId,
      paymentId: input.paymentId,
      type: "EARN",
    },
    include: { membership: true },
  });

  if (!earned || earned.points <= 0) {
    return null;
  }

  const [refunds, priorReversals] = await Promise.all([
    tx.paymentRefund.findMany({
      where: {
        businessId: input.businessId,
        paymentId: input.paymentId,
      },
      select: { amount: true },
    }),
    tx.loyaltyTransaction.aggregate({
      where: {
        businessId: input.businessId,
        paymentId: input.paymentId,
        type: "REFUND_REVERSAL",
      },
      _sum: { points: true },
    }),
  ]);

  const totalRefundedCents = refunds.reduce(
    (total, refund) => total + toCents(refund.amount),
    0,
  );
  const previouslyReversedPoints = Math.abs(priorReversals._sum.points ?? 0);
  const pointsToReverse = calculateRefundReversalPoints({
    earnedPoints: earned.points,
    paymentCents: input.paymentAmountCents,
    totalRefundedCents,
    previouslyReversedPoints,
  });

  if (pointsToReverse <= 0) {
    return null;
  }

  const transaction = await tx.loyaltyTransaction.create({
    data: {
      businessId: input.businessId,
      branchId: input.branchId ?? null,
      membershipId: earned.membershipId,
      customerId: earned.customerId,
      paymentId: input.paymentId,
      refundId: input.refundId,
      createdById: input.createdById ?? null,
      type: "REFUND_REVERSAL",
      points: -pointsToReverse,
      description: "Points reversed after refund",
    },
  });

  await tx.customerMembership.update({
    where: { id: earned.membershipId },
    data: {
      pointsBalance: Math.max(
        0,
        earned.membership.pointsBalance - pointsToReverse,
      ),
      lifetimePointsReversed: { increment: pointsToReverse },
    },
  });

  return transaction;
}

export async function restoreRedeemedLoyaltyPointsForRefund(
  tx: LoyaltyTransactionClient,
  input: {
    branchId?: string | null;
    businessId: string;
    createdById?: string | null;
    paymentAmountCents: number;
    paymentId: string;
    refundId: string;
  },
) {
  const existing = await tx.loyaltyTransaction.findFirst({
    where: {
      businessId: input.businessId,
      refundId: input.refundId,
      type: "REDEMPTION_REFUND",
    },
  });
  if (existing) return existing;

  const redemption = await tx.loyaltyTransaction.findFirst({
    where: {
      businessId: input.businessId,
      paymentId: input.paymentId,
      type: "REDEEM",
    },
    include: { membership: true },
  });
  if (!redemption || redemption.points >= 0) return null;

  const [refunds, priorRestores] = await Promise.all([
    tx.paymentRefund.findMany({
      where: {
        businessId: input.businessId,
        paymentId: input.paymentId,
      },
      select: { amount: true },
    }),
    tx.loyaltyTransaction.aggregate({
      where: {
        businessId: input.businessId,
        paymentId: input.paymentId,
        type: "REDEMPTION_REFUND",
      },
      _sum: { points: true },
    }),
  ]);
  const totalRefundedCents = refunds.reduce(
    (total, refund) => total + toCents(refund.amount),
    0,
  );
  const pointsToRestore = calculateRedemptionRefundPoints({
    paymentCents: input.paymentAmountCents,
    previouslyRestoredPoints: priorRestores._sum.points ?? 0,
    redeemedPoints: Math.abs(redemption.points),
    totalRefundedCents,
  });
  if (pointsToRestore <= 0) return null;

  const transaction = await tx.loyaltyTransaction.create({
    data: {
      businessId: input.businessId,
      branchId: input.branchId ?? null,
      membershipId: redemption.membershipId,
      customerId: redemption.customerId,
      paymentId: input.paymentId,
      refundId: input.refundId,
      createdById: input.createdById ?? null,
      type: "REDEMPTION_REFUND",
      points: pointsToRestore,
      description: "Redeemed points restored after refund",
    },
  });

  await tx.customerMembership.update({
    where: { id: redemption.membershipId },
    data: { pointsBalance: { increment: pointsToRestore } },
  });

  return transaction;
}
