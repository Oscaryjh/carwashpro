import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  ANALYTICS_BUSINESS_DAY_DEFINITION_VERSION,
  ANALYTICS_METRIC_DEFINITION_VERSION,
} from "../../src/lib/analytics/constants";
import { getBusinessDayRange } from "../../src/lib/business-day";
import { getGroupLongTermTrendReport } from "../../src/lib/business-groups/group-long-term-trends";

const prisma = new PrismaClient();

test("long-term trends read verified PostgreSQL summaries, isolate scope, and fail closed on a missing zero day", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const businessIds: string[] = [];
  const userIds: string[] = [];
  const groupIds: string[] = [];

  try {
    const [storeA, storeB, outside] = await Promise.all([
      createBusiness(
        `Phase3 Trend A ${suffix}`,
        `phase3-trend-a-${suffix}`,
        "Asia/Kuching",
        "02:00",
      ),
      createBusiness(
        `Phase3 Trend B ${suffix}`,
        `phase3-trend-b-${suffix}`,
        "Asia/Tokyo",
        "04:00",
      ),
      createBusiness(
        `Phase3 Trend Outside ${suffix}`,
        `phase3-trend-outside-${suffix}`,
        "UTC",
        "00:00",
      ),
    ]);
    businessIds.push(storeA.id, storeB.id, outside.id);

    const group = await prisma.businessGroup.create({
      data: {
        name: `Phase3 Trend Group ${suffix}`,
        code: `phase3-trend-group-${suffix}`,
      },
    });
    groupIds.push(group.id);
    await prisma.businessGroupMember.createMany({
      data: [
        {
          groupId: group.id,
          businessId: storeA.id,
          joinedAt: new Date("2025-01-01T00:00:00.000Z"),
        },
        {
          groupId: group.id,
          businessId: storeB.id,
          joinedAt: new Date("2025-01-01T00:00:00.000Z"),
        },
      ],
    });

    const owner = await prisma.user.create({
      data: {
        name: "Phase 3 Trend Owner",
        email: `phase3-trend-owner-${suffix}@example.test`,
        passwordHash: "not-a-real-password",
        role: "STAFF",
      },
    });
    userIds.push(owner.id);
    await prisma.businessGroupUser.create({
      data: {
        groupId: group.id,
        userId: owner.id,
        role: "GROUP_OWNER",
      },
    });

    const currentValues = new Map([
      [`${storeA.id}:2026-07-01`, [10_000, 1]],
      [`${storeA.id}:2026-07-02`, [20_000, 2]],
      [`${storeB.id}:2026-07-01`, [30_000, 3]],
    ]);
    const previousValues = new Map([
      [`${storeA.id}:2026-06-01`, [5_000, 1]],
      [`${storeB.id}:2026-06-01`, [5_000, 1]],
    ]);
    const yoyValues = new Map([
      [`${storeA.id}:2025-07-01`, [2_000, 1]],
      [`${storeB.id}:2025-07-01`, [3_000, 1]],
    ]);
    const summaryRows = [
      ...buildSummaryRows(
        storeA,
        ["2026-07-01", "2026-07-02", "2026-07-03"],
        currentValues,
      ),
      ...buildSummaryRows(
        storeB,
        ["2026-07-01", "2026-07-02", "2026-07-03"],
        currentValues,
      ),
      ...buildSummaryRows(
        storeA,
        ["2026-06-01", "2026-06-02", "2026-06-03"],
        previousValues,
      ),
      ...buildSummaryRows(
        storeB,
        ["2026-06-01", "2026-06-02", "2026-06-03"],
        previousValues,
      ),
      ...buildSummaryRows(
        storeA,
        ["2025-07-01", "2025-07-02", "2025-07-03"],
        yoyValues,
      ),
      ...buildSummaryRows(
        storeB,
        ["2025-07-01", "2025-07-02", "2025-07-03"],
        yoyValues,
      ),
      ...buildSummaryRows(
        outside,
        ["2026-07-01"],
        new Map([[`${outside.id}:2026-07-01`, [999_999, 1]]]),
      ),
    ];
    await prisma.analyticsDailyStoreSummary.createMany({
      data: summaryRows,
    });

    const report = await getGroupLongTermTrendReport(
      {
        userId: owner.id,
        groupId: group.id,
        activeBusinessId: storeA.id,
        preset: "month",
      },
      prisma,
      { now: new Date("2026-07-03T12:00:00.000Z") },
    );
    assert.equal(report?.status, "READY");
    if (!report || report.status !== "READY") return;
    assert.equal(report.authorizedBusinessCount, 2);
    assert.equal(report.current.netSalesCents, 60_000);
    assert.equal(report.current.transactionCount, 6);
    assert.equal(report.current.averageTransactionValueCents, 10_000);
    assert.deepEqual(
      report.points.map((point) => ({
        key: point.key,
        netSalesCents: point.netSalesCents,
        storeCount: point.storeCount,
        hasCoverage: point.hasCoverage,
      })),
      [
        {
          key: "2026-07-01",
          netSalesCents: 40_000,
          storeCount: 2,
          hasCoverage: true,
        },
        {
          key: "2026-07-02",
          netSalesCents: 20_000,
          storeCount: 2,
          hasCoverage: true,
        },
        {
          key: "2026-07-03",
          netSalesCents: 0,
          storeCount: 2,
          hasCoverage: true,
        },
      ],
    );
    assert.equal(report.comparisons[0]?.previousNetSalesCents, 10_000);
    assert.equal(report.comparisons[1]?.previousNetSalesCents, 5_000);

    await prisma.analyticsDailyStoreSummary.deleteMany({
      where: {
        businessId: storeB.id,
        businessDate: new Date("2026-07-02T00:00:00.000Z"),
      },
    });
    const incomplete = await getGroupLongTermTrendReport(
      {
        userId: owner.id,
        groupId: group.id,
        activeBusinessId: storeA.id,
        preset: "month",
      },
      prisma,
      { now: new Date("2026-07-03T12:00:00.000Z") },
    );
    assert.equal(incomplete?.status, "UNAVAILABLE");
    if (incomplete?.status === "UNAVAILABLE") {
      assert.equal(incomplete.reason, "MISSING_SUMMARIES");
    }
  } finally {
    if (businessIds.length) {
      await prisma.analyticsDailyStoreSummary.deleteMany({
        where: { businessId: { in: businessIds } },
      });
    }
    if (groupIds.length) {
      await prisma.businessGroupAuditLog.deleteMany({
        where: { groupId: { in: groupIds } },
      });
      await prisma.businessGroupUser.deleteMany({
        where: { groupId: { in: groupIds } },
      });
      await prisma.businessGroupMember.deleteMany({
        where: { groupId: { in: groupIds } },
      });
      await prisma.businessGroup.deleteMany({
        where: { id: { in: groupIds } },
      });
    }
    if (userIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (businessIds.length) {
      await prisma.business.deleteMany({
        where: { id: { in: businessIds } },
      });
    }
    await prisma.$disconnect();
  }
});

