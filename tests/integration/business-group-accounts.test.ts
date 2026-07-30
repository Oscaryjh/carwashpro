import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  createBusinessGroupAccount,
  updateBusinessGroupAccount,
} from "../../src/lib/business-groups/admin-service";

const prisma = new PrismaClient();

test("creates a group-only owner and audits the account and grant atomically", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const fixture = await createFixture(suffix);

  try {
    const result = await createBusinessGroupAccount(
      {
        groupId: fixture.groupId,
        name: `QA Group Owner ${suffix}`,
        email: `qa-group-owner-${suffix}@example.test`,
        passwordHash: "not-a-real-password-hash",
        role: "GROUP_OWNER",
        businessIds: [fixture.businessId],
      },
      { userId: fixture.actorId },
    );

    const [user, grant, audits] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: result.user.id } }),
      prisma.businessGroupUser.findUniqueOrThrow({ where: { id: result.grant.id } }),
      prisma.businessGroupAuditLog.findMany({
        where: { groupId: fixture.groupId, entityId: { in: [result.user.id, result.grant.id] } },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    assert.equal(user.businessId, null);
    assert.equal(user.branchId, null);
    assert.equal(user.role, "BUSINESS_OWNER");
    assert.deepEqual(user.permissions, []);
    assert.equal(grant.role, "GROUP_OWNER");
    assert.equal(grant.accessScope, "ALL_GROUP_BUSINESSES");
    assert.deepEqual(
      audits.map((entry) => entry.action),
      ["GROUP_USER_ACCOUNT_CREATED", "GROUP_OWNER_GRANTED"],
    );
    assert.equal(JSON.stringify(audits).includes("not-a-real-password-hash"), false);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("creates a scoped group-only manager without direct staff permissions", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const fixture = await createFixture(suffix);

  try {
    const result = await createBusinessGroupAccount(
      {
        groupId: fixture.groupId,
        name: `QA Group Manager ${suffix}`,
        email: `qa-group-manager-${suffix}@example.test`,
        passwordHash: "not-a-real-password-hash",
        role: "GROUP_MANAGER",
        businessIds: [fixture.businessId, fixture.businessId],
      },
      { userId: fixture.actorId },
    );

    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.user.id } });
    const scopes = await prisma.businessGroupUserBusinessAccess.findMany({
      where: { groupUserId: result.grant.id },
    });

    assert.equal(user.businessId, null);
    assert.equal(user.role, "STAFF");
    assert.deepEqual(user.permissions, []);
    assert.equal(scopes.length, 1);
    assert.equal(scopes[0]?.businessId, fixture.businessId);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("duplicate email rolls back the group-only account and audit", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const fixture = await createFixture(suffix);
  const email = `qa-existing-${suffix}@example.test`;
  const existing = await prisma.user.create({
    data: {
      name: "QA Existing User",
      email: email.toUpperCase(),
      role: "STAFF",
      status: "active",
      loginEnabled: true,
    },
  });

  try {
    await assert.rejects(
      createBusinessGroupAccount(
        {
          groupId: fixture.groupId,
          name: "QA Duplicate User",
          email,
          passwordHash: "not-a-real-password-hash",
          role: "GROUP_OWNER",
          businessIds: [],
        },
        { userId: fixture.actorId },
      ),
      /account with this email already exists/i,
    );

    const [matchingUsers, matchingAudits] = await Promise.all([
      prisma.user.count({
        where: { email: { equals: email, mode: "insensitive" } },
      }),
      prisma.businessGroupAuditLog.count({
        where: { groupId: fixture.groupId, action: "GROUP_USER_ACCOUNT_CREATED" },
      }),
    ]);
    assert.equal(matchingUsers, 1);
    assert.equal(matchingAudits, 0);
  } finally {
    await prisma.user.delete({ where: { id: existing.id } });
    await cleanupFixture(fixture);
  }
});

