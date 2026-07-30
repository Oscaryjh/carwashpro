import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { getAllStoresKpiReport } from "../../src/lib/business-groups/all-stores-kpi";

const prisma = new PrismaClient();

test("a transferred store stays in the old group's history and joins the new group only from the transfer instant", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const businessIds: string[] = [];
  const groupIds: string[] = [];
  const userIds: string[] = [];

  try {
    const [moved, oldAnchorA, oldAnchorB, newAnchor] = await Promise.all([
      createBusiness(`Moved ${suffix}`, `history-moved-${suffix}`),
      createBusiness(`Old A ${suffix}`, `history-old-a-${suffix}`),
      createBusiness(`Old B ${suffix}`, `history-old-b-${suffix}`),
      createBusiness(`New A ${suffix}`, `history-new-a-${suffix}`),
    ]);
    businessIds.push(moved.id, oldAnchorA.id, oldAnchorB.id, newAnchor.id);

    const [oldGroup, newGroup] = await Promise.all([
      prisma.businessGroup.create({
        data: {
          name: `Historical Old ${suffix}`,
          code: `historical-old-${suffix}`,
        },
      }),
      prisma.businessGroup.create({
        data: {
          name: `Historical New ${suffix}`,
          code: `historical-new-${suffix}`,
        },
      }),
    ]);
    groupIds.push(oldGroup.id, newGroup.id);
    const transferAt = new Date("2026-07-01T00:00:00.000Z");
    await prisma.businessGroupMember.createMany({
      data: [
        {
          groupId: oldGroup.id,
          businessId: moved.id,
          status: "REMOVED",
          joinedAt: new Date("2026-01-01T00:00:00.000Z"),
          removedAt: transferAt,
        },
        {
          groupId: oldGroup.id,
          businessId: oldAnchorA.id,
          joinedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          groupId: oldGroup.id,
          businessId: oldAnchorB.id,
          joinedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          groupId: newGroup.id,
          businessId: moved.id,
          joinedAt: transferAt,
        },
        {
          groupId: newGroup.id,
          businessId: newAnchor.id,
          joinedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    });

    const owner = await prisma.user.create({
      data: {
        name: `History Owner ${suffix}`,
        email: `history-owner-${suffix}@example.test`,
        passwordHash: "not-a-real-password",
        role: "STAFF",
      },
    });
    userIds.push(owner.id);
    await prisma.businessGroupUser.createMany({
      data: [
        {
          groupId: oldGroup.id,
          userId: owner.id,
          role: "GROUP_OWNER",
        },
        {
          groupId: newGroup.id,
          userId: owner.id,
          role: "GROUP_OWNER",
        },
      ],
    });

    await prisma.invoice.createMany({
      data: [
        invoiceData(
          moved.id,
          `OLD-${suffix}`,
          new Date("2026-06-30T23:59:59.999Z"),
          "100.00",
        ),
        invoiceData(
          moved.id,
          `NEW-${suffix}`,
          transferAt,
          "200.00",
        ),
      ],
    });

    const [oldBefore, oldAfter, newBefore, newAfter] = await Promise.all([
      reportForDay(owner.id, oldGroup.id, oldAnchorA.id, "2026-06-30"),
      reportForDay(owner.id, oldGroup.id, oldAnchorA.id, "2026-07-01"),
      reportForDay(owner.id, newGroup.id, moved.id, "2026-06-30"),
      reportForDay(owner.id, newGroup.id, moved.id, "2026-07-01"),
    ]);

    assert.equal(oldBefore?.current.grossSalesCents, 10_000);
    assert.equal(oldBefore?.current.transactionCount, 1);
    assert.equal(oldAfter?.current.grossSalesCents, 0);
    assert.equal(newBefore?.current.grossSalesCents, 0);
    assert.equal(newAfter?.current.grossSalesCents, 20_000);
    assert.equal(newAfter?.current.transactionCount, 1);
    assert.equal(
      oldBefore?.businesses.some(
        (business) => business.businessId === moved.id,
      ),
      true,
    );
  } finally {
    if (businessIds.length) {
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

function createBusiness(name: string, slug: string) {
  return prisma.business.create({
    data: {
      name,
      slug,
      industryType: "GENERAL_SERVICE",
      timezone: "UTC",
      businessDayCutoffTime: "00:00",
    },
  });
}

function invoiceData(
  businessId: string,
  invoiceNumber: string,
  issuedAt: Date,
  total: string,
) {
  return {
    businessId,
    invoiceNumber,
    subtotal: total,
    total,
    paidAmount: "0.00",
    balance: total,
    status: "UNPAID" as const,
    issuedAt,
  };
}

function reportForDay(
  userId: string,
  groupId: string,
  activeBusinessId: string,
  date: string,
) {
  return getAllStoresKpiReport({
    userId,
    groupId,
    activeBusinessId,
    range: "custom",
    from: date,
    to: date,
  });
}

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required.");
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname)) {
    throw new Error("Integration tests require a local database.");
  }
}
