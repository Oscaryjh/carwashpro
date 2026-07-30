import assert from "node:assert/strict";
import test from "node:test";
import {
  readAuthorizedDailyStoreSummaries,
  type AnalyticsDailyRow,
} from "../../src/lib/analytics/daily-summary-read";
import { getBusinessDayRange } from "../../src/lib/business-day";

test("long-range reads require membership history when fail-closed mode is enabled", async () => {
  let queryCalls = 0;
  const result = await readAuthorizedDailyStoreSummaries(
    {
      reads: [
        {
          business: {
            ...business(),
            membershipPeriods: undefined,
          },
          windows: [
            {
              fromDateValue: "2026-07-01",
              toDateValue: "2026-07-01",
            },
          ],
        },
      ],
      requireMembershipHistory: true,
    },
    {
      analyticsDailyStoreSummary: {
        findMany: async () => (queryCalls += 1, []),
      },
    } as never,
  );

  assert.deepEqual(result, {
    ok: false,
    reason: "INVALID_MEMBERSHIP_CONTEXT",
    checkedAt: result.checkedAt,
  });
  assert.equal(queryCalls, 0);
});

test("rejects a 732-day read span before querying analytics", async () => {
  let queryCalls = 0;
  const result = await readAuthorizedDailyStoreSummaries(
    {
      reads: [
        {
          business: business(),
          windows: [
            {
              fromDateValue: "2024-01-01",
              toDateValue: "2026-01-01",
            },
          ],
        },
      ],
      requireMembershipHistory: true,
    },
    {
      analyticsDailyStoreSummary: {
        findMany: async () => (queryCalls += 1, []),
      },
    } as never,
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "INVALID_RANGE");
  assert.equal(queryCalls, 0);
});

test("distinguishes an older summary definition from a missing store-day", async () => {
  const wrongVersion = dailyRow("2026-07-01");
  wrongVersion.metricDefinitionVersion = 999;
  const versionResult = await readAuthorizedDailyStoreSummaries(
    oneDayRead(),
    databaseWithRows([wrongVersion]),
  );
  assert.equal(versionResult.ok, false);
  if (!versionResult.ok) {
    assert.equal(versionResult.reason, "VERSION_MISMATCH");
  }

  const missingResult = await readAuthorizedDailyStoreSummaries(
    oneDayRead(),
    databaseWithRows([]),
  );
  assert.equal(missingResult.ok, false);
  if (!missingResult.ok) {
    assert.equal(missingResult.reason, "MISSING_SUMMARIES");
  }
});

test("deduplicates overlapping windows and keeps zero-activity rows as verified coverage", async () => {
  const rows = [
    dailyRow("2026-07-01"),
    dailyRow("2026-07-02"),
    dailyRow("2026-07-03"),
  ];
  const result = await readAuthorizedDailyStoreSummaries(
    {
      reads: [
        {
          business: business(),
          windows: [
            {
              fromDateValue: "2026-07-01",
              toDateValue: "2026-07-02",
            },
            {
              fromDateValue: "2026-07-02",
              toDateValue: "2026-07-03",
            },
          ],
        },
      ],
      requireMembershipHistory: true,
      checkedAt: new Date("2026-07-04T00:00:00.000Z"),
    },
    databaseWithRows(rows),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.expectedRowCount, 3);
  assert.equal(result.rows.length, 3);
  assert.deepEqual(
    result.rows.map((row) => row.businessDate.toISOString().slice(0, 10)),
    ["2026-07-01", "2026-07-02", "2026-07-03"],
  );
  assert.equal(result.rows[0]?.netSalesCents, 0);
  assert.equal(result.rows[0]?.transactionCount, 0);
});

