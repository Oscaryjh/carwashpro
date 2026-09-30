import type { Prisma } from "@prisma/client";
import type { AppSession } from "@/lib/auth/session";
import { hasBusinessCapability, resolveBusinessAccess } from "@/lib/business-groups/business-access";
import { requireBusinessModules } from "@/lib/modules/entitlements";
import { modulesForCapability } from "@/lib/modules/registry";

/** Server-only contract. Future adapters MUST derive user from authenticated session,
 * business from verified context, and branch/shift from server scope, never request JSON.
 * Roles, permissions and tenant ownership are re-read, not trusted from a cached session.
 */
export type WalletContext = {
  businessId: string;
  user: Pick<AppSession, "userId">;
  branchId: string | null;
  shiftId: string | null;
};

export class WalletServiceError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export async function authorizeWallet(
  tx: Prisma.TransactionClient,
  ctx: WalletContext,
  customerId: string,
  mode: "READ" | "TOP_UP",
) {
  const access = await resolveBusinessAccess({
    userId: ctx.user.userId,
    requestedBusinessId: ctx.businessId,
  }, tx);
  const deny = () => { throw new WalletServiceError("WALLET_ACCESS_DENIED", "Wallet access denied."); };
  if (!access.granted || access.businessId !== ctx.businessId || !access.industryType) return deny();
  if (access.effectiveBusinessRole !== "BUSINESS_OWNER" && access.effectiveBusinessRole !== "STAFF") return deny();
  const owner = access.effectiveBusinessRole === "BUSINESS_OWNER";
  const crm = hasBusinessCapability(access, "VIEW_CRM");
  const cashier = hasBusinessCapability(access, "PROCESS_CASHIER_PAYMENT") && access.permissions.includes("POS");
  if (!owner && (mode === "TOP_UP" ? !(crm && cashier) : !(crm || cashier))) return deny();
  await requireBusinessModules(ctx.businessId, modulesForCapability(
    mode === "TOP_UP" ? "PROCESS_CASHIER_PAYMENT" : "VIEW_CRM", access.industryType,
  ), { database: tx });
  if (mode === "TOP_UP") {
    if (!ctx.branchId || (!owner && access.branchId !== ctx.branchId)) return deny();
    const branch = await tx.branch.findFirst({ where: { id: ctx.branchId, businessId: ctx.businessId, status: "ACTIVE" }, select: { id: true } });
    if (!branch) return deny();
  }
  const customer = await tx.customer.findFirst({ where: { id: customerId, businessId: ctx.businessId }, select: { id: true } });
  if (!customer) throw new WalletServiceError("WALLET_CUSTOMER_NOT_FOUND", "Customer not found.");
  const actor = await tx.user.findUniqueOrThrow({ where: { id: ctx.user.userId }, select: { id: true, name: true, email: true } });
  return { userId: actor.id, name: actor.name, email: actor.email ?? "" };
}
