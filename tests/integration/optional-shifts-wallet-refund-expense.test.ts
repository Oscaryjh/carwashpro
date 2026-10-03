import assert from "node:assert/strict";
import test, { after } from "node:test";
import { walletFixture, walletTestDatabase } from "../helpers/wallet-fixture";
import { postWalletTopUp } from "../../src/lib/wallet/top-up";
import { getWalletTopUpOptions, submitWalletTopUp } from "../../src/lib/wallet/ui-adapter";
import { checkoutFixture, checkoutHarness } from "../helpers/wallet-checkout-fixture";
import { randomUUID } from "node:crypto";
import { createBusinessExpense, ensureStarterExpenseCategories, markBusinessExpensePaid } from "../../src/lib/expense/service";
import { getDailySalesReport } from "../../src/lib/reports/daily-sales";
import { getBusinessDayRange, getCurrentBusinessDateValue } from "../../src/lib/business-day";

const db = walletTestDatabase();
after(() => db.$disconnect());
test("Public top-up action preserves OFF confirmation and returns explicit stale-mode rejection", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await walletFixture(db); await h.login(db, f);
    await db.cashierShift.update({where:{id:f.shift.id},data:{status:"CLOSED"}});
    await db.business.update({where:{id:f.business.id},data:{cashierShiftsEnabled:false}});
    const form = new FormData();
    for(const [key,value] of Object.entries({...f.input,modeAtConfirmation:"OFF",branchId:f.branch.id,shiftId:""})) form.set(key,String(value));
    const result = await h.wallet.walletTopUpAction(form);
    assert.equal(result.ok,true,JSON.stringify(result));
    assert.equal((await db.walletTopUp.findFirstOrThrow({where:{businessId:f.business.id}})).shiftId,null);
    form.set("operationKey",randomUUID()); form.set("modeAtConfirmation","ON");
    const stale = await h.wallet.walletTopUpAction(form);
    assert.equal(stale.ok,false);
    if(!stale.ok) { assert.equal(stale.code,"CASHIER_SHIFT_MODE_CHANGED"); assert.equal(stale.uncertain,false); }
    assert.equal(await db.walletTopUp.count({where:{businessId:f.business.id}}),1);
  } finally { await h.close(); }
});
test("Expense OFF denies POS_DRAWER even with an otherwise valid drawer; bank source remains usable", async () => {
  const f = await walletFixture(db);
  await db.cashierShift.update({ where: { id: f.shift.id }, data: { openingFloat: 100 } });
  await db.business.update({ where: { id: f.business.id }, data: { cashierShiftsEnabled: false } });
  await db.businessModuleEntitlement.create({ data: { businessId: f.business.id, moduleKey: "EXPENSE", status: "ENABLED", source: "MANUAL", enabledFrom: new Date(0) } });
  await ensureStarterExpenseCategories(f.business.id, db);
  const category = await db.expenseCategory.findFirstOrThrow({ where: { businessId: f.business.id } });
  const actor = { userId: f.actor.id, name: f.actor.name, email: "" };
  const expense = await createBusinessExpense({ actor, businessId: f.business.id, branchId: f.branch.id, amount: 25, categoryId: category.id, description: "Phase2 drawer test", desiredStatus: "CONFIRMED", expenseDate: "2026-10-02", operationKey: randomUUID() }, db);
  const input = { actor, businessId: f.business.id, expenseId: expense.id, expectedRevision: expense.revision, amount: 25, operationKey: randomUUID(), paymentDate: "2026-10-02", cashierShiftId: f.shift.id, paymentMethod: "CASH" as const, paymentSource: "POS_DRAWER" as const };
  const operationsBefore = await db.financialOperation.findMany({ where: { businessId: f.business.id }, orderBy: { id: "asc" } });
  await assert.rejects(markBusinessExpensePaid(input, db), /Cashier shifts are disabled/);
  assert.equal(await db.cashierShiftExpensePayout.count({ where: { businessId: f.business.id } }), 0);
  assert.equal(await db.businessExpensePaymentEvent.count({ where: { businessId: f.business.id } }), 0);
  assert.deepEqual(await db.financialOperation.findMany({ where: { businessId: f.business.id }, orderBy: { id: "asc" } }), operationsBefore);
  assert.equal((await db.businessExpense.findUniqueOrThrow({ where: { id: expense.id } })).paymentStatus, "UNPAID");
  const paid = await markBusinessExpensePaid({ ...input, operationKey: randomUUID(), paymentMethod: "BANK_TRANSFER", paymentSource: "BANK_ACCOUNT", cashierShiftId: null }, db);
  assert.equal(paid.paymentStatus, "PAID");
});
test("Normal invoice refund OFF uses original branch, current refund time and null shift", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await checkoutFixture(db, "CASH"); await h.login(db, f); f.form.set("walletAmount", "0");
    const sale = await h.action.completeCashierSaleAction(f.form);
    assert.equal(sale.status, "success", sale.message);
    const payment = await db.payment.findFirstOrThrow({ where: { invoiceId: sale.invoice!.id } });
    await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED" } });
    await db.business.update({ where: { id: f.business.id }, data: { cashierShiftsEnabled: false } });
    const form = new FormData();
    const activity = await h.invoices.refundCashierActivityAction(payment.id);
    assert.equal(activity.ok,true);
    if(activity.ok) assert.deepEqual(activity.activity,{modeAtConfirmation:"OFF",branchId:f.branch.id,shiftId:null});
    assert.equal((await h.invoices.refundCashierActivityAction(randomUUID())).ok,false);
    for (const [k,v] of Object.entries({ operationId: randomUUID(), invoiceId: sale.invoice!.id, paymentId: payment.id, amount: "10", method: "CASH", reason: "Phase2 partial return", reference: "", branchId: randomUUID(), modeAtConfirmation: "OFF", shiftId: "" })) form.set(k,v);
    const before = new Date();
    const result = await h.invoices.refundPaymentAction({ status: "idle", message: "" }, form);
    assert.equal(result.status, "success", result.message);
    const refund = await db.paymentRefund.findFirstOrThrow({ where: { paymentId: payment.id } });
    assert.equal(refund.branchId, f.branch.id); assert.equal(refund.shiftId, null);
    assert.equal(refund.amount.toFixed(2), "10.00"); assert.ok(refund.refundedAt >= before);
    assert.equal(refund.processedById, f.actor.id);
    await db.business.update({ where: { id: f.business.id }, data: { cashierShiftsEnabled: true } });
    assert.equal((await h.invoices.refundPaymentAction({ status: "idle", message: "" }, form)).status, "success");
    assert.equal(await db.paymentRefund.count({ where: { paymentId: payment.id } }), 1);
  } finally { await h.close(); }
});
test("Top-up adapter OFF offers explicit authorized branches and replays original null shift after ON", async () => {
  const f = await walletFixture(db);
  await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED" } });
  await db.business.update({ where: { id: f.business.id }, data: { cashierShiftsEnabled: false } });
  const ctx = { ...f.ctx, branchId: null, shiftId: null };
  const options = await getWalletTopUpOptions(ctx, f.customer.id, db);
  assert.equal(options.activity?.modeAtConfirmation, "OFF");
  assert.equal(options.activity?.branchId, f.branch.id);
  const input = { ...f.input, modeAtConfirmation: "OFF" as const, branchId: f.branch.id, shiftId: null };
  const first = await submitWalletTopUp(ctx, input, db);
  await db.business.update({ where: { id: f.business.id }, data: { cashierShiftsEnabled: true } });
  await db.cashierShift.create({ data: { businessId: f.business.id, branchId: f.branch.id, cashierId: f.actor.id } });
  const replay = await submitWalletTopUp(ctx, input, db);
  assert.equal(replay.topUpId, first.topUpId); assert.equal(replay.shiftId, null); assert.equal(replay.replayed, true);
  await db.business.update({ where: { id: f.business.id }, data: { cashierShiftsEnabled: false } });
  const second = await db.branch.create({ data: { businessId: f.business.id, name: "Another branch" } });
  const multi = await getWalletTopUpOptions(ctx, f.customer.id, db);
  assert.equal(multi.activity, null);
  assert.deepEqual(multi.branches.map(b => b.id).sort(), [f.branch.id, second.id].sort());
});
for (const method of ["CASH", "CARD", "DUITNOW", "EWALLET", "BANK_TRANSFER"]) {
  test(`Top-up OFF ${method}: Paid1000 Bonus100, null shifts, no sale, immutable replay`, async () => {
    const f = await walletFixture(db);
    await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED" } });
    await db.business.update({ where: { id: f.business.id }, data: { cashierShiftsEnabled: false } });
    const ctx = { ...f.ctx, shiftId: null };
    const input = { ...f.input, modeAtConfirmation: "OFF" as const, paymentMethodCode: `BUILTIN_${method}` };
    const result = await postWalletTopUp(ctx, input, db);
    assert.equal(result.paidBalance, "1000.00"); assert.equal(result.bonusBalance, "100.00"); assert.equal(result.totalBalance, "1100.00");
    const topUp = await db.walletTopUp.findUniqueOrThrow({ where: { id: result.topUpId } });
    const payment = await db.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
    assert.equal(topUp.shiftId, null); assert.equal(payment.shiftId, null);
    assert.equal(payment.branchId, f.branch.id); assert.equal(payment.cashierId, f.actor.id);
    assert.equal(payment.amount.toFixed(2), "1000.00"); assert.equal(payment.purpose, "WALLET_TOP_UP");
    if (method === "CASH") {
      const day = getCurrentBusinessDateValue(payment.createdAt, f.business.timezone, f.business.businessDayCutoffTime);
      const range = getBusinessDayRange({ fromDateValue: day, toDateValue: day, timezone: f.business.timezone, businessDayCutoffTime: f.business.businessDayCutoffTime });
      const report = await getDailySalesReport({ businessId: f.business.id, branchId: f.branch.id, range }, db);
      assert.equal(report.summary.grossCollectionsCents, 100000, "branch/day collection includes null-shift paid credit only");
      assert.equal(report.summary.netSalesCents, 0, "top-up and bonus do not become sales");
    }
    assert.equal(await db.invoice.count({ where: { businessId: f.business.id } }), 0);
    assert.equal(await db.cashierShift.count({ where: { businessId: f.business.id } }), 1);
    await db.business.update({ where: { id: f.business.id }, data: { cashierShiftsEnabled: true } });
    const replay = await postWalletTopUp(ctx, input, db);
    assert.equal(replay.replayed, true); assert.equal(replay.topUpId, topUp.id);
    assert.equal(await db.walletTransaction.count({ where: { businessId: f.business.id } }), 2);
  });
}
