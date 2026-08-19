"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { z } from "zod";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";
import {
  deleteRuntimeEmployeeAvatarByUrl,
  writeRuntimeEmployeeAvatar,
} from "@/lib/runtime-employee-avatar";
import {
  buildPeopleMembershipScopeWhere,
  hasWholeBusinessPeopleScope,
} from "@/lib/team/people-scope";

const membershipIdSchema = z.string().uuid();
const allowedAvatarTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export type EmployeeAvatarActionState = {
  status: "idle" | "success" | "error";
  message: string;
  avatarUrl?: string;
};

export async function updateEmployeeAvatarAction(
  membershipId: string,
  _previousState: EmployeeAvatarActionState,
  formData: FormData,
): Promise<EmployeeAvatarActionState> {
  const parsedMembershipId = membershipIdSchema.safeParse(membershipId);
  if (!parsedMembershipId.success) {
    return { status: "error", message: "This employee profile is invalid." };
  }

  const { access, businessId, user } = await requireBusinessUser("MODIFY_TEAM");
  if (access.source === "DIRECT_BUSINESS") {
    assertStaffPermission(user, "TEAM");
  }

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a photo before saving." };
  }
  if (!allowedAvatarTypes.has(file.type)) {
    return { status: "error", message: "Use a JPG, PNG or WebP photo." };
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return { status: "error", message: "The processed photo must be under 2 MB." };
  }

  const scope = await resolveAttendanceScope(access);
  const now = new Date();
  const membership = await prisma.employeeBusinessMembership.findFirst({
    where: {
      ...buildPeopleMembershipScopeWhere({
        allowedBranchIds: scope.allowedBranchIds,
        businessId,
        now,
        wholeBusinessScope: hasWholeBusinessPeopleScope(access),
      }),
      id: parsedMembershipId.data,
    },
    select: {
      avatarUrl: true,
      fullName: true,
      id: true,
      branchAssignments: {
        where: {
          branchId: { in: [...scope.allowedBranchIds] },
          effectiveFrom: { lte: now },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: now } }],
          status: "ACTIVE",
        },
        orderBy: [{ isPrimary: "desc" }],
        take: 1,
        select: { branchId: true },
      },
    },
  });

  if (!membership) {
    return { status: "error", message: "Employee not found in your access scope." };
  }

  let uploadedAvatarUrl: string | null = null;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const avatar = await sharp(input, { failOn: "warning" })
      .rotate()
      .resize(512, 512, { fit: "cover", position: "attention" })
      .webp({ quality: 84 })
      .toBuffer();
    const upload = await writeRuntimeEmployeeAvatar({
      membershipId: membership.id,
      bytes: avatar,
    });
    uploadedAvatarUrl = upload.avatarUrl;
    const auditRequest = await getAuditRequestContext();

    await prisma.$transaction(async (transaction) => {
      await transaction.employeeBusinessMembership.update({
        where: { id: membership.id },
        data: { avatarUrl: upload.avatarUrl },
      });
      await writeAuditLog(
        {
          businessId,
          branchId: membership.branchAssignments[0]?.branchId ?? null,
          actor: user,
          action: "EMPLOYEE_AVATAR_UPDATED",
          entityType: "EmployeeBusinessMembership",
          entityId: membership.id,
          summary: `Updated profile photo for ${membership.fullName}`,
          before: { avatarUrl: membership.avatarUrl },
          after: { avatarUrl: upload.avatarUrl },
          request: auditRequest,
        },
        transaction,
      );
    });

    await deleteRuntimeEmployeeAvatarByUrl(membership.avatarUrl).catch((error) => {
      console.error("[employee-avatar] Unable to remove previous avatar.", error);
    });
    revalidatePath(`/team/people/${membership.id}`);

    return {
      status: "success",
      message: "Profile photo updated.",
      avatarUrl: upload.avatarUrl,
    };
  } catch (error) {
    if (uploadedAvatarUrl) {
      await deleteRuntimeEmployeeAvatarByUrl(uploadedAvatarUrl).catch(() => undefined);
    }
    console.error("[employee-avatar] Unable to update employee avatar.", error);
    return {
      status: "error",
      message: "We could not save this photo. Choose another image and try again.",
    };
  }
}
