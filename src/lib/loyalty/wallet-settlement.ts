import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { toCents } from "@/lib/validation/pos";
import { calculateEarnedPoints } from "./rules";
import { ensureCustomerMembership, getOrCreateLoyaltyProgram } from "./service";

const ACTION = "WALLET_LOYALTY_SETTLED";
const REFUND_ACTION = "WALLET_LOYALTY_REFUND_BALANCE";
const integer = z.number().int().nonnegative().safe();
const refundBalanceSchema = z.object({
  version: z.literal(1), invoiceId: z.string().uuid(), membershipId: z.string().uuid(),
  refundId: z.string().uuid(), refundedCents: integer,
  baseBalance: integer, baseRestored: integer, baseReversed: integer,
  restored: integer, reversed: integer, balance: integer, activityCount: integer,
}).strict();
const evidenceSchema = z.object({
  version: z.literal(1), invoiceId: z.string().uuid(), operationId: z.string().uuid(),
  customerId: z.string().uuid(), membershipId: z.string().uuid().nullable(),
  eligibleCents: integer, pointsPerRinggit: z.string(), earnedPoints: integer, redeemedPoints: integer,
  payments: z.array(z.object({ paymentId: z.string().uuid(), method: z.string(), eligibleCents: integer, earnedPoints: integer }).strict()).min(1).max(2),
}).strict();
type Context = { businessId: string; invoiceId: string; actorUserId: string };

async function source(tx: Prisma.TransactionClient, input: Context) {
  const invoice = await tx.invoice.findFirstOrThrow({
    where: { id: input.invoiceId, businessId: input.businessId },
    include: { payments: { orderBy: { id: "asc" } } },
  });
  if (!invoice.customerId || !invoice.payments.some(p => p.method === "MEMBER_WALLET") ||
      invoice.payments.length > 2 || invoice.payments.some(p => p.purpose === "WALLET_TOP_UP" ||
        (p.method === "MEMBER_WALLET" && p.purpose !== "SALE") || p.method === "PACKAGE" || p.businessId !== input.businessId)) {
    throw new Error("Invalid Wallet loyalty invoice source.");
  }
  return invoice;
}

/** Called only inside the existing CASHIER_CHECKOUT serializable transaction. */
export async function awardWalletInvoiceLoyalty(tx: Prisma.TransactionClient, input: Context & { operationKey: string }) {
  const invoice = await source(tx, input);
  const operation = await tx.financialOperation.findUniqueOrThrow({ where: { businessId_operationType_operationKey: {
    businessId: input.businessId, operationType: "CASHIER_CHECKOUT", operationKey: input.operationKey,
  } } });
  if (operation.state !== "IN_PROGRESS" || operation.actorUserId !== input.actorUserId ||
      await tx.auditLog.count({ where: { businessId: input.businessId, action: ACTION, entityId: invoice.id } })) {
    throw new Error("Wallet loyalty settlement already exists or operation is invalid.");
  }
  const program = await getOrCreateLoyaltyProgram(tx, input.businessId);
  const membership = program.enabled ? await ensureCustomerMembership(tx, {
    businessId: input.businessId, customerId: invoice.customerId!, createdById: input.actorUserId,
  }) : await tx.customerMembership.findFirst({ where: { businessId: input.businessId, customerId: invoice.customerId! } });
  const eligible = program.enabled && membership?.status === "ACTIVE";
  let cumulative = 0, allocated = 0;
  const payments = invoice.payments.map(payment => {
    const eligibleCents = toCents(payment.amount);
    cumulative += eligibleCents;
    const target = eligible ? calculateEarnedPoints(cumulative, Number(program.pointsPerRinggit)) : 0;
    const earnedPoints = target - allocated; allocated = target;
    return { paymentId: payment.id, method: payment.method, eligibleCents, earnedPoints };
  });
  const ids = payments.map(p => p.paymentId);
  if (await tx.loyaltyTransaction.count({ where: { businessId: input.businessId, paymentId: { in: ids }, type: "EARN" } })) {
    throw new Error("Wallet invoice points were already awarded.");
  }
  for (const payment of payments.filter(p => p.earnedPoints > 0)) {
    await tx.loyaltyTransaction.create({ data: {
      businessId: input.businessId, branchId: invoice.branchId, membershipId: membership!.id,
      customerId: invoice.customerId!, createdById: input.actorUserId, paymentId: payment.paymentId,
      type: "EARN", points: payment.earnedPoints, description: "Wallet invoice points (v1)",
    } });
  }
  if (allocated > 0) await tx.customerMembership.update({ where: { id: membership!.id }, data: {
    pointsBalance: { increment: allocated }, lifetimePointsEarned: { increment: allocated },
  } });
  const redeem = await tx.loyaltyTransaction.aggregate({ where: { businessId: input.businessId, paymentId: { in: ids }, type: "REDEEM" }, _sum: { points: true } });
  const evidence = evidenceSchema.parse({ version: 1, invoiceId: invoice.id, operationId: operation.id,
    customerId: invoice.customerId, membershipId: membership?.id ?? null,
    eligibleCents: cumulative, pointsPerRinggit: program.pointsPerRinggit.toString(),
    earnedPoints: allocated, redeemedPoints: -(redeem._sum.points ?? 0), payments });
  await writeAuditLog({ businessId: input.businessId, branchId: invoice.branchId,
    action: ACTION, entityType: "Invoice", entityId: invoice.id, summary: "Wallet invoice loyalty evidence", metadata: evidence }, tx);
}

