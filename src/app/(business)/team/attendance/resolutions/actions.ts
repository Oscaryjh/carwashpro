"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { applyManagerAttendanceResolution } from "@/lib/attendance/resolution-workflow-service";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { getAuditRequestContext } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";

export async function decideAttendanceResolutionAction(formData: FormData) {
  try {
    const { access, user, businessId } = await requireBusinessUser(
      "MODIFY_ATTENDANCE_EMPLOYEES",
    );
    const scope = await resolveAttendanceScope(access);
    const request = await getAuditRequestContext();
    const result = await applyManagerAttendanceResolution({
      context: {
        businessId,
        allowedBranchIds: scope.allowedBranchIds,
        actor: user,
        request,
      },
      input: {
        resolutionCaseId: formData.get("resolutionCaseId"),
        action: formData.get("action"),
        reason: formData.get("reason"),
        correctedClockInLocal: formData.get("correctedClockInLocal"),
        correctedClockOutLocal: formData.get("correctedClockOutLocal"),
        correctedBreakMinutes: formData.get("correctedBreakMinutes"),
        expectedUpdatedAt: formData.get("expectedUpdatedAt"),
        expectedCurrentResultId:
          String(formData.get("expectedCurrentResultId") ?? "") || null,
      },
    });
    revalidatePath("/team/attendance");
    revalidatePath("/team/attendance/resolutions");
    redirectWithMessage(
      "success",
      result.status === "RESOLVED"
        ? "Attendance Resolution Case resolved."
        : "Attendance Resolution Case returned to the employee.",
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage(
      "error",
      error instanceof Error
        ? error.message
        : "Unable to update the Attendance Resolution Case.",
    );
  }
}

function redirectWithMessage(type: "success" | "error", message: string): never {
  redirect(
    `/team/attendance/resolutions?type=${type}&message=${encodeURIComponent(message)}`,
  );
}
