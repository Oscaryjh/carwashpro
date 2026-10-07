import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { runFinancialOperation, financialOperationKeySchema } from "@/lib/financial-idempotency";
import { writeAuditLog } from "@/lib/audit";
import { recordRefundInventory, type RefundStockLineInput } from "@/lib/inventory/service";
import { isBusinessModuleEnabled } from "@/lib/modules/entitlements";
import { refundWalletInvoiceLoyalty } from "@/lib/loyalty/wallet-settlement";
import { capturePerformanceRefund } from "@/lib/performance/service";
import { reconcileInvoiceSettlementAfterRefund } from "@/lib/invoices/refund-settlement-service";
import { calculateCreditNoteAmounts } from "@/lib/tax/calculator";
import { makeCreditNoteNumber } from "@/lib/invoices/credit-note-number";
import { fromCents, toCents } from "@/lib/validation/pos";
import { planWalletRefund, parseWalletAmount } from "./rules";
import { MAX_PAYMENT_CENTS } from "./types";
import type { WalletContext } from "./authorization";
import { requireWalletRefundOwner } from "./refund-authorization";
import { WalletRefundRejected } from "./refund-errors";
import { clearCustomerPackageServiceBalances } from "@/lib/packages/service-balances";
import { captureCustomerPackageActivityBefore, appendCustomerPackageActivity } from "@/lib/packages/activity";

const requestSchema = z.object({operationKey:financialOperationKeySchema,invoiceId:z.string().uuid(),reason:z.string().trim().min(3).max(500),
  legs:z.array(z.object({paymentId:z.string().uuid(),amountCents:z.number().int().positive().max(MAX_PAYMENT_CENTS),
    method:z.enum(["MEMBER_WALLET","CASH","CARD","DUITNOW","EWALLET","BANK_TRANSFER"]),reference:z.string().trim().max(500).optional()}).strict()).min(1).max(2),
  stockLines:z.array(z.object({invoiceItemId:z.string().uuid(),quantity:z.number().int().positive(),disposition:z.enum(["RESTOCK","NO_RESTOCK"]),noRestockReason:z.string().nullable().optional()}).strict()).max(100),
}).strict().superRefine((input,ctx)=>{
  input.stockLines.forEach((line,index)=>{
    if(line.disposition==="NO_RESTOCK"&&(line.noRestockReason?.trim().length??0)<3){
      ctx.addIssue({code:z.ZodIssueCode.custom,path:["stockLines",index,"noRestockReason"],message:"A clear no-restock reason is required."});
    }
  });
  input.legs.forEach((leg,index)=>{
    if(leg.method!=="CASH"&&leg.method!=="MEMBER_WALLET"&&!leg.reference?.trim()){
      ctx.addIssue({code:z.ZodIssueCode.custom,path:["legs",index,"reference"],message:"Refund reference is required."});
    }
  });
});
export type WalletRefundInput = z.input<typeof requestSchema>;

async function sourceInvoice(tx: Prisma.TransactionClient, ctx: WalletContext, invoiceId: string) {
  const invoice = await tx.invoice.findFirst({where:{id:invoiceId,businessId:ctx.businessId},include:{items:true,payments:{include:{refunds:true}}}});
  if (!invoice?.customerId || !invoice.branchId || !invoice.payments.some(p=>p.method==="MEMBER_WALLET")) throw new Error("Wallet invoice unavailable.");
  const actor = await requireWalletRefundOwner(tx,ctx,invoice.customerId,invoice.branchId);
  return {invoice,actor};
}

