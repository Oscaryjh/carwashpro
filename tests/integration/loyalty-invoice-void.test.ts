import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase } from "../helpers/wallet-fixture";
import { checkoutFixture, checkoutHarness } from "../helpers/wallet-checkout-fixture";

assert.equal(process.env.TETAMU_WALLET_LOCAL_TEST,"true","Disposable runner required");
const db=walletTestDatabase();
process.env.TETAMU_PERFORMANCE_PHASE1="true";
after(()=>db.$disconnect());
type Harness=Awaited<ReturnType<typeof checkoutHarness>>;
async function sale(h:Harness,{redeem=500,earn=true,wallet=false,voucher=false}:{redeem?:number;earn?:boolean;wallet?:boolean;voucher?:boolean}={}) {
  const f=await checkoutFixture(db,"CASH");
  await h.login(db,f);
  await db.loyaltyProgram.create({data:{businessId:f.business.id,enabled:true,pointsPerRinggit:earn?1:0,redemptionEnabled:true,redemptionPointsPerRinggit:100,minimumRedemptionPoints:1}});
  const member=await db.customerMembership.create({data:{businessId:f.business.id,customerId:f.customer.id,pointsBalance:1000}});
  const service=await db.service.create({data:{businessId:f.business.id,name:"VOID disposable service",price:redeem?95:90,taxable:false}});
  const visit=await db.appointment.create({data:{businessId:f.business.id,branchId:f.branch.id,customerId:f.customer.id,assignedStaffId:f.actor.id,serviceId:service.id,serviceIds:[service.id],scheduledAt:new Date(),status:"COMPLETED"}});
  f.form.delete("productId");f.form.delete("productQuantity");f.form.set("serviceId",service.id);f.form.set("serviceQuantity",voucher?"2":"1");f.form.set("appointmentId",visit.id);f.form.set("assignedStaffId",f.actor.id);f.form.set("walletAmount",wallet?"45":"0");f.form.set("loyaltyPoints",String(redeem));
  f.form.set("performanceAttribution",JSON.stringify({version:1,sales:[],unassignedReason:"Disposable VOID validation"}));
  let packageId:string|undefined;
  if(voucher){
    const pkg=await db.package.create({data:{businessId:f.business.id,name:"VOID service package",serviceId:service.id,price:190,totalUses:5}});
    const cp=await db.customerPackage.create({data:{businessId:f.business.id,customerId:f.customer.id,branchId:f.branch.id,packageId:pkg.id,purchasePrice:190,totalUses:5,remainingUses:5,status:"ACTIVE"}});
    const balance=await db.customerPackageServiceBalance.create({data:{businessId:f.business.id,customerPackageId:cp.id,serviceId:service.id,totalUses:5,remainingUses:5}});
    packageId=cp.id;f.form.append("customerPackageId",balance.id);
  }
  const result=await h.action.completeCashierSaleAction(f.form);assert.equal(result.status,"success",result.message);
  const invoiceId=result.invoice!.id;
  const form=new FormData();form.set("invoiceId",invoiceId);form.set("operationId",randomUUID());form.set("voidReason","Disposable Loyalty VOID correction");
  return {...f,member,invoiceId,form,packageId};
}
async function snapshot(businessId:string){
  const where={businessId},orderBy={id:"asc" as const};
  return JSON.stringify(await Promise.all([
    db.invoice.findMany({where,orderBy}),db.payment.findMany({where,orderBy}),db.customerMembership.findMany({where,orderBy}),db.loyaltyTransaction.findMany({where,orderBy}),db.walletAccount.findMany({where,orderBy}),db.walletTransaction.findMany({where,orderBy}),db.customerPackage.findMany({where,orderBy}),db.customerPackageServiceBalance.findMany({where,orderBy}),db.inventoryMovement.findMany({where,orderBy}),db.performanceReceipt.findMany({where,orderBy}),db.auditLog.findMany({where,orderBy}),db.financialOperation.findMany({where,orderBy}),db.workOrder.findMany({where,orderBy}),
  ]),(_key,value)=>typeof value==="bigint"?value.toString():value);
}
for(const mode of ["both","earn","redeem","none","wallet","voucher","changed-settings","spent-balance"]){
  test(`VOID compensates original loyalty once: ${mode}`,async()=>{
    const h=await checkoutHarness(db);try{
      const redeem=["earn","none"].includes(mode)?0:500,earn=!["redeem","none"].includes(mode);
      const f=await sale(h,{redeem,earn,wallet:mode==="wallet",voucher:mode==="voucher"});
      const original=await db.loyaltyTransaction.findMany({where:{businessId:f.business.id}});
      assert.equal(original.filter(r=>r.type==="REDEEM").reduce((n,r)=>n+r.points,0),redeem?-500:0);
      assert.equal(original.filter(r=>r.type==="EARN").reduce((n,r)=>n+r.points,0),earn?90:0);
      if(mode==="changed-settings") await db.loyaltyProgram.update({where:{businessId:f.business.id},data:{enabled:false,pointsPerRinggit:99,redemptionPointsPerRinggit:7,minimumRedemptionPoints:9999}});
      if(mode==="spent-balance") await db.customerMembership.update({where:{id:f.member.id},data:{pointsBalance:0}});
      const result=await h.invoices.voidInvoiceAction({status:"idle",message:""},f.form);assert.equal(result.status,"success",result.message);
      const facts=await db.loyaltyTransaction.findMany({where:{businessId:f.business.id}});
      const restored=facts.filter(r=>r.type==="REDEMPTION_REFUND"),reversed=facts.filter(r=>r.type==="REFUND_REVERSAL");
      assert.equal(restored.reduce((n,r)=>n+r.points,0),redeem);
      assert.equal(reversed.reduce((n,r)=>n+r.points,0),earn?-90:0);
      assert.equal((await db.customerMembership.findUniqueOrThrow({where:{id:f.member.id}})).pointsBalance,mode==="spent-balance"?410:1000);
      const payments=await db.payment.findMany({where:{invoiceId:f.invoiceId}});
      for(const row of [...restored,...reversed]){assert.equal(row.membershipId,f.member.id);assert.equal(row.customerId,f.customer.id);assert.ok(payments.some(p=>p.id===row.paymentId));assert.equal(row.refundId,null);}
      assert.ok(payments.every(p=>p.status==="VOID"));
      assert.equal((await db.invoice.findUniqueOrThrow({where:{id:f.invoiceId}})).status,"VOID");
      if(mode==="wallet"){const account=await db.walletAccount.findFirstOrThrow({where:{businessId:f.business.id}});assert.equal(account.paidBalance.toFixed(2),"50.00");assert.equal(account.bonusBalance.toFixed(2),"30.00");}
      if(f.packageId) assert.equal((await db.customerPackage.findUniqueOrThrow({where:{id:f.packageId}})).remainingUses,5);
      if(redeem||earn){const audit=await db.auditLog.findFirstOrThrow({where:{businessId:f.business.id,entityId:f.invoiceId,action:"LOYALTY_INVOICE_VOID_COMPENSATED"}});const meta=audit.metadata as {operationId:string;transactionIds:string[]};const operation=await db.financialOperation.findUniqueOrThrow({where:{id:meta.operationId}});assert.equal(operation.operationKey,f.form.get("operationId"));assert.equal(operation.state,"COMPLETED");assert.deepEqual([...meta.transactionIds].sort(),[...restored,...reversed].map(r=>r.id).sort());}
      const after=await snapshot(f.business.id);assert.equal((await h.invoices.voidInvoiceAction({status:"idle",message:""},f.form)).status,"success");assert.equal(await snapshot(f.business.id),after);
    }finally{await h.close();}
  });
}
for(const wallet of [false,true])for(const failure of [1,2])test(`VOID rollback after loyalty row ${failure}, wallet=${wallet}`,async()=>{
  const h=await checkoutHarness(db);try{const f=await sale(h,{wallet,voucher:!wallet});const before=await snapshot(f.business.id);h.failAfter("loyaltyTransaction","create",failure);const result=await h.invoices.voidInvoiceAction({status:"idle",message:""},f.form);assert.equal(result.status,"error");assert.match(result.message,/P1C_INJECTED/);assert.equal(h.injections(),1);assert.equal(await snapshot(f.business.id),before);}finally{await h.close();}
});
test("legacy work-order invoice with null customerId compensates its original payment ledger",async()=>{
  const h=await checkoutHarness(db);try{
    const f=await sale(h);
    const vehicle=await db.vehicle.create({data:{businessId:f.business.id,customerId:f.customer.id,plateNumber:randomUUID(),size:"SMALL"}});
    const order=await db.workOrder.create({data:{businessId:f.business.id,branchId:f.branch.id,customerId:f.customer.id,vehicleId:vehicle.id,orderNumber:randomUUID(),subtotal:95,total:90,paidAmount:90,balance:0,status:"COMPLETED",paymentStatus:"PAID"}});
    await db.invoice.update({where:{id:f.invoiceId},data:{appointmentId:null,workOrderId:order.id,customerId:null}});
    await db.payment.updateMany({where:{invoiceId:f.invoiceId},data:{invoiceId:null,appointmentId:null,workOrderId:order.id}});
    const result=await h.invoices.voidInvoiceAction({status:"idle",message:""},f.form);assert.equal(result.status,"success",result.message);
    assert.equal((await db.customerMembership.findUniqueOrThrow({where:{id:f.member.id}})).pointsBalance,1000);
    assert.equal((await db.workOrder.findUniqueOrThrow({where:{id:order.id}})).paymentStatus,"UNPAID");
    assert.equal(await db.loyaltyTransaction.count({where:{businessId:f.business.id,type:{in:["REDEMPTION_REFUND","REFUND_REVERSAL"]}}}),2);
  }finally{await h.close();}
});
for(const invalid of ["missing-redeem","prior-compensation","standalone","prior-refund"])test(`VOID rejects ${invalid} without financial mutation`,async()=>{
  const h=await checkoutHarness(db);try{
    const f=await sale(h);const payment=await db.payment.findFirstOrThrow({where:{invoiceId:f.invoiceId}});
    if(invalid==="missing-redeem")await db.loyaltyTransaction.deleteMany({where:{businessId:f.business.id,type:"REDEEM"}});
    if(invalid==="prior-compensation")await db.loyaltyTransaction.create({data:{businessId:f.business.id,membershipId:f.member.id,customerId:f.customer.id,paymentId:payment.id,type:"REDEMPTION_REFUND",points:500,description:"Disposable malformed compensation"}});
    if(invalid==="standalone")await db.invoice.update({where:{id:f.invoiceId},data:{appointmentId:null}});
    if(invalid==="prior-refund")await db.paymentRefund.create({data:{businessId:f.business.id,branchId:f.branch.id,invoiceId:f.invoiceId,paymentId:payment.id,amount:1,method:"CASH",reason:"Disposable prior refund",processedById:f.actor.id}});
    const before=await snapshot(f.business.id);const result=await h.invoices.voidInvoiceAction({status:"idle",message:""},f.form);assert.equal(result.status,"error");assert.equal(await snapshot(f.business.id),before);
  }finally{await h.close();}
});
test("existing database uniqueness rejects duplicate EARN evidence without mutation",async()=>{
  const h=await checkoutHarness(db);try{
    const f=await sale(h);const payment=await db.payment.findFirstOrThrow({where:{invoiceId:f.invoiceId}});const before=await snapshot(f.business.id);
    await assert.rejects(db.loyaltyTransaction.create({data:{businessId:f.business.id,membershipId:f.member.id,customerId:f.customer.id,paymentId:payment.id,type:"EARN",points:90,description:"Disposable duplicate evidence"}}),{code:"P2002"});
    assert.equal(await snapshot(f.business.id),before);
  }finally{await h.close();}
});
test("VOID rollback after membership net update retains source graph",async()=>{
  const h=await checkoutHarness(db);try{
    const f=await sale(h,{wallet:true});const before=await snapshot(f.business.id);h.failAfter("customerMembership","updateMany");const result=await h.invoices.voidInvoiceAction({status:"idle",message:""},f.form);assert.equal(result.status,"error");assert.match(result.message,/P1C_INJECTED/);assert.equal(h.injections(),1);assert.equal(await snapshot(f.business.id),before);
  }finally{await h.close();}
});
test("VOID audit retains every ledger/operation link across more than 50 payment facts",async()=>{
  const h=await checkoutHarness(db);try{
    const f=await sale(h,{redeem:0});
    // Model a historical invoice settled in ninety separate RM1 installments.
    const original=await db.payment.findFirstOrThrow({where:{invoiceId:f.invoiceId}});
    await db.loyaltyTransaction.deleteMany({where:{businessId:f.business.id}});
    await db.payment.update({where:{id:original.id},data:{amount:1}});
    const ids=[original.id,...Array.from({length:89},()=>randomUUID())];
    await db.payment.createMany({data:ids.slice(1).map(id=>({id,businessId:f.business.id,branchId:f.branch.id,invoiceId:f.invoiceId,appointmentId:original.appointmentId,method:"CASH" as const,amount:1,status:"ACTIVE" as const}))});
    await db.loyaltyTransaction.createMany({data:ids.map(paymentId=>({businessId:f.business.id,customerId:f.customer.id,membershipId:f.member.id,paymentId,type:"EARN" as const,points:1,description:"Historical installment points"}))});
    const result=await h.invoices.voidInvoiceAction({status:"idle",message:""},f.form);assert.equal(result.status,"success",result.message);
    const audits=await db.auditLog.findMany({where:{businessId:f.business.id,entityId:f.invoiceId,action:"LOYALTY_INVOICE_VOID_COMPENSATED"}});
    const linked=audits.flatMap(row=>(row.metadata as {transactionIds:string[]}).transactionIds);
    const rows=await db.loyaltyTransaction.findMany({where:{businessId:f.business.id,type:"REFUND_REVERSAL"}});
    assert.equal(rows.length,90);assert.equal(linked.length,90);assert.deepEqual(linked.sort(),rows.map(r=>r.id).sort());
    const originals=await db.loyaltyTransaction.findMany({where:{businessId:f.business.id,type:"EARN"}});
    const metadata=audits.map(row=>row.metadata as {operationId:string;sourceTransactionIds:string[];batchCount:number;batchIndex:number});
    assert.deepEqual(metadata.flatMap(row=>row.sourceTransactionIds).sort(),originals.map(row=>row.id).sort());
    assert.equal(new Set(metadata.map(row=>row.operationId)).size,1);assert.ok(metadata.every(row=>row.batchCount===2));assert.deepEqual(metadata.map(row=>row.batchIndex).sort(),[0,1]);
    assert.equal((await db.customerMembership.findUniqueOrThrow({where:{id:f.member.id}})).pointsBalance,1000);
  }finally{await h.close();}
});
for(const model of ["invoice","auditLog"])test(`failure after ${model} write rolls back completed loyalty compensation`,async()=>{
  const h=await checkoutHarness(db);try{const f=await sale(h,{voucher:true});const before=await snapshot(f.business.id);h.failAfter(model,model==="invoice"?"update":"create");const result=await h.invoices.voidInvoiceAction({status:"idle",message:""},f.form);assert.equal(result.status,"error");assert.match(result.message,/P1C_INJECTED/);assert.equal(await snapshot(f.business.id),before);}finally{await h.close();}
});
for(const sameKey of [true,false])test(`concurrent VOID compensates once, same key=${sameKey}`,async()=>{
  const h=await checkoutHarness(db);try{const f=await sale(h,{wallet:true});const other=new FormData();for(const [k,v]of f.form)other.append(k,v);if(!sameKey)other.set("operationId",randomUUID());
    const results=await Promise.all([h.invoices.voidInvoiceAction({status:"idle",message:""},f.form),h.invoices.voidInvoiceAction({status:"idle",message:""},other)]);
    assert.equal(results.filter(r=>r.status==="success").length,sameKey?2:1);
    assert.equal((await db.customerMembership.findUniqueOrThrow({where:{id:f.member.id}})).pointsBalance,1000);
    const facts=await db.loyaltyTransaction.findMany({where:{businessId:f.business.id}});assert.equal(facts.filter(r=>r.type==="REDEMPTION_REFUND").reduce((n,r)=>n+r.points,0),500);assert.equal(facts.filter(r=>r.type==="REFUND_REVERSAL").reduce((n,r)=>n+r.points,0),-90);
    assert.equal(await db.walletTransaction.count({where:{businessId:f.business.id,type:"REVERSAL"}}),1);
  }finally{await h.close();}
});
