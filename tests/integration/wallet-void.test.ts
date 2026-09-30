import assert from "node:assert/strict";
import test,{after} from "node:test";
import {randomUUID} from "node:crypto";
import {walletTestDatabase} from "../helpers/wallet-fixture";
import {checkoutFixture,checkoutHarness} from "../helpers/wallet-checkout-fixture";
import {refundWalletSale} from "../../src/lib/wallet/refunds";
const db=walletTestDatabase(); after(()=>db.$disconnect());
async function serviceSale(h:Awaited<ReturnType<typeof checkoutHarness>>){
 const f=await checkoutFixture(db);await h.login(db,f);
 const service=await db.service.create({data:{businessId:f.business.id,name:"Synthetic service",price:40,taxable:false}});
 const visit=await db.appointment.create({data:{businessId:f.business.id,branchId:f.branch.id,customerId:f.customer.id,assignedStaffId:f.actor.id,serviceId:service.id,serviceIds:[service.id],scheduledAt:new Date(),status:"COMPLETED"}});
 f.form.delete("productId");f.form.delete("productQuantity");f.form.set("serviceId",service.id);f.form.set("serviceQuantity","1");f.form.set("appointmentId",visit.id);f.form.set("assignedStaffId",f.actor.id);
 const sale=await h.action.completeCashierSaleAction(f.form);assert.equal(sale.status,"success",sale.message);
 const form=new FormData();form.set("invoiceId",sale.invoice!.id);form.set("operationId",randomUUID());form.set("voidReason","Synthetic correction");return{f,sale,form};
}
test("refund versus void cannot restore Wallet twice",async()=>{
 const h=await checkoutHarness();try{
  const {f,sale,form}=await serviceSale(h),payment=await db.payment.findFirstOrThrow({where:{invoiceId:sale.invoice!.id}});
  const [refund,voided]=await Promise.all([refundWalletSale(f.ctx,{operationKey:randomUUID(),invoiceId:sale.invoice!.id,reason:"Concurrent correction",stockLines:[],legs:[{paymentId:payment.id,method:"MEMBER_WALLET",amountCents:4000}]},db).then(()=>true,()=>false),h.invoices.voidInvoiceAction({status:"idle",message:""},form)]);
  assert.equal(Number(refund)+Number(voided.status==="success"),1);
  const account=await db.walletAccount.findFirstOrThrow({where:{businessId:f.business.id}});assert.equal(account.paidBalance.toFixed(2),"50.00");assert.equal(account.bonusBalance.toFixed(2),"30.00");
  assert.equal(await db.walletTransaction.count({where:{businessId:f.business.id,type:{in:["REFUND","REVERSAL"]}}}),1);
 }finally{await h.close();}
});
for(const [model,method]of [["walletAccount","updateMany"],["walletTransaction","create"],["payment","updateMany"],["invoice","update"],["auditLog","create"]])test(`void rollback after ${model}.${method}`,async()=>{
 const h=await checkoutHarness(db);try{
  const {f,form}=await serviceSale(h);const snapshot=async()=>JSON.stringify(await Promise.all([db.walletAccount.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}}),db.walletTransaction.findMany({where:{businessId:f.business.id},orderBy:{sequence:"asc"}}),db.invoice.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}}),db.payment.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}}),db.auditLog.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}}),db.financialOperation.findMany({where:{businessId:f.business.id},orderBy:{id:"asc"}})]));const before=await snapshot();
  h.failAfter(model,method);const result=await h.invoices.voidInvoiceAction({status:"idle",message:""},form);assert.equal(result.status,"error");assert.match(result.message,/P1C_INJECTED/);assert.equal(h.injections(),1);assert.equal(await snapshot(),before);
 }finally{await h.close();}
});
test("existing eligible service invoice void restores wallet without a new shift",async()=>{
 const h=await checkoutHarness(); try {
  const f=await checkoutFixture(db);await h.login(db,f);
  const s=await db.service.create({data:{businessId:f.business.id,name:"P1D synthetic service",price:40,taxable:false}});
  const a=await db.appointment.create({data:{businessId:f.business.id,branchId:f.branch.id,customerId:f.customer.id,assignedStaffId:f.actor.id,serviceId:s.id,serviceIds:[s.id],scheduledAt:new Date(),status:"COMPLETED"}});
  f.form.delete("productId");f.form.delete("productQuantity");f.form.set("serviceId",s.id);f.form.set("serviceQuantity","1");f.form.set("appointmentId",a.id);f.form.set("assignedStaffId",f.actor.id);
  const sale=await h.action.completeCashierSaleAction(f.form); assert.equal(sale.status,"success",sale.message);
  await db.cashierShift.update({where:{id:f.shift.id},data:{status:"CLOSED"}});
  const form=new FormData();form.set("invoiceId",sale.invoice!.id);form.set("operationId",randomUUID());form.set("voidReason","Synthetic correction");
  const result=await h.invoices.voidInvoiceAction({status:"idle",message:""},form);assert.equal(result.status,"success",result.message);
  assert.equal((await h.invoices.voidInvoiceAction({status:"idle",message:""},form)).status,"success");
  const account=await db.walletAccount.findFirstOrThrow({where:{businessId:f.business.id}});
  assert.equal(account.paidBalance.toFixed(2),"50.00");assert.equal(account.bonusBalance.toFixed(2),"30.00");
  assert.equal(await db.walletTransaction.count({where:{businessId:f.business.id,type:"REVERSAL"}}),1);
 }finally{await h.close();}
});
