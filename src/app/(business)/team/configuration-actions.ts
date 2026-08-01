"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { z } from "zod";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { normalizeStaffPermissionsForIndustry } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";
import { assertCanGrantStaffPermissions } from "@/lib/team/permission-administration";
import {
  buildPeopleStaffScopeWhere,
  hasWholeBusinessPeopleScope,
} from "@/lib/team/people-scope";

const optionalUuid = z.union([z.string().uuid(), z.literal("")]);
const nonNegativeMoney = z.coerce.number().finite().min(0).max(999999);
const commissionRate = z.coerce.number().finite().min(0).max(100);

const roleProfileSchema = z.object({
  id: optionalUuid,
  name: z.string().trim().min(1, "Role name is required.").max(80),
  active: z.boolean(),
});

const staffLevelSchema = z.object({
  id: optionalUuid,
  name: z.string().trim().min(1, "Level name is required.").max(80),
  serviceFixedAmount: nonNegativeMoney,
  servicePercent: commissionRate,
  productFixedAmount: nonNegativeMoney,
  productPercent: commissionRate,
  packageFixedAmount: nonNegativeMoney,
  packagePercent: commissionRate,
  active: z.boolean(),
});

const staffRoleAssignmentSchema = z.object({
  userId: z.string().uuid(),
  staffRoleProfileId: optionalUuid,
});

const staffLevelAssignmentSchema = z.object({
  userId: z.string().uuid(),
  staffLevelId: optionalUuid,
});

export async function saveStaffRoleProfileAction(formData: FormData) {
  const { access, user, businessId, industryType } =
    await requireBusinessUser("MANAGE_TEAM_PERMISSIONS");

  try {
    if (!hasWholeBusinessPeopleScope(access)) {
      throw new Error("Role configuration requires whole-business access.");
    }
    const input = roleProfileSchema.parse({
      id: String(formData.get("id") ?? ""),
      name: formData.get("name"),
      active: formData.get("active") === "on",
    });
    const permissions = normalizeStaffPermissionsForIndustry(
      formData.getAll("permissions"),
      industryType,
    );
    assertCanGrantStaffPermissions(access, permissions);
    const auditRequest = await getAuditRequestContext();

    await prisma.$transaction(async (tx) => {
      const existing = input.id
        ? await tx.staffRoleProfile.findFirst({
            where: { id: input.id, businessId },
          })
        : null;

      if (input.id && !existing) {
        throw new Error("Role profile not found.");
      }

      const saved = input.id
        ? await tx.staffRoleProfile.update({
            where: { id: input.id },
            data: { name: input.name, permissions, active: input.active },
          })
        : await tx.staffRoleProfile.create({
            data: { businessId, name: input.name, permissions, active: input.active },
          });

      if (input.id) {
        await tx.user.updateMany({
          where: {
            businessId,
            role: "STAFF",
            staffRoleProfileId: saved.id,
            loginEnabled: true,
          },
          data: { permissions },
        });
      }

      await writeAuditLog(
        {
          businessId,
          actor: user,
          action: input.id ? "STAFF_ROLE_UPDATED" : "STAFF_ROLE_CREATED",
          entityType: "StaffRoleProfile",
          entityId: saved.id,
          summary: `${input.id ? "Updated" : "Created"} staff role ${saved.name}`,
          before: existing,
          after: saved,
          request: auditRequest,
        },
        tx,
      );
    });

    revalidatePath("/team");
    redirectWithMessage("roles", "Role profile saved.", "success");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("roles", getActionError(error, "Unable to save role profile."), "error");
  }
}

export async function saveStaffLevelAction(formData: FormData) {
  const { access, user, businessId } =
    await requireBusinessUser("EDIT_COMPENSATION");

  try {
    if (!hasWholeBusinessPeopleScope(access)) {
      throw new Error("Level configuration requires whole-business access.");
    }
    const input = staffLevelSchema.parse({
      id: String(formData.get("id") ?? ""),
      name: formData.get("name"),
      serviceFixedAmount: formData.get("serviceFixedAmount"),
      servicePercent: formData.get("servicePercent"),
      productFixedAmount: formData.get("productFixedAmount"),
      productPercent: formData.get("productPercent"),
      packageFixedAmount: formData.get("packageFixedAmount"),
      packagePercent: formData.get("packagePercent"),
      active: formData.get("active") === "on",
    });
    const auditRequest = await getAuditRequestContext();

    await prisma.$transaction(async (tx) => {
      const existing = input.id
        ? await tx.staffLevel.findFirst({ where: { id: input.id, businessId } })
        : null;

      if (input.id && !existing) {
        throw new Error("Staff level not found.");
      }

      const data = {
        name: input.name,
        serviceFixedAmount: input.serviceFixedAmount,
        servicePercent: input.servicePercent,
        productFixedAmount: input.productFixedAmount,
        productPercent: input.productPercent,
        packageFixedAmount: input.packageFixedAmount,
        packagePercent: input.packagePercent,
        active: input.active,
      };
      const saved = input.id
        ? await tx.staffLevel.update({ where: { id: input.id }, data })
        : await tx.staffLevel.create({ data: { businessId, ...data } });

      await writeAuditLog(
        {
          businessId,
          actor: user,
          action: input.id ? "STAFF_LEVEL_UPDATED" : "STAFF_LEVEL_CREATED",
          entityType: "StaffLevel",
          entityId: saved.id,
          summary: `${input.id ? "Updated" : "Created"} staff level ${saved.name}`,
          before: existing,
          after: saved,
          request: auditRequest,
        },
        tx,
      );
    });

    revalidatePath("/team");
    redirectWithMessage("roles", "Staff level saved.", "success");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("roles", getActionError(error, "Unable to save staff level."), "error");
  }
}

