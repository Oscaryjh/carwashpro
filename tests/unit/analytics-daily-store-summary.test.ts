import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateDailyStoreSummaryCandidate,
  ensureAnalyticsDailyCoverage,
  groupAnalyticsRefreshDateRanges,
  listDateValues,
  summarizeAnalyticsComparisons,
  validateAnalyticsRefreshRange,
} from "../../src/lib/analytics/daily-store-summary";

test("calculates canonical store-day metrics and payment-method nets", () => {
  const older = new Date("2026-07-01T03:00:00.000Z");
  const latest = new Date("2026-07-03T03:00:00.000Z");
  const candidate = calculateDailyStoreSummaryCandidate({
    businessId: "business-1",
    businessDate: "2026-07-01",
    timezone: "UTC",
    businessDayCutoffTime: "00:00",
    range: {
      fromDate: new Date("2026-07-01T00:00:00.000Z"),
      toDateExclusive: new Date("2026-07-02T00:00:00.000Z"),
    },
    computedAt: new Date("2026-07-04T00:00:00.000Z"),
    source: {
      invoices: [
        {
          balance: "10.00",
          discountAmount: "5.00",
          loyaltyDiscountAmount: "5.00",
          payments: [{ amount: "20.00", status: "ACTIVE", updatedAt: older }],
          status: "PARTIAL",
          tipAmount: "10.00",
          total: "100.00",
          updatedAt: older,
        },
        {
          balance: "0",
          discountAmount: "0",
          loyaltyDiscountAmount: "0",
          payments: [],
          status: "VOID",
          tipAmount: "0",
          total: "999.00",
          updatedAt: latest,
        },
      ],
      payments: [
        {
          amount: "70.00",
          invoice: { status: "PARTIAL" },
          method: "CASH",
          status: "ACTIVE",
          updatedAt: older,
        },
        {
          amount: "10.00",
          invoice: null,
          method: "CARD",
          status: "ACTIVE",
          updatedAt: older,
        },
        {
          amount: "999.00",
          invoice: { status: "VOID" },
          method: "CASH",
          status: "ACTIVE",
          updatedAt: latest,
        },
      ],
      refunds: [
        {
          amount: "5.00",
          invoice: { status: "PARTIAL" },
          method: "CASH",
          updatedAt: older,
        },
        {
          amount: "999.00",
          invoice: { status: "VOID" },
          method: "CARD",
          updatedAt: latest,
        },
      ],
    },
  });

  assert.equal(candidate.grossSalesCents, 8_000);
  assert.equal(candidate.discountsCents, 1_000);
  assert.equal(candidate.netSalesCents, 6_500);
  assert.equal(candidate.grossCollectionsCents, 8_000);
  assert.equal(candidate.refundsCents, 500);
  assert.equal(candidate.netCollectionsCents, 7_500);
  assert.equal(candidate.outstandingCents, 1_000);
  assert.equal(candidate.transactionCount, 1);
  assert.equal(candidate.averageTransactionValueCents, 6_500);
  assert.equal(candidate.packageVoucherCents, 2_000);
  assert.equal(candidate.sourceWatermark?.toISOString(), latest.toISOString());

  const cash = candidate.paymentMethods.find(
    (method) => method.method === "CASH",
  );
  assert.deepEqual(cash, {
    method: "CASH",
    grossCollectionsCents: 7_000,
    refundsCents: 500,
    netCollectionsCents: 6_500,
  });
  const ewallet = candidate.paymentMethods.find(
    (method) => method.method === "EWALLET",
  );
  assert.deepEqual(ewallet, {
    method: "EWALLET",
    grossCollectionsCents: 0,
    refundsCents: 0,
    netCollectionsCents: 0,
  });
});

