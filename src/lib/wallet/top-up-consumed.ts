import type { Prisma } from "@prisma/client";

/** Read-only fact shared by the options hint and the authoritative transaction guard. */
export async function isWalletTopUpConsumed(
  db: Pick<Prisma.TransactionClient, "walletTransaction">,
  walletAccountId: string,
  originalLastSequence: number,
): Promise<boolean> {
  return !!await db.walletTransaction.findFirst({where:{walletAccountId,sequence:{gt:originalLastSequence},OR:[{type:"REDEMPTION"},{paidDelta:{lt:0}},{bonusDelta:{lt:0}}]}});
}
