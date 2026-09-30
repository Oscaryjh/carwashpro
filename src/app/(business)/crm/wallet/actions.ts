"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { requireBusinessContext } from "@/lib/tenant";
import { WalletServiceError } from "@/lib/wallet/authorization";
import { getWalletPanel, getWalletTopUpOptions, getWalletHistory, listWalletOffers, saveWalletOffer, submitWalletTopUp } from "@/lib/wallet/ui-adapter";
import { financialOperationKeySchema } from "@/lib/financial-idempotency";
import { WalletRuleError } from "@/lib/wallet/types";
import { reverseWalletTopUp } from "@/lib/wallet/reversals";
import { prisma } from "@/lib/prisma";
import { readWalletRefundOwner } from "@/lib/wallet/refund-authorization";
import { isWalletLocalTestEnabled } from "@/lib/wallet/release-policy";
import { toCents } from "@/lib/validation/pos";
import { WalletTopUpAlreadyConsumedError } from "@/lib/wallet/refund-errors";

async function context() {
  const { user, businessId } = await requireBusinessContext();
  return { businessId, user: { userId: user.userId, name: user.name }, branchId: null, shiftId: null };
}
async function result<T>(work: () => Promise<T>) {
  try { return { ok: true as const, data: await work() }; }
  catch (error) {
    unstable_rethrow(error);
    if(error instanceof WalletTopUpAlreadyConsumedError) return {ok:false as const,code:error.code,message:"This top-up cannot be reversed because the wallet has already been used.",uncertain:false,canCorrect:true};
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
export async function reverseWalletTopUpAction(form: FormData) {
  return result(async () => {
    const ctx = await context();
    if (form.get("businessId") !== ctx.businessId) throw new WalletServiceError("WALLET_ACCESS_DENIED", "Business context changed.");
    return reverseWalletTopUp(ctx, {
      operationKey: String(form.get("operationKey") ?? ""), topUpId: String(form.get("topUpId") ?? ""),
      reason: String(form.get("reason") ?? ""), externalRefundReference: String(form.get("externalRefundReference") ?? ""),
    });
  });
}
export async function walletRefundOptionsAction(sourceId:string,kind:"invoice"|"top-up") {
  return result(async()=>{
    const ctx=await context();z.string().uuid().parse(sourceId);
    if(kind==="top-up"){
      const top=await prisma.walletTopUp.findFirstOrThrow({where:{id:sourceId,businessId:ctx.businessId},include:{account:true,payment:true,reversals:true}});
      await readWalletRefundOwner(prisma,ctx,top.account.customerId,top.branchId);
      return {kind,releaseEnabled:isWalletLocalTestEnabled(),businessId:ctx.businessId,scope:`${ctx.businessId}:${ctx.user.userId}:top-up:${sourceId}`,sourceId,canVoid:false,
        paidAmount:top.paidAmount.toFixed(2),bonusAmount:top.bonusAmount.toFixed(2),method:top.payment.method,reversed:top.reversals.length>0,legs:[],stockLines:[]};
    }
    if(kind!=="invoice")throw new Error("Invalid source type.");
    const invoice=await prisma.invoice.findFirstOrThrow({where:{id:sourceId,businessId:ctx.businessId},include:{payments:{include:{refunds:true}},items:{include:{inventoryRefundLines:true}}}});
    if(!invoice.branchId||!invoice.customerId||!invoice.payments.some(p=>p.method==="MEMBER_WALLET"))throw new Error("Wallet invoice unavailable.");
    await readWalletRefundOwner(prisma,ctx,invoice.customerId,invoice.branchId);
    return {kind,releaseEnabled:isWalletLocalTestEnabled(),businessId:ctx.businessId,scope:`${ctx.businessId}:${ctx.user.userId}:invoice:${sourceId}`,sourceId,
      canVoid:!!(invoice.appointmentId||invoice.workOrderId)&&!invoice.customerPackageId&&!invoice.items.some(i=>i.productId||i.customerPackageId)&&!invoice.payments.some(p=>p.refunds.length)&&!["VOID","REFUNDED"].includes(invoice.status),
      paidAmount:"",bonusAmount:"",method:"",reversed:invoice.status==="VOID",
      legs:invoice.payments.filter(p=>p.status==="ACTIVE").map(p=>({paymentId:p.id,method:p.method,availableCents:toCents(p.amount)-p.refunds.reduce((n,r)=>n+toCents(r.amount),0)})),
      stockLines:invoice.items.filter(i=>i.inventoryTracked&&i.productId).map(i=>({id:i.id,name:i.name,remainingQuantity:i.quantity-i.inventoryRefundLines.reduce((n,l)=>n+l.quantity,0)})).filter(i=>i.remainingQuantity>0)};
  });
}
export async function walletTopUpOptionsAction(customerId: string) {
  return result(async () => getWalletTopUpOptions(await context(), z.string().uuid().parse(customerId)));
}
export async function walletHistoryAction(customerId: string, page: number) {
  return result(async () => {
    const ctx=await context();
    return {...await getWalletHistory(ctx,z.string().uuid().parse(customerId),page),refundScopePrefix:`${ctx.businessId}:${ctx.user.userId}`};
  });
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
