import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { getAllStoresKpiReport } from "../../src/lib/business-groups/all-stores-kpi";
import { refreshDailyStoreSummaries } from "../../src/lib/analytics/daily-store-summary";

const prisma = new PrismaClient();

test("All Stores KPI uses live scope, canonical business days, and isolated invoice data", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const businessIds: string[] = [];
  const userIds: string[] = [];
  const groupIds: string[] = [];
  const analyticsRunIds: string[] = [];

  try {
    const [salon, auto, scopedThird, outside] = await Promise.all([
      createBusiness(
        `Stage3B1 Salon ${suffix}`,
        `stage3b1-salon-${suffix}`,
        "SALON_BEAUTY",
        "Asia/Kuching",
        "02:00",
      ),
      createBusiness(
        `Stage3B1 Auto ${suffix}`,
        `stage3b1-auto-${suffix}`,
        "AUTO_DETAILING",
        "Asia/Tokyo",
        "04:00",
      ),
      createBusiness(
        `Stage3B1 Third ${suffix}`,
        `stage3b1-third-${suffix}`,
        "GENERAL_SERVICE",
        "UTC",
        "00:00",
      ),
      createBusiness(
        `Stage3B1 Outside ${suffix}`,
        `stage3b1-outside-${suffix}`,
        "SALON_BEAUTY",
        "Asia/Kuching",
        "02:00",
      ),
    ]);
    businessIds.push(salon.id, auto.id, scopedThird.id, outside.id);

    const [group, outsideGroup] = await Promise.all([
      prisma.businessGroup.create({
        data: {
          name: `Stage3B1 Group ${suffix}`,
          code: `stage3b1-group-${suffix}`,
        },
      }),
      prisma.businessGroup.create({
        data: {
          name: `Stage3B1 Outside Group ${suffix}`,
          code: `stage3b1-outside-group-${suffix}`,
        },
      }),
    ]);
    groupIds.push(group.id, outsideGroup.id);
    await prisma.businessGroupMember.createMany({
      data: [
        { groupId: group.id, businessId: salon.id, joinedAt: new Date("2026-01-01T00:00:00.000Z") },
        { groupId: group.id, businessId: auto.id, joinedAt: new Date("2026-01-01T00:00:00.000Z") },
        { groupId: group.id, businessId: scopedThird.id, joinedAt: new Date("2026-01-01T00:00:00.000Z") },
        { groupId: outsideGroup.id, businessId: outside.id, joinedAt: new Date("2026-01-01T00:00:00.000Z") },
      ],
    });

    const [owner, manager, directOwner] = await Promise.all([
      createUser(`stage3b1-owner-${suffix}@example.test`, "STAFF"),
      createUser(`stage3b1-manager-${suffix}@example.test`, "STAFF"),
      createUser(
        `stage3b1-direct-${suffix}@example.test`,
        "BUSINESS_OWNER",
        salon.id,
      ),
    ]);
    userIds.push(owner.id, manager.id, directOwner.id);
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

    const salonInvoice = await createInvoice({
      businessId: salon.id,
      invoiceNumber: `S-${suffix}`,
      issuedAt: new Date("2026-06-30T20:00:00.000Z"),
      total: "100.00",
      discountAmount: "10.00",
      tipAmount: "10.00",
    });
    const packagePayment = await prisma.payment.create({
      data: {
        businessId: salon.id,
        invoiceId: salonInvoice.id,
        amount: "20.00",
        method: "PACKAGE",
        paidAt: new Date("2026-06-30T20:00:00.000Z"),
      },
    });
    const cashPayment = await prisma.payment.create({
      data: {
        businessId: salon.id,
        invoiceId: salonInvoice.id,
        amount: "70.00",
        method: "CASH",
        paidAt: new Date("2026-06-30T20:00:00.000Z"),
      },
    });
    await prisma.paymentRefund.create({
      data: {
        businessId: salon.id,
        invoiceId: salonInvoice.id,
        paymentId: cashPayment.id,
        amount: "5.00",
        method: "CASH",
        reason: "Stage3B1 QA refund",
        refundedAt: new Date("2026-06-30T21:00:00.000Z"),
      },
    });
    await createInvoice({
      businessId: auto.id,
      invoiceNumber: `A-${suffix}`,
      issuedAt: new Date("2026-06-30T20:00:00.000Z"),
      total: "200.00",
    });
    await createInvoice({
      businessId: salon.id,
      invoiceNumber: `P-${suffix}`,
      issuedAt: new Date("2026-06-29T20:00:00.000Z"),
      total: "50.00",
    });
    await createInvoice({
      businessId: outside.id,
      invoiceNumber: `O-${suffix}`,
      issuedAt: new Date("2026-06-30T20:00:00.000Z"),
      total: "9999.00",
    });
    const voidInvoice = await prisma.invoice.create({
      data: {
        businessId: salon.id,
        invoiceNumber: `V-${suffix}`,
        subtotal: "500.00",
        total: "500.00",
        paidAmount: "500.00",
        balance: "0.00",
        status: "VOID",
        issuedAt: new Date("2026-06-30T22:00:00.000Z"),
      },
    });
    await prisma.payment.createMany({
      data: [
        {
          businessId: salon.id,
          invoiceId: salonInvoice.id,
          amount: "300.00",
          method: "CARD",
          status: "VOID",
          paidAt: new Date("2026-06-30T22:00:00.000Z"),
        },
        {
          businessId: salon.id,
          invoiceId: voidInvoice.id,
          amount: "500.00",
          method: "CASH",
          status: "ACTIVE",
          paidAt: new Date("2026-06-30T22:00:00.000Z"),
        },
      ],
    });
    await prisma.paymentRefund.create({
      data: {
        businessId: salon.id,
        invoiceId: salonInvoice.id,
        paymentId: packagePayment.id,
        amount: "20.00",
        method: "PACKAGE",
        reason: "Stage3B1 QA package restoration",
        refundedAt: new Date("2026-06-30T22:30:00.000Z"),
      },
    });

    const ownerReport = await getAllStoresKpiReport({
      userId: owner.id,
      groupId: group.id,
      activeBusinessId: salon.id,
      range: "custom",
      from: "2026-07-01",
      to: "2026-07-01",
    });
    assert.equal(ownerReport?.authorizedBusinessCount, 3);
    assert.equal(ownerReport?.current.grossSalesCents, 28_000);
    assert.equal(ownerReport?.current.netSalesCents, 26_500);
    assert.equal(ownerReport?.current.paymentsCollectedCents, 7_000);
    assert.equal(ownerReport?.current.refundsCents, 500);
    assert.equal(ownerReport?.current.transactionCount, 2);
    assert.equal(ownerReport?.current.averageTransactionValueCents, 13_250);
    assert.equal(ownerReport?.previous.netSalesCents, 5_000);
    assert.equal(ownerReport?.dataSource, "RAW");

    const analyticsRun = await refreshDailyStoreSummaries(
      {
        businessIds: [salon.id, auto.id, scopedThird.id],
        fromDate: "2026-06-30",
        toDate: "2026-07-01",
        trigger: "BACKFILL",
      },
      prisma,
    );
    analyticsRunIds.push(analyticsRun.runId);
    const summaryReport = await getAllStoresKpiReport(
      {
        userId: owner.id,
        groupId: group.id,
        activeBusinessId: salon.id,
        range: "custom",
        from: "2026-07-01",
        to: "2026-07-01",
      },
      prisma,
      { analyticsReadMode: "PRIMARY" },
    );
    assert.equal(summaryReport?.dataSource, "DAILY_SUMMARY");
    assert.equal(summaryReport?.analyticsFallbackReason, null);
    assert.deepEqual(summaryReport?.current, ownerReport?.current);
    assert.deepEqual(summaryReport?.previous, ownerReport?.previous);

    await prisma.payment.update({
      where: { id: cashPayment.id },
      data: { reference: "updated-after-summary" },
    });
    const staleFallbackReport = await getAllStoresKpiReport(
      {
        userId: owner.id,
        groupId: group.id,
        activeBusinessId: salon.id,
        range: "custom",
        from: "2026-07-01",
        to: "2026-07-01",
      },
      prisma,
      { analyticsReadMode: "PRIMARY" },
    );
    assert.equal(staleFallbackReport?.dataSource, "RAW");
    assert.equal(
      staleFallbackReport?.analyticsFallbackReason,
      "STALE_SUMMARIES",
    );
    assert.deepEqual(staleFallbackReport?.current, ownerReport?.current);
    assert.equal(
      ownerReport?.businesses.some(
        (business) => business.businessId === outside.id,
      ),
      false,
    );

    const managerReport = await getAllStoresKpiReport({
      userId: manager.id,
      groupId: group.id,
      activeBusinessId: salon.id,
      range: "custom",
      from: "2026-07-01",
      to: "2026-07-01",
    });
    assert.deepEqual(
      new Set(managerReport?.businesses.map((business) => business.businessId)),
      new Set([salon.id, auto.id]),
    );
    assert.equal(managerReport?.current.netSalesCents, 26_500);

    assert.equal(
      await getAllStoresKpiReport({
        userId: directOwner.id,
        groupId: group.id,
        activeBusinessId: salon.id,
      }),
      null,
    );
    assert.equal(
      await getAllStoresKpiReport({
        userId: owner.id,
        groupId: outsideGroup.id,
        activeBusinessId: salon.id,
      }),
      null,
    );

    await prisma.businessGroupUserBusinessAccess.deleteMany({
      where: { groupUserId: managerGrant.id, businessId: auto.id },
    });
    assert.equal(
      await getAllStoresKpiReport({
        userId: manager.id,
        groupId: group.id,
        activeBusinessId: salon.id,
      }),
      null,
    );

    assert.ok(packagePayment.id);
  } finally {
    if (businessIds.length) {
      await prisma.analyticsDailyStoreSummary.deleteMany({
        where: { businessId: { in: businessIds } },
      });
    }
    await prisma.analyticsRefreshRun.deleteMany({
      where: { id: { in: analyticsRunIds } },
    });
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
  industryType:
    | "SALON_BEAUTY"
    | "AUTO_DETAILING"
    | "GENERAL_SERVICE",
  timezone: string,
  businessDayCutoffTime: string,
) {
  return prisma.business.create({
    data: {
      name,
      slug,
      industryType,
      timezone,
      businessDayCutoffTime,
    },
  });
}

async function createUser(
  email: string,
  role: "BUSINESS_OWNER" | "STAFF",
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

async function createInvoice(input: {
  businessId: string;
  invoiceNumber: string;
  issuedAt: Date;
  total: string;
  discountAmount?: string;
  tipAmount?: string;
}) {
  return prisma.invoice.create({
    data: {
      businessId: input.businessId,
      invoiceNumber: input.invoiceNumber,
      subtotal: input.total,
      discountAmount: input.discountAmount ?? "0.00",
      tipAmount: input.tipAmount ?? "0.00",
      total: input.total,
      paidAmount: "0.00",
      balance: input.total,
      status: "UNPAID",
      issuedAt: input.issuedAt,
    },
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
