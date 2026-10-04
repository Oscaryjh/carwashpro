import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase } from "../helpers/wallet-fixture";
import { checkoutFixture, checkoutHarness } from "../helpers/wallet-checkout-fixture";

assert.equal(process.env.TETAMU_WALLET_LOCAL_TEST, "true", "Disposable runner required");
const db = walletTestDatabase();
process.env.TETAMU_PERFORMANCE_PHASE1 = "true";
after(() => db.$disconnect());
type Harness = Awaited<ReturnType<typeof checkoutHarness>>;
async function sale(h: Harness, redeem = 100, earn = true, rate = 100, kind: "product" | "package" | "inventory" = "product", payable = 10) {
  const f = await checkoutFixture(db, "CASH");
  await h.login(db, f);
  await db.loyaltyProgram.create({ data: { businessId: f.business.id, enabled: true, pointsPerRinggit: earn ? 1 : 0, redemptionEnabled: true, redemptionPointsPerRinggit: rate, minimumRedemptionPoints: 1 } });
  const member = await db.customerMembership.create({ data: { businessId: f.business.id, customerId: f.customer.id, pointsBalance: redeem } });
  await db.product.update({ where: { id: f.product.id }, data: { price: payable + redeem / rate } });
  if (kind === "package") {
    const service = await db.service.create({ data: { businessId: f.business.id, name: "Refund service", price: 10 } });
    const pkg = await db.package.create({ data: { businessId: f.business.id, name: "Refund package", serviceId: service.id, price: 10 + redeem/rate, totalUses: 5 } });
    f.form.delete("productId"); f.form.delete("productQuantity"); f.form.set("packageId",pkg.id); f.form.set("packageQuantity","1");
  }
  if (kind === "inventory") {
    await db.businessModuleEntitlement.create({ data: { businessId: f.business.id, moduleKey: "INVENTORY", status: "ENABLED", source: "MANUAL", enabledFrom: new Date(0) } });
    await db.product.update({ where: { id: f.product.id }, data: { trackInventory: true } });
    await db.productStock.create({ data: { businessId: f.business.id, branchId: f.branch.id, productId: f.product.id, quantity: 10 } });
  }
  f.form.set("performanceAttribution", JSON.stringify({ version: 1, sales: [], unassignedReason: "Disposable normal refund" }));
  f.form.set("walletAmount", "0"); f.form.set("loyaltyPoints", String(redeem));
  const result = await h.action.completeCashierSaleAction(f.form);
  assert.equal(result.status, "success", result.message);
  const invoiceId = result.invoice!.id;
  const payment = await db.payment.findFirstOrThrow({ where: { invoiceId } });
  assert.equal(payment.amount.toFixed(2), payable.toFixed(2));
  // A later spend leaves no balance available to cover the original earning.
  if (earn) {
    await db.loyaltyTransaction.create({ data: { businessId: f.business.id, membershipId: member.id, customerId: f.customer.id, type: "REDEEM", points: -10, description: "Other purchase" } });
    await db.customerMembership.update({ where: { id: member.id }, data: { pointsBalance: 0 } });
  }
  return { ...f, member, invoiceId, payment };
}
async function snapshot(businessId: string) {
  const where = { businessId }, orderBy = { id: "asc" as const };
  return JSON.stringify(await Promise.all([
    db.invoice.findMany({where,orderBy}), db.payment.findMany({where,orderBy}), db.paymentRefund.findMany({where,orderBy}),
    db.creditNote.findMany({where,orderBy}), db.creditNoteItem.findMany({where,orderBy}),
    db.customerMembership.findMany({where,orderBy}), db.loyaltyTransaction.findMany({where,orderBy}),
    db.customerPackage.findMany({where,orderBy}), db.customerPackageServiceBalance.findMany({where,orderBy}),
    db.productStock.findMany({where,orderBy}), db.inventoryMovement.findMany({where,orderBy}), db.inventoryRefundLine.findMany({where,orderBy}),
    db.performanceReceipt.findMany({where,orderBy}), db.auditLog.findMany({where,orderBy}), db.financialOperation.findMany({where,orderBy}),
    db.walletAccount.findMany({where,orderBy}), db.walletTransaction.findMany({where,orderBy}),
  ]), (_key,value) => typeof value === "bigint" ? value.toString() : value);
}

