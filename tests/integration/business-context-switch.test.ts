import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import type { BusinessIndustry } from "@prisma/client";
import type { AppSession, CreateSessionInput } from "../../src/lib/auth/session";
import {
  authorizeBusinessContextTarget,
  commitBusinessContextSwitch,
  getAvailableBusinessContexts,
  getRecoveryBusinessContext,
} from "../../src/lib/business-groups/business-context";

const prisma = new PrismaClient();

test("business context switching is scoped, audited, and transaction safe", async () => {
  assertLocalDatabase();

  const suffix = randomUUID().slice(0, 8);
  const businessIds: string[] = [];
  const userIds: string[] = [];
  let groupId: string | null = null;

  try {
    const [home, salon, auto, outside, inactive] = await Promise.all([
      createBusiness(`Switch Home ${suffix}`, `switch-home-${suffix}`),
      createBusiness(
        `Switch Salon ${suffix}`,
        `switch-salon-${suffix}`,
        "SALON_BEAUTY",
      ),
      createBusiness(
        `Switch Auto ${suffix}`,
        `switch-auto-${suffix}`,
        "AUTO_DETAILING",
      ),
      createBusiness(`Switch Outside ${suffix}`, `switch-outside-${suffix}`),
      createBusiness(
        `Switch Inactive ${suffix}`,
        `switch-inactive-${suffix}`,
        "AUTO_DETAILING",
        "inactive",
      ),
    ]);
    businessIds.push(home.id, salon.id, auto.id, outside.id, inactive.id);

    const homeBranch = await prisma.branch.create({
      data: { businessId: home.id, name: `Home Branch ${suffix}` },
    });
    const group = await prisma.businessGroup.create({
      data: {
        name: `Switch Group ${suffix}`,
        code: `switch-group-${suffix}`,
      },
    });
    groupId = group.id;
    await prisma.businessGroupMember.createMany({
      data: [
        { groupId: group.id, businessId: salon.id },
        { groupId: group.id, businessId: auto.id },
        { groupId: group.id, businessId: inactive.id },
      ],
    });

    const [owner, manager, emptyManager, directOwner, directStaff, groupOnly] =
      await Promise.all([
        createUser(
          home.id,
          homeBranch.id,
          `switch-owner-${suffix}@example.test`,
          "BUSINESS_OWNER",
        ),
        createUser(
          home.id,
          homeBranch.id,
          `switch-manager-${suffix}@example.test`,
          "STAFF",
          ["CRM", "POS"],
        ),
        createUser(
          null,
          null,
          `switch-empty-${suffix}@example.test`,
          "STAFF",
        ),
        createUser(
          outside.id,
          null,
          `switch-direct-owner-${suffix}@example.test`,
          "BUSINESS_OWNER",
        ),
        createUser(
          outside.id,
          null,
          `switch-direct-staff-${suffix}@example.test`,
          "STAFF",
          ["CRM"],
        ),
        createUser(
          null,
          null,
          `switch-group-only-${suffix}@example.test`,
          "STAFF",
        ),
      ]);
    userIds.push(
      owner.id,
      manager.id,
      emptyManager.id,
      directOwner.id,
      directStaff.id,
      groupOnly.id,
    );

    await prisma.businessGroupUser.create({
      data: {
        groupId: group.id,
        userId: owner.id,
        role: "GROUP_OWNER",
      },
    });
    const managerGrant = await prisma.businessGroupUser.create({
      data: {
        groupId: group.id,
        userId: manager.id,
        role: "GROUP_MANAGER",
        accessScope: "SELECTED_BUSINESSES",
        businessAccesses: { create: { businessId: salon.id } },
      },
    });
    await prisma.businessGroupUser.create({
      data: {
        groupId: group.id,
        userId: emptyManager.id,
        role: "GROUP_MANAGER",
        accessScope: "SELECTED_BUSINESSES",
      },
    });
    const groupOnlyGrant = await prisma.businessGroupUser.create({
      data: {
        groupId: group.id,
        userId: groupOnly.id,
        role: "GROUP_OWNER",
      },
    });

    const ownerContexts = await getAvailableBusinessContexts(
      owner.id,
      home.id,
    );
    assert.equal(ownerContexts.canSwitch, true);
    assert.deepEqual(
      new Set(ownerContexts.businesses.map((business) => business.id)),
      new Set([home.id, salon.id, auto.id]),
    );
    assert.equal(
      ownerContexts.businesses.some((business) => business.id === outside.id),
      false,
    );

    const managerContexts = await getAvailableBusinessContexts(
      manager.id,
      home.id,
    );
    assert.deepEqual(
      new Set(managerContexts.businesses.map((business) => business.id)),
      new Set([home.id, salon.id]),
    );
    assert.equal(
      managerContexts.businesses.some((business) => business.id === auto.id),
      false,
    );

    const emptyContexts = await getAvailableBusinessContexts(
      emptyManager.id,
      null,
    );
    assert.equal(emptyContexts.canSwitch, false);
    assert.deepEqual(emptyContexts.businesses, []);

    const directContexts = await Promise.all([
      getAvailableBusinessContexts(directOwner.id, outside.id),
      getAvailableBusinessContexts(directStaff.id, outside.id),
    ]);
    for (const contexts of directContexts) {
      assert.equal(contexts.canSwitch, false);
      assert.equal(contexts.group, null);
      assert.deepEqual(
        contexts.businesses.map((business) => business.id),
        [outside.id],
      );
    }

    const managerOutsideScope = await authorizeBusinessContextTarget(
      manager.id,
      auto.id,
    );
    assert.deepEqual(managerOutsideScope, {
      ok: false,
      code: "MANAGER_SCOPE_DENIED",
      message: "You do not have access to this business.",
    });
    const outsideGroup = await authorizeBusinessContextTarget(
      owner.id,
      outside.id,
    );
    assert.equal(outsideGroup.ok, false);
    if (!outsideGroup.ok) {
      assert.equal(outsideGroup.code, "GROUP_MEMBERSHIP_INACTIVE");
      assert.equal(outsideGroup.message.includes(outside.name), false);
    }
    const inactiveTarget = await authorizeBusinessContextTarget(
      owner.id,
      inactive.id,
    );
    assert.equal(inactiveTarget.ok, false);
    if (!inactiveTarget.ok) {
      assert.equal(inactiveTarget.code, "BUSINESS_INACTIVE");
    }

    const ownerSession = sessionFor(owner, home, homeBranch.id, 3);
    const writtenSession: { value: CreateSessionInput | null } = {
      value: null,
    };
    const switched = await commitBusinessContextSwitch(
      {
        session: ownerSession,
        targetBusinessId: salon.id,
        returnTo: "/appointments?date=2026-07-27",
        source: "STORE_SWITCHER",
      },
      {
        writeSession: async (session) => {
          writtenSession.value = session;
        },
      },
    );
    assert.equal(switched.ok, true);
    if (!switched.ok) return;
    assert.equal(switched.changed, true);
    assert.equal(switched.destination, "/appointments");
    assert.ok(writtenSession.value);
    assert.equal(writtenSession.value.activeBusinessId, salon.id);
    assert.equal(writtenSession.value.businessId, undefined);
    assert.equal(writtenSession.value.contextVersion, 4);
    assert.equal(writtenSession.value.branchId, null);
    assert.equal(writtenSession.value.industryType, "SALON_BEAUTY");

    const switchAudit = await prisma.businessGroupAuditLog.findFirstOrThrow({
      where: {
        groupId: group.id,
        actorUserId: owner.id,
        action: "BUSINESS_CONTEXT_SWITCHED",
      },
    });
    assert.deepEqual(switchAudit.before, {
      activeBusinessId: home.id,
      contextVersion: 3,
    });
    assert.deepEqual(switchAudit.after, {
      activeBusinessId: salon.id,
      contextVersion: 4,
    });
    assert.deepEqual(switchAudit.metadata, {
      actorRole: "GROUP_OWNER",
      source: "STORE_SWITCHER",
    });

    const noOpAuditCount = await prisma.businessGroupAuditLog.count({
      where: { groupId: group.id, action: "BUSINESS_CONTEXT_SWITCHED" },
    });
    const noOp = await commitBusinessContextSwitch(
      {
        session: {
          ...ownerSession,
          activeBusinessId: salon.id,
          businessId: salon.id,
          industryType: "SALON_BEAUTY",
          branchId: null,
          contextVersion: 4,
        },
        targetBusinessId: salon.id,
        source: "STORE_SWITCHER",
      },
      { writeSession: async () => assert.fail("no-op must not write session") },
    );
    assert.equal(noOp.ok, true);
    if (noOp.ok) assert.equal(noOp.changed, false);
    assert.equal(
      await prisma.businessGroupAuditLog.count({
        where: { groupId: group.id, action: "BUSINESS_CONTEXT_SWITCHED" },
      }),
      noOpAuditCount,
    );

    await assert.rejects(
      commitBusinessContextSwitch(
        {
          session: {
            ...ownerSession,
            activeBusinessId: salon.id,
            businessId: salon.id,
            industryType: "SALON_BEAUTY",
            branchId: null,
            contextVersion: 4,
          },
          targetBusinessId: auto.id,
          source: "STORE_SWITCHER",
        },
        {
          writeSession: async () => {
            throw new Error("cookie writer failed");
          },
        },
      ),
      /cookie writer failed/,
    );
    assert.equal(
      await prisma.businessGroupAuditLog.count({
        where: {
          groupId: group.id,
          actorUserId: owner.id,
          action: "BUSINESS_CONTEXT_SWITCHED",
          businessId: auto.id,
        },
      }),
      0,
    );

    const managerSession: { value: CreateSessionInput | null } = {
      value: null,
    };
    const managerSwitch = await commitBusinessContextSwitch(
      {
        session: sessionFor(manager, home, homeBranch.id, 1),
        targetBusinessId: salon.id,
        returnTo: "/cashier",
        source: "STORE_SWITCHER",
      },
      {
        writeSession: async (session) => {
          managerSession.value = session;
        },
      },
    );
    assert.equal(managerSwitch.ok, true);
    if (!managerSwitch.ok) return;
    assert.equal(managerSwitch.destination, "/reports");
    assert.ok(managerSession.value);
    assert.deepEqual(managerSession.value.permissions, ["CRM", "POS"]);
    assert.equal(managerSession.value.branchId, null);

    const deniedManagerSwitch = await commitBusinessContextSwitch(
      {
        session: sessionFor(manager, home, homeBranch.id, 1),
        targetBusinessId: auto.id,
        source: "STORE_SWITCHER",
      },
      { writeSession: async () => assert.fail("denied switch wrote session") },
    );
    assert.equal(deniedManagerSwitch.ok, false);
    assert.equal(
      await prisma.businessGroupAuditLog.count({
        where: {
          groupId: group.id,
          actorUserId: manager.id,
          businessId: auto.id,
          action: "BUSINESS_CONTEXT_SWITCHED",
        },
      }),
      0,
    );

    const recovery = await getRecoveryBusinessContext({
      ...sessionFor(groupOnly, null, null, 2),
      activeBusinessId: outside.id,
      businessId: outside.id,
    });
    assert.equal(recovery.ok, true);
    if (recovery.ok) {
      assert.equal(recovery.context.businessId, auto.id);
    }

    const recoverySession = {
      ...sessionFor(groupOnly, null, null, 1),
      sessionId: `recovery-${suffix}`,
    };
    const recoveryWrites: CreateSessionInput[] = [];
    const concurrentRecoveries = await Promise.all([
      commitBusinessContextSwitch(
        {
          session: recoverySession,
          targetBusinessId: auto.id,
          source: "RECOVERY",
        },
        {
          writeSession: async (session) => {
            recoveryWrites.push(session);
          },
        },
      ),
      commitBusinessContextSwitch(
        {
          session: recoverySession,
          targetBusinessId: auto.id,
          source: "RECOVERY",
        },
        {
          writeSession: async (session) => {
            recoveryWrites.push(session);
          },
        },
      ),
    ]);
    assert.equal(concurrentRecoveries.every((result) => result.ok), true);
    assert.equal(recoveryWrites.length, 2);
    assert.equal(
      await prisma.businessGroupAuditLog.count({
        where: {
          groupId: group.id,
          actorUserId: groupOnly.id,
          action: "BUSINESS_CONTEXT_SWITCHED",
        },
      }),
      1,
    );

    const laterRecovery = await commitBusinessContextSwitch(
      {
        session: {
          ...recoverySession,
          activeBusinessId: outside.id,
          businessId: outside.id,
          contextVersion: 2,
        },
        targetBusinessId: auto.id,
        source: "RECOVERY",
      },
      { writeSession: async () => undefined },
    );
    assert.equal(laterRecovery.ok, true);
    assert.equal(
      await prisma.businessGroupAuditLog.count({
        where: {
          groupId: group.id,
          actorUserId: groupOnly.id,
          action: "BUSINESS_CONTEXT_SWITCHED",
        },
      }),
      2,
    );

    await prisma.businessGroupUser.update({
      where: { id: managerGrant.id },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    const revokedManager = await authorizeBusinessContextTarget(
      manager.id,
      salon.id,
    );
    assert.equal(revokedManager.ok, false);
    if (!revokedManager.ok) {
      assert.equal(revokedManager.code, "GROUP_ROLE_INACTIVE");
    }

    await prisma.businessGroupUser.update({
      where: { id: groupOnlyGrant.id },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    const noRecovery = await getRecoveryBusinessContext({
      ...sessionFor(groupOnly, null, null, 2),
      activeBusinessId: auto.id,
      businessId: auto.id,
    });
    assert.deepEqual(noRecovery, {
      ok: false,
      code: "NO_AVAILABLE_BUSINESS",
      message: "No active business is available for this account.",
    });
  } finally {
    if (groupId) {
      await prisma.businessGroupAuditLog.deleteMany({ where: { groupId } });
      await prisma.businessGroupUser.deleteMany({ where: { groupId } });
      await prisma.businessGroupMember.deleteMany({ where: { groupId } });
      await prisma.businessGroup.deleteMany({ where: { id: groupId } });
    }
    if (userIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (businessIds.length) {
      await prisma.branch.deleteMany({
        where: { businessId: { in: businessIds } },
      });
      await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    }
    await prisma.$disconnect();
  }
});

async function createBusiness(
  name: string,
  slug: string,
  industryType:
    | "AUTO_DETAILING"
    | "SALON_BEAUTY" = "AUTO_DETAILING",
  status: "active" | "inactive" = "active",
) {
  return prisma.business.create({
    data: { name, slug, industryType, status },
  });
}

async function createUser(
  businessId: string | null,
  branchId: string | null,
  email: string,
  role: "BUSINESS_OWNER" | "STAFF",
  permissions: string[] = [],
) {
  return prisma.user.create({
    data: {
      businessId,
      branchId,
      name: email.split("@")[0],
      email,
      passwordHash: "not-a-real-password",
      role,
      permissions,
    },
  });
}

function sessionFor(
  user: {
    id: string;
    businessId: string | null;
    name: string;
    email: string | null;
    role: "PLATFORM_ADMIN" | "BUSINESS_OWNER" | "STAFF";
    permissions: string[];
    status: "active" | "inactive";
  },
  business: {
    id: string;
    industryType: BusinessIndustry;
  } | null,
  branchId: string | null,
  contextVersion: number,
): AppSession {
  return {
    userId: user.id,
    homeBusinessId: user.businessId,
    activeBusinessId: business?.id ?? null,
    businessId: business?.id ?? null,
    contextVersion,
    branchId,
    industryType: business?.industryType ?? null,
    name: user.name,
    email: user.email ?? `${user.id}@example.test`,
    role: user.role,
    permissions: user.permissions,
    status: user.status,
  };
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
