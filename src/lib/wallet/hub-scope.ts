import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveBusinessAccess } from "@/lib/business-groups/business-access";
import { assertWalletAccessAllowed } from "./release-policy";
import { WalletServiceError } from "./authorization";

/** Internal server context: user comes from the authenticated session, Business
 * from verified context. branchId is an optional, untrusted activity filter. */
export type WalletHubContext = {
  businessId: string;
  user: { userId: string };
  branchId?: string | null;
};
export type WalletHubScope = { businessId: string; branchId: string | null };
const contextSchema = z.object({
  businessId: z.string().uuid(), user: z.object({ userId: z.string().uuid() }),
  branchId: z.string().uuid().nullish(),
});

export async function resolveWalletHubScope(context: WalletHubContext, db: Prisma.TransactionClient = prisma): Promise<WalletHubScope> {
  const ctx = contextSchema.parse(context);
  const deny = (): never => { throw new WalletServiceError("WALLET_ACCESS_DENIED", "Wallet access denied."); };
  const access = await resolveBusinessAccess({ userId: ctx.user.userId, requestedBusinessId: ctx.businessId }, db);
  if (!access.granted || access.businessId !== ctx.businessId || access.effectiveBusinessRole !== "BUSINESS_OWNER") deny();
  await assertWalletAccessAllowed(ctx, { database: db });
  const branchId = ctx.branchId ?? null;
  // Owners have Business-level history access. Inactive Branch history is valid;
  // no active operational Branch or cached session fallback is permitted here.
  if (branchId && !await db.branch.findFirst({ where: { id: branchId, businessId: ctx.businessId }, select: { id: true } })) deny();
  return { businessId: ctx.businessId, branchId };
}
