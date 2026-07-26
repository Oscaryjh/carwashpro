import { Prisma } from "@prisma/client";
import type { AppSession } from "@/lib/auth/session";
import { writeBusinessGroupAuditLog } from "@/lib/business-groups/audit";
import { prisma } from "@/lib/prisma";

type GroupActor = Pick<AppSession, "userId">;

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
    role: "GROUP_OWNER" | "GROUP_MANAGER";
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

export async function revokeBusinessGroupUser(
  input: { groupId: string; groupUserId: string },
  actor: GroupActor,
) {
  await prisma.$transaction(async (tx) => {
    const grant = await tx.businessGroupUser.findFirst({
      where: { id: input.groupUserId, groupId: input.groupId, status: "ACTIVE" },
      include: { user: { select: { name: true } } },
    });
    if (!grant) {
      throw new BusinessGroupConflictError("Active group access was not found.");
    }

    const revoked = await tx.businessGroupUser.update({
      where: { id: grant.id },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    await writeBusinessGroupAuditLog(
      {
        groupId: input.groupId,
        actor,
        action: `${grant.role}_REVOKED`,
        entityType: "BusinessGroupUser",
        entityId: grant.id,
        summary: `Revoked ${grant.role} from ${grant.user.name}`,
        before: { status: grant.status, role: grant.role },
        after: { status: revoked.status, revokedAt: revoked.revokedAt },
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
