import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "postcss";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { transform } from "esbuild";
import type { ReactElement } from "react";
import type { DailySalesReport } from "../../src/lib/reports/daily-sales";

async function components() {
  assert.ok(existsSync("src/components/reports/daily-transactions.tsx"), "Reports home presentation component must exist");
  return import("../../src/components/reports/daily-transactions");
}
const summary = { grossSalesCents: 9600, netSalesCents: 4800, transactionCount: 1, averageSaleCents: 4800, refundsCents: 4800, discountsCents: 400, grossCollectionsCents: 9600, netCollectionsCents: 4800 };
const transaction = { id: "internal-id", invoiceNumber: "1007", issuedAt: new Date("2026-10-04T05:00:00Z"), customerName: "Customer A", staffName: "Staff A", subtotalCents: 10000, discountCents: 400, totalCents: 9600, paymentLabel: "Package + Cash", status: "PAID", displayStatus: "Partially Refunded" };
const report = { summary, days: [{ ...summary, dateValue: "2026-10-04", paymentMethods: [] }], selectedDay: { dateValue: "2026-10-04", transactions: [transaction], page: 1, hasNext: true }, paymentMethods: [] } as unknown as DailySalesReport;
test("Sales Overview renders exactly five core KPI and no appointment cards", async () => {
  const { SalesOverview } = await components();
  const html = renderToStaticMarkup(createElement(SalesOverview, { report }));
  assert.equal((html.match(/report-kpi-card/g) ?? []).length, 5);
  for (const label of ["Sales Overview", "Net Sales", "Transactions", "Average Sale", "Refunds", "Discounts"]) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /Appointment|Sales Summary|>Summary</);
});
for (const source of ["Package", "Package + Cash", "Package + Card", "Member wallet + Cash", "Not recorded", "Unpaid"]) {
  test(`Today table preserves source ${source} and transaction facts`, async () => {
    const { DailyTransactions } = await components();
    const html = renderToStaticMarkup(createElement(DailyTransactions, { report: { ...report, selectedDay: { ...report.selectedDay!, transactions: [{ ...transaction, paymentLabel: source }] } }, today: true, timezone: "Asia/Singapore", baseHref: "/reports?range=today&branchId=authorized" }));
    assert.equal((html.match(/<th[ >]/g) ?? []).length, 8);
    for (const value of ["1007", "Customer A", "Staff A", "RM96.00", source, "Partially Refunded", "/invoices/internal-id"]) assert.ok(html.includes(value));
    assert.match(html, /transactionPage=2/); assert.match(html, /branchId=authorized/);
    assert.doesNotMatch(html, />internal-id<|FinancialOperation|operationKey/);
  });
}
test("multi-day shows date summaries including refund-only negatives, never full transaction DOM", async () => {
  const { DailyTransactions } = await components();
  const html = renderToStaticMarkup(createElement(DailyTransactions, { report: { ...report, days: [{ ...report.days[0], transactionCount: 0, netSalesCents: -4800, netCollectionsCents: -4800 }] }, today: false, timezone: "Asia/Singapore", baseHref: "/reports?range=custom&from=2026-10-01&to=2026-10-05&branchId=authorized" }));
  assert.match(html, /View day/); assert.match(html, /day=2026-10-04/); assert.match(html, /-RM48.00|RM-48.00/);
  assert.doesNotMatch(html, /Customer A/);
});
test("transaction pagination keeps explicit day and range, safely renders empty later page", async () => {
  const { DailyTransactions } = await components();
  const html = renderToStaticMarkup(createElement(DailyTransactions, { report: { ...report, selectedDay: { ...report.selectedDay!, transactions: [], page: 4, hasNext: false } }, today: true, timezone: "Asia/Singapore", baseHref: "/reports?range=custom&from=2026-10-01&to=2026-10-05&day=2026-10-04&branchId=authorized" }));
  assert.match(html, /No transactions on this page/); assert.match(html, /transactionPage=3/); assert.match(html, /day=2026-10-04/); assert.doesNotMatch(html, />Next</);
});
test("payments hide zero methods but retain negative refund facts and compact empty state", async () => {
  const { CollectedPayments } = await components();
  const empty = renderToStaticMarkup(createElement(CollectedPayments, { report, baseHref: "/reports?range=today" }));
  assert.match(empty, /No payments collected in this period\./);
  const html = renderToStaticMarkup(createElement(CollectedPayments, { report: { ...report, paymentMethods: [{ label: "Zero", paymentCount: 0, grossCents: 0, refundCents: 0, netCents: 0, sharePercent: 0 }, { label: "Cash", paymentCount: 0, grossCents: 0, refundCents: 100, netCents: -100, sharePercent: 0 }] }, baseHref: "/reports?range=today" }));
  assert.doesNotMatch(html, />Zero</); assert.match(html, />Cash</);
});
test("page wiring keeps details collapsed, explicit drawers separate from Today auto-read and two business metrics", () => {
  const page = readFileSync("src/app/(business)/reports/page.tsx", "utf8");
  assert.match(page, /<details className=\{styles.moreDetails\}>/);
  assert.match(page, /isDateInput\(params.day\) && dailySalesReport.selectedDay/);
  assert.match(page, /activeRange === "today" \? fromValue : undefined/);
  assert.ok(page.indexOf("<DailyTransactions") < page.indexOf("<CollectedPayments"));
  const primary = page.slice(page.indexOf('<ReportCard title="Business Performance">'), page.indexOf("<details className={styles.moreDetails}>"));
  for (const label of ["Business Expenses", "Operating Balance", "Not accounting profit."]) assert.ok(primary.includes(label));
  assert.doesNotMatch(primary, /label: "Net Sales"/);
  assert.equal((primary.match(/label:/g) ?? []).length, 2);
  assert.ok(primary.includes('value: money(Number(fromCents(dailySalesReport.summary.netSalesCents)) - Number(expenseSummary.recorded))'), "Operating Balance retains the exact canonical inputs and formula");
  assert.doesNotMatch(primary, /One-off Expenses|Recurring Expenses|Expense Settlement/);
  assert.ok(page.indexOf("<AdvancedReportDetails") > page.indexOf("<details className={styles.moreDetails}>"));
});

