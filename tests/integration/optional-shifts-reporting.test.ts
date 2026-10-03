import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletFixture, walletTestDatabase } from "../helpers/wallet-fixture";
import { checkoutHarness } from "../helpers/wallet-checkout-fixture";
import { saveCashierShiftSetting } from "../../src/lib/cashier/shift-settings";
import { postWalletTopUp } from "../../src/lib/wallet/top-up";
import { reverseWalletTopUp } from "../../src/lib/wallet/reversals";
import { getWalletPanel, getWalletHistory } from "../../src/lib/wallet/ui-adapter";
import { getDailySalesReport } from "../../src/lib/reports/daily-sales";
import { getBusinessPerformanceReadModel } from "../../src/lib/business-performance/read-model";
import { getDailyClosingReport } from "../../src/lib/daily-closing/query";
import { getGroupReports } from "../../src/lib/business-groups/group-reports";
import { getAllStoresKpiReport } from "../../src/lib/business-groups/all-stores-kpi";
import { refreshDailyStoreSummaries } from "../../src/lib/analytics/daily-store-summary";
import { getBusinessDayRange, getCurrentBusinessDateValue } from "../../src/lib/business-day";
import { createBusinessExpense, ensureStarterExpenseCategories, markBusinessExpensePaid } from "../../src/lib/expense/service";
import { readPerformanceLedger } from "../../src/lib/performance/read";

const db = walletTestDatabase();
process.env.TETAMU_PERFORMANCE_PHASE1 = "true";
after(() => db.$disconnect());
const cents = (value: { toString(): string }) => Math.round(Number(value.toString()) * 100);

