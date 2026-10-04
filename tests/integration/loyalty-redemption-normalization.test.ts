import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase } from "../helpers/wallet-fixture";
import { checkoutFixture, checkoutHarness } from "../helpers/wallet-checkout-fixture";

assert.equal(process.env.TETAMU_WALLET_LOCAL_TEST,"true","Disposable runner required");
const db=walletTestDatabase(); after(()=>db.$disconnect());
type Harness=Awaited<ReturnType<typeof checkoutHarness>>;
type Kind="cash"|"wallet"|"package"|"covered"|"service";
async function fixture(h:Harness,kind:Kind="cash",balance=1307,rate=100,minimum=100) {
  const f=await checkoutFixture(db,"CASH"); await h.login(db,f);
  await db.loyaltyProgram.create({data:{businessId:f.business.id,enabled:true,pointsPerRinggit:0,redemptionEnabled:true,redemptionPointsPerRinggit:rate,minimumRedemptionPoints:minimum}});
  const member=await db.customerMembership.create({data:{businessId:f.business.id,customerId:f.customer.id,pointsBalance:balance}});
  await db.product.update({where:{id:f.product.id},data:{price:20}});
  f.form.set("walletAmount",kind==="wallet"?"3":"0"); f.form.set("loyaltyPoints","1500");
  if(["package","covered","service"].includes(kind)) {
    const service=await db.service.create({data:{businessId:f.business.id,name:"Normalization service",price:kind==="covered"?50:20}});
    const pkg=await db.package.create({data:{businessId:f.business.id,name:"Normalization package",serviceId:service.id,price:20,totalUses:5}});
    if(kind==="package") { f.form.delete("productId");f.form.delete("productQuantity");f.form.set("packageId",pkg.id);f.form.set("packageQuantity","1"); }
    else {
      const visit=await db.appointment.create({data:{businessId:f.business.id,branchId:f.branch.id,customerId:f.customer.id,assignedStaffId:f.actor.id,serviceId:service.id,serviceIds:[service.id],scheduledAt:new Date(),status:"COMPLETED"}});
      f.form.set("serviceId",service.id);f.form.set("serviceQuantity","1");f.form.set("appointmentId",visit.id);f.form.set("assignedStaffId",f.actor.id);
      if(kind==="service") { f.form.delete("productId");f.form.delete("productQuantity"); }
      if(kind==="covered") {
        await db.product.update({where:{id:f.product.id},data:{price:10}});
        const cp=await db.customerPackage.create({data:{businessId:f.business.id,branchId:f.branch.id,customerId:f.customer.id,packageId:pkg.id,purchasePrice:20,totalUses:5,remainingUses:5,status:"ACTIVE"}});
        const benefit=await db.customerPackageServiceBalance.create({data:{businessId:f.business.id,customerPackageId:cp.id,serviceId:service.id,totalUses:5,remainingUses:5}});
        f.form.append("customerPackageId",benefit.id);
      }
    }
  }
  return {...f,member};
}
async function snapshot(businessId:string) {
  const where={businessId},orderBy={id:"asc" as const};
  return JSON.stringify(await Promise.all([db.invoice.findMany({where,orderBy}),db.payment.findMany({where,orderBy}),db.loyaltyTransaction.findMany({where,orderBy}),db.customerMembership.findMany({where,orderBy}),db.customerPackage.findMany({where,orderBy}),db.customerPackageServiceBalance.findMany({where,orderBy}),db.walletAccount.findMany({where,orderBy}),db.walletTransaction.findMany({where,orderBy}),db.financialOperation.findMany({where,orderBy}),db.auditLog.findMany({where,orderBy})]),(_key,value)=>typeof value==="bigint"?value.toString():value);
}
for(const kind of ["cash","wallet","package","covered","service"] as const) test(`server canonical redemption and replay: ${kind}`,async()=>{
  const h=await checkoutHarness(db);try{
    const f=await fixture(h,kind); const result=await h.action.completeCashierSaleAction(f.form);assert.equal(result.status,"success",result.message);
    const invoice=await db.invoice.findUniqueOrThrow({where:{id:result.invoice!.id}});
    const want=kind==="covered"?1000:1300;
    assert.equal(invoice.loyaltyPointsRedeemed,want); assert.equal(invoice.loyaltyDiscountAmount.toFixed(2),kind==="covered"?"10.00":"13.00");
    const rows=await db.loyaltyTransaction.findMany({where:{businessId:f.business.id,type:"REDEEM"}});
    assert.equal(rows.length,1);assert.equal(rows[0].points,-want);
    assert.equal((await db.customerMembership.findUniqueOrThrow({where:{id:f.member.id}})).pointsBalance,1307-want);
    if(kind==="covered")assert.equal((await db.payment.findFirstOrThrow({where:{invoiceId:invoice.id,method:"PACKAGE"}})).amount.toFixed(2),"50.00");
    const before=await snapshot(f.business.id);assert.equal((await h.action.completeCashierSaleAction(f.form)).invoice?.id,invoice.id);assert.equal(await snapshot(f.business.id),before);
  }finally{await h.close();}
});
for(const [name,balance,rate,minimum,requested,price,want] of [
  ["below block",99,100,100,1000,20,0],
  ["raw request floors",1307,100,100,550,20,500],
  ["minimum valid",550,100,500,550,20,500],
  ["order cents",1307,100,100,1500,13.8,1300],
  ["rate250",1499,250,100,2000,20,1250],
] as const)test(`server normalization boundary: ${name}`,async()=>{
  const h=await checkoutHarness(db);try{
    const f=await fixture(h,"cash",balance,rate,minimum);f.form.set("loyaltyPoints",String(requested));
    await db.product.update({where:{id:f.product.id},data:{price}});
    const result=await h.action.completeCashierSaleAction(f.form);assert.equal(result.status,"success",result.message);
    const invoice=await db.invoice.findUniqueOrThrow({where:{id:result.invoice!.id}});
    assert.equal(invoice.loyaltyPointsRedeemed,want);assert.equal(Number(invoice.loyaltyDiscountAmount),want/rate);
    assert.equal((await db.customerMembership.findUniqueOrThrow({where:{id:f.member.id}})).pointsBalance,balance-want);
    assert.equal((await db.loyaltyTransaction.aggregate({where:{businessId:f.business.id,type:"REDEEM"},_sum:{points:true}}))._sum.points??0,want===0?0:-want);
  }finally{await h.close();}
});
test("server minimum checks normalized balance cap and rejects without writes",async()=>{
  const h=await checkoutHarness(db);try{
    const f=await fixture(h,"cash",499,100,500);f.form.set("loyaltyPoints","550");const before=await snapshot(f.business.id);
    const result=await h.action.completeCashierSaleAction(f.form);assert.equal(result.status,"error");assert.match(result.message,/available points cannot/);assert.equal(await snapshot(f.business.id),before);
  }finally{await h.close();}
});
test("server re-reads current balance rather than trusting the UI snapshot or requested 1500",async()=>{
  const h=await checkoutHarness(db);try{
    const f=await fixture(h);
    h.beforeTransaction(()=>db.customerMembership.update({where:{id:f.member.id},data:{pointsBalance:707}}).then(()=>{}));
    const result=await h.action.completeCashierSaleAction(f.form);assert.equal(result.status,"success",result.message);
    assert.equal((await db.invoice.findUniqueOrThrow({where:{id:result.invoice!.id}})).loyaltyPointsRedeemed,700);
    assert.equal((await db.customerMembership.findUniqueOrThrow({where:{id:f.member.id}})).pointsBalance,7);
  }finally{await h.close();}
});
for(const kind of ["cash","wallet","package","service"] as const)test(`refund/VOID restores only original normalized 1300: ${kind}`,async()=>{
  const h=await checkoutHarness(db);try{
    const f=await fixture(h,kind);const sale=await h.action.completeCashierSaleAction(f.form);assert.equal(sale.status,"success",sale.message);
    const invoiceId=sale.invoice!.id;const payments=await db.payment.findMany({where:{invoiceId}});
    await db.loyaltyProgram.update({where:{businessId:f.business.id},data:{redemptionPointsPerRinggit:250,minimumRedemptionPoints:2000,enabled:false}});
    const form=new FormData();form.set("invoiceId",invoiceId);let result;
    if(kind==="service") { form.set("operationId",randomUUID());form.set("voidReason","Normalized redemption VOID");result=await h.invoices.voidInvoiceAction({status:"idle",message:""},form); }
    else if(kind==="wallet") { form.set("businessId",f.business.id);form.set("operationKey",randomUUID());form.set("reason","Normalized redemption refund");form.set("stockLines","[]");form.set("legs",JSON.stringify(payments.map(p=>({paymentId:p.id,method:p.method,amountCents:Number(p.amount)*100}))));result=await h.invoices.refundWalletSaleAction({status:"idle",message:""},form); }
    else { for(const [k,v]of Object.entries({operationId:randomUUID(),paymentId:payments[0].id,amount:"7",method:"CASH",reference:"",reason:"Normalized redemption refund",modeAtConfirmation:"ON",shiftId:f.shift.id}))form.set(k,v);result=await h.invoices.refundPaymentAction({status:"idle",message:""},form); }
    assert.equal(result.status,"success",result.message);
    assert.equal((await db.loyaltyTransaction.aggregate({where:{businessId:f.business.id,type:"REDEMPTION_REFUND"},_sum:{points:true}}))._sum.points,1300);
    assert.equal((await db.customerMembership.findUniqueOrThrow({where:{id:f.member.id}})).pointsBalance,1307);
  }finally{await h.close();}
});
for(const kind of ["cash","wallet","package"] as const)for(const [model,method]of [["customerMembership","updateMany"],["loyaltyTransaction","create"],["auditLog","create"]] as const)test(`normalized REDEEM rollback after ${model}: ${kind}`,async()=>{
  const h=await checkoutHarness(db);try{
    const f=await fixture(h,kind);const before=await snapshot(f.business.id);h.failAfter(model,method);
    const result=await h.action.completeCashierSaleAction(f.form);assert.equal(result.status,"error");assert.match(result.message,/P1C_INJECTED/);assert.equal(h.injections(),1);assert.equal(await snapshot(f.business.id),before);
  }finally{await h.close();}
});
