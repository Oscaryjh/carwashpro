import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase, walletFixture } from "../helpers/wallet-fixture";
import { checkoutHarness } from "../helpers/wallet-checkout-fixture";
import { postWalletTopUp } from "../../src/lib/wallet/top-up";
import { getDailySalesReport } from "../../src/lib/reports/daily-sales";
import { getBusinessPerformanceReadModel } from "../../src/lib/business-performance/read-model";
import { getBusinessDayRange, getCurrentBusinessDateValue } from "../../src/lib/business-day";
import { getDailyClosingReport } from "../../src/lib/daily-closing/query";
import { refundWalletSale } from "../../src/lib/wallet/refunds";
import { reverseWalletTopUp } from "../../src/lib/wallet/reversals";
import { getGroupReports } from "../../src/lib/business-groups/group-reports";
import { buildGroupReportCsv } from "../../src/lib/business-groups/group-report-export";
import { refreshDailyStoreSummaries } from "../../src/lib/analytics/daily-store-summary";

const db = walletTestDatabase();
after(() => db.$disconnect());
test("real top-up and mixed sales reconcile canonical facts with daily sales and dashboard", async () => {
  const h = await checkoutHarness();
  try {
    const f = await walletFixture(db, "1000", "100");
    await postWalletTopUp(f.ctx, f.input, db);
    await h.login(db, f);
    const day = getCurrentBusinessDateValue(new Date(), f.business.timezone, f.business.businessDayCutoffTime);
    const range = getBusinessDayRange({ fromDateValue: day, toDateValue: day, timezone: f.business.timezone, businessDayCutoffTime: f.business.businessDayCutoffTime });
    const read = () => getDailySalesReport({ businessId: f.business.id, branchId: f.branch.id, range }, db);
    assert.equal((await read()).summary.netSalesCents, 0);
    assert.equal((await read()).summary.grossCollectionsCents, 100000);
    const product = await db.product.create({ data: { businessId: f.business.id, name: "P1F synthetic", price: 180 } });
    async function sell(price: number, wallet: string, method: string) {
      await db.product.update({ where: { id: product.id }, data: { price } });
      const form = new FormData();
      for (const [key, value] of Object.entries({ modeAtConfirmation: "ON", shiftId: f.shift.id, operationId: randomUUID(), branchId: f.branch.id, customerId: f.customer.id, productId: product.id, productQuantity: "1", method, walletAmount: wallet, paymentMethodCode: method === "MEMBER_WALLET" ? method : `BUILTIN_${method}`, ...(method !== "MEMBER_WALLET" ? { reference: "P1F synthetic" } : {}) })) form.set(key, value);
      const result = await h.action.completeCashierSaleAction(form);
      assert.equal(result.status, "success", result.message);
    }
    await sell(180, "180", "MEMBER_WALLET");
    let report = await read();
    assert.equal(report.summary.netSalesCents, 18000);
    assert.equal(report.summary.grossCollectionsCents, 100000);
    await sell(300, "200", "CARD");
    report = await read();
    assert.equal(report.summary.netSalesCents, 48000);
    assert.equal(report.summary.grossCollectionsCents, 110000);
    assert.equal(report.walletActivity.topUpPrincipalCents, 100000);
    assert.equal(report.walletActivity.topUpBonusCents, 10000);
    assert.equal(report.walletActivity.redemptionPaidCents, 28000);
    assert.equal(report.walletActivity.redemptionBonusCents, 10000);
    const invoices = await db.invoice.findMany({ where: { businessId: f.business.id } });
    assert.equal(invoices.length, 2);
    assert.equal(invoices.reduce((sum, row) => sum + Number(row.total), 0), 480);
    const payments = await db.payment.findMany({ where: { businessId: f.business.id } });
    assert.equal(payments.filter(row => row.method === "MEMBER_WALLET").reduce((sum, row) => sum + Number(row.amount), 0), 380);
    assert.equal(payments.filter(row => row.method !== "MEMBER_WALLET").reduce((sum, row) => sum + Number(row.amount), 0), 1100);
    const account = await db.walletAccount.findFirstOrThrow({ where: { businessId: f.business.id } });
    assert.equal(account.paidBalance.toFixed(2), "720.00");
    assert.equal(account.bonusBalance.toFixed(2), "0.00");
    const dashboard = await getBusinessPerformanceReadModel({ businessId: f.business.id, allowedBranchIds: [f.branch.id], includeBusinessWide: true, range: "today" }, db);
    assert.equal(dashboard.sales?.netSalesCents, 48000);
    assert.equal(dashboard.sales?.paymentsCollectedCents, 110000);
    assert.equal(dashboard.walletActivity?.topUpBonusCents, 10000);
    const group = await db.businessGroup.create({ data: { name: "P1F synthetic group", code: randomUUID() } });
    await db.businessGroupMember.create({ data: { groupId: group.id, businessId: f.business.id, joinedAt: new Date(0) } });
    const secondBusiness = await walletFixture(db);
    await db.businessGroupMember.create({ data: { groupId: group.id, businessId: secondBusiness.business.id, joinedAt: new Date(0) } });
    await db.businessGroupUser.create({ data: { groupId: group.id, userId: f.actor.id, role: "GROUP_OWNER" } });
    await db.user.update({ where: { id: f.actor.id }, data: { loginEnabled: true } });
    const groupReport = await getGroupReports({ groupId: group.id, userId: f.actor.id, activeBusinessId: f.business.id, range: "today" }, db);
    assert.ok(groupReport);
    assert.equal(groupReport.summary.netSalesCents, 48000);
    assert.equal(groupReport.summary.paymentsCollectedCents, 110000);
    assert.equal(groupReport.walletActivity?.topUpBonusCents, 10000);
    assert.match(buildGroupReportCsv(groupReport).toString("utf8"), /"Bonus credited","100"/);
    await refreshDailyStoreSummaries({ fromDate: day, toDate: day, businessIds: [f.business.id, secondBusiness.business.id] }, db);
    const storedSummary = await db.analyticsDailyStoreSummary.findFirstOrThrow({ where: { businessId: f.business.id } });
    assert.equal(storedSummary.netSalesCents, 48000);
    assert.equal(storedSummary.grossCollectionsCents, 110000);
    const cachedGroup = await getGroupReports({ groupId: group.id, userId: f.actor.id, activeBusinessId: f.business.id, range: "today" }, db, { analyticsReadMode: "PRIMARY" });
    assert.ok(cachedGroup);
    assert.equal(cachedGroup.analyticsFallbackReason, "WALLET_CANONICAL");
    assert.equal(cachedGroup.summary.netSalesCents, 48000);
    assert.equal(cachedGroup.summary.paymentsCollectedCents, 110000);
    const membership = await db.businessGroupMember.findFirstOrThrow({ where: { groupId: group.id, businessId: f.business.id } });
    await db.businessGroupMember.update({ where: { id: membership.id }, data: { joinedAt: new Date(Date.now() + 60_000) } });
    const excludedGroup = await getGroupReports({ groupId: group.id, userId: f.actor.id, activeBusinessId: f.business.id, range: "today" }, db);
    assert.ok(excludedGroup);
    assert.equal(excludedGroup.summary.netSalesCents, 0);
    assert.equal(excludedGroup.summary.paymentsCollectedCents, 0);
    assert.equal(excludedGroup.walletActivity?.topUpPrincipalCents, 0);
    assert.equal(excludedGroup.walletActivity?.redemptionPaidCents, 0);
    await db.businessGroupMember.update({ where: { id: membership.id }, data: { joinedAt: membership.joinedAt } });
    await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED" } });
    const walletPayment = payments.find(row => row.method === "MEMBER_WALLET" && Number(row.amount) === 180)!;
    await refundWalletSale(f.ctx, { operationKey: randomUUID(), invoiceId: walletPayment.invoiceId!,
      reason: "P1F synthetic full refund", stockLines: [],
      legs: [{ paymentId: walletPayment.id, amountCents: 18000, method: "MEMBER_WALLET" }] }, db);
    const closing = await getDailyClosingReport({ businessId: f.business.id, branchId: f.branch.id, industryType: "SALON_BEAUTY", dateValue: day }, db);
    assert.equal(closing.report.financial.netSalesCents, 30000);
    assert.equal(closing.report.financial.collectedCents, 110000);
    assert.equal(closing.report.walletActivity?.refundPaidCents, 8000);
    assert.equal(closing.report.walletActivity?.refundBonusCents, 10000);
  } finally { await h.close(); }
});

