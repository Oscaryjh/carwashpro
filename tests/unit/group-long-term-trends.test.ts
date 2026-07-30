import assert from "node:assert/strict";
import test from "node:test";
import type { AnalyticsDailyRow } from "../../src/lib/analytics/daily-summary-read";
import {
  buildGroupTrendBusinessPlan,
  getGroupLongTermTrendReport,
  normalizeGroupLongTermTrendPreset,
} from "../../src/lib/business-groups/group-long-term-trends";

test("normalizes trend presets and aligns month comparisons to calendar boundaries", () => {
  assert.equal(normalizeGroupLongTermTrendPreset(undefined), "month");
  assert.equal(normalizeGroupLongTermTrendPreset("invalid"), "month");
  assert.equal(normalizeGroupLongTermTrendPreset("ytd"), "ytd");
  assert.equal(normalizeGroupLongTermTrendPreset("12months"), "12months");

  const month = buildGroupTrendBusinessPlan("month", "2026-03-31");
  assert.deepEqual(month.display, {
    fromDateValue: "2026-03-01",
    toDateValue: "2026-03-31",
  });
  assert.deepEqual(month.comparisons[0]?.previous, {
    fromDateValue: "2026-02-01",
    toDateValue: "2026-02-28",
  });
  assert.deepEqual(month.comparisons[1]?.previous, {
    fromDateValue: "2025-03-01",
    toDateValue: "2025-03-31",
  });
});

test("YTD and rolling 12-month plans clamp leap days and stay within two years", () => {
  const ytd = buildGroupTrendBusinessPlan("ytd", "2024-02-29");
  assert.deepEqual(ytd.display, {
    fromDateValue: "2024-01-01",
    toDateValue: "2024-02-29",
  });
  assert.deepEqual(ytd.comparisons[1]?.previous, {
    fromDateValue: "2023-01-01",
    toDateValue: "2023-02-28",
  });

  const rolling = buildGroupTrendBusinessPlan("12months", "2026-07-30");
  assert.deepEqual(rolling.display, {
    fromDateValue: "2025-08-01",
    toDateValue: "2026-07-30",
  });
  assert.deepEqual(rolling.comparisons[1]?.previous, {
    fromDateValue: "2024-08-01",
    toDateValue: "2025-07-30",
  });
});