test("updates a group-only login and audits profile and password changes without secrets", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const fixture = await createFixture(suffix);

  try {
    const account = await createBusinessGroupAccount(
      {
        groupId: fixture.groupId,
        name: `QA Editable Owner ${suffix}`,
        email: `qa-editable-owner-${suffix}@example.test`,
        passwordHash: "original-test-hash",
        role: "GROUP_OWNER",
        businessIds: [],
      },
      { userId: fixture.actorId },
    );

    const updated = await updateBusinessGroupAccount(
      {
        groupId: fixture.groupId,
        groupUserId: account.grant.id,
        name: `QA Updated Owner ${suffix}`,
        email: `qa-updated-owner-${suffix}@example.test`,
        passwordHash: "replacement-test-hash",
      },
      { userId: fixture.actorId },
    );

    const [storedUser, audits] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: account.user.id } }),
      prisma.businessGroupAuditLog.findMany({
        where: {
          groupId: fixture.groupId,
          action: { in: ["GROUP_USER_ACCOUNT_UPDATED", "GROUP_USER_PASSWORD_RESET"] },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    assert.equal(updated.name, `QA Updated Owner ${suffix}`);
    assert.equal(storedUser.email, `qa-updated-owner-${suffix}@example.test`);
    assert.equal(storedUser.passwordHash, "replacement-test-hash");
    assert.deepEqual(
      audits.map((entry) => entry.action),
      ["GROUP_USER_ACCOUNT_UPDATED", "GROUP_USER_PASSWORD_RESET"],
    );
    const serializedAudits = JSON.stringify(audits);
    assert.equal(serializedAudits.includes("original-test-hash"), false);
    assert.equal(serializedAudits.includes("replacement-test-hash"), false);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("rejects editing a business-linked user through group administration", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const fixture = await createFixture(suffix);

  try {
    const businessUser = await prisma.user.create({
      data: {
        businessId: fixture.businessId,
        name: `QA Business User ${suffix}`,
        email: `qa-business-user-${suffix}@example.test`,
        passwordHash: "business-user-test-hash",
        role: "BUSINESS_OWNER",
        status: "active",
        loginEnabled: true,
      },
    });
    const grant = await prisma.businessGroupUser.create({
      data: {
        groupId: fixture.groupId,
        userId: businessUser.id,
        role: "GROUP_OWNER",
        accessScope: "ALL_GROUP_BUSINESSES",
      },
    });

    await assert.rejects(
      updateBusinessGroupAccount(
        {
          groupId: fixture.groupId,
          groupUserId: grant.id,
          name: "Unauthorized Edit",
          email: `unauthorized-${suffix}@example.test`,
          passwordHash: "unauthorized-test-hash",
        },
        { userId: fixture.actorId },
      ),
      /must be managed from that business/i,
    );

    const [storedUser, updateAudits] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: businessUser.id } }),
      prisma.businessGroupAuditLog.count({
        where: {
          groupId: fixture.groupId,
          action: { in: ["GROUP_USER_ACCOUNT_UPDATED", "GROUP_USER_PASSWORD_RESET"] },
        },
      }),
    ]);
    assert.equal(storedUser.email, `qa-business-user-${suffix}@example.test`);
    assert.equal(storedUser.passwordHash, "business-user-test-hash");
    assert.equal(updateAudits, 0);
  } finally {
    await cleanupFixture(fixture);
  }
});

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  assert.match(databaseUrl, /localhost|127\.0\.0\.1/i);
}

async function createFixture(suffix: string) {
  const actor = await prisma.user.create({
    data: {
      name: `QA Platform Admin ${suffix}`,
      email: `qa-platform-${suffix}@example.test`,
      role: "PLATFORM_ADMIN",
      status: "active",
      loginEnabled: true,
    },
  });
  const business = await prisma.business.create({
    data: {
      name: `QA Group Account Business ${suffix}`,
      slug: `qa-group-account-${suffix}`,
      industryType: "GENERAL_SERVICE",
      status: "active",
    },
  });
  const group = await prisma.businessGroup.create({
    data: {
      name: `QA Group Account ${suffix}`,
      code: `qa-group-account-${suffix}`,
      members: { create: { businessId: business.id } },
    },
  });

  return { actorId: actor.id, businessId: business.id, groupId: group.id };
}

async function cleanupFixture(fixture: {
  actorId: string;
  businessId: string;
  groupId: string;
}) {
  const grants = await prisma.businessGroupUser.findMany({
    where: { groupId: fixture.groupId },
    select: { id: true, userId: true },
  });
  const grantIds = grants.map((grant) => grant.id);
  const userIds = grants.map((grant) => grant.userId);

  await prisma.$transaction([
    prisma.businessGroupAuditLog.deleteMany({ where: { groupId: fixture.groupId } }),
    prisma.businessGroupUserBusinessAccess.deleteMany({
      where: { groupUserId: { in: grantIds } },
    }),
    prisma.businessGroupUser.deleteMany({ where: { groupId: fixture.groupId } }),
    prisma.businessGroupMember.deleteMany({ where: { groupId: fixture.groupId } }),
    prisma.businessGroup.delete({ where: { id: fixture.groupId } }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
    prisma.user.delete({ where: { id: fixture.actorId } }),
    prisma.business.delete({ where: { id: fixture.businessId } }),
  ]);
}
