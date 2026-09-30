import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hasBusinessCapability, resolveBusinessAccess } from "@/lib/business-groups/business-access";
import { defaultBusinessPaymentMethods } from "@/lib/payments/business-methods";
import { authorizeWallet, WalletServiceError, type WalletContext } from "./authorization";
import { getWalletSummary } from "./read-model";
import { parseWalletAmount } from "./rules";
import { postWalletTopUp, type WalletTopUpInput } from "./top-up";
import { assertWalletLocalTestEnabled, isWalletLocalTestEnabled } from "./release-policy";

// Internal adapter context: public actions must derive business/user from the session.
async function accessFor(ctx: WalletContext, db: Prisma.TransactionClient) {
  const access = await resolveBusinessAccess({ userId: ctx.user.userId, requestedBusinessId: ctx.businessId }, db);
  if (!access.granted || access.businessId !== ctx.businessId || !["BUSINESS_OWNER", "STAFF"].includes(access.effectiveBusinessRole ?? "")) {
    throw new WalletServiceError("WALLET_ACCESS_DENIED", "Wallet access denied.");
  }
  const owner = access.effectiveBusinessRole === "BUSINESS_OWNER";
  return { owner, canTopUp: owner || (hasBusinessCapability(access, "VIEW_CRM") && hasBusinessCapability(access, "PROCESS_CASHIER_PAYMENT") && access.permissions.includes("POS")) };
}
async function ownerOnly(ctx: WalletContext, db: Prisma.TransactionClient) {
  if (!(await accessFor(ctx, db)).owner) throw new WalletServiceError("WALLET_ACCESS_DENIED", "Only the business owner can manage wallet offers and transactions.");
}
const offerSchema = z.object({
  id: z.string().uuid().optional(), expectedVersion: z.number().int().nonnegative().optional(),
  name: z.string().trim().min(1).max(160), paidAmount: z.string(), bonusAmount: z.string(), active: z.boolean(),
}).strict().refine(value => !value.id || value.expectedVersion !== undefined);
export type WalletOfferInput = z.input<typeof offerSchema>;
function offerView(row: { id: string; name: string; paidAmount: Prisma.Decimal; bonusAmount: Prisma.Decimal; active: boolean; version: number }) {
  return { id: row.id, name: row.name, paidAmount: row.paidAmount.toFixed(2), bonusAmount: row.bonusAmount.toFixed(2), totalCredited: row.paidAmount.plus(row.bonusAmount).toFixed(2), active: row.active, version: row.version };
}
export async function listWalletOffers(ctx: WalletContext, db: PrismaClient = prisma) {
  await ownerOnly(ctx, db);
  return (await db.walletTopUpOffer.findMany({ where: { businessId: ctx.businessId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map(offerView);
}
export async function saveWalletOffer(ctx: WalletContext, input: WalletOfferInput, db: PrismaClient = prisma) {
  return db.$transaction(async tx => {
    await ownerOnly(ctx, tx);
    const request = offerSchema.parse(input);
    if (parseWalletAmount(request.paidAmount) <= 0) throw new WalletServiceError("WALLET_OFFER_INVALID", "Customer pays must be greater than zero.");
    parseWalletAmount(request.bonusAmount);
    const data = { name: request.name, paidAmount: new Prisma.Decimal(request.paidAmount), bonusAmount: new Prisma.Decimal(request.bonusAmount), active: request.active };
    if (!request.id) return offerView(await tx.walletTopUpOffer.create({ data: { ...data, businessId: ctx.businessId } }));
    const updated = await tx.walletTopUpOffer.updateMany({ where: { id: request.id, businessId: ctx.businessId, version: request.expectedVersion }, data: { ...data, version: { increment: 1 } } });
    if (updated.count !== 1) throw new WalletServiceError("OFFER_CHANGED_RECONFIRM", "This offer changed. Refresh and review before saving again.");
    return offerView(await tx.walletTopUpOffer.findUniqueOrThrow({ where: { businessId_id: { businessId: ctx.businessId, id: request.id } } }));
  });
}
export async function getWalletPanel(ctx: WalletContext, customerId: string, db: PrismaClient = prisma) {
  const access = await accessFor(ctx, db);
  const summary = await getWalletSummary(ctx, customerId, db);
  return { intentScope: `${ctx.businessId}:${ctx.user.userId}:${customerId}`, totalBalance: summary.totalBalance, hasAccount: summary.hasAccount, canTopUp: access.canTopUp && isWalletLocalTestEnabled(),
    ownerDetails: access.owner ? { paidBalance: summary.paidBalance, bonusBalance: summary.bonusBalance } : null };
}
async function collectionContext(ctx: WalletContext, customerId: string, db: PrismaClient) {
  if (!(await accessFor(ctx, db)).canTopUp) throw new WalletServiceError("WALLET_ACCESS_DENIED", "You do not have permission to top up wallets.");
  await authorizeWallet(db, ctx, customerId, "READ");
  // Never choose an arbitrary shift if inconsistent data contains multiple open shifts.
  const shifts = await db.cashierShift.findMany({ where: { businessId: ctx.businessId, cashierId: ctx.user.userId, status: "OPEN" }, take: 2 });
  if (shifts.length !== 1) throw new WalletServiceError("WALLET_ACTIVE_SHIFT_REQUIRED", "Open a cashier shift before topping up a wallet.");
  const verified = { ...ctx, branchId: shifts[0].branchId, shiftId: shifts[0].id };
  await authorizeWallet(db, verified, customerId, "TOP_UP");
  return verified;
}
export async function getWalletTopUpOptions(ctx: WalletContext, customerId: string, db: PrismaClient = prisma) {
  assertWalletLocalTestEnabled();
  await collectionContext(ctx, customerId, db);
  const configured = await db.businessPaymentMethod.findMany({ where: { businessId: ctx.businessId } });
  const byCode = new Map(configured.map(row => [row.code, row]));
  // Match P1B's exact persisted-code precedence, including disabled overrides.
  const methods = [...defaultBusinessPaymentMethods.map(row => byCode.get(row.code) ?? row), ...configured.filter(row => !defaultBusinessPaymentMethods.some(builtin => builtin.code === row.code))];
  return {
    offers: (await db.walletTopUpOffer.findMany({ where: { businessId: ctx.businessId, active: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map(offerView),
    paymentMethods: methods.filter(row => row.active && row.settlementCurrency === "MYR" && row.paymentKind === "LOCAL_TENDER" && row.behavior === "STANDARD_TENDER" && ["CASH", "CARD", "DUITNOW", "EWALLET", "BANK_TRANSFER"].includes(row.canonicalMethod)).map(row => ({ code: row.code, label: row.label })),
  };
}
export async function submitWalletTopUp(ctx: WalletContext, input: WalletTopUpInput, db: PrismaClient = prisma) {
  assertWalletLocalTestEnabled();
  if (!(await accessFor(ctx, db)).canTopUp) throw new WalletServiceError("WALLET_ACCESS_DENIED", "You do not have permission to top up wallets.");
  await authorizeWallet(db, ctx, input.customerId, "READ");
  // A completed intent keeps its original fingerprint even after a shift closes.
  // No request-provided branch/shift or receipt is trusted. P1B rechecks auth + payload.
  const prior = await db.walletTopUp.findFirst({ where: { businessId: ctx.businessId, actorUserId: ctx.user.userId, operation: { operationKey: input.operationKey, operationType: "WALLET_TOP_UP" } }, select: { branchId: true, shiftId: true } });
  const verified = prior ? { ...ctx, ...prior } : await collectionContext(ctx, input.customerId, db);
  return postWalletTopUp(verified, input, db);
}
export async function getWalletHistory(ctx: WalletContext, customerId: string, page = 0, db: PrismaClient = prisma) {
  await ownerOnly(ctx, db);
  await authorizeWallet(db, ctx, customerId, "READ");
  const currentPage = z.number().int().min(0).max(100000).parse(page);
  const rows = await db.walletTopUp.findMany({ where: { businessId: ctx.businessId, account: { customerId } },
    orderBy: [{ postedAt: "desc" }, { id: "desc" }], skip: currentPage * 20, take: 21,
    include: { actor: { select: { name: true } }, payment: { select: { paymentMethodLabel: true, method: true } }, transactions: { where: { type: { in: ["TOP_UP_PAID", "TOP_UP_BONUS"] } }, orderBy: { sequence: "desc" }, take: 1 } } });
  return { canReverse: isWalletLocalTestEnabled(), hasMore: rows.length > 20, rows: rows.slice(0, 20).map(row => ({ id: row.id, date: row.postedAt.toISOString(), type: "Top-up" as const,
    amount: row.totalCredited.toFixed(2), paidAmount: row.paidAmount.toFixed(2), bonusAmount: row.bonusAmount.toFixed(2),
    balanceAfter: row.transactions[0] ? row.transactions[0].paidBalanceAfter.plus(row.transactions[0].bonusBalanceAfter).toFixed(2) : null,
    source: row.payment.paymentMethodLabel ?? row.payment.method, staff: row.actor.name, offer: row.offerNameSnapshot })) };
}