test("aggregates verified store-days with weighted ATV and MoM/YoY comparisons", async () => {
  const businesses = [
    business("store-a", "Store A"),
    business("store-b", "Store B"),
  ];
  let capturedRead: unknown = null;
  const values = new Map<string, [number, number]>([
    ["store-a:2026-07-01", [1_000, 1]],
    ["store-a:2026-07-02", [2_000, 1]],
    ["store-b:2026-07-01", [3_000, 3]],
    ["store-a:2026-06-01", [500, 1]],
    ["store-b:2026-06-01", [1_000, 1]],
    ["store-a:2025-07-01", [100, 1]],
  ]);
  const rows = [
    ...dailyRowsForPeriod(
      businesses.map((item) => item.id),
      "2026-07-01",
      15,
      values,
    ),
    ...dailyRowsForPeriod(
      businesses.map((item) => item.id),
      "2026-06-01",
      15,
      values,
    ),
    ...dailyRowsForPeriod(
      businesses.map((item) => item.id),
      "2025-07-01",
      15,
      values,
    ),
  ];
  const report = await getGroupLongTermTrendReport(
    {
      userId: "owner",
      groupId: "group",
      activeBusinessId: "store-a",
      preset: "month",
    },
    {} as never,
    {
      now: new Date("2026-07-15T12:00:00.000Z"),
      resolveScope: async () => ({
        groupId: "group",
        groupName: "QA Group",
        role: "GROUP_OWNER",
        canViewAllStores: true,
        businesses,
        reportingBusinesses: businesses,
      }),
      readSummaries: async (input) => {
        capturedRead = input;
        return {
          ok: true,
          rows,
          expectedRowCount: rows.length,
          checkedAt: new Date("2026-07-15T12:00:00.000Z"),
          oldestComputedAt: new Date("2026-07-15T11:00:00.000Z"),
          newestComputedAt: new Date("2026-07-15T11:30:00.000Z"),
        };
      },
    },
  );

  assert.equal(report?.status, "READY");
  if (!report || report.status !== "READY") return;
  assert.equal(report.current.netSalesCents, 6_000);
  assert.equal(report.current.transactionCount, 5);
  assert.equal(report.current.averageTransactionValueCents, 1_200);
  assert.equal(report.displaySummaryCount, 30);
  assert.equal(report.expectedSummaryCount, 90);
  assert.equal(report.points.length, 15);
  assert.deepEqual(
    report.points.slice(0, 2).map((point) => ({
      key: point.key,
      netSalesCents: point.netSalesCents,
      transactionCount: point.transactionCount,
      averageTransactionValueCents: point.averageTransactionValueCents,
      storeCount: point.storeCount,
      hasCoverage: point.hasCoverage,
    })),
    [
      {
        key: "2026-07-01",
        netSalesCents: 4_000,
        transactionCount: 4,
        averageTransactionValueCents: 1_000,
        storeCount: 2,
        hasCoverage: true,
      },
      {
        key: "2026-07-02",
        netSalesCents: 2_000,
        transactionCount: 1,
        averageTransactionValueCents: 2_000,
        storeCount: 2,
        hasCoverage: true,
      },
    ],
  );
  assert.equal(report.points[2]?.hasCoverage, true);
  assert.equal(report.points[2]?.storeCount, 2);
  assert.equal(report.points[2]?.netSalesCents, 0);
  assert.deepEqual(report.comparisons[0], {
    key: "MOM",
    label: "vs previous month-to-date",
    currentNetSalesCents: 6_000,
    previousNetSalesCents: 1_500,
    comparison: { kind: "PERCENT", percentage: 300 },
  });
  assert.deepEqual(report.comparisons[1], {
    key: "YOY",
    label: "vs same month last year",
    currentNetSalesCents: 6_000,
    previousNetSalesCents: 100,
    comparison: { kind: "PERCENT", percentage: 5_900 },
  });
  assert.equal(report.scopeChanged, false);
  assert.equal(
    (capturedRead as { requireMembershipHistory?: boolean })
      .requireMembershipHistory,
    true,
  );
});

test("builds cross-year rolling 12-month buckets with partial-month and weighted ATV semantics", async () => {
  const businesses = [
    business("store-a", "Store A"),
    business("store-b", "Store B"),
  ];
  const values = new Map<string, [number, number]>([
    ["store-a:2025-12-31", [9_000, 1]],
    ["store-b:2025-12-31", [3_000, 3]],
    ["store-a:2026-01-01", [8_000, 4]],
    ["store-b:2026-01-01", [2_000, 1]],
    ["store-a:2026-03-15", [5_000, 2]],
    ["store-b:2026-03-15", [1_000, 1]],
  ]);
  const rows = [
    ...dailyRowsForPeriod(
      businesses.map((item) => item.id),
      "2025-04-01",
      349,
      values,
    ),
    ...dailyRowsForPeriod(
      businesses.map((item) => item.id),
      "2024-04-01",
      349,
      values,
    ),
  ];

  const report = await getGroupLongTermTrendReport(
    {
      userId: "owner",
      groupId: "group",
      activeBusinessId: "store-a",
      preset: "12months",
    },
    {} as never,
    {
      now: new Date("2026-03-15T12:00:00.000Z"),
      resolveScope: async () => ({
        groupId: "group",
        groupName: "QA Group",
        role: "GROUP_OWNER",
        canViewAllStores: true,
        businesses,
        reportingBusinesses: businesses,
      }),
      readSummaries: async () => ({
        ok: true,
        rows,
        expectedRowCount: rows.length,
        checkedAt: new Date("2026-03-15T12:00:00.000Z"),
        oldestComputedAt: new Date("2026-03-15T11:00:00.000Z"),
        newestComputedAt: new Date("2026-03-15T11:30:00.000Z"),
      }),
    },
  );

  assert.equal(report?.status, "READY");
  if (!report || report.status !== "READY") return;
  assert.equal(report.resolution, "MONTH");
  assert.equal(report.fromDateValue, "2025-04-01");
  assert.equal(report.toDateValue, "2026-03-15");
  assert.equal(report.points.length, 12);
  assert.equal(report.displaySummaryCount, 698);
  assert.equal(report.expectedSummaryCount, 1_396);
  assert.deepEqual(
    report.points.map((point) => point.key),
    [
      "2025-04",
      "2025-05",
      "2025-06",
      "2025-07",
      "2025-08",
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
    ],
  );

  const april = report.points[0]!;
  assert.equal(april.netSalesCents, 0);
  assert.equal(april.storeCount, 2);
  assert.equal(april.hasCoverage, true);
  assert.equal(april.isPartial, false);

  const december = report.points.find((point) => point.key === "2025-12")!;
  assert.equal(december.netSalesCents, 12_000);
  assert.equal(december.transactionCount, 4);
  assert.equal(december.averageTransactionValueCents, 3_000);
  assert.equal(december.storeCount, 2);

  const january = report.points.find((point) => point.key === "2026-01")!;
  assert.equal(january.netSalesCents, 10_000);
  assert.equal(january.transactionCount, 5);
  assert.equal(january.averageTransactionValueCents, 2_000);

  const march = report.points.at(-1)!;
  assert.equal(march.key, "2026-03");
  assert.equal(march.toDateValue, "2026-03-15");
  assert.equal(march.netSalesCents, 6_000);
  assert.equal(march.transactionCount, 3);
  assert.equal(march.averageTransactionValueCents, 2_000);
  assert.equal(march.storeCount, 2);
  assert.equal(march.hasCoverage, true);
  assert.equal(march.isPartial, true);
});

