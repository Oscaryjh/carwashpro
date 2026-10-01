import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletFixture, walletTestDatabase, assertNoWalletMoney } from "../helpers/wallet-fixture";
import { checkoutFixture, checkoutHarness } from "../helpers/wallet-checkout-fixture";
import { postWalletTopUp } from "../../src/lib/wallet/top-up";
import { getWalletSummary } from "../../src/lib/wallet/read-model";
import { listWalletOffers, getWalletHistory, saveWalletOffer } from "../../src/lib/wallet/ui-adapter";
import { refundWalletSale } from "../../src/lib/wallet/refunds";
import { reverseWalletTopUp } from "../../src/lib/wallet/reversals";

const db = walletTestDatabase();
after(() => db.$disconnect());
async function pilot(ids: string, run: () => Promise<void>) {
  const values = { APP_ENVIRONMENT: "testing", RAILWAY_ENVIRONMENT_NAME: "testing", TETAMU_ENVIRONMENT: "TESTING",
    TETAMU_WALLET_TESTING_PILOT: "true", TETAMU_WALLET_TESTING_BUSINESS_IDS: ids };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { await run(); } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
const denied = (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === "WALLET_UNAVAILABLE";
test("Pilot invoice void and its completed replay require current release access",async()=>{
  const a=await checkoutFixture(db), h=await checkoutHarness(db);
  try {
    const service=await db.service.create({data:{businessId:a.business.id,name:"Pilot synthetic service",price:40,taxable:false}});
    const visit=await db.appointment.create({data:{businessId:a.business.id,branchId:a.branch.id,customerId:a.customer.id,assignedStaffId:a.actor.id,serviceId:service.id,serviceIds:[service.id],scheduledAt:new Date(),status:"COMPLETED"}});
    a.form.delete("productId"); a.form.delete("productQuantity"); a.form.set("serviceId",service.id); a.form.set("serviceQuantity","1"); a.form.set("appointmentId",visit.id); a.form.set("assignedStaffId",a.actor.id);
    await pilot(a.business.id,async()=>{
      await h.login(db,a); const sale=await h.action.completeCashierSaleAction(a.form); assert.equal(sale.status,"success",sale.message);
      const form=new FormData();form.set("invoiceId",sale.invoice!.id);form.set("operationId",randomUUID());form.set("voidReason","Pilot synthetic correction");
      process.env.TETAMU_WALLET_TESTING_PILOT="false";
      const deniedVoid=await h.invoices.voidInvoiceAction({status:"idle",message:""},form);
      assert.equal(deniedVoid.status,"error");assert.match(deniedVoid.message,/Member Wallet is not enabled/);
      assert.equal(await db.walletTransaction.count({where:{businessId:a.business.id,type:"REVERSAL"}}),0);
      process.env.TETAMU_WALLET_TESTING_PILOT="true";
      assert.equal((await h.invoices.voidInvoiceAction({status:"idle",message:""},form)).status,"success");
      assert.equal((await h.invoices.voidInvoiceAction({status:"idle",message:""},form)).status,"success");
      process.env.RAILWAY_ENVIRONMENT_NAME="production";
      assert.equal((await h.invoices.voidInvoiceAction({status:"idle",message:""},form)).status,"error");
      assert.equal(await db.walletTransaction.count({where:{businessId:a.business.id,type:"REVERSAL"}}),1);
    });
  } finally {await h.close();}
});
test("Testing pilot gates top-up, sensitive reads, and completed replay by current business and flag", async () => {
  const a = await walletFixture(db), b = await walletFixture(db);
  await pilot(a.business.id, async () => {
    const first = await postWalletTopUp(a.ctx, a.input, db);
    assert.equal((await postWalletTopUp(a.ctx, a.input, db)).topUpId, first.topUpId);
    assert.equal((await getWalletSummary(a.ctx, a.customer.id, db)).totalBalance, "1100.00");
    await assert.rejects(postWalletTopUp(b.ctx, b.input, db), denied);
    await assert.rejects(postWalletTopUp(b.ctx, {...a.input}, db), denied);
    await assert.rejects(getWalletSummary(b.ctx, b.customer.id, db), denied);
    await assert.rejects(getWalletHistory(b.ctx, b.customer.id, 0, db), denied);
    await assert.rejects(listWalletOffers(b.ctx, db), denied);
    await assert.rejects(saveWalletOffer(b.ctx, {name:"Denied",paidAmount:"1",bonusAmount:"0",active:true}, db), denied);
    await assertNoWalletMoney(db, b.business.id);
    process.env.TETAMU_WALLET_TESTING_PILOT = "false";
    await assert.rejects(postWalletTopUp(a.ctx, a.input, db), denied);
    await assert.rejects(getWalletSummary(a.ctx, a.customer.id, db), denied);
    assert.equal(await db.walletTopUp.count({where:{businessId:a.business.id}}), 1);
  });
});
test("authenticated actions cannot inject a Pilot business or replay its operation from another tenant", async () => {
  const a = await walletFixture(db), b = await walletFixture(db), h = await checkoutHarness(db);
  try { await pilot(a.business.id, async () => {
    await h.login(db,a);
    const form = new FormData(); for (const [key,value] of Object.entries(a.input)) form.set(key,String(value));
    assert.equal((await h.wallet.walletTopUpAction(form)).ok,true);
    await h.login(db,b);
    form.set("businessId",a.business.id); form.set("TETAMU_WALLET_TESTING_PILOT","true");
    const result = await h.wallet.walletTopUpAction(form);
    assert.equal(result.ok,false); if (!result.ok) { assert.equal(result.code,"WALLET_UNAVAILABLE"); assert.equal(result.uncertain,false); assert.equal(result.message,"Member Wallet is not enabled for this business."); }
    const panel = await h.wallet.walletPanelAction(a.customer.id); assert.equal(panel.ok,false);
    assert.equal(await db.walletTopUp.count({where:{businessId:a.business.id}}),1);
    await assertNoWalletMoney(db,b.business.id);
  }); } finally { await h.close(); }
});
test("Pilot checkout and refund honor allowlist before replay; ordinary Cash and Card are unaffected", async () => {
  const a = await checkoutFixture(db), b = await checkoutFixture(db), h = await checkoutHarness(db);
  try { await pilot(a.business.id,async()=>{
    await h.login(db,a);
    const sale=await h.action.completeCashierSaleAction(a.form); assert.equal(sale.status,"success",sale.message);
    const payment=await db.payment.findFirstOrThrow({where:{invoiceId:sale.invoice!.id,method:"MEMBER_WALLET"}});
    const request={operationKey:randomUUID(),invoiceId:sale.invoice!.id,reason:"Pilot synthetic refund",legs:[{paymentId:payment.id,method:"MEMBER_WALLET" as const,amountCents:4000}],stockLines:[]};
    process.env.TETAMU_WALLET_TESTING_BUSINESS_IDS=b.business.id;
    assert.equal((await h.action.completeCashierSaleAction(a.form)).status,"error");
    await assert.rejects(refundWalletSale(a.ctx,request,db),denied);
    assert.equal(await db.paymentRefund.count({where:{businessId:a.business.id}}),0);
    process.env.TETAMU_WALLET_TESTING_BUSINESS_IDS=a.business.id;
    await refundWalletSale(a.ctx,request,db);
    await refundWalletSale(a.ctx,request,db);
    process.env.TETAMU_WALLET_TESTING_PILOT="false";
    await assert.rejects(refundWalletSale(a.ctx,request,db),denied);
    assert.equal(await db.paymentRefund.count({where:{businessId:a.business.id}}),1);
    await h.login(db,b); assert.equal((await h.action.completeCashierSaleAction(b.form)).status,"error");
    for (const method of ["CASH","CARD"]) {
      const form=new FormData(); for (const [key,value] of b.form) form.append(key,value);
      form.delete("walletAmount"); form.set("method",method); form.set("paymentMethodCode",`BUILTIN_${method}`); form.set("operationId",randomUUID()); if(method==="CARD")form.set("reference","Synthetic card");
      const ordinary=await h.action.completeCashierSaleAction(form); assert.equal(ordinary.status,"success",ordinary.message);
    }
    assert.equal(await db.walletTransaction.count({where:{businessId:b.business.id,type:"REDEMPTION"}}),0);
  }); } finally { await h.close(); }
});
test("Pilot reversal and recovery reads deny after allowlist removal without additional money writes", async()=>{
  const a=await checkoutFixture(db), h=await checkoutHarness(db);
  const top=await db.walletTopUp.findFirstOrThrow({where:{businessId:a.business.id}});
  const request={operationKey:randomUUID(),topUpId:top.id,reason:"Pilot synthetic reversal"};
  try { await pilot(a.business.id,async()=>{
    await h.login(db,a); await reverseWalletTopUp(a.ctx,request,db);
    await reverseWalletTopUp(a.ctx,request,db);
    process.env.TETAMU_WALLET_TESTING_BUSINESS_IDS="";
    await assert.rejects(reverseWalletTopUp(a.ctx,request,db),denied);
    const options=await h.wallet.walletRefundOptionsAction(top.id,"top-up"); assert.equal(options.ok,false);
    if(!options.ok) assert.equal(options.code,"WALLET_UNAVAILABLE");
    assert.equal(await db.walletTopUpReversal.count({where:{businessId:a.business.id}}),1);
  }); } finally { await h.close(); }
});
