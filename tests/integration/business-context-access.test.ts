import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { resolveBusinessAccess } from "../../src/lib/business-groups/business-access";

const prisma = new PrismaClient();

test("business context access is revalidated against direct and group authorization", async () => {
  assertLocalDatabase();

  const suffix = randomUUID().slice(0, 8);
  const businessIds: string[] = [];
  const userIds: string[] = [];
  let groupId: string | null = null;

  try {
    const [home, scoped, secondMember, outside, inactive] = await Promise.all([
      createBusiness(`Context Home ${suffix}`, `context-home-${suffix}`),
      createBusiness(`Context Scoped ${suffix}`, `context-scoped-${suffix}`),
      createBusiness(`Context Second ${suffix}`, `context-second-${suffix}`),
      createBusiness(`Context Outside ${suffix}`, `context-outside-${suffix}`),
      createBusiness(
        `Context Inactive ${suffix}`,
        `context-inactive-${suffix}`,
        "inactive",
      ),
    ]);
    businessIds.push(home.id, scoped.id, secondMember.id, outside.id, inactive.id);

    const group = await prisma.businessGroup.create({
      data: {
        name: `Context Group ${suffix}`,
        code: `context-group-${suffix}`,
      },
    });
    groupId = group.id;
    await prisma.businessGroupMember.createMany({
      data: [
        { groupId: group.id, businessId: scoped.id },
        { groupId: group.id, businessId: secondMember.id },
        { groupId: group.id, businessId: inactive.id },
      ],
    });

    const [
      directOwner,
      directStaff,
      groupOwner,
      groupManager,
      emptyManager,
      groupOnlyOwner,
      groupOnlyManager,
      groupOnlyEmptyManager,
      platformAdmin,
    ] =
      await Promise.all([
        createUser(home.id, `direct-owner-${suffix}@example.test`, "BUSINESS_OWNER"),
        createUser(home.id, `direct-staff-${suffix}@example.test`, "STAFF", [
          "CRM",
        ]),
        createUser(home.id, `group-owner-${suffix}@example.test`, "BUSINESS_OWNER"),
        createUser(home.id, `group-manager-${suffix}@example.test`, "STAFF"),
        createUser(home.id, `empty-manager-${suffix}@example.test`, "STAFF"),
        createUser(null, `group-only-owner-${suffix}@example.test`, "STAFF"),
        createUser(null, `group-only-manager-${suffix}@example.test`, "STAFF"),
        createUser(
          null,
          `group-only-empty-manager-${suffix}@example.test`,
          "STAFF",
        ),
        createUser(null, `platform-${suffix}@example.test`, "PLATFORM_ADMIN"),
      ]);
    userIds.push(
      directOwner.id,
      directStaff.id,
      groupOwner.id,
      groupManager.id,
      emptyManager.id,
      groupOnlyOwner.id,
      groupOnlyManager.id,
      groupOnlyEmptyManager.id,
      platformAdmin.id,
    );

    const ownerGrant = await prisma.businessGroupUser.create({
      data: {
        groupId: group.id,
        userId: groupOwner.id,
        role: "GROUP_OWNER",
      },
    });
    const managerGrant = await prisma.businessGroupUser.create({
      data: {
        groupId: group.id,
        userId: groupManager.id,
        role: "GROUP_MANAGER",
        accessScope: "SELECTED_BUSINESSES",
        businessAccesses: { create: { businessId: scoped.id } },
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
    await prisma.businessGroupUser.create({
      data: {
        groupId: group.id,
        userId: groupOnlyEmptyManager.id,
        role: "GROUP_MANAGER",
        accessScope: "SELECTED_BUSINESSES",
      },
    });
    await prisma.businessGroupUser.create({
      data: {
        groupId: group.id,
        userId: groupOnlyOwner.id,
        role: "GROUP_OWNER",
      },
    });
    await prisma.businessGroupUser.create({
      data: {
        groupId: group.id,
        userId: groupOnlyManager.id,
        role: "GROUP_MANAGER",
        accessScope: "SELECTED_BUSINESSES",
        businessAccesses: { create: { businessId: secondMember.id } },
      },
    });

    const directOwnerAccess = await resolveBusinessAccess({
      userId: directOwner.id,
      requestedBusinessId: home.id,
      capability: "MODIFY_BUSINESS_SETTINGS",
    });
    assertGranted(directOwnerAccess, "DIRECT_BUSINESS", "BUSINESS_OWNER");

    const directStaffAccess = await resolveBusinessAccess({
      userId: directStaff.id,
      requestedBusinessId: home.id,
      capability: "VIEW_CRM",
    });
    assertGranted(directStaffAccess, "DIRECT_BUSINESS", "STAFF");
    assert.deepEqual(directStaffAccess.permissions, ["CRM"]);

    const deniedDirectStaffWrite = await resolveBusinessAccess({
      userId: directStaff.id,
      requestedBusinessId: home.id,
      capability: "PROCESS_CASHIER_PAYMENT",
    });
    assertDenied(deniedDirectStaffWrite, "CAPABILITY_DENIED", home.id);

    const delegatedOwnerRead = await resolveBusinessAccess({
      userId: groupOwner.id,
      requestedBusinessId: scoped.id,
      capability: "VIEW_REPORTS",
    });
    assertGranted(delegatedOwnerRead, "GROUP_ACCESS", "BUSINESS_OWNER");
    assert.equal(delegatedOwnerRead.actorRole, "GROUP_OWNER");
    assert.equal(delegatedOwnerRead.identityRole, "BUSINESS_OWNER");
    assert.equal(delegatedOwnerRead.groupId, group.id);

    const delegatedOwnerWrite = await resolveBusinessAccess({
      userId: groupOwner.id,
      requestedBusinessId: scoped.id,
      capability: "PROCESS_REFUND",
    });
    assertGranted(delegatedOwnerWrite, "GROUP_ACCESS", "BUSINESS_OWNER");

    const ownerOutsideGroup = await resolveBusinessAccess({
      userId: groupOwner.id,
      requestedBusinessId: outside.id,
      capability: "VIEW_REPORTS",
    });
    assertDenied(ownerOutsideGroup, "DIRECT_BUSINESS_MISMATCH", home.id);
    assert.equal("businessName" in ownerOutsideGroup, false);

    const managerRead = await resolveBusinessAccess({
      userId: groupManager.id,
      requestedBusinessId: scoped.id,
      capability: "VIEW_CRM",
    });
    assertGranted(
      managerRead,
      "GROUP_ACCESS",
      "GROUP_MANAGER_READ_ONLY",
    );
    assert.equal(managerRead.actorRole, "GROUP_MANAGER");

    const managerOutsideScope = await resolveBusinessAccess({
      userId: groupManager.id,
      requestedBusinessId: secondMember.id,
      capability: "VIEW_REPORTS",
    });
    assertDenied(managerOutsideScope, "GROUP_MANAGER_SCOPE_MISSING", home.id);

    const managerWrite = await resolveBusinessAccess({
      userId: groupManager.id,
      requestedBusinessId: scoped.id,
      capability: "PROCESS_CASHIER_PAYMENT",
    });
    assertDenied(managerWrite, "CAPABILITY_DENIED", home.id);

    const emptyManagerAccess = await resolveBusinessAccess({
      userId: emptyManager.id,
      requestedBusinessId: scoped.id,
      capability: "VIEW_REPORTS",
    });
    assertDenied(
      emptyManagerAccess,
      "GROUP_MANAGER_SCOPE_MISSING",
      home.id,
    );

    const missingCapability = await resolveBusinessAccess({
      userId: groupOwner.id,
      requestedBusinessId: scoped.id,
    });
    assertDenied(missingCapability, "CAPABILITY_REQUIRED", home.id);

    const groupOwnerFallback = await resolveBusinessAccess({
      userId: groupOnlyOwner.id,
      requestedBusinessId: null,
      capability: "VIEW_DASHBOARD",
    });
    assertGroupFallback(groupOwnerFallback, scoped.id);

    const groupManagerFallback = await resolveBusinessAccess({
      userId: groupOnlyManager.id,
      requestedBusinessId: null,
      capability: "VIEW_DASHBOARD",
    });
    assertGroupFallback(groupManagerFallback, secondMember.id);

    const groupOnlyOwnerAccess = await resolveBusinessAccess({
      userId: groupOnlyOwner.id,
      requestedBusinessId: scoped.id,
      capability: "VIEW_DASHBOARD",
    });
    assertGranted(groupOnlyOwnerAccess, "GROUP_ACCESS", "BUSINESS_OWNER");

    const groupOnlyManagerAccess = await resolveBusinessAccess({
      userId: groupOnlyManager.id,
      requestedBusinessId: secondMember.id,
      capability: "VIEW_TEAM_DIRECTORY",
    });
    assertGranted(
      groupOnlyManagerAccess,
      "GROUP_ACCESS",
      "GROUP_MANAGER_READ_ONLY",
    );

    const groupOnlyEmptyManagerAccess = await resolveBusinessAccess({
      userId: groupOnlyEmptyManager.id,
      requestedBusinessId: null,
      capability: "VIEW_DASHBOARD",
    });
    assertDenied(
      groupOnlyEmptyManagerAccess,
      "BUSINESS_REQUIRED",
      null,
    );

    const tamperedBusiness = await resolveBusinessAccess({
      userId: directOwner.id,
      requestedBusinessId: outside.id,
      capability: "VIEW_REPORTS",
    });
    assertDenied(tamperedBusiness, "DIRECT_BUSINESS_MISMATCH", home.id);

    const inactiveBusiness = await resolveBusinessAccess({
      userId: groupOwner.id,
      requestedBusinessId: inactive.id,
      capability: "VIEW_REPORTS",
    });
    assertDenied(inactiveBusiness, "BUSINESS_INACTIVE", home.id);

    await prisma.businessGroupUser.update({
      where: { id: managerGrant.id },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    const revokedManagerAccess = await resolveBusinessAccess({
      userId: groupManager.id,
      requestedBusinessId: scoped.id,
      capability: "VIEW_REPORTS",
    });
    assertDenied(revokedManagerAccess, "DIRECT_BUSINESS_MISMATCH", home.id);

    const scopedMembership = await prisma.businessGroupMember.findFirstOrThrow({
      where: { groupId: group.id, businessId: scoped.id, status: "ACTIVE" },
    });
    await prisma.businessGroupMember.update({
      where: { id: scopedMembership.id },
      data: { status: "REMOVED", removedAt: new Date() },
    });
    const removedMembershipAccess = await resolveBusinessAccess({
      userId: groupOwner.id,
      requestedBusinessId: scoped.id,
      capability: "VIEW_REPORTS",
    });
    assertDenied(
      removedMembershipAccess,
      "DIRECT_BUSINESS_MISMATCH",
      home.id,
    );

    await prisma.user.update({
      where: { id: groupOwner.id },
      data: { status: "inactive" },
    });
    const inactiveUserAccess = await resolveBusinessAccess({
      userId: groupOwner.id,
      requestedBusinessId: secondMember.id,
      capability: "VIEW_REPORTS",
    });
    assertDenied(inactiveUserAccess, "USER_INACTIVE", null);

    const platformAccess = await resolveBusinessAccess({
      userId: platformAdmin.id,
      requestedBusinessId: outside.id,
      capability: "MODIFY_BUSINESS_SETTINGS",
    });
    assertGranted(
      platformAccess,
      "PLATFORM_ADMIN",
      "PLATFORM_ADMIN",
    );
    assert.equal(platformAccess.businessId, null);

    assert.ok(ownerGrant.id);
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
      await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    }
    await prisma.$disconnect();
  }
});

async function createBusiness(
  name: string,
  slug: string,
  status: "active" | "inactive" = "active",
) {
  return prisma.business.create({ data: { name, slug, status } });
}

async function createUser(
  businessId: string | null,
  email: string,
  role: "PLATFORM_ADMIN" | "BUSINESS_OWNER" | "STAFF",
  permissions: string[] = [],
) {
  return prisma.user.create({
    data: {
      businessId,
      name: email.split("@")[0],
      email,
      passwordHash: "not-a-real-password",
      role,
      permissions,
    },
  });
}

function assertGranted(
  access: Awaited<ReturnType<typeof resolveBusinessAccess>>,
  source: "DIRECT_BUSINESS" | "GROUP_ACCESS" | "PLATFORM_ADMIN",
  effectiveRole:
    | "BUSINESS_OWNER"
    | "STAFF"
    | "GROUP_MANAGER_READ_ONLY"
    | "PLATFORM_ADMIN",
): asserts access is Extract<typeof access, { granted: true }> {
  assert.equal(access.granted, true);
  if (!access.granted) return;
  assert.equal(access.source, source);
  assert.equal(access.effectiveBusinessRole, effectiveRole);
}

function assertDenied(
  access: Awaited<ReturnType<typeof resolveBusinessAccess>>,
  reason: string,
  fallbackBusinessId: string | null,
): asserts access is Extract<typeof access, { granted: false }> {
  assert.equal(access.granted, false);
  if (access.granted) return;
  assert.equal(access.reason, reason);
  if (fallbackBusinessId) {
    assert.deepEqual(access.fallback, {
      kind: "BUSINESS",
      businessId: fallbackBusinessId,
      source: "HOME",
    });
  } else {
    assert.deepEqual(access.fallback, { kind: "NO_ACCESS" });
  }
}

function assertGroupFallback(
  access: Awaited<ReturnType<typeof resolveBusinessAccess>>,
  businessId: string,
): asserts access is Extract<typeof access, { granted: false }> {
  assert.equal(access.granted, false);
  if (access.granted) return;
  assert.equal(access.reason, "BUSINESS_REQUIRED");
  assert.deepEqual(access.fallback, {
    kind: "BUSINESS",
    businessId,
    source: "GROUP",
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
