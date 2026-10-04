import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { toCents } from "@/lib/validation/pos";
import { planNormalRefundLoyalty } from "./normal-refund-plan";

const ACTION = "LOYALTY_NORMAL_REFUND_COMPENSATED";
const integer = z.number().int().nonnegative().safe();
const sequenceSchema = z.object({
  version: z.literal(1), membershipId: z.string(), refundId: z.string(), refundedCents: integer,
  baseBalance: integer, baseRestored: integer, baseReversed: integer,
  balance: integer, restored: integer, reversed: integer, activityCount: integer,
});

/** Internal: called only inside the existing serializable PAYMENT_REFUND
 * FinancialOperation, after its normal payment/refund eligibility checks. */
export async function compensateNormalRefundLoyalty(tx: Prisma.TransactionClient, input: {
  businessId: string; branchId?: string | null; paymentId: string; refundId: string;
  paymentAmountCents: number; createdById?: string | null;
}) {
  const where = { businessId: input.businessId, paymentId: input.paymentId };
  const [facts, refunds] = await Promise.all([
    tx.loyaltyTransaction.findMany({ where }),
    tx.paymentRefund.findMany({ where, select: { id: true, amount: true } }),
  ]);
  if (!refunds.some(r => r.id === input.refundId)) throw new Error("Loyalty refund source is missing.");
  if (!facts.length) return;
  const earned = facts.filter(r => r.type === "EARN"), redeemed = facts.filter(r => r.type === "REDEEM");
  const source = earned[0] ?? redeemed[0];
  if (!source || earned.length > 1 || redeemed.length > 1 ||
      earned.some(r => r.points <= 0) || redeemed.some(r => r.points >= 0) ||
      facts.some(r => r.membershipId !== source.membershipId || r.customerId !== source.customerId ||
        !["EARN","REDEEM","REDEMPTION_REFUND","REFUND_REVERSAL"].includes(r.type))) {
    throw new Error("Loyalty refund original ledger is ambiguous.");
  }
  const compensations = facts.filter(r => r.type === "REDEMPTION_REFUND" || r.type === "REFUND_REVERSAL");
  if (compensations.some(r => !r.refundId || !refunds.some(refund => refund.id === r.refundId) ||
      (r.type === "REDEMPTION_REFUND" ? r.points <= 0 : r.points >= 0))) {
    throw new Error("Loyalty refund compensation source mismatch.");
  }
  // A partial/foreign invocation must not silently skip half the compensation.
  // Completed operation replays are returned by FinancialOperation before here.
  if (compensations.some(r => r.refundId === input.refundId)) throw new Error("Loyalty refund was already compensated.");
  const membership = await tx.customerMembership.findFirstOrThrow({ where: {
    id: source.membershipId, businessId: input.businessId, customerId: source.customerId,
  } });
  const [activityCount, audits] = await Promise.all([
    tx.loyaltyTransaction.count({ where: { businessId: input.businessId, membershipId: membership.id } }),
    tx.auditLog.findMany({ where: { businessId: input.businessId, entityType: "Payment", entityId: input.paymentId, action: ACTION, status: "SUCCESS" } }),
  ]);
  const sequences = audits.map(a => sequenceSchema.parse(a.metadata));
  if (sequences.some(s => s.membershipId !== membership.id || !refunds.some(r => r.id === s.refundId))) {
    throw new Error("Loyalty refund balance evidence mismatch.");
  }
  const previous = sequences.sort((a,b) => b.refundedCents - a.refundedCents)[0];
  const refundedCents = refunds.reduce((n,r) => n + toCents(r.amount), 0);
  if (previous && previous.refundedCents >= refundedCents) throw new Error("Loyalty refund sequence is invalid.");
  const plan = planNormalRefundLoyalty({ balance: membership.pointsBalance,
    redeemed: -(redeemed[0]?.points ?? 0), earned: earned[0]?.points ?? 0,
    paymentCents: input.paymentAmountCents, refundedCents,
    restored: compensations.filter(r => r.type === "REDEMPTION_REFUND").reduce((n,r) => n+r.points,0),
    reversed: compensations.filter(r => r.type === "REFUND_REVERSAL").reduce((n,r) => n-r.points,0),
    activityCount, previous,
  });
  const updated = await tx.customerMembership.updateMany({
    where: { id: membership.id, businessId: input.businessId, pointsBalance: membership.pointsBalance },
    data: { pointsBalance: plan.balance, lifetimePointsReversed: { increment: plan.reverseDelta } },
  });
  if (updated.count !== 1) throw new Error("Loyalty balance changed. Retry the original refund request.");
  const common = { ...where, branchId: input.branchId ?? null, membershipId: membership.id,
    customerId: membership.customerId, refundId: input.refundId, createdById: input.createdById ?? null };
  if (plan.restoreDelta > 0) await tx.loyaltyTransaction.create({ data: { ...common,
    type: "REDEMPTION_REFUND", points: plan.restoreDelta, description: "Redeemed points restored after refund" } });
  if (plan.reverseDelta > 0) await tx.loyaltyTransaction.create({ data: { ...common,
    type: "REFUND_REVERSAL", points: -plan.reverseDelta, description: "Points reversed after refund" } });
  // Existing Audit stores only the per-payment contiguous sequence snapshot;
  // no global history reconstruction, new schema, or Wallet evidence framework.
  // Legacy refunds without this snapshot start from the current balance.
  await writeAuditLog({ businessId: input.businessId, branchId: input.branchId,
    action: ACTION, entityType: "Payment", entityId: input.paymentId,
    summary: "Normal refund loyalty net compensation", metadata: {
      version: 1, membershipId: membership.id, refundId: input.refundId, refundedCents, ...plan.sequence,
    },
  }, tx);
}
