import assert from "node:assert/strict";
import test,{after} from "node:test";
import {randomUUID} from "node:crypto";
import {walletTestDatabase} from "../helpers/wallet-fixture";
import {checkoutFixture,checkoutHarness} from "../helpers/wallet-checkout-fixture";
import {refundWalletSale} from "../../src/lib/wallet/refunds";
import {reverseWalletTopUp} from "../../src/lib/wallet/reversals";
const db=walletTestDatabase();after(()=>db.$disconnect());
for(const mode of ["same-key","over-limit","two-halves"] as const) test(`Wallet concurrent refund ${mode} preserves source cap and ledger`,async()=>{
 const h=await checkoutHarness();try{
  const f=await checkoutFixture(db);await h.login(db,f);const sale=await h.action.completeCashierSaleAction(f.form);assert.equal(sale.status,"success",sale.message);
  const payment=await db.payment.findFirstOrThrow({where:{invoiceId:sale.invoice!.id}});
  const input={operationKey:randomUUID(),invoiceId:sale.invoice!.id,reason:"Concurrent synthetic refund",stockLines:[],legs:[{paymentId:payment.id,method:"MEMBER_WALLET" as const,amountCents:mode==="two-halves"?2000:3000}]};
  const results=await Promise.allSettled([refundWalletSale(f.ctx,input,db),refundWalletSale(f.ctx,{...input,operationKey:mode==="same-key"?input.operationKey:randomUUID()},db)]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,mode==="over-limit"?1:2);
  const expected=mode==="two-halves"?4000:3000;
  const refunds=await db.paymentRefund.findMany({where:{paymentId:payment.id}});assert.equal(refunds.reduce((n,r)=>n+Number(r.amount)*100,0),expected);
  const entries=await db.walletTransaction.findMany({where:{businessId:f.business.id},orderBy:{sequence:"asc"}});
  const account=await db.walletAccount.findFirstOrThrow({where:{businessId:f.business.id}});
  assert.equal(account.version,entries.length);assert.equal(Number(account.paidBalance)+Number(account.bonusBalance),40+expected/100);
  assert.deepEqual(entries.map(e=>e.sequence),entries.map((_,i)=>i+1));
  const top=await db.walletTopUp.findFirstOrThrow({where:{businessId:f.business.id}});
  await assert.rejects(reverseWalletTopUp(f.ctx,{operationKey:randomUUID(),topUpId:top.id,reason:"Already consumed"},db),/TOP_UP_ALREADY_CONSUMED/);
 }finally{await h.close();}
});
for(const [model,method] of [["paymentRefund","create"],["walletAccount","updateMany"],["walletTransaction","create"],["creditNote","create"],["inventoryMovement","create"],["loyaltyTransaction","create"],["performanceReceipt","create"],["auditLog","create"]]) test(`Wallet refund rollback after ${model}.${method}`,async()=>{
 const prior=process.env.TETAMU_PERFORMANCE_PHASE1;process.env.TETAMU_PERFORMANCE_PHASE1="true";
 const h=await checkoutHarness(db);try{
  const f=await checkoutFixture(db,"CASH");await h.login(db,f);
  await db.businessModuleEntitlement.create({data:{businessId:f.business.id,moduleKey:"INVENTORY",status:"ENABLED",source:"MANUAL",enabledFrom:new Date(0)}});
  await db.product.update({where:{id:f.product.id},data:{trackInventory:true}});
  await db.productStock.create({data:{businessId:f.business.id,branchId:f.branch.id,productId:f.product.id,quantity:10}});
  await db.loyaltyProgram.create({data:{businessId:f.business.id,enabled:true,pointsPerRinggit:1}});
  const sale=await h.action.completeCashierSaleAction(f.form);assert.equal(sale.status,"success",sale.message);
  const payments=await db.payment.findMany({where:{invoiceId:sale.invoice!.id}}),item=await db.invoiceItem.findFirstOrThrow({where:{invoiceId:sale.invoice!.id}});
  const snapshot=async()=>JSON.stringify(await Promise.all([
   // PostgreSQL does not promise row order without ORDER BY. Compare every field
   // in a stable order, including after aborted writes change heap/query plans.
   db.walletAccount.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}}),db.walletTransaction.findMany({where:{businessId:f.business.id},orderBy:{sequence:"asc"}}),db.paymentRefund.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}}),
   db.invoice.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}}),db.creditNote.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}}),db.productStock.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}}),
   db.inventoryMovement.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}}),db.inventoryRefundLine.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}}),db.auditLog.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}}),
   db.customerMembership.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}}),db.loyaltyTransaction.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}}),db.performanceReceipt.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}}),db.financialOperation.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}})]),(_key,value)=>typeof value==="bigint"?{bigint:value.toString()}:value);
  const before=await snapshot(),form=new FormData();form.set("businessId",f.business.id);form.set("invoiceId",sale.invoice!.id);form.set("operationKey",randomUUID());form.set("reason","Synthetic atomicity");
  form.set("legs",JSON.stringify(payments.map(p=>({paymentId:p.id,method:p.method,amountCents:Number(p.amount)*100}))));form.set("stockLines",JSON.stringify([{invoiceItemId:item.id,quantity:1,disposition:"RESTOCK"}]));
  h.failAfter(model,method);const result=await h.invoices.refundWalletSaleAction({status:"idle",message:""},form);
  assert.equal(result.status,"error",result.message);assert.match(result.message,/P1C_INJECTED/);assert.equal(h.injections(),1);assert.equal(await snapshot(),before);
 }finally{await h.close();if(prior===undefined)delete process.env.TETAMU_PERFORMANCE_PHASE1;else process.env.TETAMU_PERFORMANCE_PHASE1=prior;}
});
