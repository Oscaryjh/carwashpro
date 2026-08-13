"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { applyManagerAttendanceResolution } from "@/lib/attendance/resolution-workflow-service";
import { resolveAttendanceP2Exception } from "@/lib/attendance/p2-service";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { parseBranchLocalDateTime } from "@/lib/attendance/work-date";
import { getAuditRequestContext } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";

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
    revalidatePath("/team/approvals");
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

export async function decideAttendanceP2ResolutionAction(formData: FormData) {
  try {
    const { access, user, businessId } = await requireBusinessUser("MODIFY_ATTENDANCE_EMPLOYEES");
    const scope = await resolveAttendanceScope(access);
    const request = await getAuditRequestContext();
    const exceptionId = String(formData.get("exceptionId") ?? "");
    const issue = await prisma.attendanceP2Exception.findFirst({
      where: { id: exceptionId, businessId, branchId: { in: [...scope.allowedBranchIds] } },
      select: { branchId: true },
    });
    if (!issue) throw new Error("Attendance P2 exception was not found in the authorized scope.");
    const branch = await prisma.branch.findFirst({
      where: { id: issue.branchId, businessId },
      select: { attendanceSetting: { select: { timezone: true } } },
    });
    const timezone = branch?.attendanceSetting?.timezone ?? "Asia/Kuala_Lumpur";
    await resolveAttendanceP2Exception({
      context: { businessId, allowedBranchIds: scope.allowedBranchIds, actor: user, request },
      input: {
        exceptionId,
        expectedRevision: Number(formData.get("expectedRevision")),
        type: formData.get("resolutionType"),
        reason: formData.get("reason"),
        correctedClockInAt: parseOptionalBranchDate(formData.get("correctedClockInAt"), timezone),
        correctedClockOutAt: parseOptionalBranchDate(formData.get("correctedClockOutAt"), timezone),
        correctedBreakMinutes: parseOptionalNumber(formData.get("correctedBreakMinutes")),
      },
    });
    revalidatePath("/team/attendance");
    revalidatePath("/team/approvals");
    revalidatePath("/team/attendance/resolutions");
    revalidatePath("/team/attendance/timesheets");
    redirectWithMessage("success", "Attendance P2 exception resolved.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("error", error instanceof Error ? error.message : "Unable to resolve Attendance P2 exception.");
  }
}

function parseOptionalBranchDate(value: FormDataEntryValue | null, timezone: string) {
  const text = String(value ?? "").trim();
  return text ? parseBranchLocalDateTime(text, timezone) : null;
}

function parseOptionalNumber(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text ? Number(text) : null;
}

function redirectWithMessage(type: "success" | "error", message: string): never {
  redirect(
    `/team/attendance/resolutions?type=${type}&message=${encodeURIComponent(message)}`,
  );
}
