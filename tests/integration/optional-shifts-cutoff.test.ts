import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletFixture, walletTestDatabase } from "../helpers/wallet-fixture";
import { checkoutHarness } from "../helpers/wallet-checkout-fixture";
import { postWalletTopUp } from "../../src/lib/wallet/top-up";
import { reverseWalletTopUp } from "../../src/lib/wallet/reversals";
import { getBusinessDayRange, getCurrentBusinessDateValue } from "../../src/lib/business-day";
import { getDailySalesReport } from "../../src/lib/reports/daily-sales";

const db=walletTestDatabase();after(()=>db.$disconnect());
for(const mode of ["ON","OFF"] as const)for(const [instant,day,otherDay] of [
  ["2026-09-30T17:59:00.000Z","2026-09-30","2026-10-01"],
  ["2026-09-30T18:00:00.000Z","2026-10-01","2026-09-30"],
])test(`${mode} payment/refund/topup/reversal at ${instant} belongs only to ${day}`,async()=>{
  const at=new Date(instant);
  // Timestamp at INSERT, never rewrite an immutable committed fact. Auth and
  // posting execute for real with a valid current shift; readers use event time.
  const dated=db.$extends({query:{
    payment:{create({args,query}){return query({...args,data:{...args.data,paidAt:at}})}},
    invoice:{create({args,query}){return query({...args,data:{...args.data,issuedAt:at}})}},
    paymentRefund:{create({args,query}){return query({...args,data:{...args.data,refundedAt:at}})}},
    walletTopUp:{create({args,query}){return query({...args,data:{...args.data,postedAt:at}})}},
    walletTransaction:{create({args,query}){return query({...args,data:{...args.data,createdAt:at}})}},
  }}) as unknown as typeof db;
  const h=await checkoutHarness(dated);
  try{
    const f=await walletFixture(db,"100","10");
    await db.business.update({where:{id:f.business.id},data:{timezone:"Asia/Kuching",businessDayCutoffTime:"02:00",cashierShiftsEnabled:mode==="ON"}});
    if(mode==="OFF")await db.cashierShift.update({where:{id:f.shift.id},data:{status:"CLOSED"}});
    await h.login(db,f);
    const shiftId=mode==="ON"?f.shift.id:null,ctx={...f.ctx,shiftId};
    const top=await postWalletTopUp(ctx,{...f.input,modeAtConfirmation:mode,shiftId},dated);
    const product=await db.product.create({data:{businessId:f.business.id,name:"Cutoff cash",price:300}});
    const form=new FormData();for(const[k,v]of Object.entries({operationId:randomUUID(),branchId:f.branch.id,customerId:f.customer.id,productId:product.id,productQuantity:"1",method:"CASH",paymentMethodCode:"BUILTIN_CASH",walletAmount:"0",modeAtConfirmation:mode,shiftId:shiftId??""}))form.set(k,v);
    const sale=await h.action.completeCashierSaleAction(form);assert.equal(sale.status,"success",sale.message);
    const payment=await db.payment.findFirstOrThrow({where:{invoiceId:sale.invoice!.id}});
    const refund=new FormData();for(const[k,v]of Object.entries({operationId:randomUUID(),invoiceId:sale.invoice!.id,paymentId:payment.id,amount:"50",method:"CASH",reason:"Cutoff refund",reference:"",modeAtConfirmation:mode,shiftId:shiftId??""}))refund.set(k,v);
    assert.equal((await h.invoices.refundPaymentAction({status:"idle",message:""},refund)).status,"success");
    await reverseWalletTopUp(ctx,{operationKey:randomUUID(),topUpId:top.topUpId,reason:"Cutoff untouched topup"},dated);
    const payments=await db.payment.findMany({where:{businessId:f.business.id}}),refunds=await db.paymentRefund.findMany({where:{businessId:f.business.id}});
    assert.deepEqual(payments.map(p=>Number(p.amount)).sort((a,b)=>a-b),[100,300]);
    assert.deepEqual(refunds.map(r=>Number(r.amount)).sort((a,b)=>a-b),[50,100]);
    for(const p of payments){assert.equal(p.paidAt.toISOString(),instant);assert.equal(p.shiftId,shiftId);}
    for(const r of refunds)assert.equal(r.refundedAt.toISOString(),instant);
    assert.equal(getCurrentBusinessDateValue(at,"Asia/Kuching","02:00"),day);
    for(const date of [day,otherDay]){
      const range=getBusinessDayRange({fromDateValue:date,toDateValue:date,timezone:"Asia/Kuching",businessDayCutoffTime:"02:00"});
      const read=await getDailySalesReport({businessId:f.business.id,branchId:f.branch.id,range},db),included=date===day;
      assert.equal(read.summary.netSalesCents,included?25000:0);assert.equal(read.summary.grossCollectionsCents,included?40000:0);assert.equal(read.summary.netCollectionsCents,included?25000:0);
      assert.equal(read.walletActivity.topUpPrincipalCents,included?10000:0);assert.equal(read.walletActivity.reversedPrincipalCents,included?10000:0);
    }
    assert.equal(await db.dailyClosingSnapshot.count({where:{businessId:f.business.id}}),0);
  }finally{await h.close();}
});