test("default reader bounds stale candidates and preserves disjoint source windows", async () => {
  type CapturedStaleQuery = {
    where: {
      businessId: { in: string[] };
      updatedAt: { gt: Date };
      OR: unknown[];
    };
    orderBy: { updatedAt: string };
    take: number;
  };

  const rows = [dailyRow("2026-07-01"), dailyRow("2026-07-03")];
  const captured: Partial<
    Record<"invoice" | "payment" | "refund", CapturedStaleQuery>
  > = {};
  const result = await readAuthorizedDailyStoreSummaries(
    {
      reads: [
        {
          business: business(),
          windows: [
            {
              fromDateValue: "2026-07-01",
              toDateValue: "2026-07-01",
            },
            {
              fromDateValue: "2026-07-03",
              toDateValue: "2026-07-03",
            },
          ],
        },
      ],
      requireMembershipHistory: true,
      checkedAt: new Date("2026-07-05T00:00:00.000Z"),
    },
    {
      analyticsDailyStoreSummary: {
        findMany: async () => rows,
      },
      invoice: {
        findFirst: async () => null,
        findMany: async (args: CapturedStaleQuery) => {
          captured.invoice = args;
          return [];
        },
      },
      payment: {
        findFirst: async () => null,
        findMany: async (args: CapturedStaleQuery) => {
          captured.payment = args;
          return [];
        },
      },
      paymentRefund: {
        findFirst: async () => null,
        findMany: async (args: CapturedStaleQuery) => {
          captured.refund = args;
          return [];
        },
      },
    } as never,
  );

  assert.equal(result.ok, true);
  const storeId = business().id;
  const firstRange = getBusinessDayRange({
    fromDateValue: "2026-07-01",
    toDateValue: "2026-07-01",
    timezone: "Asia/Kuching",
    businessDayCutoffTime: "02:00",
  });
  const secondRange = getBusinessDayRange({
    fromDateValue: "2026-07-03",
    toDateValue: "2026-07-03",
    timezone: "Asia/Kuching",
    businessDayCutoffTime: "02:00",
  });

  for (const query of [
    captured.invoice,
    captured.payment,
    captured.refund,
  ]) {
    assert.equal(query?.take, 2_001);
    assert.deepEqual(query?.orderBy, { updatedAt: "desc" });
    assert.deepEqual(query?.where.businessId, { in: [storeId] });
    assert.deepEqual(query?.where.updatedAt, {
      gt: new Date("2026-07-04T00:00:00.000Z"),
    });
  }
  assert.deepEqual(captured.invoice?.where.OR, [
    {
      businessId: storeId,
      issuedAt: { gte: firstRange.fromDate, lt: firstRange.toDateExclusive },
    },
    {
      businessId: storeId,
      issuedAt: { gte: secondRange.fromDate, lt: secondRange.toDateExclusive },
    },
  ]);
  assert.deepEqual(captured.payment?.where.OR, [
    {
      businessId: storeId,
      paidAt: { gte: firstRange.fromDate, lt: firstRange.toDateExclusive },
    },
    {
      businessId: storeId,
      paidAt: { gte: secondRange.fromDate, lt: secondRange.toDateExclusive },
    },
    {
      businessId: storeId,
      invoice: {
        issuedAt: { gte: firstRange.fromDate, lt: firstRange.toDateExclusive },
      },
    },
    {
      businessId: storeId,
      invoice: {
        issuedAt: {
          gte: secondRange.fromDate,
          lt: secondRange.toDateExclusive,
        },
      },
    },
  ]);
  assert.deepEqual(captured.refund?.where.OR, [
    {
      businessId: storeId,
      refundedAt: {
        gte: firstRange.fromDate,
        lt: firstRange.toDateExclusive,
      },
    },
    {
      businessId: storeId,
      refundedAt: {
        gte: secondRange.fromDate,
        lt: secondRange.toDateExclusive,
      },
    },
    {
      businessId: storeId,
      invoice: {
        issuedAt: { gte: firstRange.fromDate, lt: firstRange.toDateExclusive },
      },
    },
    {
      businessId: storeId,
      invoice: {
        issuedAt: {
          gte: secondRange.fromDate,
          lt: secondRange.toDateExclusive,
        },
      },
    },
  ]);
});

function oneDayRead() {
  return {
    reads: [
      {
        business: business(),
        windows: [
          {
            fromDateValue: "2026-07-01",
            toDateValue: "2026-07-01",
          },
        ],
      },
    ],
    requireMembershipHistory: true,
  };
}

function business() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Store A",
    industryType: "GENERAL_SERVICE" as const,
    logoUrl: null,
    timezone: "Asia/Kuching",
    businessDayCutoffTime: "02:00",
    isCurrent: true,
    membershipPeriods: [
      {
        joinedAt: new Date("1970-01-01T00:00:00.000Z"),
        removedAt: null,
      },
    ],
  };
}

function dailyRow(businessDate: string): AnalyticsDailyRow {
  const range = getBusinessDayRange({
    fromDateValue: businessDate,
    toDateValue: businessDate,
    timezone: "Asia/Kuching",
    businessDayCutoffTime: "02:00",
  });
  return {
    averageTransactionValueCents: null,
    businessDate: new Date(`${businessDate}T00:00:00.000Z`),
    businessDayCutoffTime: "02:00",
    businessDayDefinitionVersion: 1,
    businessId: business().id,
    computedAt: new Date("2026-07-04T00:00:00.000Z"),
    discountsCents: 0,
    grossCollectionsCents: 0,
    grossSalesCents: 0,
    metricDefinitionVersion: 1,
    netCollectionsCents: 0,
    netSalesCents: 0,
    outstandingCents: 0,
    packageVoucherCents: 0,
    refundsCents: 0,
    sourceFrom: range.fromDate,
    sourceToExclusive: range.toDateExclusive,
    sourceWatermark: null,
    timezone: "Asia/Kuching",
    tipsCents: 0,
    transactionCount: 0,
  };
}

function databaseWithRows(rows: AnalyticsDailyRow[]) {
  return {
    analyticsDailyStoreSummary: {
      findMany: async () => rows,
    },
    invoice: {
      findMany: async () => [],
      findFirst: async () => null,
    },
    payment: {
      findMany: async () => [],
      findFirst: async () => null,
    },
    paymentRefund: {
      findMany: async () => [],
      findFirst: async () => null,
    },
  } as never;
}
