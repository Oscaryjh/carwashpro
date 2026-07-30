import { Prisma } from "@prisma/client";
import type { AppSession } from "@/lib/auth/session";
import { writeBusinessGroupAuditLog } from "@/lib/business-groups/audit";
import { prisma } from "@/lib/prisma";

type GroupActor = Pick<AppSession, "userId">;

type BusinessGroupRole = "GROUP_OWNER" | "GROUP_MANAGER";

export class BusinessGroupConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessGroupConflictError";
  }
}

export async function addBusinessToGroup(
  input: { groupId: string; businessId: string },
  actor: GroupActor,
) {
  await prisma.$transaction(async (tx) => {
    const [group, business, activeMembership] = await Promise.all([
      tx.businessGroup.findFirst({ where: { id: input.groupId, status: "ACTIVE" } }),
      tx.business.findFirst({ where: { id: input.businessId, status: "active" } }),
      tx.businessGroupMember.findFirst({
        where: { businessId: input.businessId, status: "ACTIVE" },
        include: { group: { select: { name: true } } },
      }),
    ]);

    if (!group) throw new BusinessGroupConflictError("Business group is not active.");
    if (!business) {
      throw new BusinessGroupConflictError("Only active businesses can join a group.");
    }
    if (activeMembership) {
      throw new BusinessGroupConflictError(
        activeMembership.groupId === input.groupId
          ? "This business is already in this group."
          : `This business already belongs to ${activeMembership.group.name}.`,
      );
    }

    const member = await tx.businessGroupMember.create({
      data: { groupId: input.groupId, businessId: input.businessId },
    });
    await writeBusinessGroupAuditLog(
      {
        groupId: input.groupId,
        businessId: input.businessId,
        actor,
        action: "BUSINESS_JOINED_GROUP",
        entityType: "BusinessGroupMember",
        entityId: member.id,
        summary: `Added business ${business.name} to ${group.name}`,
        after: { businessId: business.id, businessName: business.name, status: member.status },
      },
      tx,
    );
  });
}

export async function removeBusinessFromGroup(
  input: { groupId: string; memberId: string },
  actor: GroupActor,
) {
  await prisma.$transaction(async (tx) => {
    const member = await tx.businessGroupMember.findFirst({
      where: { id: input.memberId, groupId: input.groupId, status: "ACTIVE" },
      include: {
        business: { select: { name: true } },
        group: { select: { name: true } },
      },
    });
    if (!member) {
      throw new BusinessGroupConflictError("Active group membership was not found.");
    }

    const removed = await tx.businessGroupMember.update({
      where: { id: member.id },
      data: { status: "REMOVED", removedAt: new Date() },
    });
    await writeBusinessGroupAuditLog(
      {
        groupId: input.groupId,
        businessId: member.businessId,
        actor,
        action: "BUSINESS_REMOVED_FROM_GROUP",
        entityType: "BusinessGroupMember",
        entityId: member.id,
        summary: `Removed business ${member.business.name} from ${member.group.name}`,
        before: { status: member.status },
        after: { status: removed.status, removedAt: removed.removedAt },
      },
      tx,
    );
  });
}