test("uses one conservative group date anchor across timezone and year boundaries", async () => {
  const businesses = [
    business("store-a", "Store A"),
    {
      ...business("store-b", "Store B"),
      timezone: "America/Los_Angeles",
    },
  ];
  let reads: ReadonlyArray<{
    windows: ReadonlyArray<{ fromDateValue: string; toDateValue: string }>;
  }> = [];
  const report = await getGroupLongTermTrendReport(
    {
      userId: "owner",
      groupId: "group",
      activeBusinessId: "store-a",
      preset: "month",
    },
    {} as never,
    {
      now: new Date("2026-01-01T00:30:00.000Z"),
      resolveScope: async () => ({
        groupId: "group",
        groupName: "QA Group",
        role: "GROUP_OWNER",
        canViewAllStores: true,
        businesses,
        reportingBusinesses: businesses,
      }),
      readSummaries: async (input) => {
        reads = input.reads;
        return {
          ok: true,
          rows: [],
          expectedRowCount: 0,
          checkedAt: new Date("2026-01-01T00:30:00.000Z"),
          oldestComputedAt: null,
          newestComputedAt: null,
        };
      },
    },
  );

  assert.equal(report?.status, "READY");
  if (!report || report.status !== "READY") return;
  assert.equal(report.fromDateValue, "2025-12-01");
  assert.equal(report.toDateValue, "2025-12-31");
  assert.equal(report.points.length, 31);
  assert.equal(reads.length, 2);
  for (const read of reads) {
    assert.ok(
      read.windows.some(
        (window) =>
          window.fromDateValue === "2025-12-01" &&
          window.toDateValue === "2025-12-31",
      ),
    );
  }
});

test("warns when comparison windows contain a different store composition", async () => {
  const stable = business("store-a", "Store A");
  const joinedThisYear = {
    ...business("store-b", "Store B"),
    membershipPeriods: [
      {
        joinedAt: new Date("2026-01-01T00:00:00.000Z"),
        removedAt: null,
      },
    ],
  };
  const businesses = [stable, joinedThisYear];
  const report = await getGroupLongTermTrendReport(
    {
      userId: "owner",
      groupId: "group",
      activeBusinessId: "store-a",
      preset: "month",
    },
    {} as never,
    {
      now: new Date("2026-07-15T12:00:00.000Z"),
      resolveScope: async () => ({
        groupId: "group",
        groupName: "QA Group",
        role: "GROUP_OWNER",
        canViewAllStores: true,
        businesses,
        reportingBusinesses: businesses,
      }),
      readSummaries: async () => ({
        ok: true,
        rows: [],
        expectedRowCount: 0,
        checkedAt: new Date("2026-07-15T12:00:00.000Z"),
        oldestComputedAt: null,
        newestComputedAt: null,
      }),
    },
  );

  assert.equal(report?.status, "READY");
  if (report?.status === "READY") {
    assert.equal(report.scopeChanged, true);
  }
});