export async function assignStaffRoleAction(formData: FormData) {
  const { access, user, businessId } =
    await requireBusinessUser("MANAGE_TEAM_PERMISSIONS");

  try {
    const input = staffRoleAssignmentSchema.parse({
      userId: formData.get("userId"),
      staffRoleProfileId: String(formData.get("staffRoleProfileId") ?? ""),
    });
    const scope = await resolveAttendanceScope(access);
    const peopleScope = {
      allowedBranchIds: scope.allowedBranchIds,
      businessId,
      now: new Date(),
      wholeBusinessScope: hasWholeBusinessPeopleScope(access),
    };
    const auditRequest = await getAuditRequestContext();

    await prisma.$transaction(async (tx) => {
      const [staff, roleProfile] = await Promise.all([
        tx.user.findFirst({
          where: {
            ...buildPeopleStaffScopeWhere(peopleScope),
            id: input.userId,
            role: "STAFF",
          },
          select: {
            id: true,
            name: true,
            branchId: true,
            loginEnabled: true,
            permissions: true,
            staffRoleProfileId: true,
          },
        }),
        input.staffRoleProfileId
          ? tx.staffRoleProfile.findFirst({
              where: { id: input.staffRoleProfileId, businessId, active: true },
            })
          : null,
      ]);

      if (!staff) throw new Error("Staff user not found in the authorized branch scope.");
      if (input.staffRoleProfileId && !roleProfile) throw new Error("Role profile is unavailable.");
      assertCanGrantStaffPermissions(access, roleProfile?.permissions ?? []);

      const updated = await tx.user.update({
        where: { id: staff.id },
        data: {
          staffRoleProfileId: roleProfile?.id ?? null,
          ...(roleProfile && staff.loginEnabled
            ? { permissions: roleProfile.permissions }
            : {}),
        },
      });

      await writeAuditLog(
        {
          businessId,
          branchId: staff.branchId,
          actor: user,
          action: "STAFF_CLASSIFICATION_UPDATED",
          entityType: "User",
          entityId: staff.id,
          summary: `Updated role and level for ${staff.name}`,
          before: {
            staffRoleProfileId: staff.staffRoleProfileId,
            permissions: staff.permissions,
          },
          after: {
            staffRoleProfileId: updated.staffRoleProfileId,
            permissions: updated.permissions,
          },
          request: auditRequest,
        },
        tx,
      );
    });

    revalidatePath("/team");
    redirectWithMessage("staff", "Staff role updated.", "success");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("staff", getActionError(error, "Unable to update staff role."), "error");
  }
}

export async function assignStaffLevelAction(formData: FormData) {
  const { access, user, businessId } =
    await requireBusinessUser("EDIT_COMPENSATION");

  try {
    const input = staffLevelAssignmentSchema.parse({
      userId: formData.get("userId"),
      staffLevelId: String(formData.get("staffLevelId") ?? ""),
    });
    const scope = await resolveAttendanceScope(access);
    const peopleScope = {
      allowedBranchIds: scope.allowedBranchIds,
      businessId,
      now: new Date(),
      wholeBusinessScope: hasWholeBusinessPeopleScope(access),
    };
    const auditRequest = await getAuditRequestContext();

    await prisma.$transaction(async (tx) => {
      const [staff, staffLevel] = await Promise.all([
        tx.user.findFirst({
          where: {
            ...buildPeopleStaffScopeWhere(peopleScope),
            id: input.userId,
            role: "STAFF",
          },
          select: {
            id: true,
            name: true,
            branchId: true,
            staffLevelId: true,
          },
        }),
        input.staffLevelId
          ? tx.staffLevel.findFirst({
              where: { id: input.staffLevelId, businessId, active: true },
            })
          : null,
      ]);

      if (!staff) throw new Error("Staff user not found in the authorized branch scope.");
      if (input.staffLevelId && !staffLevel) throw new Error("Staff level is unavailable.");

      const updated = await tx.user.update({
        where: { id: staff.id },
        data: { staffLevelId: staffLevel?.id ?? null },
      });

      await writeAuditLog(
        {
          businessId,
          branchId: staff.branchId,
          actor: user,
          action: "STAFF_LEVEL_ASSIGNED",
          entityType: "User",
          entityId: staff.id,
          summary: `Updated level for ${staff.name}`,
          before: { staffLevelId: staff.staffLevelId },
          after: { staffLevelId: updated.staffLevelId },
          request: auditRequest,
        },
        tx,
      );
    });

    revalidatePath("/team");
    redirectWithMessage("staff", "Staff level updated.", "success");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("staff", getActionError(error, "Unable to update staff level."), "error");
  }
}

function redirectWithMessage(section: string, message: string, type: "success" | "error"): never {
  redirect(`/team?section=${section}&type=${type}&message=${encodeURIComponent(message)}`);
}

function getActionError(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) return error.errors[0]?.message ?? fallback;
  if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
    return "A role or level with this name already exists.";
  }
  return error instanceof Error ? error.message : fallback;
}
