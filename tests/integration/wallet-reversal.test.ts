import assert from "node:assert/strict";
import test,{after} from "node:test";
import {randomUUID} from "node:crypto";
import {walletTestDatabase,walletFixture} from "../helpers/wallet-fixture";
import {postWalletTopUp} from "../../src/lib/wallet/top-up";
import {reverseWalletTopUp} from "../../src/lib/wallet/reversals";
import {checkoutFixture,checkoutHarness} from "../helpers/wallet-checkout-fixture";
const db=walletTestDatabase(); after(()=>db.$disconnect());
test("zero bonus reversal uses original snapshot after offer edit; foreign/Staff/gate denied",async()=>{
 const f=await walletFixture(db,"25","0"),top=await postWalletTopUp(f.ctx,f.input,db),foreign=await walletFixture(db);
 const input={operationKey:randomUUID(),topUpId:top.topUpId,reason:"Original offer snapshot"};
 await assert.rejects(reverseWalletTopUp(foreign.ctx,input,db));
 await db.user.update({where:{id:f.actor.id},data:{role:"STAFF"}});await assert.rejects(reverseWalletTopUp(f.ctx,input,db),/owner/i);await db.user.update({where:{id:f.actor.id},data:{role:"BUSINESS_OWNER"}});
 await db.walletTopUpOffer.update({where:{id:f.offer.id},data:{paidAmount:999,bonusAmount:999,version:{increment:1}}});
 const result=await reverseWalletTopUp(f.ctx,input,db);assert.equal((await db.paymentRefund.findUniqueOrThrow({where:{id:result.externalRefundId}})).amount.toFixed(2),"25.00");
 assert.equal(await db.walletTransaction.count({where:{businessId:f.business.id,type:"REVERSAL"}}),1);
 const gate=process.env.TETAMU_WALLET_LOCAL_TEST;try{process.env.TETAMU_WALLET_LOCAL_TEST="false";await assert.rejects(reverseWalletTopUp(f.ctx,input,db),/Member Wallet is not enabled for this business\./);}finally{process.env.TETAMU_WALLET_LOCAL_TEST=gate;}
});
test("concurrent reversal and consumption have only one legal winner",async()=>{
 const h=await checkoutHarness();try{
  const f=await checkoutFixture(db);await h.login(db,f);const top=await db.walletTopUp.findFirstOrThrow({where:{businessId:f.business.id}});
  const [reversal,sale]=await Promise.all([reverseWalletTopUp(f.ctx,{operationKey:randomUUID(),topUpId:top.id,reason:"Concurrent cancellation"},db).then(()=>true,()=>false),h.action.completeCashierSaleAction(f.form)]);
  assert.equal(Number(reversal)+Number(sale.status==="success"),1);
  const account=await db.walletAccount.findFirstOrThrow({where:{businessId:f.business.id}});assert.equal(Number(account.paidBalance)+Number(account.bonusBalance),reversal?0:40);
 }finally{await h.close();}
});
test("unused top-up reversal without shift returns only principal and preserves immutable source",async()=>{
  const f=await walletFixture(db); const top=await postWalletTopUp(f.ctx,f.input,db);
  await db.cashierShift.update({where:{id:f.shift.id},data:{status:"CLOSED"}});
  const module=await import("../../src/lib/wallet/reversals").catch(()=>null);
  assert.ok(module?.reverseWalletTopUp,"P1D reversal service must exist");
  const input={operationKey:randomUUID(),topUpId:top.topUpId,reason:"Synthetic cancellation"};
  const result=await module.reverseWalletTopUp(f.ctx,input,db);
  assert.deepEqual(await module.reverseWalletTopUp(f.ctx,input,db),result);
  const account=await db.walletAccount.findFirstOrThrow({where:{businessId:f.business.id}});
  assert.equal(account.paidBalance.toFixed(2),"0.00"); assert.equal(account.bonusBalance.toFixed(2),"0.00");
  const refund=await db.paymentRefund.findUniqueOrThrow({where:{id:result.externalRefundId}});
  assert.equal(refund.amount.toFixed(2),"1000.00"); assert.equal(refund.shiftId,null);assert.equal(refund.invoiceId,null);
  const reversal=await db.walletTopUpReversal.findUniqueOrThrow({where:{externalRefundId:refund.id}});
  const audit=await db.auditLog.findFirstOrThrow({where:{businessId:f.business.id,entityType:"WalletTopUpReversal",entityId:reversal.id,action:"WALLET_TOP_UP_REVERSED"}});
  assert.equal((audit.metadata as {shiftId?:string|null}).shiftId,null);
  assert.equal((audit.metadata as {sourceShiftId?:string|null}).sourceShiftId,f.shift.id);
  assert.equal((await db.payment.findUniqueOrThrow({where:{id:refund.paymentId}})).status,"ACTIVE");
  assert.equal(await db.creditNote.count({where:{businessId:f.business.id}}),0);
  await assert.rejects(module.reverseWalletTopUp(f.ctx,{...input,operationKey:randomUUID()},db),/ALREADY_REVERSED/);
});