test("cash top-up and unassigned reversal use their own dates across the Malaysia month/cutoff boundary", async () => {
  const f = await walletFixture(db, "1000", "100");
  await db.business.update({ where: { id: f.business.id }, data: { timezone: "Asia/Kuching", businessDayCutoffTime: "02:00" } });
  // Deterministic source timestamps are assigned at INSERT on a disposable fixture.
  // Keep the database immutability trigger enabled; never rewrite refund facts.
  const datedDb = db.$extends({ query: {
    payment: { create({ args, query }) { return query({ ...args, data: { ...args.data, paidAt: new Date("2026-09-30T17:59:59.999Z") } }); } },
    paymentRefund: { create({ args, query }) { return query({ ...args, data: { ...args.data, refundedAt: new Date("2026-09-30T18:00:00.000Z") } }); } },
  } }) as unknown as typeof db;
  const top = await postWalletTopUp(f.ctx, f.input, datedDb);
  await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED" } });
  const closedShift = await db.cashierShift.findUniqueOrThrow({ where: { id: f.shift.id } });
  await reverseWalletTopUp(f.ctx, { operationKey: randomUUID(), topUpId: top.topUpId, reason: "P1F cutoff synthetic" }, datedDb);
  const previous = await getDailyClosingReport({ businessId: f.business.id, branchId: f.branch.id, industryType: "SALON_BEAUTY", dateValue: "2026-09-30" }, db);
  const current = await getDailyClosingReport({ businessId: f.business.id, branchId: f.branch.id, industryType: "SALON_BEAUTY", dateValue: "2026-10-01" }, db);
  assert.equal(previous.report.financial.netSalesCents, 0);
  assert.equal(previous.report.financial.collectedCents, 100000);
  assert.equal(previous.report.walletActivity?.topUpPrincipalCents, 100000);
  assert.equal(previous.report.walletActivity?.reversedPrincipalCents, 0);
  assert.equal(current.report.financial.netSalesCents, 0);
  assert.equal(current.report.financial.collectedCents, -100000);
  assert.equal(current.report.walletActivity?.topUpPrincipalCents, 0);
  assert.equal(current.report.walletActivity?.reversedPrincipalCents, 100000);
  assert.equal(current.report.cashDrawer.unassignedRefundCents, 100000);
  assert.deepEqual(await db.cashierShift.findUniqueOrThrow({ where: { id: f.shift.id } }), closedShift);
  assert.equal(await db.invoice.count({ where: { businessId: f.business.id } }), 0);
});