test("fails closed when historical summaries are incomplete and never queries raw aggregates", async () => {
  let readCalls = 0;
  const businesses = [
    business("store-a", "Store A"),
    business("store-b", "Store B"),
  ];
  const report = await getGroupLongTermTrendReport(
    {
      userId: "owner",
      groupId: "group",
      activeBusinessId: "store-a",
      preset: "12months",
    },
    new Proxy(
      {},
      {
        get() {
          throw new Error("Long-range RAW access is not allowed.");
        },
      },
    ) as never,
    {
      now: new Date("2026-07-15T12:00:00.000Z"),
      resolveScope: async () => ({
        groupId: "group",
        groupName: "QA Group",
        role: "GROUP_OWNER",
        canViewAllStores: true,
        businesses,
        reportingBusinesses: businesses,
      }),
      readSummaries: async () => {
        readCalls += 1;
        return {
          ok: false,
          reason: "MISSING_SUMMARIES",
          checkedAt: new Date("2026-07-15T12:00:00.000Z"),
        };
      },
    },
  );

  assert.equal(readCalls, 1);
  assert.deepEqual(report, {
    groupId: "group",
    groupName: "QA Group",
    role: "GROUP_OWNER",
    preset: "12months",
    presetLabel: "Rolling 12 months",
    authorizedBusinessCount: 2,
    checkedAt: new Date("2026-07-15T12:00:00.000Z"),
    status: "UNAVAILABLE",
    reason: "MISSING_SUMMARIES",
  });
});

test("resolves authorization before reading historical analytics", async () => {
  let readCalls = 0;
  const report = await getGroupLongTermTrendReport(
    {
      userId: "staff",
      groupId: "group",
      activeBusinessId: "store-a",
    },
    {} as never,
    {
      resolveScope: async () => null,
      readSummaries: async () => {
        readCalls += 1;
        throw new Error("should not read");
      },
    },
  );
  assert.equal(report, null);
  assert.equal(readCalls, 0);
});

function business(id: string, name: string) {
  return {
    id,
    name,
    industryType: "GENERAL_SERVICE" as const,
    logoUrl: null,
    timezone: "Asia/Kuching",
    businessDayCutoffTime: "02:00",
    isCurrent: id === "store-a",
    membershipPeriods: [
      {
        joinedAt: new Date("1970-01-01T00:00:00.000Z"),
        removedAt: null,
      },
    ],
  };
}

function dailyRow(
  businessId: string,
  businessDate: string,
  netSalesCents: number,
  transactionCount: number,
): AnalyticsDailyRow {
  const averageTransactionValueCents =
    transactionCount > 0
      ? Math.round(netSalesCents / transactionCount)
      : null;
  return {
    averageTransactionValueCents,
    businessDate: new Date(`${businessDate}T00:00:00.000Z`),
    businessDayCutoffTime: "02:00",
    businessDayDefinitionVersion: 1,
    businessId,
    computedAt: new Date("2026-07-15T11:00:00.000Z"),
    discountsCents: 0,
    grossCollectionsCents: netSalesCents,
    grossSalesCents: netSalesCents,
    metricDefinitionVersion: 1,
    netCollectionsCents: netSalesCents,
    netSalesCents,
    outstandingCents: 0,
    packageVoucherCents: 0,
    refundsCents: 0,
    sourceFrom: new Date(`${businessDate}T00:00:00.000Z`),
    sourceToExclusive: new Date(
      new Date(`${businessDate}T00:00:00.000Z`).getTime() + 86_400_000,
    ),
    sourceWatermark: null,
    timezone: "Asia/Kuching",
    tipsCents: 0,
    transactionCount,
  };
}

function dailyRowsForPeriod(
  businessIds: string[],
  fromDateValue: string,
  dayCount: number,
  values: Map<string, [number, number]>,
) {
  return businessIds.flatMap((businessId) =>
    Array.from({ length: dayCount }, (_, index) => {
      const date = new Date(`${fromDateValue}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + index);
      const businessDate = date.toISOString().slice(0, 10);
      const [netSalesCents = 0, transactionCount = 0] =
        values.get(`${businessId}:${businessDate}`) ?? [];
      return dailyRow(
        businessId,
        businessDate,
        netSalesCents,
        transactionCount,
      );
    }),
  );
}
