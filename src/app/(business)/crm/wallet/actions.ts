"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { requireBusinessContext } from "@/lib/tenant";
import { WalletServiceError } from "@/lib/wallet/authorization";
import { getWalletPanel, getWalletTopUpOptions, getWalletHistory, listWalletOffers, saveWalletOffer, submitWalletTopUp } from "@/lib/wallet/ui-adapter";
import { financialOperationKeySchema } from "@/lib/financial-idempotency";
import { WalletRuleError } from "@/lib/wallet/types";

async function context() {
  const { user, businessId } = await requireBusinessContext();
  return { businessId, user: { userId: user.userId, name: user.name }, branchId: null, shiftId: null };
}
async function result<T>(work: () => Promise<T>) {
  try { return { ok: true as const, data: await work() }; }
  catch (error) {
    unstable_rethrow(error);
    const code = error instanceof WalletServiceError ? error.code : error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const messages: Record<string, string> = {
      WALLET_ACCESS_DENIED: "You do not have permission to perform this wallet action.",
      WALLET_ACTIVE_SHIFT_REQUIRED: "Open a cashier shift before topping up a wallet.",
      WALLET_CUSTOMER_NOT_FOUND: "This customer is unavailable in your current business.",
      WALLET_OFFER_UNAVAILABLE: "This offer is no longer available. Select an active offer.",
      WALLET_OFFER_INVALID: "Enter a positive payment amount and a bonus of zero or more, with up to two decimal places.",
      OFFER_CHANGED_RECONFIRM: "This top-up offer has changed. Please review the updated amount before confirming again.",
      WALLET_PAYMENT_METHOD_DENIED: "Select an active MYR payment method available for wallet top-ups.",
      IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD: "This confirmation has different recorded details. Do not collect payment again. Ask the business owner to review it.",
    };
    if (error instanceof z.ZodError || error instanceof WalletRuleError) return { ok: false as const, code: "INVALID_INPUT", message: "Check the entered details and amounts before trying again.", uncertain: false };
    return { ok: false as const, code: messages[code] ? code : "UNEXPECTED", message: messages[code] ?? "We could not confirm the result. Retry this same confirmation; do not collect payment again.", uncertain: !messages[code] || code === "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD" };
  }
}
export async function walletPanelAction(customerId: string) {
  return result(async () => getWalletPanel(await context(), z.string().uuid().parse(customerId)));
}
export async function walletTopUpOptionsAction(customerId: string) {
  return result(async () => getWalletTopUpOptions(await context(), z.string().uuid().parse(customerId)));
}
export async function walletHistoryAction(customerId: string, page: number) {
  return result(async () => getWalletHistory(await context(), z.string().uuid().parse(customerId), page));
}
export async function walletOffersAction() {
  return result(async () => listWalletOffers(await context()));
}
export async function saveWalletOfferAction(form: FormData) {
  return result(async () => {
    const ctx = await context();
    // An owner switching business in another tab must not save an old form there.
    if (form.get("businessId") !== ctx.businessId) throw new WalletServiceError("WALLET_ACCESS_DENIED", "Business context changed.");
    return saveWalletOffer(ctx, {
      id: form.get("id") ? String(form.get("id")) : undefined,
      expectedVersion: form.get("id") ? Number(form.get("version")) : undefined,
      name: String(form.get("name") ?? ""), paidAmount: String(form.get("paidAmount") ?? ""),
      bonusAmount: String(form.get("bonusAmount") ?? ""), active: form.get("active") === "true",
    });
  });
}
export async function walletTopUpAction(form: FormData) {
  return result(async () => {
    const ctx = await context();
    const input = z.object({ customerId: z.string().uuid(), offerId: z.string().uuid(), expectedOfferVersion: z.number().int().nonnegative(), paymentMethodCode: z.string().min(1).max(128), reference: z.string().max(500), operationKey: financialOperationKeySchema }).parse({
      customerId: form.get("customerId"), offerId: form.get("offerId"), expectedOfferVersion: Number(form.get("expectedOfferVersion")), paymentMethodCode: form.get("paymentMethodCode"), reference: form.get("reference") ?? "", operationKey: form.get("operationKey"),
    });
    const receipt = await submitWalletTopUp(ctx, input);
    // Explicit confirmation DTO: Staff may see this collection, not account composition.
    return { topUpId: receipt.topUpId, paidAmount: receipt.paidAmount, bonusAmount: receipt.bonusAmount,
      totalCredited: receipt.totalCredited, totalBalance: receipt.totalBalance, postedAt: receipt.postedAt,
      offerNameSnapshot: receipt.offerNameSnapshot, paymentMethodLabel: receipt.paymentMethodLabel,
      reference: receipt.reference, staffName: ctx.user.name, replayed: receipt.replayed };
  });
}
