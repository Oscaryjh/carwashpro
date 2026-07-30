"use server";

import { randomUUID } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import { revalidatePath } from "next/cache";
import path from "path";
import { requireUser } from "@/lib/auth/session";
import { writeBusinessGroupAuditLog } from "@/lib/business-groups/audit";
import {
  GroupLogoValidationError,
  readValidatedGroupLogo,
} from "@/lib/business-groups/group-logo";
import { prisma } from "@/lib/prisma";

const GROUP_LOGO_UPLOAD_DIR = path.join(
  process.cwd(),
  "public",
  "uploads",
  "group-logos",
);
const GROUP_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type GroupLogoUploadState = {
  status: "idle" | "success" | "error";
  message: string;
  logoUrl?: string;
};

export async function updateGroupLogoAction(
  _previousState: GroupLogoUploadState,
  formData: FormData,
): Promise<GroupLogoUploadState> {
  const user = await requireUser();
  const groupId = formData.get("groupId")?.toString() ?? "";

  if (!GROUP_ID_PATTERN.test(groupId)) {
    return { status: "error", message: "Invalid business group." };
  }

  const grant = await prisma.businessGroupUser.findFirst({
    where: {
      groupId,
      userId: user.userId,
      role: "GROUP_OWNER",
      status: "ACTIVE",
      group: { status: "ACTIVE" },
    },
    select: {
      group: {
        select: {
          id: true,
          name: true,
          logoUrl: true,
        },
      },
    },
  });

  if (!grant) {
    return {
      status: "error",
      message: "Only the group owner can change this logo.",
    };
  }

  try {
    const logo = await readValidatedGroupLogo(formData.get("logo"));
    await mkdir(GROUP_LOGO_UPLOAD_DIR, { recursive: true });

    const filename = `${groupId}-${randomUUID()}.${logo.extension}`;
    const filePath = path.join(GROUP_LOGO_UPLOAD_DIR, filename);
    const logoUrl = `/uploads/group-logos/${filename}`;
    await writeFile(filePath, logo.buffer);

    try {
      await prisma.$transaction(async (tx) => {
        await tx.businessGroup.update({
          where: { id: groupId },
          data: { logoUrl },
        });
        await writeBusinessGroupAuditLog(
          {
            groupId,
            actor: user,
            action: "BUSINESS_GROUP_LOGO_UPDATED",
            entityType: "BusinessGroup",
            entityId: groupId,
            summary: `Updated logo for ${grant.group.name}`,
            before: { logoUrl: grant.group.logoUrl },
            after: { logoUrl },
            metadata: {
              mimeType: logo.mimeType,
              sizeBytes: logo.sizeBytes,
            },
          },
          tx,
        );
      });
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }

    revalidatePath(`/groups/${groupId}`, "layout");
    revalidatePath(`/groups/${groupId}/overview`);
    revalidatePath(`/groups/${groupId}/reports`);
    revalidatePath(`/groups/${groupId}/closing`);

    return {
      status: "success",
      message: "Group logo updated.",
      logoUrl,
    };
  } catch (error) {
    if (error instanceof GroupLogoValidationError) {
      return { status: "error", message: error.message };
    }

    console.error("[business-group-logo] Unable to update group logo.", error);
    return {
      status: "error",
      message: "Unable to update the group logo. Please try again.",
    };
  }
}
