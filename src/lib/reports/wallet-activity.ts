import type { Prisma } from "@prisma/client";
import { calculateWalletLedgerMetrics } from "@/lib/financial-metrics";
import { toCents } from "@/lib/validation/pos";

/** Canonical wallet detail projection, using the caller's existing authorized scope/window. */
export async function readWalletActivity(
  database: Pick<Prisma.TransactionClient, "walletTransaction">,
  input: { businessId: string; branchId?: string | null; branchIds?: readonly string[]; from: Date; toExclusive: Date },
) {
  const eventRange = { gte: input.from, lt: input.toExclusive };
  const rows = await database.walletTransaction.findMany({
    where: {
      businessId: input.businessId,
      ...(input.branchId ? { branchId: input.branchId } : input.branchIds ? { branchId: { in: [...input.branchIds] } } : {}),
      OR: [
        { type: { in: ["TOP_UP_PAID", "TOP_UP_BONUS"] }, topUp: { payment: { paidAt: eventRange } } },
        { type: "REDEMPTION", payment: { paidAt: eventRange } },
        { type: "REFUND", refund: { refundedAt: eventRange } },
        { type: "REVERSAL", original: { type: { in: ["TOP_UP_PAID", "TOP_UP_BONUS"] }, topUp: { reversals: { some: { refund: { refundedAt: eventRange } } } } } },
        { type: "REVERSAL", original: { type: "REDEMPTION" }, createdAt: eventRange },
        { type: "ADJUSTMENT", createdAt: eventRange },
      ],
    },
    select: { type: true, paidDelta: true, bonusDelta: true, operation: { select: { state: true } }, original: { select: { type: true } } },
  });
  if (rows.some(row => row.operation.state !== "COMPLETED")) throw new Error("Wallet operation is incomplete; reconciliation is required.");
  return calculateWalletLedgerMetrics(rows.map(row => ({
    type: row.type, originalType: row.original?.type,
    paidCents: toCents(row.paidDelta), bonusCents: toCents(row.bonusDelta),
  })));
}
