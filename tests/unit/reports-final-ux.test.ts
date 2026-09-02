import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ReportFilterPanel,
  type ReportFilterRange,
} from "../../src/components/report-filter-panel";
import type { DailySalesRow } from "../../src/lib/reports/daily-sales";
import {
  formatPaymentShare,
  formatReportMoney,
  getVisibleDailySalesDays,
  normalizeReportDateRange,
} from "../../src/lib/reports/presentation";

const baseProps = {
  fromValue: "2026-08-01",
  selectedBranchId: null,
  toValue: "2026-08-27",
};

function renderFilter(activeRange: ReportFilterRange) {
  return renderToStaticMarkup(
    createElement(ReportFilterPanel, { ...baseProps, activeRange }),
  );
}

test("report filter always renders Today, 7 Days, Month and Custom", () => {
  const html = renderFilter("today");
  for (const label of ["Today", "7 Days", "Month", "Custom"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
});

for (const range of ["today", "7days", "month"] as const) {
  test(`${range} hides custom From and To date controls`, () => {
    const html = renderFilter(range);
    assert.doesNotMatch(html, /name="from"/);
    assert.doesNotMatch(html, /name="to"/);
    assert.doesNotMatch(html, /name="branchId"/);
    assert.doesNotMatch(html, />Run report</);
  });
}

test("custom shows From and To date controls", () => {
  const html = renderFilter("custom");
  assert.match(html, />From</);
  assert.match(html, /name="from"/);
  assert.match(html, />To</);
  assert.match(html, /name="to"/);
  assert.match(html, /report-filter-form-custom/);
  assert.doesNotMatch(html, />Branch</);
  assert.doesNotMatch(html, />All branches</);
  assert.match(html, />Run report</);
});

test("custom range preserves the server-resolved branch scope without showing a branch picker", () => {
  const html = renderToStaticMarkup(
    createElement(ReportFilterPanel, {
      ...baseProps,
      activeRange: "custom",
      selectedBranchId: "branch-1",
    }),
  );

  assert.match(html, /type="hidden" name="branchId" value="branch-1"/);
  assert.doesNotMatch(html, /<select/);
});

test("report money preserves zero, thousands and long amounts", () => {
  assert.equal(formatReportMoney(0), "RM0.00");
  assert.equal(formatReportMoney(1_280), "RM1,280.00");
  assert.equal(formatReportMoney(128_839.9), "RM128,839.90");
  assert.equal(formatReportMoney(1_288_839.9), "RM1,288,839.90");
  assert.equal(formatReportMoney(12_888_839.9), "RM12,888,839.90");
});

function dailyRow(overrides: Partial<DailySalesRow> = {}): DailySalesRow {
  return {
    dateValue: "2026-08-01",
    grossSalesCents: 0,
    netSalesCents: 0,
    transactionCount: 0,
    averageSaleCents: 0,
    refundsCents: 0,
    discountsCents: 0,
    grossCollectionsCents: 0,
    netCollectionsCents: 0,
    paymentMethods: [],
    ...overrides,
  };
}

test("empty days are hidden by default while all activity days remain visible", () => {
  const empty = dailyRow();
  const sale = dailyRow({ dateValue: "2026-08-02", transactionCount: 1 });
  const refundOnly = dailyRow({ dateValue: "2026-08-03", refundsCents: 3_000 });
  const paymentOnly = dailyRow({
    dateValue: "2026-08-04",
    grossCollectionsCents: 5_000,
    paymentMethods: [{
      label: "Cash",
      paymentCount: 1,
      grossCents: 5_000,
      refundCents: 0,
      netCents: 5_000,
      sharePercent: 100,
    }],
  });

  assert.deepEqual(
    getVisibleDailySalesDays([empty, sale, refundOnly, paymentOnly], false).map(
      (row) => row.dateValue,
    ),
    ["2026-08-02", "2026-08-03", "2026-08-04"],
  );
});

test("show empty days reveals the complete presentation period", () => {
  const days = [dailyRow(), dailyRow({ dateValue: "2026-08-02" })];
  assert.equal(getVisibleDailySalesDays(days, true).length, 2);
});

test("tiny payment shares remain visible without rounding to zero", () => {
  assert.equal(formatPaymentShare(0), "0%");
  assert.equal(formatPaymentShare(0.04), "<0.1%");
  assert.equal(formatPaymentShare(0.1), "0.1%");
  assert.equal(formatPaymentShare(99.96), "100.0%");
});

test("business and expense financial labels use full metric lists without ellipsis", () => {
  const page = readFileSync("src/app/(business)/reports/page.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");
  const metricListStyles = styles.slice(
    styles.indexOf(".report-metric-list"),
    styles.indexOf(".report-empty-state"),
  );

  assert.match(page, /<ReportCard title="Business Performance">[\s\S]*?<MetricList/);
  assert.match(page, /<ReportCard title="Expense Settlement">[\s\S]*?<MetricList/);
  assert.match(page, /Simple Operating Balance/);
  assert.match(page, /Paid against selected expenses/);
  assert.match(page, /Outstanding selected expenses/);
  assert.doesNotMatch(metricListStyles, /text-overflow:\s*ellipsis/);
});

test("payment section is labelled as a payment view, not cashflow", () => {
  const page = readFileSync("src/app/(business)/reports/page.tsx", "utf8");
  assert.match(page, />Payment view</);
  assert.doesNotMatch(page, />Cashflow view</i);
});

test("daily sales renders Payment Mix separately and avoids repeated empty payment copy", () => {
  const page = readFileSync("src/app/(business)/reports/page.tsx", "utf8");
  const dailySalesSection = page.slice(
    page.indexOf("function DailySalesSection"),
    page.indexOf("function PaymentsCollectedSection"),
  );

  assert.match(dailySalesSection, /<th>Payment Mix<\/th>/);
  assert.match(dailySalesSection, /Show empty days/);
  assert.match(dailySalesSection, /getVisibleDailySalesDays/);
  assert.doesNotMatch(dailySalesSection, /No payments collected/);
});

test("summary KPIs are grouped and use a responsive non-fixed grid", () => {
  const page = readFileSync("src/app/(business)/reports/page.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");

  assert.match(page, />Sales Summary</);
  assert.match(page, />Appointment Summary</);
  assert.match(styles, /\.report-summary-primary,[\s\S]*?repeat\(auto-fit,/);
});

test("staff section describes invoice-linked attribution rather than generic performance", () => {
  const page = readFileSync("src/app/(business)/reports/page.tsx", "utf8");
  assert.match(page, /<ReportCard title="Staff Activity">/);
  assert.match(page, /<th>Attributed Sales<\/th>/);
  assert.doesNotMatch(page, /<ReportCard title="Staff Performance">/);
});

test("reports copy does not suggest changing a branch after the branch picker is removed", () => {
  const page = readFileSync("src/app/(business)/reports/page.tsx", "utf8");

  assert.match(page, /Try another date range\./);
  assert.doesNotMatch(page, /date range or branch/i);
});

test("reversed custom dates normalize to the same From, To and canonical redirect order", () => {
  assert.deepEqual(normalizeReportDateRange("2026-08-27", "2026-08-25"), {
    fromValue: "2026-08-25",
    toValue: "2026-08-27",
  });

  const page = readFileSync("src/app/(business)/reports/page.tsx", "utf8");
  assert.match(page, /redirect\(`\/reports\?\$\{normalizedParams\.toString\(\)\}`\)/);
});

test("reports exposes invoice discount contributors and payment-method source drawers", () => {
  const page = readFileSync("src/app/(business)/reports/page.tsx", "utf8");

  assert.match(page, /<th>Subtotal<\/th><th>Discount<\/th><th>Net<\/th>/);
  assert.match(page, /paymentMethod: method\.label/);
  assert.match(page, />View payments →</);
  assert.match(page, /function PaymentMethodDrawer/);
  assert.match(page, /row\.invoiceId \? <Link href=\{`\/invoices\/\$\{row\.invoiceId\}`\}/);
});

test("repeat metric wording is period-scoped without changing its calculation", () => {
  const page = readFileSync("src/app/(business)/reports/page.tsx", "utf8");

  assert.match(page, /label="Repeat Visits" value=\{salon\.repeatCustomers\}/);
  assert.match(page, /repeatCustomerGroups\.filter\(\(row\) => row\._count > 1\)\.length/);
  assert.doesNotMatch(page, /label="Repeat customers"/);
});

test("refund history shows method, reason and processor from canonical refund records", () => {
  const invoicePage = readFileSync(
    "src/app/(business)/invoices/[invoiceId]/page.tsx",
    "utf8",
  );

  assert.match(invoicePage, /<h3>Refund history<\/h3>/);
  assert.match(invoicePage, /Method: \{refund\.originalPaymentLabel\}/);
  assert.match(invoicePage, /Reason: \{refund\.reason\}/);
  assert.match(invoicePage, /Processed by: \{refund\.processedBy\?\.name/);
});

test("invoice refund presentation separates settlement, refunds, net collection and outstanding", () => {
  const invoicePage = readFileSync(
    "src/app/(business)/invoices/[invoiceId]/page.tsx",
    "utf8",
  );
  const invoiceModal = readFileSync(
    "src/components/appointment-invoice-modal.tsx",
    "utf8",
  );

  assert.match(invoicePage, /<span>Settled<\/span>/);
  assert.match(invoicePage, /<span>Refunded<\/span>/);
  assert.match(invoicePage, /<span>Net collected<\/span>/);
  assert.match(invoicePage, /<span>Outstanding<\/span>/);
  assert.match(invoicePage, /Partially refunded/);
  assert.match(invoicePage, /Fully refunded/);
  assert.match(invoiceModal, /<span>Settled<\/span>/);
  assert.match(invoiceModal, /<span>Refunded<\/span>/);
  assert.match(invoiceModal, /<span>Net collected<\/span>/);
  assert.match(invoiceModal, /<span>Outstanding<\/span>/);
  assert.match(invoiceModal, /Partially refunded/);
  assert.match(invoiceModal, /Fully refunded/);
});

test("report drawers close only from the real backdrop or Escape and remain mobile-width safe", () => {
  const drawer = readFileSync("src/components/report-drawer-shell.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");

  assert.match(drawer, /event\.target === event\.currentTarget/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(styles, /\.report-day-drawer \{\s*box-sizing: border-box;\s*width: 100%;/);
});

test("appointment statuses are presented as title-case user labels", () => {
  const page = readFileSync("src/app/(business)/reports/page.tsx", "utf8");

  assert.match(page, /status\.toLowerCase\(\)\.replaceAll\("_", "-"\)/);
  assert.match(page, /return normalized\.charAt\(0\)\.toUpperCase\(\) \+ normalized\.slice\(1\)/);
});