// Catches current-mode filtering, null-shift omissions, refund double subtraction,
// bonus counted as collection, and historical facts attached to a later shift.
test("ON OFF ON canonical mixed facts remain visible in every reporting mode", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await walletFixture(db, "900", "100");
    await h.login(db, f);
    await db.loyaltyProgram.create({data:{businessId:f.business.id,enabled:true,pointsPerRinggit:1,welcomePoints:0}});
    const day = getCurrentBusinessDateValue(new Date(), f.business.timezone, f.business.businessDayCutoffTime);
    const range = getBusinessDayRange({ fromDateValue: day, toDateValue: day, timezone: f.business.timezone, businessDayCutoffTime: f.business.businessDayCutoffTime });
    const setMode = (enabled: boolean) => saveCashierShiftSetting(db, { businessId: f.business.id, actor: { userId: f.actor.id }, enabled });
    const product = await db.product.create({ data: { businessId: f.business.id, name: "Mixed history", price: 300 } });
    async function sale(amount: number, method: string, shiftId: string | null) {
      await db.product.update({ where: { id: product.id }, data: { price: amount } });
      const form = new FormData();
      for (const [k,v] of Object.entries({ operationId: randomUUID(), branchId: f.branch.id, customerId: f.customer.id, productId: product.id, productQuantity: "1", method, paymentMethodCode: `BUILTIN_${method}`, walletAmount: "0", reference: "Mixed fixture", modeAtConfirmation: shiftId ? "ON" : "OFF", shiftId: shiftId ?? "" })) form.set(k,v);
      const result = await h.action.completeCashierSaleAction(form);
      assert.equal(result.status, "success", result.message);
      return db.payment.findFirstOrThrow({ where: { invoiceId: result.invoice!.id } });
    }
    const cash = await sale(300, "CASH", f.shift.id);
    await db.businessModuleEntitlement.create({ data: { businessId: f.business.id, moduleKey: "EXPENSE", status: "ENABLED", source: "MANUAL", enabledFrom: new Date(0) } });
    await ensureStarterExpenseCategories(f.business.id, db);
    const category = await db.expenseCategory.findFirstOrThrow({ where: { businessId: f.business.id } });
    const actor = { userId: f.actor.id, name: f.actor.name, email: "" };
    const expense = await createBusinessExpense({ actor, businessId: f.business.id, branchId: f.branch.id, amount: 30, categoryId: category.id, description: "ON drawer", desiredStatus: "CONFIRMED", expenseDate: day, operationKey: randomUUID() }, db);
    await markBusinessExpensePaid({ actor, businessId: f.business.id, expenseId: expense.id, expectedRevision: expense.revision, amount: 30, operationKey: randomUUID(), paymentDate: day, cashierShiftId: f.shift.id, paymentMethod: "CASH", paymentSource: "POS_DRAWER" }, db);
    await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED", endedAt: new Date() } });
    await setMode(false);
    await sale(200, "CARD", null);
    const offer = await db.walletTopUpOffer.create({ data: { businessId: f.business.id, name: "Untouched100", paidAmount: 100, bonusAmount: 0 } });
    const offInput = { ...f.input, offerId: offer.id, operationKey: randomUUID(), modeAtConfirmation: "OFF" as const, shiftId: null };
    const offCtx = { ...f.ctx, shiftId: null };
    const top = await postWalletTopUp(offCtx, offInput, db);
    await reverseWalletTopUp(offCtx, { operationKey: randomUUID(), topUpId: top.topUpId, reason: "Reverse untouched100" }, db);
    const refund = new FormData();
    for (const [k,v] of Object.entries({ operationId: randomUUID(), invoiceId: cash.invoiceId!, paymentId: cash.id, amount: "50", method: "CASH", reason: "Mixed history partial refund", reference: "", modeAtConfirmation: "OFF", shiftId: "" })) refund.set(k,v);
    const result = await h.invoices.refundPaymentAction({ status: "idle", message: "" }, refund);
    assert.equal(result.status, "success", result.message);
    await setMode(true);
    const nextShift = await db.cashierShift.create({ data: { businessId: f.business.id, branchId: f.branch.id, cashierId: f.actor.id } });
    await postWalletTopUp({...f.ctx,shiftId:nextShift.id}, {...f.input,shiftId:nextShift.id}, db);
    await db.cashierShift.update({ where: { id: nextShift.id }, data: { status: "CLOSED", endedAt: new Date() } });

    const facts = async () => ({
      payments: await db.payment.findMany({ where: { businessId: f.business.id }, orderBy: { id: "asc" } }),
      refunds: await db.paymentRefund.findMany({ where: { businessId: f.business.id }, orderBy: { id: "asc" } }),
      topups: await db.walletTopUp.findMany({ where: { businessId: f.business.id }, orderBy: { id: "asc" } }),
      ledger: await db.walletTransaction.findMany({ where: { businessId: f.business.id }, orderBy: { id: "asc" } }),
      performance: await db.performanceReceipt.findMany({ where: { businessId: f.business.id }, orderBy: { id: "asc" } }),
      loyalty: await db.loyaltyTransaction.findMany({ where: { businessId: f.business.id }, orderBy: { id: "asc" } }),
      operations: await db.financialOperation.findMany({ where: { businessId: f.business.id }, orderBy: { id: "asc" } }),
    });
    const original = await facts();
    assert.deepEqual(original.payments.map(p => [p.method, cents(p.amount), p.shiftId]).sort(), [["CASH",30000,f.shift.id],["CASH",90000,nextShift.id],["CASH",10000,null],["CARD",20000,null]].sort());
    assert.deepEqual(original.refunds.map(r => [cents(r.amount),r.shiftId]).sort(), [[5000,null],[10000,null]].sort());
    const payout = await db.cashierShiftExpensePayout.findFirstOrThrow({ where: { businessId: f.business.id } });
    assert.equal(cents(payout.amount),3000); assert.equal(payout.shiftId,f.shift.id);
    assert.equal(original.payments.filter(p=>p.method==="CASH").reduce((s,p)=>s+cents(p.amount),0)-original.refunds.reduce((s,r)=>s+cents(r.amount),0)-cents(payout.amount),112000);
    const group = await db.businessGroup.create({ data: { name: "Mixed group", code: randomUUID() } });
    await db.businessGroupMember.create({ data: { groupId: group.id, businessId: f.business.id, joinedAt: new Date(0) } });
    const emptyStore = await walletFixture(db);
    await db.businessGroupMember.create({ data: { groupId: group.id, businessId: emptyStore.business.id, joinedAt: new Date(0) } });
    await db.businessGroupUser.create({ data: { groupId: group.id, userId: f.actor.id, role: "GROUP_OWNER" } });
    await db.user.update({ where: { id: f.actor.id }, data: { loginEnabled: true } });
    for (const enabled of [true,false,true]) {
      await setMode(enabled);
      const daily = await getDailySalesReport({ businessId: f.business.id, branchId: f.branch.id, range },db);
      assert.equal(daily.summary.netSalesCents,45000); assert.equal(daily.summary.grossCollectionsCents,150000); assert.equal(daily.summary.netCollectionsCents,135000);
      assert.equal(daily.walletActivity.topUpPrincipalCents,100000); assert.equal(daily.walletActivity.topUpBonusCents,10000); assert.equal(daily.walletActivity.reversedPrincipalCents,10000);
      const dashboard = await getBusinessPerformanceReadModel({ businessId:f.business.id,allowedBranchIds:[f.branch.id],includeBusinessWide:true,range:"today" },db);
      assert.equal(dashboard.sales?.netSalesCents,45000); assert.equal(dashboard.sales?.paymentsCollectedCents,135000);
      const groupInput = { groupId:group.id,userId:f.actor.id,activeBusinessId:f.business.id,range:"today" as const };
      const report = await getGroupReports(groupInput,db); assert.ok(report);
      assert.equal(report.summary.netSalesCents,45000); assert.equal(report.summary.paymentsCollectedCents,150000); assert.equal(report.summary.refundsCents,5000);
      const kpi = await getAllStoresKpiReport(groupInput,db); assert.ok(kpi);
      // Group / All Stores expose gross collections; dashboard exposes net.
      assert.equal(kpi.current.netSalesCents,45000); assert.equal(kpi.current.paymentsCollectedCents,150000); assert.equal(kpi.current.refundsCents,5000);
      await refreshDailyStoreSummaries({ fromDate:day,toDate:day,businessIds:[f.business.id] },db);
      const summary = await db.analyticsDailyStoreSummary.findFirstOrThrow({ where:{businessId:f.business.id} });
      assert.equal(summary.netSalesCents,45000); assert.equal(summary.grossCollectionsCents,150000);
      const closing = await getDailyClosingReport({ businessId:f.business.id,branchId:f.branch.id,industryType:"SALON_BEAUTY",dateValue:day },db);
      assert.equal(closing.report.cashDrawer.expensePayoutCents,3000);
      assert.equal(closing.report.financial.collectedCents,135000);
      const panel = await getWalletPanel(offCtx,f.customer.id,db);
      assert.equal(panel.totalBalance,"1000.00"); assert.deepEqual(panel.ownerDetails,{paidBalance:"900.00",bonusBalance:"100.00"});
      const history = await getWalletHistory(offCtx,f.customer.id,0,db);
      assert.deepEqual(history.rows.map(r=>[r.type,r.amount]).sort(), [["Top-up","1000.00"],["Top-up","100.00"],["Top-up reversal","-100.00"]].sort());
      const performance=await readPerformanceLedger({businessId:f.business.id,branchId:f.branch.id,actorUserId:f.actor.id},{year:Number(day.slice(0,4)),asOf:new Date()},db);
      assert.equal(performance.team.total,45000);assert.equal(performance.team.salesRefunds,5000);assert.equal(performance.coverageStatus,"COMPLETE");
      const membership=await db.customerMembership.findFirstOrThrow({where:{businessId:f.business.id,customerId:f.customer.id}});
      assert.equal(membership.pointsBalance,450,"500 sale points minus50 refund; no TopUp/bonus points");
      assert.deepEqual(await facts(),original,"settings/readers cannot rewrite financial history");
      assert.equal(await db.dailyClosingSnapshot.count({where:{businessId:f.business.id}}),0);
    }
  } finally { await h.close(); }
});
