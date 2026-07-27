import assert from "node:assert/strict";
import test from "node:test";
import { getBusinessDayRangeWithPrevious } from "../../src/lib/business-day";
import {
  calculateAllStoresKpis,
  compareKpiValues,
  getAllStoresKpiReport,
  getCurrentBusinessDateValue,
  moneyToCents,
} from "../../src/lib/business-groups/all-stores-kpi";

const salonPeriods = getBusinessDayRangeWithPrevious({
  fromDateValue: "2026-07-01",
  toDateValue: "2026-07-01",
  timezone: "Asia/Kuching",
  businessDayCutoffTime: "02:00",
});

test("calculates invoice sales, package redemption, refunds, collection, count, and ATV in cents", () => {
  const result = calculateAllStoresKpis({
    businessIds: ["salon"],
    periods: new Map([["salon", salonPeriods]]),
    invoices: [
      {
        id: "invoice-current",
        businessId: "salon",
        issuedAt: new Date("2026-06-30T20:00:00.000Z"),
        total: "120.00",
        tipAmount: "10.00",
        discountAmount: "10.00",
        loyaltyDiscountAmount: "5.00",
        payments: [{ amount: "20.00" }],
      },
      {
        id: "package-sale",
        businessId: "salon",
        issuedAt: new Date("2026-06-30T21:00:00.000Z"),
        total: "200.00",
        tipAmount: "0.00",
        discountAmount: "0.00",
        loyaltyDiscountAmount: "0.00",
        payments: [],
      },
      {
        id: "invoice-previous",
        businessId: "salon",
        issuedAt: new Date("2026-06-29T20:00:00.000Z"),
        total: "50.00",
        tipAmount: "0.00",
        discountAmount: "0.00",
        loyaltyDiscountAmount: "0.00",
        payments: [],
      },
    ],
    payments: [
      {
        businessId: "salon",
        paidAt: new Date("2026-06-30T22:00:00.000Z"),
        amount: "100.00",
      },
    ],
    refunds: [
      {
        businessId: "salon",
        refundedAt: new Date("2026-07-01T01:00:00.000Z"),
        amount: "15.00",
      },
    ],
  }).get("salon");

  assert.deepEqual(result?.current, {
    grossSalesCents: 30_500,
    netSalesCents: 27_500,
    paymentsCollectedCents: 10_000,
    refundsCents: 1_500,
    transactionCount: 2,
    averageTransactionValueCents: 13_750,
  });
  assert.deepEqual(result?.previous, {
    grossSalesCents: 5_000,
    netSalesCents: 5_000,
    paymentsCollectedCents: 0,
    refundsCents: 0,
    transactionCount: 1,
    averageTransactionValueCents: 5_000,
  });
});

test("unpaid and partial invoices count once while payments remain independent", () => {
  const result = calculateAllStoresKpis({
    businessIds: ["salon"],
    periods: new Map([["salon", salonPeriods]]),
    invoices: [
      invoice("unpaid", "75.00"),
      invoice("partial", "125.00"),
    ],
    payments: [
      {
        businessId: "salon",
        paidAt: new Date("2026-06-30T22:00:00.000Z"),
        amount: "25.00",
      },
      {
        businessId: "salon",
        paidAt: new Date("2026-06-30T23:00:00.000Z"),
        amount: "25.00",
      },
    ],
    refunds: [],
  }).get("salon")?.current;

  assert.equal(result?.grossSalesCents, 20_000);
  assert.equal(result?.netSalesCents, 20_000);
  assert.equal(result?.paymentsCollectedCents, 5_000);
  assert.equal(result?.transactionCount, 2);
  assert.equal(result?.averageTransactionValueCents, 10_000);
});

test("refunds belong to refundedAt business day without removing original invoice", () => {
  const result = calculateAllStoresKpis({
    businessIds: ["salon"],
    periods: new Map([["salon", salonPeriods]]),
    invoices: [invoice("original", "100.00")],
    payments: [],
    refunds: [
      {
        businessId: "salon",
        refundedAt: new Date("2026-06-29T22:00:00.000Z"),
        amount: "30.00",
      },
    ],
  }).get("salon");

  assert.equal(result?.current.transactionCount, 1);
  assert.equal(result?.current.netSalesCents, 10_000);
  assert.equal(result?.previous.refundsCents, 3_000);
  assert.equal(result?.previous.netSalesCents, -3_000);
});

test("comparison handles New, No change, and signed percentages", () => {
  assert.deepEqual(compareKpiValues(1_000, 0), { kind: "NEW" });
  assert.deepEqual(compareKpiValues(0, 0), { kind: "NO_CHANGE" });
  assert.deepEqual(compareKpiValues(-100, 0), {
    kind: "CHANGE",
    direction: "DOWN",
  });
  assert.deepEqual(compareKpiValues(125, 100), {
    kind: "PERCENT",
    percentage: 25,
  });
  assert.deepEqual(compareKpiValues(50, 100), {
    kind: "PERCENT",
    percentage: -50,
  });
});

test("money conversion remains integer based and rejects excess precision", () => {
  assert.equal(moneyToCents("0"), 0);
  assert.equal(moneyToCents("10.5"), 1_050);
  assert.equal(moneyToCents("-1.25"), -125);
  assert.throws(() => moneyToCents("1.001"), /two decimal places/);
});