export async function grantBusinessGroupUser(
  input: {
    groupId: string;
    userId: string;
    role: BusinessGroupRole;
    businessIds: string[];
  },
  actor: GroupActor,
) {
  await prisma.$transaction(async (tx) => {
    const [group, targetUser, activeGrant, activeMembers] = await Promise.all([
      tx.businessGroup.findFirst({ where: { id: input.groupId, status: "ACTIVE" } }),
      tx.user.findFirst({ where: { id: input.userId, status: "active" } }),
      tx.businessGroupUser.findFirst({
        where: { groupId: input.groupId, userId: input.userId, status: "ACTIVE" },
      }),
      tx.businessGroupMember.findMany({
        where: { groupId: input.groupId, status: "ACTIVE" },
        select: { businessId: true },
      }),
    ]);

    if (!group) throw new BusinessGroupConflictError("Business group is not active.");
    if (!targetUser || targetUser.role === "PLATFORM_ADMIN") {
      throw new BusinessGroupConflictError(
        "Select an active business user, not a platform administrator.",
      );
    }
    if (activeGrant) {
      throw new BusinessGroupConflictError(
        "This user already has an active role in this group.",
      );
    }

    const activeBusinessIds = new Set(activeMembers.map((member) => member.businessId));
    const requestedBusinessIds =
      input.role === "GROUP_OWNER" ? [] : Array.from(new Set(input.businessIds));
    if (requestedBusinessIds.some((businessId) => !activeBusinessIds.has(businessId))) {
      throw new BusinessGroupConflictError(
        "A group manager can only be assigned active businesses in this group.",
      );
    }

    const grant = await tx.businessGroupUser.create({
      data: {
        groupId: input.groupId,
        userId: input.userId,
        role: input.role,
        accessScope:
          input.role === "GROUP_OWNER" ? "ALL_GROUP_BUSINESSES" : "SELECTED_BUSINESSES",
        businessAccesses:
          requestedBusinessIds.length > 0
            ? { create: requestedBusinessIds.map((businessId) => ({ businessId })) }
            : undefined,
      },
    });
    await writeBusinessGroupAuditLog(
      {
        groupId: input.groupId,
        actor,
        action: `${input.role}_GRANTED`,
        entityType: "BusinessGroupUser",
        entityId: grant.id,
        summary: `Granted ${input.role} to ${targetUser.name}`,
        after: {
          userId: targetUser.id,
          role: grant.role,
          accessScope: grant.accessScope,
          businessIds: requestedBusinessIds,
        },
      },
      tx,
    );
  });
}

export async function createBusinessGroupAccount(
  input: {
    groupId: string;
    name: string;
    email: string;
    passwordHash: string;
    role: BusinessGroupRole;
    businessIds: string[];
  },
  actor: GroupActor,
) {
  return prisma.$transaction(async (tx) => {
    const [group, existingUser, activeMembers] = await Promise.all([
      tx.businessGroup.findFirst({
        where: { id: input.groupId, status: "ACTIVE" },
        select: { id: true, name: true },
      }),
      tx.user.findFirst({
        where: { email: { equals: input.email, mode: "insensitive" } },
        select: { id: true },
      }),
      tx.businessGroupMember.findMany({
        where: { groupId: input.groupId, status: "ACTIVE" },
        select: { businessId: true },
      }),
    ]);

    if (!group) {
      throw new BusinessGroupConflictError("Business group is not active.");
    }
    if (existingUser) {
      throw new BusinessGroupConflictError(
        "An account with this email already exists. Grant access to the existing user instead.",
      );
    }

    const activeBusinessIds = new Set(activeMembers.map((member) => member.businessId));
    const requestedBusinessIds =
      input.role === "GROUP_OWNER" ? [] : Array.from(new Set(input.businessIds));
    if (requestedBusinessIds.some((businessId) => !activeBusinessIds.has(businessId))) {
      throw new BusinessGroupConflictError(
        "A group manager can only be assigned active businesses in this group.",
      );
    }

    const user = await tx.user.create({
      data: {
        businessId: null,
        branchId: null,
        name: input.name,
        email: input.email,
        passwordHash: input.passwordHash,
        loginEnabled: true,
        role: input.role === "GROUP_OWNER" ? "BUSINESS_OWNER" : "STAFF",
        permissions: [],
        status: "active",
      },
      select: { id: true, name: true, email: true, role: true },
    });

    const grant = await tx.businessGroupUser.create({
      data: {
        groupId: input.groupId,
        userId: user.id,
        role: input.role,
        accessScope:
          input.role === "GROUP_OWNER" ? "ALL_GROUP_BUSINESSES" : "SELECTED_BUSINESSES",
        businessAccesses:
          requestedBusinessIds.length > 0
            ? { create: requestedBusinessIds.map((businessId) => ({ businessId })) }
            : undefined,
      },
    });

    await writeBusinessGroupAuditLog(
      {
        groupId: input.groupId,
        actor,
        action: "GROUP_USER_ACCOUNT_CREATED",
        entityType: "User",
        entityId: user.id,
        summary: `Created group-only account for ${user.name}`,
        after: {
          userId: user.id,
          name: user.name,
          email: user.email,
          identityRole: user.role,
          businessId: null,
        },
      },
      tx,
    );
    await writeBusinessGroupAuditLog(
      {
        groupId: input.groupId,
        actor,
        action: `${input.role}_GRANTED`,
        entityType: "BusinessGroupUser",
        entityId: grant.id,
        summary: `Granted ${input.role} to ${user.name}`,
        after: {
          userId: user.id,
          role: grant.role,
          accessScope: grant.accessScope,
          businessIds: requestedBusinessIds,
        },
      },
      tx,
    );

    return { user, grant };
  });
}

