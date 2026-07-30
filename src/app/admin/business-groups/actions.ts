"use server";

import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { assertRole } from "@/lib/auth/permissions";
import { writeBusinessGroupAuditLog } from "@/lib/business-groups/audit";
import {
  addBusinessToGroup,
  businessGroupConflictState,
  createBusinessGroupAccount,
  grantBusinessGroupUser,
  removeBusinessFromGroup,
  revokeBusinessGroupUser,
  updateBusinessGroupAccount,
} from "@/lib/business-groups/admin-service";
import { prisma } from "@/lib/prisma";
import {
  businessGroupAccountSchema,
  businessGroupAccountUpdateSchema,
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

export type BusinessGroupActionState = {
  status: "idle" | "error" | "success";
  message: string;
};

const successState: BusinessGroupActionState = {
  status: "success",
  message: "",
};

function validationError(message: string): BusinessGroupActionState {
  return { status: "error", message };
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

export async function addBusinessToGroupAction(
  _previousState: BusinessGroupActionState,
  formData: FormData,
): Promise<BusinessGroupActionState> {
  const actor = await requirePlatformAdmin();
  const parsed = businessGroupMembershipSchema.safeParse({
    groupId: formData.get("groupId"),
    businessId: formData.get("businessId"),
  });
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message ?? "Check the selected business.");
  }
  const input = parsed.data;

  try {
    await addBusinessToGroup(input, actor);
  } catch (error) {
    const conflict = businessGroupConflictState(
      error,
      "This business already belongs to an active group.",
    );
    if (conflict) return conflict;
    throw error;
  }

  revalidatePath(`/admin/business-groups/${input.groupId}`);
  return successState;
}

export async function removeBusinessFromGroupAction(
  _previousState: BusinessGroupActionState,
  formData: FormData,
): Promise<BusinessGroupActionState> {
  const actor = await requirePlatformAdmin();
  const groupId = String(formData.get("groupId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");

  try {
    await removeBusinessFromGroup({ groupId, memberId }, actor);
  } catch (error) {
    const conflict = businessGroupConflictState(error);
    if (conflict) return conflict;
    throw error;
  }

  revalidatePath(`/admin/business-groups/${groupId}`);
  return successState;
}

export async function grantBusinessGroupUserAction(
  _previousState: BusinessGroupActionState,
  formData: FormData,
): Promise<BusinessGroupActionState> {
  const actor = await requirePlatformAdmin();
  const groupId = String(formData.get("groupId") ?? "");
  const parsed = businessGroupUserSchema.safeParse({
    groupId,
    userId: formData.get("userId"),
    role: formData.get("role"),
    businessIds: uniqueIds(formData.getAll("businessIds").map(String).filter(Boolean)),
  });
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message ?? "Check the group access details.");
  }
  const input = parsed.data;

  try {
    await grantBusinessGroupUser(input, actor);
  } catch (error) {
    const conflict = businessGroupConflictState(
      error,
      "This user already has an active role in this group.",
    );
    if (conflict) return conflict;
    throw error;
  }

  revalidatePath(`/admin/business-groups/${input.groupId}`);
  return successState;
}

export async function createBusinessGroupAccountAction(
  _previousState: BusinessGroupActionState,
  formData: FormData,
): Promise<BusinessGroupActionState> {
  const actor = await requirePlatformAdmin();
  const parsed = businessGroupAccountSchema.safeParse({
    groupId: formData.get("groupId"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    role: formData.get("role"),
    businessIds: uniqueIds(formData.getAll("businessIds").map(String).filter(Boolean)),
  });
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message ?? "Check the account details.");
  }

  const input = {
    groupId: parsed.data.groupId,
    name: parsed.data.name,
    email: parsed.data.email,
    role: parsed.data.role,
    businessIds: parsed.data.businessIds,
  };
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);

  try {
    await createBusinessGroupAccount({ ...input, passwordHash }, actor);
  } catch (error) {
    const conflict = businessGroupConflictState(
      error,
      "An account with this email already exists. Grant access to the existing user instead.",
    );
    if (conflict) return conflict;
    throw error;
  }

  revalidatePath(`/admin/business-groups/${input.groupId}`);
  return {
    status: "success",
    message: "Group login account created. The user can now sign in with this email.",
  };
}

export async function revokeBusinessGroupUserAction(
  _previousState: BusinessGroupActionState,
  formData: FormData,
): Promise<BusinessGroupActionState> {
  const actor = await requirePlatformAdmin();
  const groupId = String(formData.get("groupId") ?? "");
  const groupUserId = String(formData.get("groupUserId") ?? "");

  try {
    await revokeBusinessGroupUser({ groupId, groupUserId }, actor);
  } catch (error) {
    const conflict = businessGroupConflictState(error);
    if (conflict) return conflict;
    throw error;
  }

  revalidatePath(`/admin/business-groups/${groupId}`);
  return successState;
}

export async function updateBusinessGroupAccountAction(
  _previousState: BusinessGroupActionState,
  formData: FormData,
): Promise<BusinessGroupActionState> {
  const actor = await requirePlatformAdmin();
  const parsed = businessGroupAccountUpdateSchema.safeParse({
    groupId: formData.get("groupId"),
    groupUserId: formData.get("groupUserId"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message ?? "Check the account details.");
  }

  const passwordHash = parsed.data.password
    ? await bcrypt.hash(parsed.data.password, 12)
    : undefined;

  try {
    await updateBusinessGroupAccount(
      {
        groupId: parsed.data.groupId,
        groupUserId: parsed.data.groupUserId,
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash,
      },
      actor,
    );
  } catch (error) {
    const conflict = businessGroupConflictState(
      error,
      "An account with this email already exists.",
    );
    if (conflict) return conflict;
    throw error;
  }

  revalidatePath(`/admin/business-groups/${parsed.data.groupId}`);
  return {
    status: "success",
    message: passwordHash
      ? "Group login and password updated."
      : "Group login updated.",
  };
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
