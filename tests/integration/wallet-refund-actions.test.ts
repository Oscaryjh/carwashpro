import { setWalletModule } from "../helpers/wallet-fixture";
import assert from "node:assert/strict";
import test,{after} from "node:test";
import {randomUUID} from "node:crypto";
import {walletTestDatabase} from "../helpers/wallet-fixture";
import {checkoutFixture,checkoutHarness} from "../helpers/wallet-checkout-fixture";
const db=walletTestDatabase(); after(()=>db.$disconnect());

test("consumed top-up action is a definitive business rejection without writes, not an unknown result",async()=>{
 const h=await checkoutHarness(db);try{
  const f=await checkoutFixture(db);await h.login(db,f);const sale=await h.action.completeCashierSaleAction(f.form);assert.equal(sale.status,"success",sale.message);
  await db.cashierShift.update({where:{id:f.shift.id},data:{status:"CLOSED"}});
  const top=await db.walletTopUp.findFirstOrThrow({where:{businessId:f.business.id}});
  const snapshot=async()=>JSON.stringify(await Promise.all([db.walletAccount.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}}),db.walletTransaction.findMany({where:{businessId:f.business.id},orderBy:{sequence:"asc"}}),db.paymentRefund.count({where:{businessId:f.business.id}}),db.walletTopUpReversal.count({where:{businessId:f.business.id}}),db.financialOperation.count({where:{businessId:f.business.id}})]));
  const before=await snapshot(),form=new FormData();for(const[k,v]of Object.entries({businessId:f.business.id,topUpId:top.id,operationKey:randomUUID(),reason:"Used top-up rejection",externalRefundReference:""}))form.set(k,v);
  const result=await h.wallet.reverseWalletTopUpAction(form);
  assert.equal(result.ok,false);if(!result.ok){assert.equal(result.code,"TOP_UP_ALREADY_CONSUMED");assert.equal(result.uncertain,false);assert.equal((result as {canCorrect?:boolean}).canCorrect,true);assert.equal(result.message,"This top-up cannot be reversed because the wallet has already been used.");}
  assert.equal(await snapshot(),before);
 }finally{await h.close();}
});
test("closed release gate rejects sensitive recovery context and all writes",async()=>{
 const h=await checkoutHarness(db);try{
  const f=await checkoutFixture(db);await h.login(db,f);const top=await db.walletTopUp.findFirstOrThrow({where:{businessId:f.business.id}});
  await setWalletModule(db, f.business.id, false);
  const options=await h.wallet.walletRefundOptionsAction(top.id,"top-up");assert.equal(options.ok,false);if(!options.ok){assert.equal(options.code,"WALLET_UNAVAILABLE");assert.equal(options.uncertain,false);}
  const form=new FormData();for(const[k,v]of Object.entries({businessId:f.business.id,topUpId:top.id,operationKey:randomUUID(),reason:"Protected reversal",externalRefundReference:""}))form.set(k,v);
  assert.equal((await h.wallet.reverseWalletTopUpAction(form)).ok,false);assert.equal(await db.paymentRefund.count({where:{businessId:f.business.id}}),0);
  await db.user.update({where:{id:f.actor.id},data:{role:"STAFF",permissions:["CRM","POS"]}});assert.equal((await h.wallet.walletRefundOptionsAction(top.id,"top-up")).ok,false);
 }finally{await h.close();}
});
test("authenticated top-up reversal without shift and source DTO are Owner-only",async()=>{
 const h=await checkoutHarness(db);try{
  const f=await checkoutFixture(db);await h.login(db,f);const top=await db.walletTopUp.findFirstOrThrow({where:{businessId:f.business.id}});
  await db.cashierShift.update({where:{id:f.shift.id},data:{status:"CLOSED"}});
  const options=await h.wallet.walletRefundOptionsAction(top.id,"top-up");assert.equal(options.ok,true);if(options.ok){assert.equal(options.data.paidAmount,"50.00");assert.equal(options.data.bonusAmount,"30.00");}
  const form=new FormData();for(const [k,v]of Object.entries({businessId:f.business.id,topUpId:top.id,operationKey:randomUUID(),reason:"Authenticated cancellation",externalRefundReference:""}))form.set(k,v);
  assert.equal((await h.wallet.reverseWalletTopUpAction(form)).ok,true);assert.equal((await h.wallet.reverseWalletTopUpAction(form)).ok,true);
  assert.equal(await db.paymentRefund.count({where:{businessId:f.business.id}}),1);
  await db.user.update({where:{id:f.actor.id},data:{role:"STAFF",permissions:["CRM","POS"]}});
  assert.equal((await h.wallet.walletRefundOptionsAction(top.id,"top-up")).ok,false);assert.equal((await h.wallet.reverseWalletTopUpAction(form)).ok,false);
 }finally{await h.close();}
});
for(const model of ["paymentRefund","walletTopUpReversal","walletTransaction","auditLog"]) test(`top-up reversal rollback after ${model}`,async()=>{
 const h=await checkoutHarness(db);try{
  const f=await checkoutFixture(db);await h.login(db,f);const top=await db.walletTopUp.findFirstOrThrow({where:{businessId:f.business.id}});
  const snapshot=async()=>JSON.stringify(await Promise.all([db.walletAccount.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}}),db.walletTransaction.findMany({where:{businessId:f.business.id},orderBy:{sequence:"asc"}}),db.paymentRefund.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}}),db.walletTopUpReversal.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}}),db.auditLog.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}}),db.financialOperation.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}})]));const before=await snapshot();
  const form=new FormData();for(const [k,v]of Object.entries({businessId:f.business.id,topUpId:top.id,operationKey:randomUUID(),reason:"Rollback cancellation",externalRefundReference:""}))form.set(k,v);
  h.failAfter(model,"create");const result=await h.wallet.reverseWalletTopUpAction(form);assert.equal(result.ok,false);if(!result.ok)assert.equal(result.uncertain,true,"unclassified failures must retain pending confirmation");assert.equal(h.injections(),1);assert.equal(await snapshot(),before);
 }finally{await h.close();}
});
test("ordinary cash refund still requires a shift, and split invoice old endpoint is denied",async()=>{
 const h=await checkoutHarness(db);try{
  const f=await checkoutFixture(db,"CASH");await h.login(db,f);f.form.delete("walletAmount");
  const sale=await h.action.completeCashierSaleAction(f.form);assert.equal(sale.status,"success",sale.message);
  const payment=await db.payment.findFirstOrThrow({where:{invoiceId:sale.invoice!.id}});
  await db.cashierShift.update({where:{id:f.shift.id},data:{status:"CLOSED"}});
  const form=new FormData();for(const [k,v] of Object.entries({invoiceId:sale.invoice!.id,paymentId:payment.id,operationId:randomUUID(),amount:"1",method:"CASH",reference:"",reason:"Synthetic ordinary refund"}))form.set(k,v);
  const result=await h.invoices.refundPaymentAction({status:"idle",message:""},form);assert.equal(result.status,"error");assert.match(result.message,/shift/i);assert.equal(await db.paymentRefund.count({where:{businessId:f.business.id}}),0);
 }finally{await h.close();}
});
test("authenticated no-shift split refund is atomic, scoped, replay-safe; old endpoint cannot bypass Wallet protection",async()=>{
 const h=await checkoutHarness(db); try {
  const f=await checkoutFixture(db,"CASH");await h.login(db,f);
  const sale=await h.action.completeCashierSaleAction(f.form);assert.equal(sale.status,"success",sale.message);
  const payments=await db.payment.findMany({where:{invoiceId:sale.invoice!.id}});
  const form=new FormData();form.set("businessId",f.business.id);form.set("invoiceId",sale.invoice!.id);form.set("operationKey",randomUUID());form.set("reason","Synthetic split refund");
  form.set("legs",JSON.stringify(payments.map(p=>({paymentId:p.id,amountCents:Number(p.amount)*100,method:p.method}))));form.set("stockLines","[]");
  await db.cashierShift.update({where:{id:f.shift.id},data:{status:"CLOSED"}});
  const action=(h.invoices as unknown as Record<string,Function>).refundWalletSaleAction;
  assert.equal(typeof action,"function","Wallet refund action must exist");
  const result=await action({status:"idle",message:""},form);assert.equal(result.status,"success",result.message);
  assert.equal((await action({status:"idle",message:""},form)).status,"success");
  assert.equal(await db.paymentRefund.count({where:{businessId:f.business.id}}),2);
  assert.equal(await db.creditNote.count({where:{businessId:f.business.id}}),2);
  assert.equal((await db.walletAccount.findFirstOrThrow({where:{businessId:f.business.id}})).bonusBalance.toFixed(2),"30.00");
  await db.user.update({where:{id:f.actor.id},data:{role:"STAFF",permissions:["POS"]}});
  const denied=await action({status:"idle",message:""},form).catch(()=>({status:"error"}));assert.equal(denied.status,"error");
  assert.equal(await db.paymentRefund.count({where:{businessId:f.business.id}}),2);
 }finally{await h.close();}
});
test("invalid no-restock reason is correctable before any refund is frozen or written",async()=>{
 const h=await checkoutHarness(db);try{
  const f=await checkoutFixture(db);await h.login(db,f);
  await db.businessModuleEntitlement.create({data:{businessId:f.business.id,moduleKey:"INVENTORY",status:"ENABLED",source:"MANUAL",enabledFrom:new Date(0)}});
  await db.product.update({where:{id:f.product.id},data:{trackInventory:true}});
  await db.productStock.create({data:{businessId:f.business.id,branchId:f.branch.id,productId:f.product.id,quantity:5}});
  const sale=await h.action.completeCashierSaleAction(f.form);assert.equal(sale.status,"success",sale.message);
  const payment=await db.payment.findFirstOrThrow({where:{invoiceId:sale.invoice!.id,method:"MEMBER_WALLET"}});
  const item=await db.invoiceItem.findFirstOrThrow({where:{invoiceId:sale.invoice!.id}});
  await db.cashierShift.update({where:{id:f.shift.id},data:{status:"CLOSED"}});
  const form=new FormData();form.set("businessId",f.business.id);form.set("invoiceId",sale.invoice!.id);form.set("operationKey",randomUUID());form.set("reason","Correctable no-restock validation");
  form.set("legs",JSON.stringify([{paymentId:payment.id,amountCents:1000,method:"MEMBER_WALLET"}]));
  form.set("stockLines",JSON.stringify([{invoiceItemId:item.id,quantity:1,disposition:"NO_RESTOCK",noRestockReason:""}]));
  const result=await h.invoices.refundWalletSaleAction({status:"idle",message:""},form);
  assert.equal(result.status,"error");assert.equal(result.canCorrect,true);assert.match(result.message,/reason/i);
  assert.equal(await db.paymentRefund.count({where:{businessId:f.business.id}}),0);
  assert.equal(await db.financialOperation.count({where:{businessId:f.business.id,operationType:"PAYMENT_REFUND"}}),0);
 }finally{await h.close();}
});