async function createBusiness(
  name: string,
  slug: string,
  timezone: string,
  businessDayCutoffTime: string,
) {
  return prisma.business.create({
    data: {
      name,
      slug,
      industryType: "GENERAL_SERVICE",
      timezone,
      businessDayCutoffTime,
    },
  });
}

function buildSummaryRows(
  business: {
    id: string;
    timezone: string;
    businessDayCutoffTime: string;
  },
  businessDates: string[],
  values: Map<string, number[]>,
) {
  return businessDates.map((businessDate) => {
    const [netSalesCents = 0, transactionCount = 0] =
      values.get(`${business.id}:${businessDate}`) ?? [];
    const range = getBusinessDayRange({
      fromDateValue: businessDate,
      toDateValue: businessDate,
      timezone: business.timezone,
      businessDayCutoffTime: business.businessDayCutoffTime,
    });
    return {
      businessId: business.id,
      businessDate: new Date(`${businessDate}T00:00:00.000Z`),
      timezone: business.timezone,
      businessDayCutoffTime: business.businessDayCutoffTime,
      businessDayDefinitionVersion:
        ANALYTICS_BUSINESS_DAY_DEFINITION_VERSION,
      metricDefinitionVersion: ANALYTICS_METRIC_DEFINITION_VERSION,
      grossSalesCents: netSalesCents,
      discountsCents: 0,
      netSalesCents,
      grossCollectionsCents: netSalesCents,
      netCollectionsCents: netSalesCents,
      refundsCents: 0,
      outstandingCents: 0,
      tipsCents: 0,
      packageVoucherCents: 0,
      transactionCount,
      averageTransactionValueCents:
        transactionCount > 0
          ? Math.round(netSalesCents / transactionCount)
          : null,
      sourceFrom: range.fromDate,
      sourceToExclusive: range.toDateExclusive,
      sourceWatermark: null,
      computedAt: new Date("2026-07-04T00:00:00.000Z"),
    };
  });
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for integration tests.");
  }
  const hostname = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1"].includes(hostname)) {
    throw new Error("Integration tests are restricted to the local database.");
  }
}
