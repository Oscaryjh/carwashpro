import assert from "node:assert/strict";
import test from "node:test";
import { getGroupReports } from "../../src/lib/business-groups/group-reports";

const partialStore = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Joined Mid-range",
  industryType: "AUTO_DETAILING" as const,
  logoUrl: null,
  timezone: "Asia/Kuching",
  businessDayCutoffTime: "02:00",
  isCurrent: true,
  membershipPeriods: [
    {
      joinedAt: new Date("2026-07-01T18:00:00.000Z"),
      removedAt: null,
    },
  ],
};

const fullStore = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Full Range",
  industryType: "SALON_BEAUTY" as const,
  logoUrl: null,
  timezone: "Asia/Kuching",
  businessDayCutoffTime: "02:00",
  isCurrent: false,
  membershipPeriods: [
    {
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      removedAt: null,
    },
  ],
};

test("projects membership coverage onto each store trend date", async () => {
  const database = {
    analyticsDailyStoreSummary: {
      findMany: async () => [],
    },
    invoice: {
      findMany: async () => [],
      count: async () => 0,
    },
    payment: {
      findMany: async () => [],
    },
    paymentRefund: {
      findMany: async () => [],
    },
  };
  const result = await getGroupReports(
    {
      userId: "user",
      groupId: "33333333-3333-4333-8333-333333333333",
      activeBusinessId: partialStore.id,
      range: "custom",
      from: "2026-07-01",
      to: "2026-07-03",
    },
    database as never,
    {
      analyticsReadMode: "OFF",
      now: new Date("2026-07-03T12:00:00.000Z"),
      resolveScope: async () => ({
        groupId: "33333333-3333-4333-8333-333333333333",
        groupName: "Coverage Group",
        role: "GROUP_OWNER",
        canViewAllStores: true,
        businesses: [partialStore, fullStore],
      }),
    },
  );

  assert.deepEqual(
    result?.businessPerformance.map((business) => ({
      businessId: business.businessId,
      coverage: business.coverage,
      rank: business.rank,
    })),
    [
      { businessId: fullStore.id, coverage: "FULL", rank: 1 },
      { businessId: partialStore.id, coverage: "PARTIAL", rank: 2 },
    ],
  );
  assert.deepEqual(
    result?.businessTrends
      .find((trend) => trend.businessId === partialStore.id)
      ?.points.map((point) => ({
        businessDate: point.businessDate,
        coverage: point.coverage,
        netSalesCents: point.netSalesCents,
      })),
    [
      { businessDate: "2026-07-01", coverage: "NONE", netSalesCents: 0 },
      { businessDate: "2026-07-02", coverage: "FULL", netSalesCents: 0 },
      { businessDate: "2026-07-03", coverage: "FULL", netSalesCents: 0 },
    ],
  );
});
