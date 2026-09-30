import { Prisma, type WalletAccount } from "@prisma/client";

/** Internal posting primitive; not an action or a client-supplied balance setter.
 * Caller owns the serializable financial operation and complete source graph.
 */
export async function appendWalletEntry(tx: Prisma.TransactionClient, input: {
  account: WalletAccount;
  topUpId: string;
  financialOperationId: string;
  branchId: string;
  actorUserId: string;
  component: "PAID" | "BONUS";
  amount: Prisma.Decimal;
}) {
  const { account, amount } = input;
  if (!amount.gt(0) || amount.decimalPlaces() > 2) throw new Error("Invalid wallet credit amount.");
  const paidDelta = input.component === "PAID" ? amount : new Prisma.Decimal(0);
  const bonusDelta = input.component === "BONUS" ? amount : new Prisma.Decimal(0);
  const updated = await tx.walletAccount.updateMany({
    where: { id: account.id, businessId: account.businessId, version: account.version },
    data: { paidBalance: { increment: paidDelta }, bonusBalance: { increment: bonusDelta }, version: { increment: 1 } },
  });
  if (updated.count !== 1) {
    // Reuse the financial runner's bounded whole-transaction concurrency retry.
    throw new Prisma.PrismaClientKnownRequestError("Wallet account version changed.", { code: "P2034", clientVersion: Prisma.prismaVersion.client });
  }
  const next = await tx.walletAccount.findUniqueOrThrow({ where: { id: account.id } });
  await tx.walletTransaction.create({ data: {
    businessId: account.businessId, walletAccountId: account.id, sequence: next.version,
    type: input.component === "PAID" ? "TOP_UP_PAID" : "TOP_UP_BONUS",
    paidDelta, bonusDelta, paidBalanceAfter: next.paidBalance, bonusBalanceAfter: next.bonusBalance,
    policyVersion: "WALLET_P1_TOP_UP_V1", financialOperationId: input.financialOperationId,
    entryKey: input.component === "PAID" ? "paid" : "bonus", topUpId: input.topUpId,
    branchId: input.branchId, actorUserId: input.actorUserId,
  } });
  return next;
}
