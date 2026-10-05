import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DailyTransactions, CollectedPayments } from "../../src/components/reports/daily-transactions";
import type { DailySalesReport } from "../../src/lib/reports/daily-sales";
const wallet = { topUpPrincipalCents: 0, topUpBonusCents: 0, redemptionPaidCents: 0, redemptionBonusCents: 0, refundPaidCents: 0, refundBonusCents: 0, reversedPrincipalCents: 0, reversedBonusCents: 0, voidRestoredPaidCents: 0, voidRestoredBonusCents: 0 };
const day = { dateValue: "2026-10-03", grossSalesCents: 20000, netSalesCents: 10000, transactionCount: 1, averageSaleCents: 10000, refundsCents: 0, discountsCents: 10000, grossCollectionsCents: 0, netCollectionsCents: 0, paymentMethods: [] };
const report = { walletActivity: wallet, summary: day, days: [day], paymentMethods: [], selectedDay: null } as unknown as DailySalesReport;
const expense = { oneOff: 0, recurring: 0, paymentsInPeriod: 0, paid: 0, unpaid: 0 };
async function advanced(props: Partial<{ report: DailySalesReport; expense: typeof expense }> = {}) {
  assert.ok(existsSync("src/components/reports/advanced-details.tsx"), "conditional advanced presentation exists");
  const { AdvancedReportDetails } = await import("../../src/components/reports/advanced-details");
  return renderToStaticMarkup(createElement(AdvancedReportDetails, { report, expense, baseHref: "/reports?range=month", ...props }));
}
for (const period of ["7days", "month", "custom"]) test(`${period} uses six-column daily summary, not gross sales or transaction list`, () => {
  const html = renderToStaticMarkup(createElement(DailyTransactions, { report, today: false, timezone: "Asia/Singapore", baseHref: `/reports?range=${period}` }));
  assert.match(html, />Daily Sales by Day</);
  assert.equal((html.match(/<th[ >]/g) ?? []).length, 6);
  for (const label of ["Date", "Transactions", "Net Sales", "Refunds", "Payments Collected", "View"]) assert.ok(html.includes(`>${label}<`));
  assert.doesNotMatch(html, /RM200.00/); assert.match(html, /day=2026-10-03/);
});
test("Today title and empty contract unchanged", () => {
  assert.match(renderToStaticMarkup(createElement(DailyTransactions, { report, today: true, timezone: "Asia/Singapore", baseHref: "/reports?range=today" })), />Daily Transactions</);
});
test("non-sales hint requires positive top-up principal, not sales/collections difference or bonus alone", () => {
  const render = (r: DailySalesReport) => renderToStaticMarkup(createElement(CollectedPayments, { report: r, baseHref: "/reports" }));
  assert.doesNotMatch(render({ ...report, summary: { ...report.summary, netCollectionsCents: 999999 } }), /Includes non-sales/);
  assert.doesNotMatch(render({ ...report, walletActivity: { ...wallet, topUpBonusCents: 100 } }), /Includes non-sales/);
  assert.match(render({ ...report, walletActivity: { ...wallet, topUpPrincipalCents: 100 } }), /Includes non-sales collections such as wallet top-ups\./);
});
test("all-zero advanced sections render nothing", async () => { assert.equal(await advanced(), ""); });
test("wallet summary uses nonzero existing facts; detailed breakdown is collapsed and excludes zero rows", async () => {
  const html = await advanced({ report: { ...report, walletActivity: { ...wallet, topUpPrincipalCents: 100000, topUpBonusCents: 10000, redemptionPaidCents: 2000, redemptionBonusCents: 8000 } } });
  for (const text of ["Wallet Activity", "Top-ups", "Bonus credited", "Wallet used", "RM1,000.00", "View wallet breakdown", "Redemption paid credit", "Redemption bonus credit"]) assert.ok(html.includes(text));
  assert.doesNotMatch(html, /<details[^>]* open|Wallet refunds|Invoice void|Refund paid credit|RM0.00/);
});
test("reversal-only wallet remains accessible even with no summary activity", async () => {
  const html = await advanced({ report: { ...report, walletActivity: { ...wallet, reversedPrincipalCents: 100 } } });
  assert.match(html, /Wallet Activity/); assert.match(html, /Top-up reversal principal/);
});
test("expense breakdown only presents one-off/recurring; settlement independent and nonzero", async () => {
  const html = await advanced({ expense: { ...expense, oneOff: 12, unpaid: 12 } });
  assert.match(html, /Expense Breakdown/); assert.match(html, /One-off Expenses/); assert.match(html, /Expense Settlement/);
  assert.doesNotMatch(html, /Net Sales|Confirmed Expenses|Operating Balance|Business Performance/);
});
test("refund breakdown retains positive sales and external refund facts", async () => {
  const html = await advanced({ report: { ...report, summary: { ...day, refundsCents: 12000 }, paymentMethods: [{ label: "Cash", paymentCount: 0, grossCents: 0, netCents: -8000, refundCents: 8000, sharePercent: 0 }] } });
  assert.match(html, /Sales refunds/); assert.match(html, /External refunds/); assert.match(html, /RM120.00/); assert.match(html, /RM80.00/);
});
test("payment breakdown preserves counts/refunds/links but no repeated period net total", async () => {
  const html = await advanced({ report: { ...report, paymentMethods: [{ label: "Cash", paymentCount: 1, grossCents: 100000, netCents: 99000, refundCents: 1000, sharePercent: 100 }] } });
  assert.match(html, /Payment Breakdown/); assert.match(html, /1 payment/); assert.match(html, /Gross/); assert.match(html, /Refunds/); assert.match(html, /paymentMethod=Cash/);
  assert.doesNotMatch(html, /Net collected|Daily Sales|Business Performance/);
});
test("page removes duplicate legacy sections and retains appointment attribution and balance formula", () => {
  const page = readFileSync("src/app/(business)/reports/page.tsx", "utf8");
  assert.doesNotMatch(page, /function DailySalesSection|function PaymentsCollectedSection/);
  assert.equal((page.match(/title="Business Performance"/g) ?? []).length, 1);
  assert.match(page, /Attributed Sales/);
  assert.ok(page.includes('money(Number(fromCents(dailySalesReport.summary.netSalesCents)) - Number(expenseSummary.recorded))'));
  assert.doesNotMatch(page, /\{data.totalAppointments\} appointments/);
});