test("current business date follows each timezone and cutoff including DST", () => {
  assert.equal(
    getCurrentBusinessDateValue(
      new Date("2026-07-01T17:30:00.000Z"),
      "Asia/Kuching",
      "02:00",
    ),
    "2026-07-01",
  );
  assert.equal(
    getCurrentBusinessDateValue(
      new Date("2026-07-01T17:30:00.000Z"),
      "Asia/Tokyo",
      "04:00",
    ),
    "2026-07-01",
  );
  assert.equal(
    getCurrentBusinessDateValue(
      new Date("2026-03-08T06:30:00.000Z"),
      "America/New_York",
      "02:00",
    ),
    "2026-03-07",
  );
  assert.equal(
    getCurrentBusinessDateValue(
      new Date("2026-11-01T07:30:00.000Z"),
      "America/New_York",
      "02:00",
    ),
    "2026-11-01",
  );
});

test("service resolves authorization before querying and never accepts client business lists", async () => {
  let resolverCalls = 0;
  let queryCalls = 0;
  const database = {
    invoice: { findMany: async () => (queryCalls += 1, []) },
    payment: { findMany: async () => (queryCalls += 1, []) },
    paymentRefund: { findMany: async () => (queryCalls += 1, []) },
  } as never;
  const resolveScope = async () => {
    resolverCalls += 1;
    return {
      groupId: "group",
      groupName: "QA Group",
      role: "GROUP_OWNER" as const,
      canViewAllStores: true,
      businesses: [
        {
          id: "authorized-a",
          name: "Authorized A",
          industryType: "SALON_BEAUTY" as const,
          logoUrl: null,
          timezone: "Asia/Kuching",
          businessDayCutoffTime: "02:00",
          isCurrent: true,
        },
        {
          id: "authorized-b",
          name: "Authorized B",
          industryType: "AUTO_DETAILING" as const,
          logoUrl: null,
          timezone: "Asia/Tokyo",
          businessDayCutoffTime: "04:00",
          isCurrent: false,
        },
      ],
    };
  };

  const report = await getAllStoresKpiReport(
    {
      userId: "user",
      groupId: "group",
      activeBusinessId: "authorized-a",
      range: "custom",
      from: "2026-07-01",
      to: "2026-07-07",
    },
    database,
    { resolveScope: resolveScope as never },
  );
  assert.equal(resolverCalls, 1);
  assert.equal(queryCalls, 3);
  assert.equal(report?.authorizedBusinessCount, 2);
  assert.equal(
    report?.businesses[0]?.currentRange.fromDate.toISOString(),
    "2026-06-30T18:00:00.000Z",
  );
  assert.equal(
    report?.businesses[1]?.currentRange.fromDate.toISOString(),
    "2026-06-30T19:00:00.000Z",
  );

  queryCalls = 0;
  const denied = await getAllStoresKpiReport(
    {
      userId: "user",
      groupId: "outside",
      activeBusinessId: "authorized-a",
    },
    database,
    { resolveScope: (async () => null) as never },
  );
  assert.equal(denied, null);
  assert.equal(queryCalls, 0);
});

test("custom ranges reject invalid order and more than 31 days", async () => {
  const scope = {
    groupId: "group",
    groupName: "QA Group",
    role: "GROUP_OWNER" as const,
    canViewAllStores: true,
    businesses: [
      {
        id: "a",
        name: "A",
        industryType: "SALON_BEAUTY" as const,
        logoUrl: null,
        timezone: "UTC",
        businessDayCutoffTime: "00:00",
        isCurrent: true,
      },
      {
        id: "b",
        name: "B",
        industryType: "AUTO_DETAILING" as const,
        logoUrl: null,
        timezone: "UTC",
        businessDayCutoffTime: "00:00",
        isCurrent: false,
      },
    ],
  };
  const database = {} as never;
  const base = {
    userId: "user",
    groupId: "group",
    activeBusinessId: "a",
    range: "custom",
  };

  await assert.rejects(
    getAllStoresKpiReport(
      { ...base, from: "2026-07-02", to: "2026-07-01" },
      database,
      { resolveScope: (async () => scope) as never },
    ),
    /start date/,
  );
  await assert.rejects(
    getAllStoresKpiReport(
      { ...base, from: "2026-07-01", to: "2026-08-01" },
      database,
      { resolveScope: (async () => scope) as never },
    ),
    /31 business days/,
  );

  let queryCalls = 0;
  const databaseWithQueries = {
    invoice: { findMany: async () => (queryCalls += 1, []) },
    payment: { findMany: async () => (queryCalls += 1, []) },
    paymentRefund: { findMany: async () => (queryCalls += 1, []) },
  } as never;
  const boundary = await getAllStoresKpiReport(
    { ...base, from: "2026-07-01", to: "2026-07-31" },
    databaseWithQueries,
    { resolveScope: (async () => scope) as never },
  );
  assert.equal(boundary?.businesses[0]?.currentRange.dayCount, 31);
  assert.equal(boundary?.businesses[0]?.previousRange.dayCount, 31);
  assert.equal(queryCalls, 3);
});

function invoice(id: string, total: string) {
  return {
    id,
    businessId: "salon",
    issuedAt: new Date("2026-06-30T20:00:00.000Z"),
    total,
    tipAmount: "0.00",
    discountAmount: "0.00",
    loyaltyDiscountAmount: "0.00",
    payments: [],
  };
}