test("unconsumed cash top-up reversal is an unassigned cash refund, never a sales refund", async () => {
  const f = await walletFixture(db, "1000", "100");
  const top = await postWalletTopUp(f.ctx, f.input, db);
  await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED" } });
  const before = await db.cashierShift.findUniqueOrThrow({ where: { id: f.shift.id } });
  await reverseWalletTopUp(f.ctx, { operationKey: randomUUID(), topUpId: top.topUpId, reason: "P1F synthetic reversal" }, db);
  const day = getCurrentBusinessDateValue(new Date(), f.business.timezone, f.business.businessDayCutoffTime);
  const closing = await getDailyClosingReport({ businessId: f.business.id, branchId: f.branch.id, industryType: "SALON_BEAUTY", dateValue: day }, db);
  assert.equal(closing.report.financial.netSalesCents, 0);
  assert.equal(closing.report.financial.refundsCents, 0);
  assert.equal(closing.report.financial.collectedCents, 0);
  assert.equal(closing.report.cashDrawer.unassignedRefundCents, 100000);
  assert.equal(closing.report.walletActivity?.reversedPrincipalCents, 100000);
  assert.equal(closing.report.walletActivity?.reversedBonusCents, 10000);
  assert.deepEqual(await db.cashierShift.findUniqueOrThrow({ where: { id: f.shift.id } }), before);
  const refunds = await db.paymentRefund.findMany({ where: { businessId: f.business.id } });
  assert.equal(refunds.length, 1); assert.equal(refunds[0].shiftId, null);
  assert.equal(refunds[0].amount.toFixed(2), "1000.00");
  assert.equal(await db.invoice.count({ where: { businessId: f.business.id } }), 0);
});
