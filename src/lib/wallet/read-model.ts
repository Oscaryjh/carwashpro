import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorizeWallet, type WalletContext } from "./authorization";

/** Decimal MYR strings preserve exact cents even for accumulated balances. No writes. */
export async function getWalletSummary(ctx: WalletContext, customerId: string, database: PrismaClient = prisma) {
  return database.$transaction(async (tx) => {
    await authorizeWallet(tx, ctx, customerId, "READ");
    const account = await tx.walletAccount.findUnique({ where: { businessId_customerId: { businessId: ctx.businessId, customerId } } });
    return {
      hasAccount: Boolean(account), walletAccountId: account?.id ?? null,
      paidBalance: account?.paidBalance.toFixed(2) ?? "0.00",
      bonusBalance: account?.bonusBalance.toFixed(2) ?? "0.00",
      totalBalance: account ? account.paidBalance.plus(account.bonusBalance).toFixed(2) : "0.00",
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
