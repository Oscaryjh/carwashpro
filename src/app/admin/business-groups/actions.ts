"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { assertRole } from "@/lib/auth/permissions";
import { writeBusinessGroupAuditLog } from "@/lib/business-groups/audit";
import { prisma } from "@/lib/prisma";
import {
  businessGroupMembershipSchema,
  businessGroupSchema,
  businessGroupUserSchema,
  uniqueIds,
} from "@/lib/validation/business-group";

function requirePlatformAdmin() {
  return requireUser().then((user) => {
    assertRole(user, ["PLATFORM_ADMIN"]);
    return user;
  });
}

export async function createBusinessGroupAction(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const input = businessGroupSchema.parse({
    name: formData.get("name"),
    code: formData.get("code"),
  });

  try {
    const group = await prisma.$transaction(async (tx) => {
      const created = await tx.businessGroup.create({ data: input });
      await writeBusinessGroupAuditLog(
        {
          groupId: created.id,
          actor,
          action: "BUSINESS_GROUP_CREATED",
          entityType: "BusinessGroup",
          entityId: created.id,
          summary: `Created business group ${created.name}`,
          after: { name: created.name, code: created.code, status: created.status },
        },
        tx,
      );
      return created;
    });

    revalidatePath("/admin/business-groups");
    redirect(`/admin/business-groups/${group.id}`);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("This group code already exists.");
    }
    throw error;
  }
}

export async function addBusinessToGroupAction(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const input = businessGroupMembershipSchema.parse({
    groupId: formData.get("groupId"),
    businessId: formData.get("businessId"),
  });

  try {
    await prisma.$transaction(async (tx) => {
      const [group, business, activeMembership] = await Promise.all([
        tx.businessGroup.findFirst({ where: { id: input.groupId, status: "ACTIVE" } }),
        tx.business.findFirst({ where: { id: input.businessId, status: "active" } }),
        tx.businessGroupMember.findFirst({
          where: { businessId: input.businessId, status: "ACTIVE" },
          include: { group: { select: { name: true } } },
        }),
      ]);

      if (!group) throw new Error("Business group is not active.");
      if (!business) throw new Error("Only active businesses can join a group.");
      if (activeMembership) {
        throw new Error(
          activeMembership.groupId === input.groupId
            ? "This business is already in the group."
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
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("This business was added to another active group at the same time.");
    }
    throw error;
  }

  revalidatePath(`/admin/business-groups/${input.groupId}`);
}

export async function removeBusinessFromGroupAction(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const groupId = String(formData.get("groupId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");

  await prisma.$transaction(async (tx) => {
    const member = await tx.businessGroupMember.findFirst({
      where: { id: memberId, groupId, status: "ACTIVE" },
      include: { business: { select: { name: true } }, group: { select: { name: true } } },
    });
    if (!member) throw new Error("Active group membership was not found.");

    const removed = await tx.businessGroupMember.update({
      where: { id: member.id },
      data: { status: "REMOVED", removedAt: new Date() },
    });
    await writeBusinessGroupAuditLog(
      {
        groupId,
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

  revalidatePath(`/admin/business-groups/${groupId}`);
}

export async function grantBusinessGroupUserAction(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const groupId = String(formData.get("groupId") ?? "");
  const input = businessGroupUserSchema.parse({
    groupId,
    userId: formData.get("userId"),
    role: formData.get("role"),
    businessIds: uniqueIds(formData.getAll("businessIds").map(String).filter(Boolean)),
  });

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
    if (!group) throw new Error("Business group is not active.");
    if (!targetUser || targetUser.role === "PLATFORM_ADMIN") {
      throw new Error("Select an active business user, not a platform administrator.");
    }
    if (activeGrant) throw new Error("This user already has an active group role.");

    const activeBusinessIds = new Set(activeMembers.map((member) => member.businessId));
    const requestedBusinessIds = input.role === "GROUP_OWNER" ? [] : input.businessIds;
    if (requestedBusinessIds.some((businessId) => !activeBusinessIds.has(businessId))) {
      throw new Error("A group manager can only be assigned active businesses in this group.");
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

  revalidatePath(`/admin/business-groups/${input.groupId}`);
}

export async function revokeBusinessGroupUserAction(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const groupId = String(formData.get("groupId") ?? "");
  const groupUserId = String(formData.get("groupUserId") ?? "");

  await prisma.$transaction(async (tx) => {
    const grant = await tx.businessGroupUser.findFirst({
      where: { id: groupUserId, groupId, status: "ACTIVE" },
      include: { user: { select: { name: true } } },
    });
    if (!grant) throw new Error("Active group access was not found.");

    const revoked = await tx.businessGroupUser.update({
      where: { id: grant.id },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    await writeBusinessGroupAuditLog(
      {
        groupId,
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

  revalidatePath(`/admin/business-groups/${groupId}`);
}

export async function deactivateBusinessGroupAction(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const groupId = String(formData.get("groupId") ?? "");

  await prisma.$transaction(async (tx) => {
    const group = await tx.businessGroup.findFirst({ where: { id: groupId, status: "ACTIVE" } });
    if (!group) throw new Error("Active business group was not found.");

    const now = new Date();
    await tx.businessGroup.update({ where: { id: group.id }, data: { status: "INACTIVE" } });
    await tx.businessGroupMember.updateMany({
      where: { groupId, status: "ACTIVE" },
      data: { status: "REMOVED", removedAt: now },
    });
    await tx.businessGroupUser.updateMany({
      where: { groupId, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: now },
    });
    await writeBusinessGroupAuditLog(
      {
        groupId,
        actor,
        action: "BUSINESS_GROUP_DEACTIVATED",
        entityType: "BusinessGroup",
        entityId: groupId,
        summary: `Deactivated business group ${group.name}`,
        before: { status: group.status },
        after: { status: "INACTIVE" },
      },
      tx,
    );
  });

  revalidatePath("/admin/business-groups");
  redirect("/admin/business-groups");
}
