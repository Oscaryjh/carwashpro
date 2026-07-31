"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { getAuditRequestContext } from "@/lib/audit";
import {
  adjustAttendanceSession,
  reviewAttendanceException,
} from "@/lib/attendance/management-service";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";

export async function reviewAttendanceExceptionAction(
  formData: FormData,
) {
  try {
    const { access, user, businessId } = await requireBusinessUser(
      "MODIFY_ATTENDANCE_EMPLOYEES",
    );
    const scope = await resolveAttendanceScope(access);
    const request = await getAuditRequestContext();
    const decision = String(formData.get("decision") ?? "");
    await reviewAttendanceException({
      businessId,
      allowedBranchIds: scope.allowedBranchIds,
      actor: user,
      request,
      input: {
        exceptionId: formData.get("exceptionId"),
        decision,
        reviewNote: formData.get("reviewNote"),
      },
    });
    revalidateAttendancePaths();
    redirectWithMessage(
      "success",
      decision === "APPROVED"
        ? "Attendance exception approved."
        : "Attendance exception rejected.",
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage(
      "error",
      error instanceof Error
        ? error.message
        : "Unable to review Attendance exception.",
    );
  }
}

export async function adjustAttendanceSessionAction(
  formData: FormData,
) {
  try {
    const { access, user, businessId } = await requireBusinessUser(
      "MODIFY_ATTENDANCE_EMPLOYEES",
    );
    const scope = await resolveAttendanceScope(access);
    const request = await getAuditRequestContext();
    await adjustAttendanceSession({
      businessId,
      allowedBranchIds: scope.allowedBranchIds,
      actor: user,
      request,
      input: {
        sessionId: formData.get("sessionId"),
        adjustedClockInLocal: formData.get("adjustedClockInLocal"),
        adjustedClockOutLocal: formData.get("adjustedClockOutLocal"),
        adjustedBreakMinutes: formData.get("adjustedBreakMinutes"),
        reason: formData.get("reason"),
        expectedUpdatedAt: formData.get("expectedUpdatedAt"),
      },
    });
    revalidateAttendancePaths();
    redirectWithMessage(
      "success",
      "Attendance session adjusted with an audit record.",
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage(
      "error",
      error instanceof Error
        ? error.message
        : "Unable to adjust Attendance session.",
    );
  }
}

function revalidateAttendancePaths() {
  revalidatePath("/team");
  revalidatePath("/team/attendance");
}

function redirectWithMessage(
  type: "success" | "error",
  message: string,
): never {
  redirect(
    `/team/attendance?type=${type}&message=${encodeURIComponent(
      message,
    )}`,
  );
}
