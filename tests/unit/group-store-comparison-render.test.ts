import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GroupStoreComparison } from "../../src/components/group-store-comparison";
import type {
  GroupReportBusinessPerformance,
  GroupReportsResult,
} from "../../src/lib/business-groups/group-reports";

const stores = [
  performance("11111111-1111-4111-8111-111111111111", "Alpha", 12_000, 2),
  performance("22222222-2222-4222-8222-222222222222", "Beta", 8_000, 1),
  performance("33333333-3333-4333-8333-333333333333", "Charlie", 0, 0),
  performance("44444444-4444-4444-8444-444444444444", "Delta", -500, 0),
];

test("renders an accessible two-store KPI matrix and shared trend", () => {
  const html = renderToStaticMarkup(
    createElement(GroupStoreComparison, {
      compareStore: [stores[0].businessId, stores[1].businessId],
      groupId: "group-id",
      report: report(stores),
    }),
  );

  assert.match(html, /Store comparison/);
  assert.match(html, /data-store-count="2"/);
  assert.match(html, /<caption>Selected store KPI comparison<\/caption>/);
  assert.match(html, /scope="col">Metric/);
  assert.match(html, /scope="row">Net sales/);
  assert.match(html, /Alpha/);
  assert.match(html, /Beta/);
  assert.match(html, /Selected store daily net sales comparison/);
});

test("keeps the four-store boundary and a zero-activity store visible", () => {
  const html = renderToStaticMarkup(
    createElement(GroupStoreComparison, {
      compareStore: stores.map((store) => store.businessId),
      groupId: "group-id",
      report: report(stores),
    }),
  );

  assert.match(html, /data-store-count="4"/);
  assert.match(html, /Charlie/);
  assert.match(html, /No activity/);
  assert.match(html, /RM(?:\u00a0| )0\.00/);
  assert.match(html, /4 selected/);
});

test("renders point coverage gaps and fails closed for a no-scope store", () => {
  const isolatedStores = stores.map((business) => ({
    ...business,
    metrics: { ...business.metrics },
  }));
  const fixture = report(isolatedStores);
  fixture.businessPerformance[1].coverage = "PARTIAL";
  fixture.businessTrends[1].coverage = "PARTIAL";
  fixture.businessTrends[1].points[0].coverage = "NONE";
  fixture.businessTrends[1].points[1].coverage = "PARTIAL";
  fixture.businessPerformance[2].coverage = "NONE";
  fixture.businessTrends[2].coverage = "NONE";
  fixture.businessTrends[2].points.forEach((point) => {
    point.coverage = "NONE";
  });

  const partialHtml = renderToStaticMarkup(
    createElement(GroupStoreComparison, {
      compareStore: [stores[0].businessId, stores[1].businessId],
      groupId: "group-id",
      report: fixture,
    }),
  );
  assert.match(partialHtml, /Partial membership period/);
  assert.match(partialHtml, /data-direction="unavailable"/);
  assert.match(partialHtml, /Not in scope/);
  assert.match(partialHtml, /Partial coverage/);

  const invalidHtml = renderToStaticMarkup(
    createElement(GroupStoreComparison, {
      compareStore: [
        stores[0].businessId,
        stores[1].businessId,
        stores[2].businessId,
      ],
      groupId: "group-id",
      report: fixture,
    }),
  );
  assert.match(invalidHtml, /data-comparison-status="invalid-selection"/);
  assert.match(invalidHtml, /role="alert"/);
  assert.match(invalidHtml, /data-coverage="none" data-disabled="true"/);
  assert.doesNotMatch(invalidHtml, /data-store-count=/);
});

function report(
  businessPerformance: GroupReportBusinessPerformance[],
): GroupReportsResult {
  return {
    groupId: "group-id",
    groupName: "QA Group",
    role: "GROUP_OWNER",
    authorizedBusinesses: businessPerformance.map((business) => ({
      id: business.businessId,
      name: business.businessName,
      industryType: business.industryType,
      logoUrl: null,
      timezone: "Asia/Kuching",
      businessDayCutoffTime: "02:00",
      isCurrent: business.rank === 1,
      membershipPeriods: [
        {
          joinedAt: new Date("2026-01-01T00:00:00.000Z"),
          removedAt: null,
        },
      ],
    })),
    filters: {
      range: "7days",
      from: null,
      to: null,
      storeId: null,
      paymentMethod: null,
      status: null,
      page: 1,
    },
    summaryDataSource: "DAILY_SUMMARY",
    analyticsFallbackReason: null,
    summary: metrics(19_500, 3),
    trend: [],
    businessPerformance,
    businessTrends: businessPerformance.map((business) => ({
      businessId: business.businessId,
      businessName: business.businessName,
      coverage: business.coverage,
      points: [
        {
          businessDate: "2026-07-29",
          coverage: "FULL",
          ...business.metrics,
        },
        {
          businessDate: "2026-07-30",
          coverage: "FULL",
          ...metrics(Math.round(business.metrics.netSalesCents / 2), 0),
        },
      ],
    })),
    catalogRankings: { services: [], products: [], packages: [] },
    rows: [],
    totalRows: 0,
    totalPages: 1,
  };
}

function performance(
  businessId: string,
  businessName: string,
  netSalesCents: number,
  transactionCount: number,
): GroupReportBusinessPerformance {
  return {
    rank: storesRank(businessName),
    businessId,
    businessName,
    industryType: "AUTO_DETAILING",
    coverage: "FULL",
    metrics: metrics(netSalesCents, transactionCount),
  };
}

function metrics(netSalesCents: number, transactionCount: number) {
  return {
    grossSalesCents: Math.max(0, netSalesCents),
    netSalesCents,
    paymentsCollectedCents: Math.max(0, netSalesCents),
    refundsCents: netSalesCents < 0 ? Math.abs(netSalesCents) : 0,
    transactionCount,
    averageTransactionValueCents: transactionCount
      ? Math.round(netSalesCents / transactionCount)
      : null,
  };
}

function storesRank(name: string) {
  if (name === "Alpha") return 1;
  if (name === "Beta") return 2;
  if (name === "Charlie") return 3;
  return 4;
}
