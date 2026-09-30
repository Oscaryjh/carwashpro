import type { Prisma } from "@prisma/client";
import { resolveBusinessAccess, hasBusinessCapability } from "@/lib/business-groups/business-access";
import { requireBusinessModules } from "@/lib/modules/entitlements";
import { modulesForCapability } from "@/lib/modules/registry";
import { WalletServiceError, type WalletContext } from "./authorization";
import { assertWalletLocalTestEnabled } from "./release-policy";

/** D5: no cashier shift is required or fabricated for an owner refund. */
export async function requireWalletRefundOwner(tx: Prisma.TransactionClient, ctx: WalletContext, customerId: string, branchId: string) {
  assertWalletLocalTestEnabled();
  return readWalletRefundOwner(tx,ctx,customerId,branchId);
}

/** Read-only recovery context. Every money writer still calls the gated helper above. */
export async function readWalletRefundOwner(tx: Prisma.TransactionClient, ctx: WalletContext, customerId: string, branchId: string) {
  const access = await resolveBusinessAccess({userId:ctx.user.userId, requestedBusinessId:ctx.businessId},tx);
  if (!access.granted || access.businessId !== ctx.businessId || !access.industryType ||
      access.effectiveBusinessRole !== "BUSINESS_OWNER" || !hasBusinessCapability(access,"PROCESS_REFUND")) {
    throw new WalletServiceError("WALLET_ACCESS_DENIED","Only the business owner can process wallet refunds.");
  }
  await requireBusinessModules(ctx.businessId,modulesForCapability("PROCESS_REFUND",access.industryType),{database:tx});
  if (!await tx.branch.findFirst({where:{id:branchId,businessId:ctx.businessId}}) ||
      !await tx.customer.findFirst({where:{id:customerId,businessId:ctx.businessId}})) throw new Error("Wallet refund source unavailable.");
  const actor = await tx.user.findUniqueOrThrow({where:{id:ctx.user.userId},select:{id:true,name:true,email:true}});
  return {userId:actor.id,name:actor.name,email:actor.email ?? ""};
}
