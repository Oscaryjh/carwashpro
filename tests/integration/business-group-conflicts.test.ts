import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  BusinessGroupConflictError,
  addBusinessToGroup,
  businessGroupConflictState,
  grantBusinessGroupUser,
  revokeBusinessGroupUser,
} from "../../src/lib/business-groups/admin-service";

const prisma = new PrismaClient();

test("group conflicts preserve one active record and do not create audit logs", async () => {
  assertLocalDatabase();

  const suffix = randomUUID().slice(0, 8);
  const groupIds: string[] = [];
  const businessIds: string[] = [];
  const userIds: string[] = [];

  try {
    const [groupA, groupB] = await Promise.all([
      prisma.businessGroup.create({
        data: { name: `QA Group A ${suffix}`, code: `qa-group-a-${suffix}` },
      }),
      prisma.businessGroup.create({
        data: { name: `QA Group B ${suffix}`, code: `qa-group-b-${suffix}` },
      }),
    ]);
    groupIds.push(groupA.id, groupB.id);

    const [businessA, businessB] = await Promise.all([
      prisma.business.create({
        data: { name: `QA Business A ${suffix}`, slug: `qa-business-a-${suffix}` },
      }),
      prisma.business.create({
        data: { name: `QA Business B ${suffix}`, slug: `qa-business-b-${suffix}` },
      }),
    ]);
    businessIds.push(businessA.id, businessB.id);

    const actor = await prisma.user.create({
      data: {
        name: `QA Platform Admin ${suffix}`,
        email: `qa-platform-${suffix}@example.test`,
        passwordHash: "not-a-real-password",
        role: "PLATFORM_ADMIN",
      },
    });
    const [owner, manager, invalidManager] = await Promise.all([
      prisma.user.create({
        data: {
          businessId: businessA.id,
          name: `QA Group Owner ${suffix}`,
          email: `qa-owner-${suffix}@example.test`,
          passwordHash: "not-a-real-password",
          role: "BUSINESS_OWNER",
        },
      }),
      prisma.user.create({
        data: {
          businessId: businessA.id,
          name: `QA Group Manager ${suffix}`,
          email: `qa-manager-${suffix}@example.test`,
          passwordHash: "not-a-real-password",
          role: "STAFF",
        },
      }),
      prisma.user.create({
        data: {
          businessId: businessB.id,
          name: `QA Invalid Manager ${suffix}`,
          email: `qa-invalid-manager-${suffix}@example.test`,
          passwordHash: "not-a-real-password",
          role: "STAFF",
        },
      }),
    ]);
    userIds.push(actor.id, owner.id, manager.id, invalidManager.id);
    const auditActor = { userId: actor.id };

    await addBusinessToGroup(
      { groupId: groupA.id, businessId: businessA.id },
      auditActor,
    );

    const duplicateMembershipError = await captureConflict(() =>
      addBusinessToGroup(
        { groupId: groupA.id, businessId: businessA.id },
        auditActor,
      ),
    );
    assert.deepEqual(businessGroupConflictState(duplicateMembershipError), {
      status: "error",
      message: "This business is already in this group.",
    });

    const crossGroupMembershipError = await captureConflict(() =>
      addBusinessToGroup(
        { groupId: groupB.id, businessId: businessA.id },
        auditActor,
      ),
    );
    assert.match(crossGroupMembershipError.message, /already belongs to QA Group A/);
    assert.equal(
      await prisma.businessGroupMember.count({
        where: { businessId: businessA.id, status: "ACTIVE" },
      }),
      1,
    );
    assert.equal(
      await prisma.businessGroupAuditLog.count({
        where: { groupId: { in: groupIds }, action: "BUSINESS_JOINED_GROUP" },
      }),
      1,
    );

    await grantBusinessGroupUser(
      {
        groupId: groupA.id,
        userId: owner.id,
        role: "GROUP_OWNER",
        businessIds: [],
      },
      auditActor,
    );
    const duplicateOwnerError = await captureConflict(() =>
      grantBusinessGroupUser(
        {
          groupId: groupA.id,
          userId: owner.id,
          role: "GROUP_OWNER",
          businessIds: [],
        },
        auditActor,
      ),
    );
    assert.deepEqual(businessGroupConflictState(duplicateOwnerError), {
      status: "error",
      message: "This user already has an active role in this group.",
    });
    assert.equal(
      await prisma.businessGroupUser.count({
        where: { groupId: groupA.id, userId: owner.id, status: "ACTIVE" },
      }),
      1,
    );
    assert.equal(
      await prisma.businessGroupAuditLog.count({
        where: { groupId: groupA.id, action: "GROUP_OWNER_GRANTED" },
      }),
      1,
    );

    await grantBusinessGroupUser(
      {
        groupId: groupA.id,
        userId: manager.id,
        role: "GROUP_MANAGER",
        businessIds: [businessA.id, businessA.id],
      },
      auditActor,
    );
    const duplicateManagerError = await captureConflict(() =>
      grantBusinessGroupUser(
        {
          groupId: groupA.id,
          userId: manager.id,
          role: "GROUP_MANAGER",
          businessIds: [businessA.id],
        },
        auditActor,
      ),
    );
    assert.deepEqual(businessGroupConflictState(duplicateManagerError), {
      status: "error",
      message: "This user already has an active role in this group.",
    });
    assert.equal(
      await prisma.businessGroupUser.count({
        where: { groupId: groupA.id, userId: manager.id, status: "ACTIVE" },
      }),
      1,
    );
    assert.equal(
      await prisma.businessGroupUserBusinessAccess.count({
        where: { groupUser: { groupId: groupA.id, userId: manager.id, status: "ACTIVE" } },
      }),
      1,
    );
    assert.equal(
      await prisma.businessGroupAuditLog.count({
        where: { groupId: groupA.id, action: "GROUP_MANAGER_GRANTED" },
      }),
      1,
    );

    const invalidScopeAuditCount = await prisma.businessGroupAuditLog.count({
      where: { groupId: groupA.id },
    });
    const invalidScopeError = await captureConflict(() =>
      grantBusinessGroupUser(
        {
          groupId: groupA.id,
          userId: invalidManager.id,
          role: "GROUP_MANAGER",
          businessIds: [businessB.id],
        },
        auditActor,
      ),
    );
    assert.equal(
      invalidScopeError.message,
      "A group manager can only be assigned active businesses in this group.",
    );
    assert.equal(
      await prisma.businessGroupUser.count({
        where: { groupId: groupA.id, userId: invalidManager.id },
      }),
      0,
    );
    assert.equal(
      await prisma.businessGroupAuditLog.count({ where: { groupId: groupA.id } }),
      invalidScopeAuditCount,
    );

    const activeManager = await prisma.businessGroupUser.findFirstOrThrow({
      where: { groupId: groupA.id, userId: manager.id, status: "ACTIVE" },
    });
    await revokeBusinessGroupUser(
      { groupId: groupA.id, groupUserId: activeManager.id },
      auditActor,
    );
    const auditCountAfterRevoke = await prisma.businessGroupAuditLog.count({
      where: { groupId: groupA.id },
    });
    const duplicateRevokeError = await captureConflict(() =>
      revokeBusinessGroupUser(
        { groupId: groupA.id, groupUserId: activeManager.id },
        auditActor,
      ),
    );
    assert.equal(duplicateRevokeError.message, "Active group access was not found.");
    assert.equal(
      await prisma.businessGroupAuditLog.count({ where: { groupId: groupA.id } }),
      auditCountAfterRevoke,
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
      await prisma.businessGroup.deleteMany({ where: { id: { in: groupIds } } });
    }
    if (userIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (businessIds.length) {
      await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    }
    await prisma.$disconnect();
  }
});

async function captureConflict(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    assert.ok(error instanceof BusinessGroupConflictError);
    return error;
  }

  assert.fail("Expected the group operation to report a business conflict.");
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests.");

  const hostname = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1"].includes(hostname)) {
    throw new Error("Integration tests are restricted to the local database.");
  }
}
