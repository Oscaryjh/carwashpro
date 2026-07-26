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
    assert.equal(duplicateRevokeError.message, "This group role has already been revoked.");
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

for (const role of ["GROUP_OWNER", "GROUP_MANAGER"] as const) {
  test(`concurrent ${role} revocation is atomic and writes one audit log`, async () => {
    assertLocalDatabase();

    const suffix = randomUUID().slice(0, 8);
    const group = await prisma.businessGroup.create({
      data: {
        name: `QA Concurrent ${role} ${suffix}`,
        code: `qa-concurrent-${role.toLowerCase()}-${suffix}`,
      },
    });
    const business = await prisma.business.create({
      data: {
        name: `QA Concurrent Business ${suffix}`,
        slug: `qa-concurrent-business-${suffix}`,
      },
    });
    const [actor, targetUser] = await Promise.all([
      prisma.user.create({
        data: {
          name: `QA Concurrent Actor ${suffix}`,
          email: `qa-concurrent-actor-${suffix}@example.test`,
          passwordHash: "not-a-real-password",
          role: "PLATFORM_ADMIN",
        },
      }),
      prisma.user.create({
        data: {
          businessId: business.id,
          name: `QA Concurrent Target ${suffix}`,
          email: `qa-concurrent-target-${suffix}@example.test`,
          passwordHash: "not-a-real-password",
          role: role === "GROUP_OWNER" ? "BUSINESS_OWNER" : "STAFF",
        },
      }),
    ]);

    try {
      await addBusinessToGroup(
        { groupId: group.id, businessId: business.id },
        { userId: actor.id },
      );
      await grantBusinessGroupUser(
        {
          groupId: group.id,
          userId: targetUser.id,
          role,
          businessIds: role === "GROUP_MANAGER" ? [business.id] : [],
        },
        { userId: actor.id },
      );

      const activeGrant = await prisma.businessGroupUser.findFirstOrThrow({
        where: { groupId: group.id, userId: targetUser.id, role, status: "ACTIVE" },
      });
      const auditCountBefore = await prisma.businessGroupAuditLog.count({
        where: { groupId: group.id, action: `${role}_REVOKED` },
      });

      const results = await Promise.allSettled([
        revokeBusinessGroupUser(
          { groupId: group.id, groupUserId: activeGrant.id },
          { userId: actor.id },
        ),
        revokeBusinessGroupUser(
          { groupId: group.id, groupUserId: activeGrant.id },
          { userId: actor.id },
        ),
      ]);

      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);
      assert.ok(rejected[0].reason instanceof BusinessGroupConflictError);
      assert.deepEqual(businessGroupConflictState(rejected[0].reason), {
        status: "error",
        message: "This group role has already been revoked.",
      });

      const persistedGrant = await prisma.businessGroupUser.findUniqueOrThrow({
        where: { id: activeGrant.id },
      });
      assert.equal(persistedGrant.status, "REVOKED");
      assert.ok(persistedGrant.revokedAt);

      const revokeAudits = await prisma.businessGroupAuditLog.findMany({
        where: { groupId: group.id, action: `${role}_REVOKED` },
        orderBy: { createdAt: "asc" },
      });
      assert.equal(revokeAudits.length, auditCountBefore + 1);
      const audit = revokeAudits.at(-1);
      assert.ok(audit);
      assert.equal(audit.actorUserId, actor.id);
      assert.equal(audit.groupId, group.id);
      assert.equal(audit.entityId, activeGrant.id);
      assert.equal(audit.action, `${role}_REVOKED`);
      assert.deepEqual(audit.before, { status: "ACTIVE", role });
      assert.equal((audit.after as { status?: string })?.status, "REVOKED");
      assert.ok((audit.after as { revokedAt?: string })?.revokedAt);
      assert.ok(audit.createdAt);

      const auditCountAfterConcurrentRevoke = revokeAudits.length;
      const sequentialError = await captureConflict(() =>
        revokeBusinessGroupUser(
          { groupId: group.id, groupUserId: activeGrant.id },
          { userId: actor.id },
        ),
      );
      assert.equal(sequentialError.message, "This group role has already been revoked.");
      assert.equal(
        await prisma.businessGroupAuditLog.count({
          where: { groupId: group.id, action: `${role}_REVOKED` },
        }),
        auditCountAfterConcurrentRevoke,
      );

      const missingRoleError = await captureConflict(() =>
        revokeBusinessGroupUser(
          { groupId: group.id, groupUserId: randomUUID() },
          { userId: actor.id },
        ),
      );
      assert.equal(missingRoleError.message, "This group role was not found.");
      assert.equal(
        await prisma.businessGroupAuditLog.count({
          where: { groupId: group.id, action: `${role}_REVOKED` },
        }),
        auditCountAfterConcurrentRevoke,
      );
    } finally {
      await prisma.businessGroupAuditLog.deleteMany({ where: { groupId: group.id } });
      await prisma.businessGroupUser.deleteMany({ where: { groupId: group.id } });
      await prisma.businessGroupMember.deleteMany({ where: { groupId: group.id } });
      await prisma.businessGroup.delete({ where: { id: group.id } });
      await prisma.user.deleteMany({ where: { id: { in: [actor.id, targetUser.id] } } });
      await prisma.business.delete({ where: { id: business.id } });
    }
  });
}

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