/** One REFUND entry, linked to the immutable original debit; caller owns the transaction. */
export async function restoreWalletForRefund(tx: Prisma.TransactionClient, ctx: WalletContext, input:{refundId:string;financialOperationId:string}) {
  const refund = await tx.paymentRefund.findFirstOrThrow({where:{id:input.refundId,businessId:ctx.businessId},include:{payment:true}});
  const original = await tx.walletTransaction.findFirstOrThrow({where:{businessId:ctx.businessId,paymentId:refund.paymentId,type:"REDEMPTION"},include:{account:true,related:true}});
  if (!refund.branchId || refund.payment.status!=="ACTIVE" || refund.method!=="MEMBER_WALLET" || refund.payment.method!=="MEMBER_WALLET") throw new Error("Invalid wallet refund source.");
  await requireWalletRefundOwner(tx,ctx,original.account.customerId,refund.branchId);
  await tx.financialOperation.findFirstOrThrow({where:{id:input.financialOperationId,businessId:ctx.businessId,actorUserId:ctx.user.userId,operationType:"PAYMENT_REFUND",state:"IN_PROGRESS"}});
  if (original.related.some(r=>r.type==="REVERSAL" || r.refundId===refund.id)) throw new Error("Wallet source already reversed or refund already posted.");
  const prior = original.related.filter(r=>r.type==="REFUND");
  const paid = prior.reduce((n,r)=>n+parseWalletAmount(r.paidDelta),0), bonus = prior.reduce((n,r)=>n+parseWalletAmount(r.bonusDelta),0);
  const refunds = await tx.paymentRefund.findMany({where:{paymentId:refund.paymentId,id:{not:refund.id}}});
  if (refunds.reduce((n,r)=>n+parseWalletAmount(r.amount),0)!==paid+bonus) throw new Error("Wallet refund history is inconsistent.");
  const plan = planWalletRefund({originalPaidCents:parseWalletAmount(original.paidDelta.negated()),originalBonusCents:parseWalletAmount(original.bonusDelta.negated()),refundedPaidCents:paid,refundedBonusCents:bonus,refundCents:parseWalletAmount(refund.amount)});
  const account = original.account, pd = new Prisma.Decimal(plan.paidCents).div(100), bd = new Prisma.Decimal(plan.bonusCents).div(100);
  const updated = await tx.walletAccount.updateMany({where:{id:account.id,version:account.version},data:{paidBalance:{increment:pd},bonusBalance:{increment:bd},version:{increment:1}}});
  if(updated.count!==1) throw new Prisma.PrismaClientKnownRequestError("Wallet version changed.",{code:"P2034",clientVersion:Prisma.prismaVersion.client});
  const entry = await tx.walletTransaction.create({data:{businessId:ctx.businessId,walletAccountId:account.id,sequence:account.version+1,type:"REFUND",paidDelta:pd,bonusDelta:bd,paidBalanceAfter:account.paidBalance.plus(pd),bonusBalanceAfter:account.bonusBalance.plus(bd),policyVersion:"WALLET_P1_PAID_FIRST_REFUND_V1",financialOperationId:input.financialOperationId,entryKey:`refund:${refund.id}`,refundId:refund.id,originalTransactionId:original.id,branchId:refund.branchId,actorUserId:ctx.user.userId,reason:refund.reason}});
  return {transactionId:entry.id};
}