export async function updateBusinessGroupAccount(
  input: {
    groupId: string;
    groupUserId: string;
    name: string;
    email: string;
    passwordHash?: string;
  },
  actor: GroupActor,
) {
  return prisma.$transaction(async (tx) => {
    const grant = await tx.businessGroupUser.findFirst({
      where: {
        id: input.groupUserId,
        groupId: input.groupId,
        status: "ACTIVE",
        group: { status: "ACTIVE" },
      },
      include: {
        user: {
          select: {
            id: true,
            businessId: true,
            name: true,
            email: true,
          },
        },
      },
    });
    if (!grant) {
      throw new BusinessGroupConflictError("This active group account was not found.");
    }
    if (grant.user.businessId !== null) {
      throw new BusinessGroupConflictError(
        "Business user login details must be managed from that business.",
      );
    }

    const existingUser = await tx.user.findFirst({
      where: {
        id: { not: grant.user.id },
        email: { equals: input.email, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (existingUser) {
      throw new BusinessGroupConflictError("An account with this email already exists.");
    }

    const profileChanged =
      grant.user.name !== input.name ||
      (grant.user.email ?? "").toLowerCase() !== input.email.toLowerCase();
    if (!profileChanged && !input.passwordHash) {
      throw new BusinessGroupConflictError("No account changes were provided.");
    }

    const updatedUser = await tx.user.update({
      where: { id: grant.user.id },
      data: {
        name: input.name,
        email: input.email,
        ...(input.passwordHash ? { passwordHash: input.passwordHash } : {}),
      },
      select: { id: true, name: true, email: true },
    });

    if (profileChanged) {
      await writeBusinessGroupAuditLog(
        {
          groupId: input.groupId,
          actor,
          action: "GROUP_USER_ACCOUNT_UPDATED",
          entityType: "User",
          entityId: updatedUser.id,
          summary: `Updated group-only account ${updatedUser.name}`,
          before: {
            userId: grant.user.id,
            name: grant.user.name,
            email: grant.user.email,
          },
          after: {
            userId: updatedUser.id,
            name: updatedUser.name,
            email: updatedUser.email,
          },
        },
        tx,
      );
    }

    if (input.passwordHash) {
      await writeBusinessGroupAuditLog(
        {
          groupId: input.groupId,
          actor,
          action: "GROUP_USER_PASSWORD_RESET",
          entityType: "User",
          entityId: updatedUser.id,
          summary: `Reset password for group-only account ${updatedUser.name}`,
          metadata: { passwordChanged: true },
        },
        tx,
      );
    }

    return updatedUser;
  });
}

export async function revokeBusinessGroupUser(
  input: { groupId: string; groupUserId: string },
  actor: GroupActor,
) {
  await prisma.$transaction(async (tx) => {
    const grant = await tx.businessGroupUser.findFirst({
      where: { id: input.groupUserId, groupId: input.groupId },
      include: { user: { select: { name: true } } },
    });
    if (!grant) {
      throw new BusinessGroupConflictError("This group role was not found.");
    }
    if (grant.status !== "ACTIVE") {
      throw new BusinessGroupConflictError("This group role has already been revoked.");
    }

    const revokedAt = new Date();
    const revoked = await tx.businessGroupUser.updateMany({
      where: {
        id: grant.id,
        groupId: input.groupId,
        status: "ACTIVE",
      },
      data: { status: "REVOKED", revokedAt },
    });
    if (revoked.count !== 1) {
      throw new BusinessGroupConflictError("This group role has already been revoked.");
    }

    await writeBusinessGroupAuditLog(
      {
        groupId: input.groupId,
        actor,
        action: `${grant.role}_REVOKED`,
        entityType: "BusinessGroupUser",
        entityId: grant.id,
        summary: `Revoked ${grant.role} from ${grant.user.name}`,
        before: { status: grant.status, role: grant.role },
        after: { status: "REVOKED", revokedAt },
      },
      tx,
    );
  });
}

export function businessGroupConflictState(
  error: unknown,
  uniqueConstraintMessage = "This active group assignment already exists.",
) {
  if (error instanceof BusinessGroupConflictError) {
    return { status: "error" as const, message: error.message };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return {
      status: "error" as const,
      message: uniqueConstraintMessage,
    };
  }

  return null;
}