for (const mode of ["earn","redeem","none","settings"] as const) for (const amounts of [["10"],["2.5","2.5","5"]]) {
  test(`original points, not current settings: ${mode}, ${amounts}`, async () => {
    const h = await checkoutHarness(db);
    try {
      const f = await sale(h,mode === "earn" || mode === "none" ? 0 : 100,mode !== "redeem" && mode !== "none");
      if (mode === "settings") await db.loyaltyProgram.update({ where: {businessId:f.business.id}, data: { enabled:false, pointsPerRinggit:99, redemptionPointsPerRinggit:7, minimumRedemptionPoints:9999 } });
      for (const amount of amounts) await refund(h,f,amount);
      assert.deepEqual(await facts(f), { balance:mode === "redeem" ? 100 : mode === "settings" ? 90 : 0,
        restored:mode === "redeem" || mode === "settings" ? 100 : 0, reversed:mode === "earn" || mode === "settings" ? 10 : 0 });
      assert.equal(await db.paymentRefund.count({where:{paymentId:f.payment.id}}),amounts.length);
    } finally { await h.close(); }
  });
}
for (const type of ["EARN","REDEEM","WELCOME_BONUS","REDEMPTION_REFUND"] as const) {
  test(`intervening ${type} is retained and old insufficient reversal creates no debt`, async () => {
    const h = await checkoutHarness(db);
    try {
      const f = await sale(h,3,true,1); await refund(h,f,"3");
      if (type === "REDEEM") await db.loyaltyTransaction.create({data:{businessId:f.business.id,membershipId:f.member.id,customerId:f.customer.id,type:"EARN",points:1,description:"Other purchase before redemption"}});
      const activity = await db.loyaltyTransaction.create({data:{businessId:f.business.id,membershipId:f.member.id,customerId:f.customer.id,type,points:type === "REDEEM" ? -1 : 10,description:"Unrelated activity"}});
      await db.customerMembership.update({where:{id:f.member.id},data:{pointsBalance:type === "REDEEM" ? 0 : 10}});
      await refund(h,f,"0.4");
      assert.equal((await facts(f)).balance,type === "REDEEM" ? 1 : 11);
      assert.deepEqual(await db.loyaltyTransaction.findUniqueOrThrow({where:{id:activity.id}}),activity);
    } finally { await h.close(); }
  });
}
test("same-key normal refund replay does not repeat any money, credit note or points", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await sale(h); const form = refundForm(f,"10");
    assert.equal((await h.invoices.refundPaymentAction({status:"idle",message:""},form)).status,"success");
    const before = await snapshot(f.business.id);
    assert.equal((await h.invoices.refundPaymentAction({status:"idle",message:""},form)).status,"success");
    assert.equal(await snapshot(f.business.id),before);
    assert.deepEqual(await facts(f),{balance:90,restored:100,reversed:10});
  } finally { await h.close(); }
});
test("historical multi-payment invoice compensates only the selected payment", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await sale(h);
    // Historical installments may have different original earning rates.
    await db.payment.update({where:{id:f.payment.id},data:{amount:5}});
    const other = await db.payment.create({data:{businessId:f.business.id,branchId:f.branch.id,invoiceId:f.invoiceId,method:"CASH",amount:5,status:"ACTIVE"}});
    const otherEarn = await db.loyaltyTransaction.create({data:{businessId:f.business.id,membershipId:f.member.id,customerId:f.customer.id,paymentId:other.id,type:"EARN",points:7,description:"Other installment original earning"}});
    await db.customerMembership.update({where:{id:f.member.id},data:{pointsBalance:7}});
    await refund(h,f,"5");
    assert.deepEqual(await facts(f),{balance:97,restored:100,reversed:10});
    assert.deepEqual(await db.loyaltyTransaction.findMany({where:{paymentId:other.id}}),[otherEarn]);
    const form = refundForm(f,"5"); form.set("paymentId",other.id);
    const result = await h.invoices.refundPaymentAction({status:"idle",message:""},form);
    assert.equal(result.status,"success",result.message);
    assert.equal((await facts(f)).balance,90);
    assert.equal(await db.loyaltyTransaction.count({where:{paymentId:other.id,type:"REFUND_REVERSAL",points:-7}}),1);
  } finally { await h.close(); }
});
test("odd original points reach exact full targets after partial floors", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await sale(h,101,true,1);
    // Original earned=10 here; the 101/11 boundary is separately unit-tested.
    for (const amount of ["2.51","2.52","4.97"]) await refund(h,f,amount);
    assert.deepEqual(await facts(f),{balance:91,restored:101,reversed:10});
  } finally { await h.close(); }
});
test("legacy compensated refund without a new audit applies only remaining delta", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await sale(h); await refund(h,f,"5");
    // Model pre-fix historical refund facts: no sequence snapshot and a clamped balance of 50.
    await db.auditLog.deleteMany({where:{businessId:f.business.id,action:"LOYALTY_NORMAL_REFUND_COMPENSATED"}});
    await db.customerMembership.update({where:{id:f.member.id},data:{pointsBalance:50}});
    const oldRows = await db.loyaltyTransaction.findMany({where:{paymentId:f.payment.id,refundId:{not:null}},orderBy:{id:"asc"}});
    await refund(h,f,"5");
    assert.deepEqual(await facts(f),{balance:95,restored:100,reversed:10});
    assert.deepEqual(await db.loyaltyTransaction.findMany({where:{id:{in:oldRows.map(r=>r.id)}},orderBy:{id:"asc"}}),oldRows);
  } finally { await h.close(); }
});
test("concurrent different partial keys cannot double compensate", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await sale(h);
    const results = await Promise.all([refundForm(f,"5"),refundForm(f,"5")].map(form => h.invoices.refundPaymentAction({status:"idle",message:""},form)));
    assert.ok(results.every(r => r.status === "success"),JSON.stringify(results));
    assert.deepEqual(await facts(f),{balance:90,restored:100,reversed:10});
    assert.equal(await db.paymentRefund.count({where:{paymentId:f.payment.id}}),2);
    assert.equal(await db.creditNote.count({where:{invoiceId:f.invoiceId}}),2);
  } finally { await h.close(); }
});
for (const kind of ["package","inventory"] as const) for (const [model,method,call] of [
  ["customerMembership","updateMany",1],["loyaltyTransaction","create",1],["loyaltyTransaction","create",2],
  ["creditNote","create",1],["auditLog","create",1],["performanceReceipt","create",1],
] as const) {
  test(`normal ${kind} refund atomic rollback after ${model}.${method} #${call}`, async () => {
    const h = await checkoutHarness(db);
    try {
      const f = await sale(h,100,true,100,kind); const form = refundForm(f,"10");
      if (kind === "inventory") {
        const item = await db.invoiceItem.findFirstOrThrow({where:{invoiceId:f.invoiceId,productId:f.product.id}});
        assert.equal(item.inventoryTracked,true);
        form.set("refundItemId",item.id); form.set(`refundQuantity_${item.id}`,"1"); form.set(`refundDisposition_${item.id}`,"RESTOCK");
      }
      const before = await snapshot(f.business.id); h.failAfter(model,method,call);
      const result = await h.invoices.refundPaymentAction({status:"idle",message:""},form);
      assert.equal(result.status,"error"); assert.match(result.message,/P1C_INJECTED/); assert.equal(h.injections(),1);
      assert.equal(await snapshot(f.business.id),before);
    } finally { await h.close(); }
  });
}
test("ordinary package full refund cancels entitlement and nets original points; partial/used still reject", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await sale(h,100,true,100,"package");
    const cp = await db.customerPackage.findFirstOrThrow({where:{businessId:f.business.id}});
    const before = await snapshot(f.business.id);
    const partial = await h.invoices.refundPaymentAction({status:"idle",message:""},refundForm(f,"5"));
    assert.equal(partial.status,"error"); assert.match(partial.message,/in full/); assert.equal(await snapshot(f.business.id),before);
    await refund(h,f,"10"); assert.deepEqual(await facts(f),{balance:90,restored:100,reversed:10});
    const cancelled = await db.customerPackage.findUniqueOrThrow({where:{id:cp.id}});
    assert.equal(cancelled.status,"CANCELLED"); assert.equal(cancelled.remainingUses,0);
    assert.ok((await db.customerPackageServiceBalance.findMany({where:{customerPackageId:cp.id}})).every(r=>r.remainingUses===0));
    const used = await sale(h,100,true,100,"package");
    await db.customerPackage.updateMany({where:{businessId:used.business.id},data:{remainingUses:4}});
    const usedBefore = await snapshot(used.business.id);
    const result = await h.invoices.refundPaymentAction({status:"idle",message:""},refundForm(used,"10"));
    assert.equal(result.status,"error"); assert.match(result.message,/unused/); assert.equal(await snapshot(used.business.id),usedBefore);
  } finally { await h.close(); }
});
for (const amounts of [["3.4"],["3","0.4"],["1","2","0.4"]]) {
  test(`normal refund rounding/clamp does not depend on partial batches: ${amounts}`, async () => {
    const h = await checkoutHarness(db);
    try {
      const f = await sale(h,3,true,1);
      for (const amount of amounts) await refund(h,f,amount);
      assert.deepEqual(await facts(f), {balance:0,restored:1,reversed:3});
    } finally { await h.close(); }
  });
}
type Sale = Awaited<ReturnType<typeof sale>>;
test("server rejects more than persisted remaining and rolled-back refunds do not reduce availability",async()=>{
 const h=await checkoutHarness(db);
 try{
  const f=await sale(h);
  await refund(h,f,'5');
  const before=await snapshot(f.business.id);
  const rejected=await h.invoices.refundPaymentAction({status:'idle',message:''},refundForm(f,'5.01'));
  assert.equal(rejected.status,'error');assert.match(rejected.message,/cannot exceed RM5/);
  assert.equal(await snapshot(f.business.id),before);
  h.failAfter('paymentRefund','create',1);
  const rolledBack=await h.invoices.refundPaymentAction({status:'idle',message:''},refundForm(f,'5'));
  assert.equal(rolledBack.status,'error');assert.equal(await snapshot(f.business.id),before);
  assert.equal(await db.paymentRefund.count({where:{paymentId:f.payment.id}}),1);
 }finally{await h.close();}
});
function refundForm(f: Sale, amount: string) {
  const form = new FormData();
  for (const [key,value] of Object.entries({ operationId: randomUUID(), invoiceId: f.invoiceId, paymentId: f.payment.id, amount, method: "CASH", reference: "", reason: "Disposable normal refund", modeAtConfirmation: "ON", shiftId: f.shift.id })) form.set(key,value);
  return form;
}
test('RM96 two RM48 keys complete exactly once and match full refund compensation',async()=>{
 const h=await checkoutHarness(db);
 try{
  const f=await sale(h,400,true,100,'product',96);
  // Keep the actual original earning available, as in the real UAT sale.
  await db.customerMembership.update({where:{id:f.member.id},data:{pointsBalance:96}});
  const first=refundForm(f,'48'),second=refundForm(f,'48');assert.notEqual(first.get('operationId'),second.get('operationId'));
  for(const form of [first,second])assert.equal((await h.invoices.refundPaymentAction({status:'idle',message:''},form)).status,'success');
  const rows=await db.paymentRefund.findMany({where:{paymentId:f.payment.id}});assert.equal(rows.length,2);assert.equal(rows.reduce((n,r)=>n+Number(r.amount),0),96);
  assert.deepEqual(await facts(f),{balance:400,restored:400,reversed:96});
  const before=await snapshot(f.business.id);
  for(const form of [first,second])assert.equal((await h.invoices.refundPaymentAction({status:'idle',message:''},form)).status,'success');
  assert.equal(await snapshot(f.business.id),before);
  const full=await sale(h,400,true,100,'product',96);await db.customerMembership.update({where:{id:full.member.id},data:{pointsBalance:96}});await refund(h,full,'96');assert.deepEqual(await facts(full),await facts(f));
 }finally{await h.close();}
});
test('RM96 second request rollback retries original K2 without duplicating K1',async()=>{
 const h=await checkoutHarness(db);
 try{
  const f=await sale(h,400,true,100,'product',96);await db.customerMembership.update({where:{id:f.member.id},data:{pointsBalance:96}});
  await refund(h,f,'48');const second=refundForm(f,'48'),before=await snapshot(f.business.id);
  h.failAfter('paymentRefund','create',1);
  assert.equal((await h.invoices.refundPaymentAction({status:'idle',message:''},second)).status,'error');assert.equal(await snapshot(f.business.id),before);
  assert.equal((await h.invoices.refundPaymentAction({status:'idle',message:''},second)).status,'success');assert.equal(await db.paymentRefund.count({where:{paymentId:f.payment.id}}),2);assert.deepEqual(await facts(f),{balance:400,restored:400,reversed:96});
 }finally{await h.close();}
});
async function refund(h: Harness, f: Sale, amount: string) {
  const result = await h.invoices.refundPaymentAction({ status: "idle", message: "" }, refundForm(f, amount));
  assert.equal(result.status, "success", result.message);
}
async function facts(f: Sale) {
  const rows = await db.loyaltyTransaction.findMany({ where: { businessId: f.business.id, paymentId: f.payment.id } });
  return {
    balance: (await db.customerMembership.findUniqueOrThrow({ where: { id: f.member.id } })).pointsBalance,
    restored: rows.filter(r => r.type === "REDEMPTION_REFUND").reduce((n,r) => n+r.points,0),
    reversed: rows.filter(r => r.type === "REFUND_REVERSAL").reduce((n,r) => n-r.points,0),
  };
}
for (const amounts of [["10"],["5","5"],["2.5","2.5","5"]]) {
  test(`normal refund nets restore/reverse independently of batches: ${amounts}`, async () => {
    const h = await checkoutHarness(db);
    try {
      const f = await sale(h);
      for (const amount of amounts) await refund(h,f,amount);
      assert.deepEqual(await facts(f), { balance: 90, restored: 100, reversed: 10 });
      const rows = await db.loyaltyTransaction.findMany({ where: { paymentId: f.payment.id, refundId: { not: null } } });
      assert.equal(rows.length, amounts.length * 2);
      assert.ok(rows.every(r => r.membershipId === f.member.id && r.customerId === f.customer.id));
    } finally { await h.close(); }
  });
}