test("validates and expands an inclusive analytics refresh range", () => {
  assert.deepEqual(listDateValues("2026-07-01", "2026-07-03"), [
    "2026-07-01",
    "2026-07-02",
    "2026-07-03",
  ]);
  assert.equal(
    validateAnalyticsRefreshRange("2026-01-01", "2026-01-01").dayCount,
    1,
  );
  assert.throws(
    () => validateAnalyticsRefreshRange("2026-07-03", "2026-07-01"),
    /start date/,
  );
  assert.throws(
    () => validateAnalyticsRefreshRange("invalid", "2026-07-01"),
    /valid YYYY-MM-DD/,
  );
  assert.throws(
    () => validateAnalyticsRefreshRange("2024-01-01", "2026-01-02"),
    /cannot exceed 731 days/,
  );
});

test("summarizes shadow parity without hiding mismatches or missing rows", () => {
  const matched = {
    status: "MATCHED" as const,
    businessId: "business-1",
    businessDate: "2026-07-01",
    differences: [],
    rawSourceWatermark: null,
    storedSourceWatermark: null,
  };
  const mismatch = {
    status: "MISMATCH" as const,
    businessId: "business-1",
    businessDate: "2026-07-02",
    differences: [
      { field: "netSalesCents", expected: 100, actual: 90 },
    ],
    rawSourceWatermark: null,
    storedSourceWatermark: null,
  };
  const missing = {
    status: "MISSING" as const,
    businessId: "business-2",
    businessDate: "2026-07-01",
    differences: [],
    rawSourceWatermark: null,
    storedSourceWatermark: null,
  };
  const report = summarizeAnalyticsComparisons({
    fromDate: "2026-07-01",
    toDate: "2026-07-02",
    businessCount: 2,
    dayCount: 2,
    comparisons: [matched, mismatch, missing],
  });

  assert.equal(report.status, "HAS_ISSUES");
  assert.equal(report.comparisonCount, 3);
  assert.equal(report.matchedCount, 1);
  assert.equal(report.mismatchCount, 1);
  assert.equal(report.missingCount, 1);
  assert.deepEqual(report.issues, [mismatch, missing]);
});

test("groups late events into bounded contiguous ranges without filling gaps", () => {
  assert.deepEqual(
    groupAnalyticsRefreshDateRanges([
      "2026-07-30",
      "2024-01-01",
      "2026-07-29",
      "2026-07-29",
    ]),
    [
      { fromDate: "2024-01-01", toDate: "2024-01-01" },
      { fromDate: "2026-07-29", toDate: "2026-07-30" },
    ],
  );
  assert.deepEqual(groupAnalyticsRefreshDateRanges([]), []);
  assert.throws(
    () => groupAnalyticsRefreshDateRanges(["not-a-date"]),
    /valid dates/,
  );
});

test("scheduled coverage creates zero-value summaries for missing active-store days", async () => {
  const refreshCalls: Array<Record<string, unknown>> = [];
  const database = {
    business: {
      findMany: async () => [
        {
          id: "business-a",
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
          timezone: "UTC",
          businessDayCutoffTime: "02:00",
        },
        {
          id: "business-b",
          createdAt: new Date("2026-07-30T08:00:00.000Z"),
          timezone: "UTC",
          businessDayCutoffTime: "02:00",
        },
      ],
    },
    analyticsDailyStoreSummary: {
      findMany: async () => [],
    },
  } as never;

  const results = await ensureAnalyticsDailyCoverage(
    new Date("2026-07-30T12:00:00.000Z"),
    database,
    { days: 2 },
    {
      refreshSummaries: (async (input: Record<string, unknown>) => {
        refreshCalls.push(input);
        return {
          runId: `run-${refreshCalls.length}`,
          businessCount: 1,
          summaryCount: 1,
          sourceWatermark: null,
        };
      }) as never,
    },
  );

  assert.equal(results.length, 2);
  assert.deepEqual(refreshCalls, [
    {
      businessIds: ["business-a"],
      fromDate: "2026-07-29",
      toDate: "2026-07-30",
      trigger: "SCHEDULED",
    },
    {
      businessIds: ["business-b"],
      fromDate: "2026-07-30",
      toDate: "2026-07-30",
      trigger: "SCHEDULED",
    },
  ]);

  await assert.rejects(
    ensureAnalyticsDailyCoverage(
      new Date("2026-07-30T12:00:00.000Z"),
      database,
      { days: 15 },
    ),
    /between 1 and 14/,
  );
});
