import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { refreshDailyStoreSummaries } from "../../src/lib/analytics/daily-store-summary";
import {
  getGroupReports,
  GroupReportsInputError,
} from "../../src/lib/business-groups/group-reports";

const prisma = new PrismaClient();

test("Group Reports enforces live scope, event filters, and database pagination", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const businessIds: string[] = [];
  const groupIds: string[] = [];
  const userIds: string[] = [];
  const analyticsRunIds: string[] = [];

  try {
    const [salon, auto, outside] = await Promise.all([
      createBusiness(
        `Stage3B2 Salon ${suffix}`,
        `stage3b2-salon-${suffix}`,
        "SALON_BEAUTY",
        "Asia/Kuching",
        "02:00",
      ),
      createBusiness(
        `Stage3B2 Auto ${suffix}`,
        `stage3b2-auto-${suffix}`,
        "AUTO_DETAILING",
        "Asia/Tokyo",
        "04:00",
      ),
      createBusiness(
        `Stage3B2 Outside ${suffix}`,
        `stage3b2-outside-${suffix}`,
        "SALON_BEAUTY",
        "UTC",
        "00:00",
      ),
    ]);
    businessIds.push(salon.id, auto.id, outside.id);

    const [group, outsideGroup] = await Promise.all([
      prisma.businessGroup.create({
        data: {
          name: `Stage3B2 Group ${suffix}`,
          code: `stage3b2-group-${suffix}`,
        },
      }),
      prisma.businessGroup.create({
        data: {
          name: `Stage3B2 Outside ${suffix}`,
          code: `stage3b2-outside-group-${suffix}`,
        },
      }),
    ]);
    groupIds.push(group.id, outsideGroup.id);
    const memberships = await Promise.all([
      prisma.businessGroupMember.create({
        data: { groupId: group.id, businessId: salon.id, joinedAt: new Date("2026-01-01T00:00:00.000Z") },
      }),
      prisma.businessGroupMember.create({
        data: { groupId: group.id, businessId: auto.id, joinedAt: new Date("2026-01-01T00:00:00.000Z") },
      }),
      prisma.businessGroupMember.create({
        data: { groupId: outsideGroup.id, businessId: outside.id, joinedAt: new Date("2026-01-01T00:00:00.000Z") },
      }),
    ]);

    const [owner, manager, directOwner, staff, platformAdmin] =
      await Promise.all([
        createUser(`stage3b2-owner-${suffix}@example.test`, "STAFF"),
        createUser(`stage3b2-manager-${suffix}@example.test`, "STAFF"),
        createUser(
          `stage3b2-direct-${suffix}@example.test`,
          "BUSINESS_OWNER",
          salon.id,
        ),
        createUser(
          `stage3b2-staff-${suffix}@example.test`,
          "STAFF",
          salon.id,
        ),
        createUser(
          `stage3b2-admin-${suffix}@example.test`,
          "PLATFORM_ADMIN",
        ),
      ]);
    userIds.push(
      owner.id,
      manager.id,
      directOwner.id,
      staff.id,
      platformAdmin.id,
    );
    await prisma.businessGroupUser.create({
      data: { groupId: group.id, userId: owner.id, role: "GROUP_OWNER" },
    });
    const managerGrant = await prisma.businessGroupUser.create({
      data: {
        groupId: group.id,
        userId: manager.id,
        role: "GROUP_MANAGER",
        accessScope: "SELECTED_BUSINESSES",
        businessAccesses: {
          create: [{ businessId: salon.id }, { businessId: auto.id }],
        },
      },
    });

    const primaryInvoice = await prisma.invoice.create({
      data: {
        businessId: salon.id,
        invoiceNumber: `S-PRIMARY-${suffix}`,
        subtotal: "120.00",
        discountAmount: "10.00",
        tipAmount: "10.00",
        total: "120.00",
        paidAmount: "70.00",
        balance: "30.00",
        status: "PARTIAL",
        issuedAt: new Date("2026-06-30T20:00:00.000Z"),
      },
    });
    const cashPayment = await prisma.payment.create({
      data: {
        businessId: salon.id,
        invoiceId: primaryInvoice.id,
        amount: "50.00",
        method: "CASH",
        paidAt: new Date("2026-06-30T21:00:00.000Z"),
      },
    });
    await prisma.payment.createMany({
      data: [
        {
          businessId: salon.id,
          invoiceId: primaryInvoice.id,
          amount: "20.00",
          method: "CARD",
          paidAt: new Date("2026-06-30T21:30:00.000Z"),
        },
        {
          businessId: salon.id,
          invoiceId: primaryInvoice.id,
          amount: "20.00",
          method: "PACKAGE",
          paidAt: new Date("2026-06-30T21:45:00.000Z"),
        },
      ],
    });
    await prisma.paymentRefund.create({
      data: {
        businessId: salon.id,
        invoiceId: primaryInvoice.id,
        paymentId: cashPayment.id,
        amount: "5.00",
        method: "CASH",
        reason: "Stage3B2 QA refund",
        refundedAt: new Date("2026-06-30T22:00:00.000Z"),
      },
    });

    await prisma.invoice.create({
      data: {
        businessId: auto.id,
        invoiceNumber: `A-PRIMARY-${suffix}`,
        subtotal: "200.00",
        total: "200.00",
        paidAmount: "200.00",
        balance: "0.00",
        status: "PAID",
        issuedAt: new Date("2026-06-30T20:00:00.000Z"),
        payments: {
          create: {
            businessId: auto.id,
            amount: "200.00",
            method: "CASH",
            paidAt: new Date("2026-06-30T20:30:00.000Z"),
          },
        },
        items: {
          create: {
            businessId: auto.id,
            serviceId: null,
            productId: null,
            name: "Stage3B2 Auto Service",
            quantity: 2,
            unitPrice: "100.00",
            lineTotal: "200.00",
          },
        },
      },
    });
    await prisma.invoice.create({
      data: {
        businessId: outside.id,
        invoiceNumber: `OUTSIDE-${suffix}`,
        subtotal: "9999.00",
        total: "9999.00",
        paidAmount: "0.00",
        balance: "9999.00",
        issuedAt: new Date("2026-06-30T20:00:00.000Z"),
      },
    });
    await prisma.invoice.createMany({
      data: Array.from({ length: 26 }, (_, index) => ({
        businessId: salon.id,
        invoiceNumber: `S-PAGE-${String(index).padStart(2, "0")}-${suffix}`,
        subtotal: "1.00",
        total: "1.00",
        paidAmount: "0.00",
        balance: "1.00",
        status: "UNPAID" as const,
        issuedAt: new Date(
          new Date("2026-06-30T20:00:00.000Z").getTime() + index + 1,
        ),
      })),
    });

    const auditCountBefore = await prisma.businessGroupAuditLog.count({
      where: { groupId: group.id },
    });
    const ownerPageOne = await getGroupReports({
      userId: owner.id,
      groupId: group.id,
      activeBusinessId: salon.id,
      range: "custom",
      from: "2026-07-01",
      to: "2026-07-01",
      page: "1",
    });
    assert.equal(ownerPageOne?.authorizedBusinesses.length, 2);
    assert.equal(ownerPageOne?.totalRows, 28);
    assert.equal(ownerPageOne?.rows.length, 25);
    assert.equal(ownerPageOne?.summary.transactionCount, 28);
    assert.equal(ownerPageOne?.trend.length, 1);
    assert.equal(ownerPageOne?.trend[0].transactionCount, 28);
    assert.deepEqual(
      ownerPageOne?.businessPerformance.map((item) => item.businessId),
      [auto.id, salon.id],
    );
    assert.equal(ownerPageOne?.businessPerformance[0].rank, 1);
    assert.deepEqual(ownerPageOne?.catalogRankings.services, []);
    assert.equal(
      ownerPageOne?.businessPerformance.some(
        (item) => item.businessId === outside.id,
      ),
      false,
    );
    assert.equal(
      ownerPageOne?.rows.some((row) => row.businessId === outside.id),
      false,
    );
    assert.equal(
      await prisma.businessGroupAuditLog.count({ where: { groupId: group.id } }),
      auditCountBefore,
    );

    const analyticsRefresh = await refreshDailyStoreSummaries({
      businessIds: [salon.id, auto.id],
      fromDate: "2026-06-30",
      toDate: "2026-07-01",
      trigger: "BACKFILL",
    });
    analyticsRunIds.push(analyticsRefresh.runId);
    const dailySummaryReport = await getGroupReports(
      {
        userId: owner.id,
        groupId: group.id,
        activeBusinessId: salon.id,
        range: "custom",
        from: "2026-07-01",
        to: "2026-07-01",
        page: "1",
      },
      prisma,
      { analyticsReadMode: "PRIMARY" },
    );
    assert.equal(dailySummaryReport?.summaryDataSource, "DAILY_SUMMARY");
    assert.equal(dailySummaryReport?.analyticsFallbackReason, null);
    assert.deepEqual(dailySummaryReport?.summary, ownerPageOne?.summary);
    assert.deepEqual(dailySummaryReport?.trend, ownerPageOne?.trend);
    assert.deepEqual(
      dailySummaryReport?.businessPerformance.map((item) => ({
        businessId: item.businessId,
        metrics: item.metrics,
        rank: item.rank,
      })),
      ownerPageOne?.businessPerformance.map((item) => ({
        businessId: item.businessId,
        metrics: item.metrics,
        rank: item.rank,
      })),
    );
    assert.deepEqual(
      dailySummaryReport?.businessTrends,
      ownerPageOne?.businessTrends,
    );

    const ownerPageTwo = await getGroupReports({
      userId: owner.id,
      groupId: group.id,
      activeBusinessId: salon.id,
      range: "custom",
      from: "2026-07-01",
      to: "2026-07-01",
      page: "2",
    });
    assert.equal(ownerPageTwo?.rows.length, 3);
    assert.equal(
      new Set(
        [...ownerPageOne!.rows, ...ownerPageTwo!.rows].map((row) => row.id),
      ).size,
      28,
    );

    const cashPartial = await getGroupReports({
      userId: manager.id,
      groupId: group.id,
      activeBusinessId: salon.id,
      range: "custom",
      from: "2026-07-01",
      to: "2026-07-01",
      store: salon.id,
      paymentMethod: "cash",
      status: "partial",
    });
    assert.equal(cashPartial?.rows.length, 1);
    assert.equal(cashPartial?.rows[0].id, primaryInvoice.id);
    assert.equal(cashPartial?.rows[0].paidAmountCents, 5_000);
    assert.equal(cashPartial?.rows[0].refundAmountCents, 500);
    assert.deepEqual(cashPartial?.rows[0].paymentMethods, ["CASH"]);
    assert.equal(cashPartial?.summary.transactionCount, 1);
    assert.equal(cashPartial?.summary.paymentsCollectedCents, 5_000);
    assert.equal(cashPartial?.summary.refundsCents, 500);

    await assert.rejects(
      () =>
        getGroupReports({
          userId: owner.id,
          groupId: group.id,
          activeBusinessId: salon.id,
          store: outside.id,
        }),
      GroupReportsInputError,
    );
    for (const user of [directOwner, staff, platformAdmin]) {
      assert.equal(
        await getGroupReports({
          userId: user.id,
          groupId: group.id,
          activeBusinessId: salon.id,
        }),
        null,
      );
    }
    assert.equal(
      await getGroupReports({
        userId: owner.id,
        groupId: outsideGroup.id,
        activeBusinessId: salon.id,
      }),
      null,
    );

    await prisma.businessGroupUserBusinessAccess.delete({
      where: {
        groupUserId_businessId: {
          groupUserId: managerGrant.id,
          businessId: auto.id,
        },
      },
    });
    assert.equal(
      await getGroupReports({
        userId: manager.id,
        groupId: group.id,
        activeBusinessId: salon.id,
      }),
      null,
    );
    await prisma.businessGroupUserBusinessAccess.create({
      data: { groupUserId: managerGrant.id, businessId: auto.id },
    });
    await prisma.businessGroupMember.update({
      where: { id: memberships[1].id },
      data: { status: "REMOVED", removedAt: new Date() },
    });
    assert.equal(
      await getGroupReports({
        userId: owner.id,
        groupId: group.id,
        activeBusinessId: salon.id,
      }),
      null,
    );
  } finally {
    if (businessIds.length) {
      await prisma.analyticsDailyStoreSummary.deleteMany({
        where: { businessId: { in: businessIds } },
      });
    }
    if (analyticsRunIds.length) {
      await prisma.analyticsRefreshRun.deleteMany({
        where: { id: { in: analyticsRunIds } },
      });
    }
    if (businessIds.length) {
      await prisma.paymentRefund.deleteMany({
        where: { businessId: { in: businessIds } },
      });
      await prisma.payment.deleteMany({
        where: { businessId: { in: businessIds } },
      });
      await prisma.invoice.deleteMany({
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
  industryType: "SALON_BEAUTY" | "AUTO_DETAILING",
  timezone: string,
  businessDayCutoffTime: string,
) {
  return prisma.business.create({
    data: { name, slug, industryType, timezone, businessDayCutoffTime },
  });
}

async function createUser(
  email: string,
  role: "BUSINESS_OWNER" | "PLATFORM_ADMIN" | "STAFF",
  businessId: string | null = null,
) {
  return prisma.user.create({
    data: {
      businessId,
      name: email.split("@")[0],
      email,
      passwordHash: "not-a-real-password",
      role,
    },
  });
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const hostname = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1"].includes(hostname)) {
    throw new Error("Integration tests are restricted to the local database.");
  }
}
