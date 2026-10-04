import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase } from "../helpers/wallet-fixture";
import { checkoutFixture, checkoutHarness } from "../helpers/wallet-checkout-fixture";
import { awardLoyaltyPointsForPayment, ensureCustomerMembership } from "../../src/lib/loyalty/service";

assert.equal(process.env.TETAMU_WALLET_LOCAL_TEST,"true","Disposable runner required");
const db = walletTestDatabase();
after(() => db.$disconnect());
type Harness = Awaited<ReturnType<typeof checkoutHarness>>;
type Mode = "cash" | "card" | "wallet" | "split" | "package" | "mixed" | "service";
async function fixture(h: Harness, mode: Mode, rate: string) {
  const f = await checkoutFixture(db,mode === "wallet" ? "MEMBER_WALLET" : mode === "card" ? "CARD" : "CASH");
  await h.login(db,f);
  const amount = mode === "wallet" ? 50 : 100;
  await db.loyaltyProgram.create({data:{businessId:f.business.id,enabled:true,pointsPerRinggit:rate,welcomePoints:7}});
  const member = await db.customerMembership.create({data:{businessId:f.business.id,customerId:f.customer.id,pointsBalance:0}});
  await db.product.update({where:{id:f.product.id},data:{price:amount}});
  f.form.set("walletAmount",mode === "wallet" || mode === "split" ? "50" : "0");
  if (["package","mixed","service"].includes(mode)) {
    const service = await db.service.create({data:{businessId:f.business.id,name:"Precision service",price:mode === "mixed" ? 50 : 100}});
    if (mode === "package") {
      const pkg = await db.package.create({data:{businessId:f.business.id,name:"Precision package",serviceId:service.id,price:100,totalUses:5}});
      f.form.delete("productId"); f.form.delete("productQuantity"); f.form.set("packageId",pkg.id); f.form.set("packageQuantity","1");
    } else {
      const appointment = await db.appointment.create({data:{businessId:f.business.id,branchId:f.branch.id,customerId:f.customer.id,assignedStaffId:f.actor.id,serviceId:service.id,serviceIds:[service.id],scheduledAt:new Date(),status:"COMPLETED"}});
      f.form.set("serviceId",service.id); f.form.set("serviceQuantity","1"); f.form.set("appointmentId",appointment.id); f.form.set("assignedStaffId",f.actor.id);
      if (mode === "service") { f.form.delete("productId"); f.form.delete("productQuantity"); }
      else await db.product.update({where:{id:f.product.id},data:{price:50}});
    }
  }
  return {...f,member,amount};
}
async function snapshot(businessId: string) {
  const where={businessId},orderBy={id:"asc" as const};
  return JSON.stringify(await Promise.all([
    db.invoice.findMany({where,orderBy}),db.payment.findMany({where,orderBy}),db.loyaltyTransaction.findMany({where,orderBy}),
    db.customerMembership.findMany({where,orderBy}),db.walletAccount.findMany({where,orderBy}),db.walletTransaction.findMany({where,orderBy}),
    db.customerPackage.findMany({where,orderBy}),db.customerPackageServiceBalance.findMany({where,orderBy}),
    db.financialOperation.findMany({where,orderBy}),db.auditLog.findMany({where,orderBy}),
  ]),(_key,value)=>typeof value === "bigint" ? value.toString() : value);
}
for (const [mode,rate,want] of [
  ["cash","0.29",29],["cash","1.13",113],["card","1.13",113],
  ["wallet","0.58",29],["split","0.29",29],["package","0.29",29],["mixed","0.29",29],
] as const) test(`precise ${mode} sale at ${rate}, replay retains exactly ${want} points`, async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(h,mode,rate);
    const result = await h.action.completeCashierSaleAction(f.form); assert.equal(result.status,"success",result.message);
    const payments = await db.payment.findMany({where:{invoiceId:result.invoice!.id}});
    const rows = await db.loyaltyTransaction.findMany({where:{paymentId:{in:payments.map(p=>p.id)},type:"EARN"}});
    assert.equal(rows.reduce((n,r)=>n+r.points,0),want);
    assert.equal((await db.customerMembership.findUniqueOrThrow({where:{id:f.member.id}})).pointsBalance,want);
    if (mode === "split") assert.deepEqual(rows.map(r=>r.points).sort((a,b)=>a-b),[14,15],"cumulative invoice flooring, not 14+14");
    if (mode === "package") assert.equal(await db.customerPackage.count({where:{businessId:f.business.id,status:"ACTIVE",remainingUses:5}}),1);
    const before = await snapshot(f.business.id);
    assert.equal((await h.action.completeCashierSaleAction(f.form)).invoice?.id,result.invoice!.id);
    assert.equal(await snapshot(f.business.id),before);
  } finally { await h.close(); }
});
for (const mode of ["cash","wallet","split","package","service"] as const) test(`new precise EARN is compensated from original ledger after rate change: ${mode}`, async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(h,mode,mode === "wallet" ? "0.58" : "0.29");
    const sale = await h.action.completeCashierSaleAction(f.form); assert.equal(sale.status,"success",sale.message);
    const invoiceId = sale.invoice!.id;
    const payments = await db.payment.findMany({where:{invoiceId}});
    const originals = await db.loyaltyTransaction.findMany({where:{businessId:f.business.id,type:"EARN"},orderBy:{id:"asc"}});
    assert.equal(originals.reduce((n,r)=>n+r.points,0),29);
    await db.loyaltyProgram.update({where:{businessId:f.business.id},data:{pointsPerRinggit:"1.13",enabled:false}});
    const form = new FormData(); form.set("invoiceId",invoiceId);
    let result;
    if (mode === "service") {
      form.set("operationId",randomUUID()); form.set("voidReason","Decimal precision VOID regression");
      result = await h.invoices.voidInvoiceAction({status:"idle",message:""},form);
    } else if (mode === "wallet" || mode === "split") {
      form.set("businessId",f.business.id); form.set("operationKey",randomUUID());
      form.set("reason","Decimal precision full refund"); form.set("stockLines","[]");
      form.set("legs",JSON.stringify(payments.map(p=>({paymentId:p.id,method:p.method,amountCents:Number(p.amount)*100}))));
      result = await h.invoices.refundWalletSaleAction({status:"idle",message:""},form);
    } else {
      for (const [key,value] of Object.entries({operationId:randomUUID(),paymentId:payments[0].id,amount:"100",method:"CASH",reference:"",reason:"Decimal precision full refund",modeAtConfirmation:"ON",shiftId:f.shift.id})) form.set(key,value);
      result = await h.invoices.refundPaymentAction({status:"idle",message:""},form);
    }
    assert.equal(result.status,"success",result.message);
    const reversed = await db.loyaltyTransaction.findMany({where:{businessId:f.business.id,type:"REFUND_REVERSAL"}});
    assert.equal(reversed.reduce((n,r)=>n+r.points,0),-29);
    assert.equal((await db.customerMembership.findUniqueOrThrow({where:{id:f.member.id}})).pointsBalance,0);
    assert.deepEqual(await db.loyaltyTransaction.findMany({where:{businessId:f.business.id,type:"EARN"},orderBy:{id:"asc"}}),originals);
  } finally { await h.close(); }
});
for (const mode of ["cash","wallet","split","package"] as const) for (const model of ["loyaltyTransaction","customerMembership"] as const) {
  test(`precise ${mode} EARN rolls back after ${model} write`, async () => {
    const h = await checkoutHarness(db);
    try {
      const f = await fixture(h,mode,mode === "wallet" ? "0.58" : "0.29");
      const before = await snapshot(f.business.id);
      h.failAfter(model,model === "loyaltyTransaction" ? "create" : "update");
      const result = await h.action.completeCashierSaleAction(f.form);
      assert.equal(result.status,"error"); assert.match(result.message,/P1C_INJECTED/); assert.equal(h.injections(),1);
      assert.equal(await snapshot(f.business.id),before);
    } finally { await h.close(); }
  });
}
test("external Cash/Card installments keep existing per-payment floor contract", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(h,"cash","0.29");
    await db.$transaction(async tx => {
      const invoice = await tx.invoice.create({data:{businessId:f.business.id,branchId:f.branch.id,customerId:f.customer.id,invoiceNumber:randomUUID(),subtotal:100,total:100,paidAmount:100,balance:0,status:"PAID"}});
      for (const method of ["CASH","CARD"] as const) {
        const payment = await tx.payment.create({data:{businessId:f.business.id,branchId:f.branch.id,invoiceId:invoice.id,method,amount:50,status:"ACTIVE"}});
        await awardLoyaltyPointsForPayment(tx,{businessId:f.business.id,branchId:f.branch.id,customerId:f.customer.id,paymentId:payment.id,paymentMethod:method,amountCents:5000});
      }
    });
    const rows = await db.loyaltyTransaction.findMany({where:{businessId:f.business.id,type:"EARN"}});
    assert.deepEqual(rows.map(r=>r.points),[14,14]);
    assert.equal((await db.customerMembership.findUniqueOrThrow({where:{id:f.member.id}})).pointsBalance,28);
  } finally { await h.close(); }
});
test("fixed welcome points, top-up exclusion and PACKAGE tender exclusion remain unchanged", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(h,"cash","0.29");
    const customer = await db.customer.create({data:{businessId:f.business.id,name:"Welcome precision fixture",phone:randomUUID()}});
    await db.$transaction(tx=>ensureCustomerMembership(tx,{businessId:f.business.id,customerId:customer.id}));
    const welcome = await db.loyaltyTransaction.findFirstOrThrow({where:{customerId:customer.id,type:"WELCOME_BONUS"}});
    assert.equal(welcome.points,7);
    const topup = await db.payment.findFirstOrThrow({where:{businessId:f.business.id,purpose:"WALLET_TOP_UP"}});
    const voucher = await db.payment.create({data:{businessId:f.business.id,branchId:f.branch.id,method:"PACKAGE",amount:100,status:"ACTIVE"}});
    for (const p of [topup,voucher]) await db.$transaction(tx=>awardLoyaltyPointsForPayment(tx,{businessId:f.business.id,customerId:f.customer.id,paymentId:p.id,paymentMethod:p.method,amountCents:10000}));
    assert.equal(await db.loyaltyTransaction.count({where:{businessId:f.business.id,type:"EARN"}}),0);
    assert.equal((await db.customerMembership.findUniqueOrThrow({where:{id:f.member.id}})).pointsBalance,0);
  } finally { await h.close(); }
});
