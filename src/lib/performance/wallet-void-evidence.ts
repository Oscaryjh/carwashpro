import type { Prisma } from "@prisma/client";

/** Only fully Wallet-funded voids with a completed, exact original-ledger reversal qualify. */
export async function verifiedWalletVoidPayments(tx: Prisma.TransactionClient, scope: { businessId: string; branchId: string }) {
  const rows = await tx.walletTransaction.findMany({
    where: { ...scope, type: "REDEMPTION", payment: { status: "VOID", method: "MEMBER_WALLET", purpose: "SALE", invoice: { status: "VOID" } } },
    include: { payment: { include: { refunds: true, invoice: { include: { payments: true } } } }, related: { include: { operation: true } }, operation: true },
  });
  const valid = new Set<string>();
  for (const row of rows) {
    const payment = row.payment!;
    const reversal = row.related[0];
    if (row.operation.state !== "COMPLETED" || row.related.length !== 1 || !reversal || reversal.type !== "REVERSAL" ||
      reversal.operation.state !== "COMPLETED" || reversal.operation.operationType !== "INVOICE_VOID" ||
      reversal.operation.businessId !== scope.businessId || reversal.branchId !== scope.branchId ||
      !reversal.paidDelta.equals(row.paidDelta.negated()) || !reversal.bonusDelta.equals(row.bonusDelta.negated()) ||
      !row.paidDelta.plus(row.bonusDelta).negated().equals(payment.amount) || payment.refunds.length ||
      !payment.invoice?.payments.every(p => p.status === "VOID" && p.method === "MEMBER_WALLET")) continue;
    valid.add(payment.id);
  }
  return valid;
}