export async function refundWalletSale(ctx:WalletContext, raw:WalletRefundInput, db:PrismaClient=prisma) {
  const input=requestSchema.parse(raw);
  if(new Set(input.legs.map(l=>l.paymentId)).size!==input.legs.length || new Set(input.stockLines.map(l=>l.invoiceItemId)).size!==input.stockLines.length) throw new Error("Duplicate refund source.");
  const source=await sourceInvoice(db,ctx,input.invoiceId); // gate/auth before financial result replay
  const {operationKey,...payload}=input;
  const {result}=await runFinancialOperation({businessId:ctx.businessId,actorUserId:ctx.user.userId,branchId:source.invoice.branchId,operationType:"PAYMENT_REFUND",operationKey,
    payload:{...payload,walletActorId:ctx.user.userId},execute:async tx=>{
      const {invoice,actor}=await sourceInvoice(tx,ctx,input.invoiceId);
      if(invoice.status==="VOID") throw new Error("Invoice cannot be refunded through Wallet checkout.");
      const packageIds = [...new Set([invoice.customerPackageId, ...invoice.items.map(item => item.customerPackageId)].filter((id): id is string => !!id))];
      if (packageIds.length) {
        // A package purchase is refunded as one operation across EVERY original source.
        // Validation and entitlement reversal share the existing serializable transaction.
        const payments = invoice.payments.filter(payment => payment.status === "ACTIVE");
        if (payments.length !== input.legs.length || payments.some(payment => {
          const leg = input.legs.find(entry => entry.paymentId === payment.id);
          return payment.purpose === "WALLET_TOP_UP" || (payment.method === "MEMBER_WALLET" && payment.purpose !== "SALE")
            || payment.method === "PACKAGE" || payment.packageUses > 0
            || payment.refunds.length > 0 || !leg || leg.method !== payment.method
            || leg.amountCents !== toCents(payment.amount);
        })) throw new WalletRefundRejected("Package purchases must be refunded in full to all original payment sources.");
        const packages = await tx.customerPackage.findMany({
          where: { id: { in: packageIds }, businessId: ctx.businessId, customerId: invoice.customerId!, branchId: invoice.branchId },
          include: { serviceBalances: true },
        });
        if (packages.length !== packageIds.length || packages.some(pkg =>
          pkg.status !== "ACTIVE" || pkg.remainingUses !== pkg.totalUses
          || pkg.serviceBalances.some(balance => balance.remainingUses !== balance.totalUses)
        )) throw new WalletRefundRejected("All packages in this invoice must be unused before they can be refunded.");
      }
      const op=await tx.financialOperation.findUniqueOrThrow({where:{businessId_operationType_operationKey:{businessId:ctx.businessId,operationType:"PAYMENT_REFUND",operationKey}}});
      const legs=input.legs.map(leg=>{
        const payment=invoice.payments.find(p=>p.id===leg.paymentId && p.businessId===ctx.businessId && p.status==="ACTIVE" && p.branchId===invoice.branchId);
        if(!payment || payment.purpose==="WALLET_TOP_UP" || payment.method==="PACKAGE") throw new Error("Original payment unavailable.");
        if((payment.method==="MEMBER_WALLET")!==(leg.method==="MEMBER_WALLET")) throw new Error("Wallet refunds must return to the original wallet.");
        if(leg.method!=="CASH" && leg.method!=="MEMBER_WALLET" && !leg.reference) throw new WalletRefundRejected("Refund reference is required.");
        const available=toCents(payment.amount)-payment.refunds.reduce((n,r)=>n+toCents(r.amount),0);
        if(leg.amountCents>available) throw new WalletRefundRejected("Refund exceeds the original payment remaining amount.");
        return {leg,payment};
      }).sort((a,b)=>a.payment.id.localeCompare(b.payment.id));
      const inventory=await isBusinessModuleEnabled(ctx.businessId,"INVENTORY",{database:tx});
      if(inventory && !input.stockLines.length) {
        for(const item of invoice.items.filter(i=>i.inventoryTracked)) {
          const returned=await tx.inventoryRefundLine.aggregate({where:{businessId:ctx.businessId,invoiceItemId:item.id},_sum:{quantity:true}});
          if((returned._sum.quantity??0)<item.quantity) throw new WalletRefundRejected("Choose the returned product quantities and disposition.");
        }
      }
      const refundIds:string[]=[], creditNoteNumbers:string[]=[];
      for(const {leg,payment} of legs) {
        const refund=await tx.paymentRefund.create({data:{businessId:ctx.businessId,branchId:invoice.branchId,paymentId:payment.id,invoiceId:invoice.id,workOrderId:invoice.workOrderId,processedById:ctx.user.userId,shiftId:null,amount:fromCents(leg.amountCents),method:leg.method,tenderCurrency:"MYR",tenderAmount:fromCents(leg.amountCents),exchangeRateToMyr:1,reason:input.reason,reference:leg.reference||null}});
        refundIds.push(refund.id);
        const before=payment.method==="MEMBER_WALLET"?await tx.walletTransaction.findFirstOrThrow({where:{paymentId:payment.id},include:{account:true}}):null;
        if(before) await restoreWalletForRefund(tx,ctx,{refundId:refund.id,financialOperationId:op.id});
        const amounts=calculateCreditNoteAmounts({invoiceSubtotal:Number(invoice.subtotal),invoiceTax:Number(invoice.taxAmount),invoiceTotal:Number(invoice.total),refundTotal:leg.amountCents/100});
        const note=await tx.creditNote.create({data:{businessId:ctx.businessId,branchId:invoice.branchId,invoiceId:invoice.id,refundId:refund.id,customerId:invoice.customerId,createdById:ctx.user.userId,creditNoteNumber:makeCreditNoteNumber(),reason:input.reason,subtotal:fromCents(toCents(amounts.subtotal)),taxableSubtotal:fromCents(toCents(amounts.taxableSubtotal)),taxAmount:fromCents(toCents(amounts.tax)),taxRate:invoice.taxRate,taxLabel:invoice.taxLabel,total:fromCents(toCents(amounts.total)),items:{create:{businessId:ctx.businessId,name:`Refund for ${invoice.invoiceNumber}`,quantity:1,unitPrice:fromCents(toCents(amounts.subtotal)),lineTotal:fromCents(toCents(amounts.subtotal)),taxable:amounts.tax>0,taxRate:invoice.taxRate,taxAmount:fromCents(toCents(amounts.tax))}}}});
        creditNoteNumbers.push(note.creditNoteNumber);
        await capturePerformanceRefund(tx,refund.id,{businessId:ctx.businessId,actorUserId:ctx.user.userId});
        const after=before?await tx.walletAccount.findUniqueOrThrow({where:{id:before.account.id}}):null;
        await writeAuditLog({businessId:ctx.businessId,branchId:invoice.branchId,actor,action:"PAYMENT_REFUNDED",entityType:"PaymentRefund",entityId:refund.id,summary:`Refunded RM${fromCents(leg.amountCents)} from ${invoice.invoiceNumber}`,before:before?.account,after,metadata:{operationId:op.id,paymentId:payment.id,originalTransactionId:before?.id??null,shiftId:null,sourceShiftId:payment.shiftId,method:leg.method,reason:input.reason,reference:leg.reference??null}},tx);
      }
      // Only revoke the purchase after every source has been refunded; any later failure
      // also rolls back every refund, wallet restoration and entitlement change.
      if (packageIds.length) {
        const captures = [];
        for (const customerPackageId of [...packageIds].sort()) {
          captures.push(await captureCustomerPackageActivityBefore(tx, { businessId: ctx.businessId, customerPackageId }));
        }
        await tx.customerPackage.updateMany({
          where: { businessId: ctx.businessId, id: { in: packageIds } },
          data: { status: "CANCELLED", remainingUses: 0 },
        });
        await clearCustomerPackageServiceBalances(tx, packageIds);
        for (const capture of captures) {
          const items = invoice.items.filter(item => item.customerPackageId === capture.customerPackageId);
          await appendCustomerPackageActivity(tx, capture, { eventType: "CANCELLED", sourceType: "PAYMENT_REFUND",
            financialOperationId: op.id, actorUserId: ctx.user.userId, branchId: invoice.branchId, invoiceId: invoice.id,
            appointmentId: invoice.appointmentId, workOrderId: invoice.workOrderId,
            paymentId: legs[0].payment.id, paymentRefundId: refundIds[0],
            additionalSourceRefs: { paymentIds: legs.map(leg => leg.payment.id), refundIds }, reason: input.reason,
            ...(items.length === 1 ? { purchaseSourceMapping: { customerPackageId: capture.customerPackageId, invoiceId: invoice.id, invoiceItemId: items[0].id } } : {}),
          });
        }
      }
      // One balance adjustment for this entire operation, after every refund leg exists.
      await refundWalletInvoiceLoyalty(tx,{businessId:ctx.businessId,invoiceId:invoice.id,refundId:refundIds[0],actorUserId:ctx.user.userId});
      if(input.stockLines.length) await recordRefundInventory(tx,{businessId:ctx.businessId,branchId:invoice.branchId!,actorUserId:ctx.user.userId,paymentRefundId:refundIds[0],lines:input.stockLines as RefundStockLineInput[]});
      await reconcileInvoiceSettlementAfterRefund(tx,{businessId:ctx.businessId,invoiceId:invoice.id,totalCents:toCents(invoice.total),workOrderId:invoice.workOrderId});
      await writeAuditLog({businessId:ctx.businessId,branchId:invoice.branchId,actor,action:"WALLET_SALE_REFUNDED",entityType:"Invoice",entityId:invoice.id,summary:"Wallet sale refund recorded",metadata:{operationId:op.id,refundIds,stockLines:input.stockLines,shiftId:null,reason:input.reason}},tx);
      return {invoiceId:invoice.id,refundIds,creditNoteNumbers};
    }},db);
  return result;
}