/** Refund uses original points and the whole invoice cumulative refund, never today's program. */
export async function refundWalletInvoiceLoyalty(tx: Prisma.TransactionClient, input: Context & { refundId: string }) {
  const invoice = await source(tx, input);
  const records = await tx.auditLog.findMany({ where: { businessId: input.businessId, entityType: "Invoice", entityId: invoice.id, action: ACTION, status: "SUCCESS" } });
  if (records.length !== 1) throw new Error("Wallet loyalty evidence unavailable; review is required.");
  const evidence = evidenceSchema.parse(records[0].metadata);
  const payments = invoice.payments.map(p => ({ paymentId: p.id, method: p.method, eligibleCents: toCents(p.amount) }));
  if (evidence.invoiceId !== invoice.id || evidence.customerId !== invoice.customerId ||
      JSON.stringify(evidence.payments.map(({ earnedPoints: _points, ...p }) => p)) !== JSON.stringify(payments) ||
      evidence.eligibleCents !== payments.reduce((n, p) => n + p.eligibleCents, 0)) {
    throw new Error("Wallet loyalty source evidence mismatch.");
  }
  const redemption = await tx.walletTransaction.findFirstOrThrow({ where: { businessId: input.businessId, paymentId: { in: payments.map(p => p.paymentId) }, type: "REDEMPTION" }, include: { operation: true } });
  if (redemption.financialOperationId !== evidence.operationId || redemption.operation.state !== "COMPLETED") throw new Error("Wallet loyalty operation mismatch.");
  const ids = payments.map(p => p.paymentId);
  const facts = await tx.loyaltyTransaction.findMany({ where: { businessId: input.businessId, paymentId: { in: ids } } });
  const sum = (type: string) => facts.filter(row => row.type === type).reduce((n, row) => n + row.points, 0);
  if (sum("EARN") !== evidence.earnedPoints || -sum("REDEEM") !== evidence.redeemedPoints ||
      facts.some(row => row.customerId !== evidence.customerId || row.membershipId !== evidence.membershipId) ||
      evidence.payments.some(p => facts.filter(row => row.type === "EARN" && row.paymentId === p.paymentId).reduce((n, row) => n + row.points, 0) !== p.earnedPoints)) {
    throw new Error("Wallet historical points evidence mismatch.");
  }
  const refunds = await tx.paymentRefund.findMany({ where: { businessId: input.businessId, invoiceId: invoice.id, paymentId: { in: ids } } });
  const refund = refunds.find(row => row.id === input.refundId);
  if (!refund) throw new Error("Wallet loyalty refund source unavailable.");
  if (facts.some(row => row.refundId === refund.id)) return;
  const refunded = refunds.reduce((n, row) => n + toCents(row.amount), 0);
  const ratio = (points: number) => evidence.eligibleCents > 0
    ? Number(BigInt(points) * BigInt(Math.min(refunded, evidence.eligibleCents)) / BigInt(evidence.eligibleCents)) : 0;
  const reverse = ratio(evidence.earnedPoints) + sum("REFUND_REVERSAL");
  const restore = ratio(evidence.redeemedPoints) - sum("REDEMPTION_REFUND");
  if (reverse < 0 || restore < 0) throw new Error("Wallet historical points exceed cumulative refund.");
  if (!reverse && !restore) return;
  const membership = await tx.customerMembership.findFirstOrThrow({ where: { id: evidence.membershipId!, businessId: input.businessId, customerId: evidence.customerId } });
  const activityCount = await tx.loyaltyTransaction.count({ where: { businessId: input.businessId, membershipId: membership.id } });
  const priorRecords = await tx.auditLog.findMany({ where: { businessId: input.businessId,
    entityType: "Invoice", entityId: invoice.id, action: REFUND_ACTION, status: "SUCCESS" } });
  const priorBalances = priorRecords.map(record => refundBalanceSchema.parse(record.metadata));
  if (priorBalances.some(record => record.invoiceId !== invoice.id || record.membershipId !== membership.id ||
      !refunds.some(row => row.id === record.refundId) || record.refundedCents >= refunded ||
      record.baseRestored > record.restored || record.baseReversed > record.reversed ||
      record.restored > evidence.redeemedPoints || record.reversed > evidence.earnedPoints ||
      record.balance !== Math.max(0, record.baseBalance + record.restored - record.baseRestored - record.reversed + record.baseReversed)) ||
      new Set(priorBalances.map(record => record.refundedCents)).size !== priorBalances.length) {
    throw new Error("Wallet cumulative refund balance evidence mismatch.");
  }
  const previous = priorBalances.sort((a, b) => b.refundedCents - a.refundedCents)[0];
  const restoredBefore = sum("REDEMPTION_REFUND"), reversedBefore = -sum("REFUND_REVERSAL");
  if ((previous && (previous.restored !== restoredBefore || previous.reversed !== reversedBefore)) ||
      (!previous && (restoredBefore !== 0 || reversedBefore !== 0))) {
    throw new Error("Wallet cumulative refund balance evidence unavailable.");
  }
  // Reconcile one cumulative refund sequence, rather than carrying a points debt.
  // Unrelated points activity ends the sequence: later refunds cannot reclaim
  // points earned elsewhere to cover an earlier insufficient-balance reversal.
  const continuous = previous && previous.activityCount === activityCount && previous.balance === membership.pointsBalance;
  const baseBalance = continuous ? previous.baseBalance : membership.pointsBalance;
  const baseRestored = continuous ? previous.baseRestored : restoredBefore;
  const baseReversed = continuous ? previous.baseReversed : reversedBefore;
  const restored = restoredBefore + restore, reversed = reversedBefore + reverse;
  const balance = Math.max(0, baseBalance + (restored - baseRestored) - (reversed - baseReversed));
  const common = { businessId: input.businessId, branchId: invoice.branchId, membershipId: membership.id, customerId: evidence.customerId, paymentId: refund.paymentId, refundId: refund.id, createdById: input.actorUserId };
  if (restore) await tx.loyaltyTransaction.create({ data: { ...common, type: "REDEMPTION_REFUND", points: restore, description: "Wallet invoice redeemed points restored (v1)" } });
  if (reverse) await tx.loyaltyTransaction.create({ data: { ...common, type: "REFUND_REVERSAL", points: -reverse, description: "Wallet invoice cumulative refund (v1)" } });
  await tx.customerMembership.update({ where: { id: membership.id }, data: {
    pointsBalance: balance,
    lifetimePointsReversed: { increment: reverse },
  } });
  await writeAuditLog({ businessId: input.businessId, branchId: invoice.branchId,
    action: REFUND_ACTION, entityType: "Invoice", entityId: invoice.id,
    summary: "Wallet cumulative refund loyalty balance", metadata: refundBalanceSchema.parse({
      version: 1, invoiceId: invoice.id, membershipId: membership.id, refundId: refund.id,
      refundedCents: refunded, baseBalance, baseRestored, baseReversed, restored, reversed, balance,
      activityCount: activityCount + Number(restore > 0) + Number(reverse > 0),
    }) }, tx);
}
