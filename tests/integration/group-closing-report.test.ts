import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient, type BusinessIndustry } from "@prisma/client";
import {
  getGroupClosingReport,
  GroupClosingInputError,
} from "../../src/lib/business-groups/group-closing-report";
import type { DailyClosingReport } from "../../src/lib/daily-closing/types";

const prisma = new PrismaClient();

test("Group Daily Closing reads frozen snapshots and enforces live group scope", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const businessIds: string[] = [];
  const groupIds: string[] = [];
  const userIds: string[] = [];

  try {
    const [salon, auto, outside] = await Promise.all([
      createBusiness(`Closing Salon ${suffix}`, `closing-salon-${suffix}`, "SALON_BEAUTY"),
      createBusiness(`Closing Auto ${suffix}`, `closing-auto-${suffix}`, "AUTO_DETAILING"),
      createBusiness(`Closing Outside ${suffix}`, `closing-outside-${suffix}`, "SALON_BEAUTY"),
    ]);
    businessIds.push(salon.id, auto.id, outside.id);
    const [salonBranch, autoBranch, outsideBranch] = await Promise.all([
      prisma.branch.create({ data: { businessId: salon.id, name: `Salon Branch ${suffix}` } }),
      prisma.branch.create({ data: { businessId: auto.id, name: `Auto Branch ${suffix}` } }),
      prisma.branch.create({ data: { businessId: outside.id, name: `Outside Branch ${suffix}` } }),
    ]);
    const [group, outsideGroup] = await Promise.all([
      prisma.businessGroup.create({
        data: { name: `Closing Group ${suffix}`, code: `closing-group-${suffix}` },
      }),
      prisma.businessGroup.create({
        data: { name: `Outside Group ${suffix}`, code: `outside-closing-${suffix}` },
      }),
    ]);
    groupIds.push(group.id, outsideGroup.id);
    await prisma.businessGroupMember.createMany({
      data: [
        { groupId: group.id, businessId: salon.id },
        { groupId: group.id, businessId: auto.id },
        { groupId: outsideGroup.id, businessId: outside.id },
      ],
    });
    const [owner, manager, directOwner] = await Promise.all([
      createUser(`closing-owner-${suffix}@example.test`),
      createUser(`closing-manager-${suffix}@example.test`),
      createUser(`closing-direct-${suffix}@example.test`, salon.id, "BUSINESS_OWNER"),
    ]);
    userIds.push(owner.id, manager.id, directOwner.id);
    await prisma.businessGroupUser.create({
      data: { groupId: group.id, userId: owner.id, role: "GROUP_OWNER" },
    });
    await prisma.businessGroupUser.create({
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

    const salonSnapshot = await createSnapshot({
      businessId: salon.id,
      branchId: salonBranch.id,
      closedByUserId: owner.id,
      businessType: "SALON_BEAUTY",
      businessName: salon.name,
      branchName: salonBranch.name,
      grossSalesCents: 12_000,
      netSalesCents: 10_000,
      collectedCents: 8_000,
      outstandingCents: 2_000,
      refundsCents: 500,
      expectedCashCents: 5_000,
      actualCashCents: 5_000,
    });
    await createSnapshot({
      businessId: auto.id,
      branchId: autoBranch.id,
      closedByUserId: owner.id,
      businessType: "AUTO_DETAILING",
      businessName: auto.name,
      branchName: autoBranch.name,
      grossSalesCents: 20_000,
      netSalesCents: 19_000,
      collectedCents: 19_000,
      outstandingCents: 0,
      refundsCents: 1_000,
      expectedCashCents: 10_000,
      actualCashCents: 10_500,
    });
    await createSnapshot({
      businessId: outside.id,
      branchId: outsideBranch.id,
      closedByUserId: directOwner.id,
      businessType: "SALON_BEAUTY",
      businessName: outside.name,
      branchName: outsideBranch.name,
      grossSalesCents: 999_900,
      netSalesCents: 999_900,
      collectedCents: 0,
      outstandingCents: 999_900,
      refundsCents: 0,
      expectedCashCents: 0,
      actualCashCents: 0,
    });

    const auditBefore = await prisma.businessGroupAuditLog.count({
      where: { groupId: group.id },
    });
    const ownerReport = await getGroupClosingReport({
      userId: owner.id,
      groupId: group.id,
      activeBusinessId: salon.id,
      range: "custom",
      from: "2026-07-01",
      to: "2026-07-01",
    });
    assert.equal(ownerReport?.rows.length, 2);
    assert.equal(ownerReport?.summary.snapshotCount, 2);
    assert.equal(ownerReport?.summary.storeCount, 2);
    assert.equal(ownerReport?.summary.grossSalesCents, 32_000);
    assert.equal(ownerReport?.summary.netSalesCents, 29_000);
    assert.equal(ownerReport?.summary.cashDifferenceCents, 500);
    assert.equal(ownerReport?.rows.some((row) => row.businessId === outside.id), false);
    assert.equal(ownerReport?.rows.find((row) => row.id === salonSnapshot.id)?.financial?.netSalesCents, 10_000);
    assert.equal(
      await prisma.businessGroupAuditLog.count({ where: { groupId: group.id } }),
      auditBefore,
    );

    const managerReport = await getGroupClosingReport({
      userId: manager.id,
      groupId: group.id,
      activeBusinessId: salon.id,
      range: "custom",
      from: "2026-07-01",
      to: "2026-07-01",
    });
    assert.deepEqual(
      new Set(managerReport?.rows.map((row) => row.businessId)),
      new Set([salon.id, auto.id]),
    );

    await assert.rejects(
      () =>
        getGroupClosingReport({
          userId: owner.id,
          groupId: group.id,
          activeBusinessId: salon.id,
          store: outside.id,
        }),
      GroupClosingInputError,
    );
    assert.equal(
      await getGroupClosingReport({
        userId: directOwner.id,
        groupId: group.id,
        activeBusinessId: salon.id,
      }),
      null,
    );
  } finally {
    if (businessIds.length) {
      await prisma.closingWhatsAppSendAttempt.deleteMany({
        where: { businessId: { in: businessIds } },
      });
      await prisma.dailyClosingSnapshot.deleteMany({
        where: { businessId: { in: businessIds } },
      });
      await prisma.branch.deleteMany({ where: { businessId: { in: businessIds } } });
    }
    if (groupIds.length) {
      await prisma.businessGroupAuditLog.deleteMany({ where: { groupId: { in: groupIds } } });
      await prisma.businessGroupUser.deleteMany({ where: { groupId: { in: groupIds } } });
      await prisma.businessGroupMember.deleteMany({ where: { groupId: { in: groupIds } } });
      await prisma.businessGroup.deleteMany({ where: { id: { in: groupIds } } });
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (businessIds.length) {
      await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    }
    await prisma.$disconnect();
  }
});

async function createBusiness(
  name: string,
  slug: string,
  industryType: BusinessIndustry,
) {
  return prisma.business.create({
    data: {
      name,
      slug,
      industryType,
      timezone: "Asia/Kuching",
      businessDayCutoffTime: "02:00",
    },
  });
}

async function createUser(
  email: string,
  businessId: string | null = null,
  role: "BUSINESS_OWNER" | "STAFF" = "STAFF",
) {
  return prisma.user.create({
    data: {
      businessId,
      email,
      name: email.split("@")[0],
      passwordHash: "not-a-real-password",
      role,
    },
  });
}

async function createSnapshot(input: {
  businessId: string;
  branchId: string;
  closedByUserId: string;
  businessType: BusinessIndustry;
  businessName: string;
  branchName: string;
  grossSalesCents: number;
  netSalesCents: number;
  collectedCents: number;
  outstandingCents: number;
  refundsCents: number;
  expectedCashCents: number;
  actualCashCents: number;
}) {
  const businessDate = "2026-07-01";
  const closedAt = new Date("2026-07-01T15:00:00.000Z");
  const report = closingReport({
    grossSalesCents: input.grossSalesCents,
    netSalesCents: input.netSalesCents,
    collectedCents: input.collectedCents,
    outstandingCents: input.outstandingCents,
    refundsCents: input.refundsCents,
  });
  return prisma.dailyClosingSnapshot.create({
    data: {
      businessId: input.businessId,
      branchId: input.branchId,
      businessDate: new Date(`${businessDate}T00:00:00.000Z`),
      timezone: "Asia/Kuching",
      businessType: input.businessType,
      closedAt,
      closedByUserId: input.closedByUserId,
      expectedCashCents: input.expectedCashCents,
      actualCashCents: input.actualCashCents,
      cashDifferenceCents: input.actualCashCents - input.expectedCashCents,
      closingNote: "QA TEST frozen group closing",
      whatsappText: "QA TEST frozen WhatsApp text",
      reportDataJson: {
        version: 1,
        businessDate,
        timezone: "Asia/Kuching",
        businessType: input.businessType,
        generatedAt: closedAt.toISOString(),
        closedAt: closedAt.toISOString(),
        closingNote: "QA TEST frozen group closing",
        business: { id: input.businessId, name: input.businessName },
        branch: { id: input.branchId, name: input.branchName },
        closedBy: { id: input.closedByUserId, name: "QA TEST closer" },
        cash: {
          expectedCents: input.expectedCashCents,
          actualCents: input.actualCashCents,
          differenceCents: input.actualCashCents - input.expectedCashCents,
        },
        report,
      },
    },
  });
}

function closingReport(
  financial: Omit<DailyClosingReport["financial"], "discountsCents">,
): DailyClosingReport {
  return {
    alerts: [],
    financial: { ...financial, discountsCents: 0 },
    invoiceCounts: { paid: 0, partial: 0, refunded: 0, total: 0, unpaid: 0 },
    operations: {
      averageSpendCents: 0,
      cancelled: 0,
      completed: 0,
      customersServed: 0,
      newCustomers: 0,
      returningCustomers: 0,
      vehiclesServed: 0,
    },
    packages: { amountCents: 0, redemptions: 0, sold: 0 },
    paymentMethods: [],
    topServices: [],
  };
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const hostname = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1"].includes(hostname)) {
    throw new Error("Integration tests are restricted to the local database.");
  }
}
