import { Prisma, type PrismaClient, type WalletTransaction } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { financialOperationKeySchema, runFinancialOperation } from "@/lib/financial-idempotency";
import { writeAuditLog } from "@/lib/audit";
import type { WalletContext } from "./authorization";
import { requireWalletRefundOwner } from "./refund-authorization";
import { WalletTopUpAlreadyConsumedError } from "./refund-errors";

async function reverseEntry(tx:Prisma.TransactionClient,ctx:WalletContext,original:WalletTransaction,operationId:string,reason:string) {
  const account=await tx.walletAccount.findUniqueOrThrow({where:{id:original.walletAccountId}});
  const paid=original.paidDelta.negated(),bonus=original.bonusDelta.negated();
  if(account.paidBalance.plus(paid).lt(0)||account.bonusBalance.plus(bonus).lt(0)) throw new Error("Insufficient original wallet components.");
  const changed=await tx.walletAccount.updateMany({where:{id:account.id,version:account.version},data:{paidBalance:{increment:paid},bonusBalance:{increment:bonus},version:{increment:1}}});
  if(changed.count!==1) throw new Prisma.PrismaClientKnownRequestError("Wallet version changed.",{code:"P2034",clientVersion:Prisma.prismaVersion.client});
  const entry=await tx.walletTransaction.create({data:{businessId:ctx.businessId,walletAccountId:account.id,type:"REVERSAL",sequence:account.version+1,paidDelta:paid,bonusDelta:bonus,paidBalanceAfter:account.paidBalance.plus(paid),bonusBalanceAfter:account.bonusBalance.plus(bonus),policyVersion:"WALLET_P1_FULL_REVERSAL_V1",financialOperationId:operationId,entryKey:`reverse:${original.id}`,originalTransactionId:original.id,actorUserId:ctx.user.userId,branchId:original.branchId,reason}});
  return entry;
}
async function topUpSource(tx:Prisma.TransactionClient,ctx:WalletContext,id:string) {
  const top=await tx.walletTopUp.findFirstOrThrow({where:{id,businessId:ctx.businessId},include:{account:true,payment:{include:{refunds:true}},transactions:true,reversals:true}});
  const actor=await requireWalletRefundOwner(tx,ctx,top.account.customerId,top.branchId);
  return {top,actor};
}
const schema=z.object({operationKey:financialOperationKeySchema,topUpId:z.string().uuid(),reason:z.string().trim().min(3).max(500),externalRefundReference:z.string().trim().max(500).optional()}).strict();
export async function reverseWalletTopUp(ctx:WalletContext,raw:z.input<typeof schema>,db:PrismaClient=prisma) {
  const input=schema.parse(raw),source=await topUpSource(db,ctx,input.topUpId);
  const {operationKey,...payload}=input;
  const {result}=await runFinancialOperation({businessId:ctx.businessId,actorUserId:ctx.user.userId,branchId:source.top.branchId,operationType:"WALLET_TOP_UP_REVERSAL",operationKey,payload:{...payload,walletActorId:ctx.user.userId},execute:async tx=>{
    const {top,actor}=await topUpSource(tx,ctx,input.topUpId);
    if(top.reversals.length) throw new Error("ALREADY_REVERSED");
    if(top.payment.status!=="ACTIVE" || top.payment.refunds.length) throw new Error("Original top-up payment cannot be reversed.");
    if(top.payment.method!=="CASH" && !input.externalRefundReference) throw new Error("Original channel refund reference is required.");
    const originals=top.transactions.filter(t=>t.type==="TOP_UP_PAID"||t.type==="TOP_UP_BONUS").sort((a,b)=>a.sequence-b.sequence);
    if(originals.length!==(top.bonusAmount.gt(0)?2:1)) throw new Error("Incomplete original top-up ledger.");
    const used=await tx.walletTransaction.findFirst({where:{walletAccountId:top.walletAccountId,sequence:{gt:originals.at(-1)!.sequence},OR:[{type:"REDEMPTION"},{paidDelta:{lt:0}},{bonusDelta:{lt:0}}]}});
    if(used) throw new WalletTopUpAlreadyConsumedError();
    const op=await tx.financialOperation.findUniqueOrThrow({where:{businessId_operationType_operationKey:{businessId:ctx.businessId,operationType:"WALLET_TOP_UP_REVERSAL",operationKey}}});
    const refund=await tx.paymentRefund.create({data:{businessId:ctx.businessId,branchId:top.branchId,paymentId:top.externalPaymentId,processedById:ctx.user.userId,shiftId:null,invoiceId:null,amount:top.paidAmount,method:top.payment.method,tenderCurrency:"MYR",tenderAmount:top.paidAmount,exchangeRateToMyr:1,reason:input.reason,reference:input.externalRefundReference||null}});
    const reversal=await tx.walletTopUpReversal.create({data:{businessId:ctx.businessId,topUpId:top.id,externalRefundId:refund.id,financialOperationId:op.id,actorUserId:ctx.user.userId,reason:input.reason}});
    for(const original of originals) await reverseEntry(tx,ctx,original,op.id,input.reason);
    const after=await tx.walletAccount.findUniqueOrThrow({where:{id:top.walletAccountId}});
    await writeAuditLog({businessId:ctx.businessId,branchId:top.branchId,actor,action:"WALLET_TOP_UP_REVERSED",entityType:"WalletTopUpReversal",entityId:reversal.id,summary:"Original top-up principal refunded; bonus removed",before:top.account,after,metadata:{operationId:op.id,topUpId:top.id,externalRefundId:refund.id,originalTransactionIds:originals.map(o=>o.id),shiftId:null,sourceShiftId:top.shiftId,paidAmount:top.paidAmount.toFixed(2),bonusAmount:top.bonusAmount.toFixed(2),reason:input.reason,reference:input.externalRefundReference||null}},tx);
    return {topUpId:top.id,externalRefundId:refund.id};
  }},db);
  return result;
}

/** Called only inside the existing INVOICE_VOID transaction; DB enforces the final VOID graph. */
export async function reverseWalletPaymentForVoid(tx:Prisma.TransactionClient,ctx:WalletContext,input:{paymentId:string;reason:string;financialOperationId:string}) {
  const original=await tx.walletTransaction.findFirstOrThrow({where:{businessId:ctx.businessId,paymentId:input.paymentId,type:"REDEMPTION"},include:{account:true,related:true,payment:{include:{refunds:true}}}});
  if(!original.branchId || !original.payment || original.payment.status!=="ACTIVE" || original.payment.refunds.length || original.related.length) throw new Error("Wallet payment cannot be voided.");
  const actor=await requireWalletRefundOwner(tx,ctx,original.account.customerId,original.branchId);
  await tx.financialOperation.findFirstOrThrow({where:{id:input.financialOperationId,businessId:ctx.businessId,actorUserId:ctx.user.userId,operationType:"INVOICE_VOID",state:"IN_PROGRESS"}});
  const entry=await reverseEntry(tx,ctx,original,input.financialOperationId,input.reason);
  const after=await tx.walletAccount.findUniqueOrThrow({where:{id:original.walletAccountId}});
  await writeAuditLog({businessId:ctx.businessId,branchId:original.branchId,actor,action:"WALLET_PAYMENT_REVERSED",entityType:"WalletTransaction",entityId:entry.id,summary:"Original wallet payment restored for invoice void",before:original.account,after,metadata:{operationId:input.financialOperationId,originalTransactionId:original.id,paymentId:input.paymentId,shiftId:null,sourceShiftId:original.payment.shiftId,reason:input.reason}},tx);
  return {transactionId:entry.id};
}
