import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGroupClosingCsv,
  buildGroupClosingPdf,
  buildGroupClosingXlsx,
  groupClosingExportFileName,
} from "../../src/lib/business-groups/group-closing-export";
import type { GroupClosingReport } from "../../src/lib/business-groups/group-closing-report";

const report: GroupClosingReport = {
  groupId: "11111111-1111-4111-8111-111111111111",
  groupName: "QA Group",
  role: "GROUP_OWNER",
  authorizedBusinesses: [],
  filters: {
    range: "custom",
    from: "2026-07-01",
    to: "2026-07-01",
    storeId: null,
    auditStatus: null,
    page: 1,
    auditPage: 1,
  },
  summary: {
    snapshotCount: 1,
    storeCount: 1,
    branchCount: 1,
    invalidReportCount: 0,
    grossSalesCents: 12_000,
    netSalesCents: 10_000,
    collectedCents: 8_000,
    outstandingCents: 2_000,
    refundsCents: 500,
    expectedCashCents: 5_000,
    actualCashCents: 4_800,
    cashDifferenceCents: -200,
    balancedCount: 0,
    overCount: 0,
    shortCount: 1,
  },
  audit: {
    checkedAt: new Date("2026-07-02T00:00:00.000Z"),
    requiredCount: 1,
    completedCount: 0,
    missingCount: 1,
    completionPercent: 0,
    notDueCount: 0,
    notApplicableCount: 0,
    partialMembershipCount: 0,
    branchNotOpenCount: 0,
    branchHistoryUnknownCount: 0,
    unsupportedIndustryCount: 0,
    unexpectedSnapshotCount: 1,
    rows: [
      {
        businessId: "22222222-2222-4222-8222-222222222222",
        businessName: "QA Store",
        branchId: "33333333-3333-4333-8333-333333333333",
        branchName: "=FORMULA",
        businessDate: "2026-07-01",
        timezone: "UTC",
        dueAt: new Date("2026-07-02T00:00:00.000Z"),
        status: "MISSING",
        snapshotId: null,
      },
    ],
    totalRows: 1,
    totalPages: 1,
    page: 1,
  },
  rows: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      businessId: "22222222-2222-4222-8222-222222222222",
      businessName: "QA Store",
      branchId: "33333333-3333-4333-8333-333333333333",
      branchName: "Main Branch",
      businessDate: "2026-07-01",
      timezone: "UTC",
      expectedCashCents: 5_000,
      actualCashCents: 4_800,
      cashDifferenceCents: -200,
      closingNote: null,
      closedAt: new Date("2026-07-02T00:05:00.000Z"),
      closedByName: "QA Owner",
      reportVersion: 2,
      generatedAt: new Date("2026-07-02T00:05:00.000Z"),
      businessDayCutoffTime: "00:00",
      businessDayDefinitionVersion: 1,
      metricDefinitionVersion: 1,
      financial: {
        grossSalesCents: 12_000,
        netSalesCents: 10_000,
        collectedCents: 8_000,
        outstandingCents: 2_000,
        refundsCents: 500,
        discountsCents: 1_500,
      },
      whatsappStatus: "NOT_QUEUED",
    },
  ],
  totalRows: 1,
  totalPages: 1,
};

test("Closing CSV exports audit and snapshots with formula injection protection", () => {
  const csv = buildGroupClosingCsv(report).toString("utf8");
  assert.match(csv, /^\uFEFF"Group","QA Group"/);
  assert.match(csv, /"Missing closings","1"/);
  assert.match(csv, /"'=FORMULA"/);
  assert.match(csv, /"Cash difference","'-2"/);
});

test("Closing Excel export contains a Closing Audit worksheet", () => {
  const xlsx = buildGroupClosingXlsx(report);
  assert.equal(xlsx.subarray(0, 4).toString("hex"), "504b0304");
  assert.match(xlsx.toString("utf8"), /Closing Audit/);
  assert.match(xlsx.toString("utf8"), /xl\/worksheets\/sheet1\.xml/);
});

test("Closing PDF export and filename are audit specific", () => {
  const pdf = buildGroupClosingPdf(report);
  assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
  assert.match(pdf.toString("latin1"), /CLOSING AUDIT - QA Group/);
  assert.equal(
    groupClosingExportFileName(report, "pdf"),
    "QA-Group-closing-audit.pdf",
  );
});
