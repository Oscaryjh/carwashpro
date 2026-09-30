import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { assertCashierShiftAcceptsActivity } from "@/lib/closing/shift-control";
import { financialOperationKeySchema, runFinancialOperation } from "@/lib/financial-idempotency";
import { defaultBusinessPaymentMethods } from "@/lib/payments/business-methods";
import { authorizeWallet, WalletServiceError, type WalletContext } from "./authorization";
import { appendWalletEntry } from "./ledger";
import { parseWalletAmount } from "./rules";

const requestSchema = z.object({
  customerId: z.string().uuid(), offerId: z.string().uuid(), expectedOfferVersion: z.number().int().nonnegative(),
  paymentMethodCode: z.string().trim().min(1).max(128),
  reference: z.string().trim().max(500).optional(), operationKey: financialOperationKeySchema,
}).strict();
export type WalletTopUpInput = z.input<typeof requestSchema>;

/** Records an operator-confirmed external collection, NOT a bank/provider charge.
 * On a timeout retry the SAME intent/key/reference; never collect money a second time.
 * No network side effects may be added to the retryable transaction below.
 * Monetary result fields are exact decimal MYR strings, not floating-point ringgit.
 */
export async function postWalletTopUp(ctx: WalletContext, input: WalletTopUpInput, database: PrismaClient = prisma) {
  const request = requestSchema.parse(input);
  const reference = request.reference || null;
  // The shared runner can replay without execute(): always recheck access first.
  await authorizeWallet(database, ctx, request.customerId, "TOP_UP");
  const { result, replayed } = await runFinancialOperation({
    businessId: ctx.businessId, branchId: ctx.branchId, actorUserId: ctx.user.userId,
    operationKey: request.operationKey, operationType: "WALLET_TOP_UP",
    payload: { customerId: request.customerId, offerId: request.offerId, expectedOfferVersion: request.expectedOfferVersion,
      paymentMethodCode: request.paymentMethodCode, reference,
      actorUserId: ctx.user.userId, branchId: ctx.branchId, shiftId: ctx.shiftId },
    execute: async (tx) => {
      const actor = await authorizeWallet(tx, ctx, request.customerId, "TOP_UP");
      const branchId = ctx.branchId!; // checked by centralized authorization
      const shift = ctx.shiftId ? await tx.cashierShift.findFirst({ where: {
        id: ctx.shiftId, businessId: ctx.businessId, branchId, cashierId: actor.userId, status: "OPEN",
      } }) : null;
      if (!shift) throw new WalletServiceError("WALLET_ACTIVE_SHIFT_REQUIRED", "An active cashier shift in this branch is required.");
      const activity = await assertCashierShiftAcceptsActivity(tx, { businessId: ctx.businessId, shift });
      const offer = await tx.walletTopUpOffer.findFirst({ where: { id: request.offerId, businessId: ctx.businessId } });
      if (!offer || !offer.active) throw new WalletServiceError("WALLET_OFFER_UNAVAILABLE", "Top-up offer is unavailable.");
      if (offer.version !== request.expectedOfferVersion) throw new WalletServiceError("OFFER_CHANGED_RECONFIRM", "This offer changed. Review it and confirm again.");
      if (parseWalletAmount(offer.paidAmount) <= 0 || parseWalletAmount(offer.bonusAmount) < 0) throw new WalletServiceError("WALLET_OFFER_INVALID", "Invalid top-up offer.");
      const configured = await tx.businessPaymentMethod.findUnique({ where: { businessId_code: { businessId: ctx.businessId, code: request.paymentMethodCode } } });
      // Same virtual built-ins as Cashier; a persisted disabled row takes precedence.
      const method = configured ?? defaultBusinessPaymentMethods.find(row => row.code === request.paymentMethodCode);
      if (!method || !method.active || method.paymentKind !== "LOCAL_TENDER" || method.settlementCurrency !== "MYR"
        || method.behavior !== "STANDARD_TENDER" || !["CASH", "CARD", "DUITNOW", "EWALLET", "BANK_TRANSFER"].includes(method.canonicalMethod)) {
        throw new WalletServiceError("WALLET_PAYMENT_METHOD_DENIED", "Use an active MYR external payment method.");
      }
      const operation = await tx.financialOperation.findUniqueOrThrow({ where: { businessId_operationType_operationKey: {
        businessId: ctx.businessId, operationType: "WALLET_TOP_UP", operationKey: request.operationKey,
      } } });
      let account = await tx.walletAccount.findUnique({ where: { businessId_customerId: { businessId: ctx.businessId, customerId: request.customerId } } });
      if (!account) account = await tx.walletAccount.create({ data: { businessId: ctx.businessId, customerId: request.customerId } });
      const payment = await tx.payment.create({ data: {
        businessId: ctx.businessId, branchId, shiftId: shift.id, cashierId: actor.userId,
        purpose: "WALLET_TOP_UP", invoiceId: null, amount: offer.paidAmount,
        method: method.canonicalMethod, businessPaymentMethodId: method.id,
        paymentMethodLabel: method.label, tenderCurrency: "MYR", tenderAmount: offer.paidAmount,
        exchangeRateToMyr: new Prisma.Decimal(1), reference, paidAt: activity.activityAt,
      } });
      const topUp = await tx.walletTopUp.create({ data: {
        businessId: ctx.businessId, walletAccountId: account.id, offerId: offer.id,
        offerVersion: offer.version, offerNameSnapshot: offer.name,
        paidAmount: offer.paidAmount, bonusAmount: offer.bonusAmount, totalCredited: offer.paidAmount.plus(offer.bonusAmount),
        externalPaymentId: payment.id, financialOperationId: operation.id, branchId, shiftId: shift.id, actorUserId: actor.userId,
        postedAt: activity.activityAt,
      } });
      const source = { topUpId: topUp.id, financialOperationId: operation.id, branchId, actorUserId: actor.userId };
      account = await appendWalletEntry(tx, { ...source, account, component: "PAID", amount: offer.paidAmount });
      if (offer.bonusAmount.gt(0)) account = await appendWalletEntry(tx, { ...source, account, component: "BONUS", amount: offer.bonusAmount });
      const receipt = {
        topUpId: topUp.id, paymentId: payment.id, walletAccountId: account.id, customerId: request.customerId,
        offerId: offer.id, offerVersion: offer.version, offerNameSnapshot: offer.name,
        paidAmount: offer.paidAmount.toFixed(2), bonusAmount: offer.bonusAmount.toFixed(2), totalCredited: topUp.totalCredited.toFixed(2),
        paidBalance: account.paidBalance.toFixed(2), bonusBalance: account.bonusBalance.toFixed(2), totalBalance: account.paidBalance.plus(account.bonusBalance).toFixed(2),
        paymentMethodCode: method.code, paymentMethod: method.canonicalMethod, paymentMethodLabel: method.label,
        reference, branchId, shiftId: shift.id, actorUserId: actor.userId, postedAt: topUp.postedAt.toISOString(),
      };
      await writeAuditLog({ businessId: ctx.businessId, branchId, actor, action: "WALLET_TOP_UP", entityType: "WalletTopUp", entityId: topUp.id,
        summary: "Member wallet top-up recorded.", metadata: { ...receipt, operationKey: request.operationKey, financialOperationId: operation.id },
      }, tx);
      return receipt;
    },
  }, database);
  return { ...result, replayed };
}
