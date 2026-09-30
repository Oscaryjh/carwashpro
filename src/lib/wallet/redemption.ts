import { Prisma } from "@prisma/client";
import { parseWalletAmount, planWalletDebit } from "./rules";
import { assertWalletLocalTestEnabled } from "./release-policy";

/** Caller owns the CASHIER_CHECKOUT serializable transaction and financial graph. */
export async function postWalletRedemption(tx: Prisma.TransactionClient, input: {
  businessId: string; customerId: string; branchId: string; actorUserId: string;
  paymentId: string; financialOperationId: string; amountCents: number;
}): Promise<{ transactionId: string; paidUsedCents: number; bonusUsedCents: number }> {
  assertWalletLocalTestEnabled();
  const operation = await tx.financialOperation.findFirst({ where: { id: input.financialOperationId,
    businessId: input.businessId, branchId: input.branchId, actorUserId: input.actorUserId, operationType: "CASHIER_CHECKOUT", state: "IN_PROGRESS" } });
  if (!operation) throw new Error("Wallet requires the current cashier financial operation.");
  const payment = await tx.payment.findFirst({ where: { id: input.paymentId, businessId: input.businessId,
    branchId: input.branchId, cashierId: input.actorUserId, method: "MEMBER_WALLET", purpose: "SALE", status: "ACTIVE",
    invoice: { businessId: input.businessId, customerId: input.customerId, branchId: input.branchId } } });
  if (!payment || parseWalletAmount(payment.amount) !== input.amountCents) throw new Error("Wallet payment scope or amount mismatch.");
  const account = await tx.walletAccount.findUnique({ where: { businessId_customerId: { businessId: input.businessId, customerId: input.customerId } } });
  if (!account || account.currency !== "MYR") throw new Error("No MYR wallet balance is available.");
  const debit = planWalletDebit({ paidCents: parseWalletAmount(account.paidBalance), bonusCents: parseWalletAmount(account.bonusBalance), amountCents: input.amountCents });
  const paid = new Prisma.Decimal(debit.paidUsedCents).div(100);
  const bonus = new Prisma.Decimal(debit.bonusUsedCents).div(100);
  const updated = await tx.walletAccount.updateMany({ where: { id: account.id, businessId: input.businessId, version: account.version,
    paidBalance: { gte: paid }, bonusBalance: { gte: bonus } },
    data: { paidBalance: { decrement: paid }, bonusBalance: { decrement: bonus }, version: { increment: 1 } } });
  if (updated.count !== 1) throw new Prisma.PrismaClientKnownRequestError("Wallet account version changed.", { code: "P2034", clientVersion: Prisma.prismaVersion.client });
  const entry = await tx.walletTransaction.create({ data: { businessId: input.businessId, walletAccountId: account.id,
    type: "REDEMPTION", sequence: account.version + 1, paidDelta: paid.negated(), bonusDelta: bonus.negated(),
    paidBalanceAfter: account.paidBalance.minus(paid), bonusBalanceAfter: account.bonusBalance.minus(bonus),
    paymentId: payment.id, financialOperationId: operation.id, branchId: input.branchId, actorUserId: input.actorUserId,
    entryKey: "redemption", policyVersion: "WALLET_P1_BONUS_FIRST_V1" } });
  return { transactionId: entry.id, ...debit };
}
