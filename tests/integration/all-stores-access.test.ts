import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  getAvailableGroupReportingContexts,
  resolveAuthorizedGroupReportingScope,
} from "../../src/lib/business-groups/all-stores-access";

const prisma = new PrismaClient();

test("All Stores reporting scope follows live group membership and manager scope", async () => {
  assertLocalDatabase();

  const suffix = randomUUID().slice(0, 8);
  const businessIds: string[] = [];
  const userIds: string[] = [];
  const groupIds: string[] = [];

  try {
    const [salon, auto, outside, inactive] = await Promise.all([
      createBusiness(`Stage3A Salon ${suffix}`, `stage3a-salon-${suffix}`, "SALON_BEAUTY"),
      createBusiness(`Stage3A Auto ${suffix}`, `stage3a-auto-${suffix}`, "AUTO_DETAILING"),
      createBusiness(`Stage3A Outside ${suffix}`, `stage3a-outside-${suffix}`, "GENERAL_SERVICE"),
      createBusiness(
        `Stage3A Inactive ${suffix}`,
        `stage3a-inactive-${suffix}`,
        "AUTO_DETAILING",
        "inactive",
      ),
    ]);
    businessIds.push(salon.id, auto.id, outside.id, inactive.id);

    const [primaryGroup, secondGroup] = await Promise.all([
      prisma.businessGroup.create({
        data: { name: `Stage3A Primary ${suffix}`, code: `stage3a-primary-${suffix}` },
      }),
      prisma.businessGroup.create({
        data: { name: `Stage3A Second ${suffix}`, code: `stage3a-second-${suffix}` },
      }),
    ]);
    groupIds.push(primaryGroup.id, secondGroup.id);
    await prisma.businessGroupMember.createMany({
      data: [
        { groupId: primaryGroup.id, businessId: salon.id },
        { groupId: primaryGroup.id, businessId: auto.id },
        { groupId: primaryGroup.id, businessId: inactive.id },
        { groupId: secondGroup.id, businessId: outside.id },
      ],
    });

    const [owner, manager, directOwner] = await Promise.all([
      createUser(`stage3a-owner-${suffix}@example.test`, "STAFF"),
      createUser(`stage3a-manager-${suffix}@example.test`, "STAFF"),
      createUser(`stage3a-direct-${suffix}@example.test`, "BUSINESS_OWNER", salon.id),
    ]);
    userIds.push(owner.id, manager.id, directOwner.id);

    const ownerPrimaryGrant = await prisma.businessGroupUser.create({
      data: {
        groupId: primaryGroup.id,
        userId: owner.id,
        role: "GROUP_OWNER",
      },
    });
    await prisma.businessGroupUser.create({
      data: {
        groupId: secondGroup.id,
        userId: owner.id,
        role: "GROUP_OWNER",
      },
    });
    const managerGrant = await prisma.businessGroupUser.create({
      data: {
        groupId: primaryGroup.id,
        userId: manager.id,
        role: "GROUP_MANAGER",
        accessScope: "SELECTED_BUSINESSES",
        businessAccesses: {
          create: [{ businessId: salon.id }, { businessId: auto.id }],
        },
      },
    });

    const ownerContexts = await getAvailableGroupReportingContexts(
      owner.id,
      salon.id,
    );
    assert.equal(ownerContexts.length, 2);
    assert.deepEqual(
      ownerContexts
        .find((context) => context.groupId === primaryGroup.id)
        ?.businesses.map((business) => business.id),
      [auto, salon]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((business) => business.id),
    );
    assert.equal(
      ownerContexts
        .find((context) => context.groupId === primaryGroup.id)
        ?.businesses.some((business) => business.id === inactive.id),
      false,
    );
    assert.deepEqual(
      ownerContexts
        .find((context) => context.groupId === secondGroup.id)
        ?.businesses.map((business) => business.id),
      [outside.id],
    );

    const managerContexts = await getAvailableGroupReportingContexts(
      manager.id,
      salon.id,
    );
    assert.equal(managerContexts.length, 1);
    assert.equal(managerContexts[0]?.canViewAllStores, true);
    assert.deepEqual(
      new Set(managerContexts[0]?.businesses.map((business) => business.id)),
      new Set([salon.id, auto.id]),
    );

    const directContexts = await getAvailableGroupReportingContexts(
      directOwner.id,
      salon.id,
    );
    assert.deepEqual(directContexts, []);

    await prisma.businessGroupUserBusinessAccess.deleteMany({
      where: { groupUserId: managerGrant.id, businessId: auto.id },
    });
    const managerAfterScopeRemoval =
      await getAvailableGroupReportingContexts(manager.id, salon.id);
    assert.deepEqual(
      managerAfterScopeRemoval[0]?.businesses.map((business) => business.id),
      [salon.id],
    );
    assert.equal(managerAfterScopeRemoval[0]?.canViewAllStores, false);

    await prisma.businessGroupUser.update({
      where: { id: managerGrant.id },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    assert.deepEqual(
      await getAvailableGroupReportingContexts(manager.id, salon.id),
      [],
    );

    const salonMembership =
      await prisma.businessGroupMember.findFirstOrThrow({
        where: {
          groupId: primaryGroup.id,
          businessId: salon.id,
          status: "ACTIVE",
        },
      });
    await prisma.businessGroupMember.update({
      where: { id: salonMembership.id },
      data: { status: "REMOVED", removedAt: new Date() },
    });
    const ownerAfterMembershipRemoval =
      await resolveAuthorizedGroupReportingScope(
        owner.id,
        primaryGroup.id,
        salon.id,
      );
    assert.deepEqual(
      ownerAfterMembershipRemoval?.businesses.map((business) => business.id),
      [auto.id],
    );
    assert.equal(ownerAfterMembershipRemoval?.canViewAllStores, false);

    await prisma.businessGroupUser.update({
      where: { id: ownerPrimaryGrant.id },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    assert.equal(
      await resolveAuthorizedGroupReportingScope(
        owner.id,
        primaryGroup.id,
        salon.id,
      ),
      null,
    );
  } finally {
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
  status: "active" | "inactive" = "active",
) {
  return prisma.business.create({
    data: { name, slug, industryType, status },
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
