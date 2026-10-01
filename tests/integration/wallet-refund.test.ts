import { setWalletModule } from "../helpers/wallet-fixture";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase } from "../helpers/wallet-fixture";
import { checkoutFixture, checkoutHarness } from "../helpers/wallet-checkout-fixture";
const db = walletTestDatabase();
after(() => db.$disconnect());
test("Wallet refund source, tenant, owner and local gate are fail-closed",async()=>{
 const h=await checkoutHarness();try{
  const f=await checkoutFixture(db);await h.login(db,f);const sale=await h.action.completeCashierSaleAction(f.form);assert.equal(sale.status,"success",sale.message);
  const {refundWalletSale}=await import("../../src/lib/wallet/refunds");const p=await db.payment.findFirstOrThrow({where:{invoiceId:sale.invoice!.id}});
  const input={operationKey:randomUUID(),invoiceId:sale.invoice!.id,reason:"Negative test",stockLines:[],legs:[{paymentId:p.id,amountCents:100,method:"MEMBER_WALLET" as const}]};
  const foreign=await checkoutFixture(db);
  await assert.rejects(refundWalletSale(foreign.ctx,input,db));
  await assert.rejects(refundWalletSale(f.ctx,{...input,legs:[{...input.legs[0],method:"CASH"}]},db));
  await assert.rejects(refundWalletSale(f.ctx,{...input,legs:[input.legs[0],input.legs[0]]},db));
  await assert.rejects(refundWalletSale(f.ctx,{...input,legs:[{...input.legs[0],amountCents:4001}]},db));
  const gate=process.env.TETAMU_WALLET_LOCAL_TEST;try{await setWalletModule(db, f.business.id, false);await assert.rejects(refundWalletSale(f.ctx,input,db),/Member Wallet is not enabled for this business\./);}finally{await setWalletModule(db, f.business.id, true);}
  await db.user.update({where:{id:f.actor.id},data:{role:"STAFF",permissions:["POS","CRM"]}});await assert.rejects(refundWalletSale(f.ctx,input,db),/owner/i);
  assert.equal(await db.paymentRefund.count({where:{businessId:f.business.id}}),0);
 }finally{await h.close();}
});
test("split CARD refund restocks once and later funds-only refund does not repeat stock",async()=>{
 const h=await checkoutHarness();try{
  const f=await checkoutFixture(db,"CARD");await h.login(db,f);
  await db.businessModuleEntitlement.create({data:{businessId:f.business.id,moduleKey:"INVENTORY",status:"ENABLED",source:"MANUAL",enabledFrom:new Date(0)}});
  await db.product.update({where:{id:f.product.id},data:{trackInventory:true}});await db.productStock.create({data:{businessId:f.business.id,branchId:f.branch.id,productId:f.product.id,quantity:10}});
  const sale=await h.action.completeCashierSaleAction(f.form);assert.equal(sale.status,"success",sale.message);
  const {refundWalletSale}=await import("../../src/lib/wallet/refunds"),payments=await db.payment.findMany({where:{invoiceId:sale.invoice!.id}}),item=await db.invoiceItem.findFirstOrThrow({where:{invoiceId:sale.invoice!.id}});
  const input={operationKey:randomUUID(),invoiceId:sale.invoice!.id,reason:"Synthetic split partial",stockLines:[{invoiceItemId:item.id,quantity:1,disposition:"RESTOCK" as const}],legs:payments.map(p=>({paymentId:p.id,amountCents:1000,method:p.method as "CARD"|"MEMBER_WALLET",reference:"original-channel-refund"}))};
  await refundWalletSale(f.ctx,input,db);
  await assert.rejects(refundWalletSale(f.ctx,{...input,operationKey:randomUUID()},db));
  await refundWalletSale(f.ctx,{...input,operationKey:randomUUID(),stockLines:[]},db);
  assert.equal((await db.productStock.findFirstOrThrow({where:{businessId:f.business.id}})).quantity,10);
  assert.equal(await db.inventoryRefundLine.count({where:{businessId:f.business.id}}),1);
  assert.equal((await db.invoice.findUniqueOrThrow({where:{id:sale.invoice!.id}})).status,"REFUNDED");
 }finally{await h.close();}
});
test("Wallet refund restores original paid then bonus with no active shift and no duplicate refund", async () => {
  const h = await checkoutHarness();
  try {
    const f = await checkoutFixture(db); await h.login(db, f);
    const sale = await h.action.completeCashierSaleAction(f.form); assert.equal(sale.status, "success", sale.message);
    await db.cashierShift.update({where:{id:f.shift.id},data:{status:"CLOSED"}});
    const p = await db.payment.findFirstOrThrow({where:{invoiceId:sale.invoice!.id,method:"MEMBER_WALLET"}});
    const module = await import("../../src/lib/wallet/refunds").catch(() => null);
    assert.ok(module?.refundWalletSale, "P1D refund service must exist");
    const request = {operationKey:randomUUID(),invoiceId:sale.invoice!.id,reason:"Synthetic refund",stockLines:[],legs:[{paymentId:p.id,amountCents:1500,method:"MEMBER_WALLET" as const}]};
    const result = await module.refundWalletSale(f.ctx, request, db);
    assert.deepEqual(await module.refundWalletSale(f.ctx, request, db),result);
    let a = await db.walletAccount.findFirstOrThrow({where:{businessId:f.business.id}});
    assert.equal(a.paidBalance.toFixed(2),"50.00"); assert.equal(a.bonusBalance.toFixed(2),"5.00");
    const refundRecord=await db.paymentRefund.findUniqueOrThrow({where:{id:result.refundIds[0]}});
    assert.equal(refundRecord.shiftId,null);
    const refundAudit=await db.auditLog.findFirstOrThrow({where:{businessId:f.business.id,entityType:"PaymentRefund",entityId:refundRecord.id,action:"PAYMENT_REFUNDED"}});
    assert.equal((refundAudit.metadata as {shiftId?:string|null}).shiftId,null);
    assert.equal((refundAudit.metadata as {sourceShiftId?:string|null}).sourceShiftId,f.shift.id);
    await module.refundWalletSale(f.ctx,{...request,operationKey:randomUUID(),legs:[{...request.legs[0],amountCents:2500}]},db);
    a = await db.walletAccount.findFirstOrThrow({where:{businessId:f.business.id}});
    assert.equal(a.paidBalance.toFixed(2),"50.00"); assert.equal(a.bonusBalance.toFixed(2),"30.00");
    await assert.rejects(module.refundWalletSale(f.ctx,{...request,operationKey:randomUUID()},db));
    assert.equal(await db.paymentRefund.count({where:{paymentId:p.id}}),2);
    assert.equal((await db.invoice.findUniqueOrThrow({where:{id:sale.invoice!.id}})).balance.toFixed(2),"0.00");
  } finally { await h.close(); }
});