test("bounded Today DTO renders 20 rows, with long names preserved rather than truncated", async () => {
  const { DailyTransactions } = await components();
  const customerName = "Long customer name ".repeat(8);
  const staffName = "Long staff name ".repeat(8);
  const rows = Array.from({ length: 20 }, (_, i) => ({ ...transaction, id: `invoice-${i}`, invoiceNumber: String(i), customerName, staffName }));
  const html = renderToStaticMarkup(createElement(DailyTransactions, { report: { ...report, selectedDay: { ...report.selectedDay!, transactions: rows } }, today: true, timezone: "Asia/Singapore", baseHref: "/reports?range=today" }));
  assert.equal((html.match(/<tr>/g) ?? []).length, 21);
  assert.ok(html.includes(customerName)); assert.ok(html.includes(staffName));
  const css = readFileSync("src/app/(business)/reports/reports.module.css", "utf8");
  assert.match(css, /white-space: normal; overflow-wrap: anywhere/);
});

test("Salon has standalone services without duplicated staff/appointments; Wallet stays in details", async () => {
  const page = readFileSync("src/app/(business)/reports/page.tsx", "utf8");
  const performanceStart = page.indexOf("function SalonReportSections");
  const performanceEnd = page.indexOf("function getReportRange(", performanceStart);
  assert.ok(performanceStart >= 0 && performanceEnd > performanceStart);
  const code = await transform(`import {formatReportMoney as money} from './src/lib/reports/presentation';${page.slice(performanceStart, performanceEnd)};export {SalonReportSections};`, {loader:'tsx',format:'cjs',jsx:'automatic'});
  const compiled = {exports:{} as {SalonReportSections:(props:{data:object})=>ReactElement|null}};
  new Function('require','module','exports',code.code)(createRequire(`${process.cwd()}/package.json`),compiled,compiled.exports);
  const data = {serviceSales:[{serviceId:'haircut',name:'Haircut',quantity:2,amount:45}]};
  const html = renderToStaticMarkup(createElement(compiled.exports.SalonReportSections,{data}));
  assert.match(html, /Top Services/);
  assert.match(html, /Haircut/); assert.match(html, /RM45\.00/); assert.match(html, /<td>2<\/td>/);
  assert.doesNotMatch(html,/Top Staff|Attributed Sales|Appointments|Repeat visits|Performance|report-operational-grid|Empty/);
  assert.equal(renderToStaticMarkup(createElement(compiled.exports.SalonReportSections,{data:{...data,serviceSales:[]}})), '');
  const details = page.slice(page.indexOf("<details className={styles.moreDetails}>"), page.indexOf("</details>"));
  assert.match(details, /<AdvancedReportDetails/);
  assert.doesNotMatch(page.slice(page.indexOf("<SalesOverview"), page.indexOf("<details className={styles.moreDetails}>")), /WalletFinancialSummary|DailySalesSection|Appointment Summary/);
});

test("remaining non-Salon operational grid keeps its tablet and desktop layout", () => {
  const css = parse(readFileSync("src/app/(business)/reports/reports.module.css", "utf8"));
  // Check the active responsive contract, not a snapshot of CSS formatting.
  // Removing either tablet override would restore the overflowing three-card row.
  for (const [width, expected] of [
    [768, "repeat(1, minmax(0, 1fr))"],
    [1024, "repeat(2, minmax(0, 1fr))"],
    [1280, "repeat(auto-fit, minmax(220px, 1fr))"],
    [1440, "repeat(auto-fit, minmax(220px, 1fr))"],
  ] as const) {
    let columns = "";
    css.walkRules(".home :global(.report-operational-grid)", (rule) => {
      const parent = rule.parent;
      if (parent?.type === "atrule") {
        assert.equal(parent.name, "media");
        const maximum = /^\(max-width:\s*(\d+)px\)$/.exec(parent.params);
        assert.ok(maximum, "Performance breakpoint must be an explicit maximum width");
        if (width > Number(maximum[1])) return;
      }
      rule.walkDecls("grid-template-columns", (declaration) => { columns = declaration.value; });
    });
    assert.equal(columns, expected, `Performance grid at ${width}px`);
  }
});
