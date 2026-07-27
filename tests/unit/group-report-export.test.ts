import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGroupReportCsv,
  buildGroupReportPdf,
  buildGroupReportXlsx,
} from "../../src/lib/business-groups/group-report-export";
import type { GroupReportsResult } from "../../src/lib/business-groups/group-reports";

const report = {
  groupId: "group",
  groupName: "QA Group",
  role: "GROUP_OWNER",
  authorizedBusinesses: [],
  filters: {
    range: "today",
    from: null,
    to: null,
    storeId: null,
    paymentMethod: null,
    status: null,
    page: 1,
  },
  summary: {
    grossSalesCents: 12_000,
    netSalesCents: 11_000,
    paymentsCollectedCents: 10_000,
    refundsCents: 500,
    transactionCount: 1,
    averageTransactionValueCents: 11_000,
  },
  trend: [],
  businessPerformance: [],
  catalogRankings: { services: [], products: [], packages: [] },
  rows: [
    {
      id: "invoice",
      invoiceNumber: "=QA-001",
      businessId: "business",
      businessName: "QA Store",
      businessDate: "2026-07-27",
      issuedAt: new Date("2026-07-27T00:00:00Z"),
      timezone: "Asia/Kuching",
      customerName: "QA Customer",
      grossAmountCents: 12_000,
      discountCents: 1_000,
      tipCents: 0,
      packageRedemptionCents: 0,
      netInvoiceAmountCents: 11_000,
      paidAmountCents: 10_000,
      refundAmountCents: 500,
      balanceCents: 1_000,
      paymentStatus: "PARTIAL",
      invoiceStatus: "PARTIAL",
      paymentMethods: ["CASH"],
    },
  ],
  totalRows: 1,
  totalPages: 1,
} satisfies GroupReportsResult;

test("CSV export includes report data and prevents spreadsheet formula injection", () => {
  const csv = buildGroupReportCsv(report).toString("utf8");
  assert.match(csv, /^\uFEFF"Group","QA Group"/);
  assert.match(csv, /"'=QA-001"/);
  assert.match(csv, /"Net sales","110"/);
});

test("Excel export creates a valid XLSX zip with workbook and worksheet entries", () => {
  const xlsx = buildGroupReportXlsx(report);
  assert.equal(xlsx.subarray(0, 4).toString("hex"), "504b0304");
  assert.match(xlsx.toString("utf8"), /xl\/worksheets\/sheet1\.xml/);
  assert.match(xlsx.toString("utf8"), /QA Group/);
});

test("PDF export creates a multi-line PDF document", () => {
  const pdf = buildGroupReportPdf(report);
  assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
  assert.match(pdf.toString("latin1"), /GROUP REPORT - QA Group/);
  assert.ok(pdf.length > 500);
});
