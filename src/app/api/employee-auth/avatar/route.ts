import { revalidatePath } from "next/cache";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { EmployeeAuthError } from "@/lib/attendance/employee-auth/errors";
import { assertEmployeeAuthSameOrigin } from "@/lib/attendance/employee-auth/http";
import { employeeAuthErrorResponse, employeeAuthJson } from "@/lib/attendance/employee-auth/response";
import {
  AvatarImageValidationError,
  EMPLOYEE_AVATAR_CONTENT_TYPES,
  processEmployeeAvatarImage,
} from "@/lib/employee-avatar-image";
import { prisma } from "@/lib/prisma";
import { deleteRuntimeEmployeeAvatarByUrl, writeRuntimeEmployeeAvatar } from "@/lib/runtime-employee-avatar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedAvatarTypes = new Set<string>(EMPLOYEE_AVATAR_CONTENT_TYPES);
const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  let uploadedAvatarUrl: string | null = null;
  let avatarPersisted = false;
  try {
    assertEmployeeAuthSameOrigin(request);
    const auth = await requireEmployeeSelfServiceAuthContext(request);
    const form = await request.formData();
    const file = form.get("avatar");
    if (!(file instanceof File) || file.size === 0) {
      throw invalidAvatar("Choose a photo before saving.");
    }
    if (!allowedAvatarTypes.has(file.type)) {
      throw invalidAvatar("Use a photo from your camera or photo library.");
    }
    if (file.size > MAX_AVATAR_BYTES) {
      throw invalidAvatar("Choose a photo smaller than 10 MB.");
    }

    const membership = await prisma.employeeBusinessMembership.findFirst({
      where: {
        id: auth.membershipId,
        employeeAccountId: auth.employeeAccountId,
        businessId: auth.businessId,
        status: "ACTIVE",
      },
      select: { avatarUrl: true, fullName: true, id: true },
    });
    if (!membership) throw new EmployeeAuthError("MEMBERSHIP_INACTIVE");

    const input = Buffer.from(await file.arrayBuffer());
    let bytes: Buffer;
    try {
      bytes = await processEmployeeAvatarImage({
        input,
        contentType: file.type,
        maxBytes: MAX_AVATAR_BYTES,
      });
    } catch (error) {
      if (error instanceof AvatarImageValidationError && error.code === "TOO_LARGE") {
        throw invalidAvatar("Choose a photo smaller than 10 MB.");
      }
      throw invalidAvatar("This photo could not be processed. Choose another photo.");
    }
    const upload = await writeRuntimeEmployeeAvatar({
      membershipId: membership.id,
      bytes,
    });
    uploadedAvatarUrl = upload.avatarUrl;
    const auditRequest = await getAuditRequestContext();

    await prisma.$transaction(async (transaction) => {
      const updated = await transaction.employeeBusinessMembership.updateMany({
        where: {
          id: membership.id,
          employeeAccountId: auth.employeeAccountId,
          businessId: auth.businessId,
          status: "ACTIVE",
        },
        data: { avatarUrl: upload.avatarUrl },
      });
      if (updated.count !== 1) throw new EmployeeAuthError("MEMBERSHIP_INACTIVE");

      await writeAuditLog({
        businessId: auth.businessId,
        branchId: auth.primaryBranchId,
        action: "EMPLOYEE_SELF_AVATAR_UPDATED",
        entityType: "EmployeeBusinessMembership",
        entityId: membership.id,
        summary: "Employee updated their Staff App profile photo",
        before: { avatarUrl: membership.avatarUrl },
        after: { avatarUrl: upload.avatarUrl },
        metadata: { deviceId: auth.deviceId, sessionId: auth.sessionId },
        request: auditRequest,
      }, transaction);
    });
    avatarPersisted = true;

    await deleteRuntimeEmployeeAvatarByUrl(membership.avatarUrl).catch((error) => {
      console.error("[staff-avatar] Unable to remove previous avatar.", error);
    });
    revalidatePath("/staff");
    revalidatePath("/staff/profile");
    return employeeAuthJson({ ok: true, avatarUrl: upload.avatarUrl });
  } catch (error) {
    if (uploadedAvatarUrl && !avatarPersisted) {
      await deleteRuntimeEmployeeAvatarByUrl(uploadedAvatarUrl).catch(() => undefined);
    }
    return employeeAuthErrorResponse(error);
  }
}

function invalidAvatar(message: string) {
  return new EmployeeAuthError("INVALID_REQUEST", message, {
    publicMessage: message,
    status: 400,
  });
}
