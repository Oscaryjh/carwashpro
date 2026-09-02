"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { AttendanceOvertimeError } from "@/lib/attendance/overtime-service";
import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { getAuditRequestContext } from "@/lib/audit";
import { decideStaffOvertime } from "@/lib/staff-pwa/overtime-approvals";

export async function decideMobileOvertimeAction(formData: FormData) {
  const finalResultId = String(formData.get("finalResultId") ?? "");
  const month = String(formData.get("month") ?? "");
  try {
    const auth = await requireEmployeeSelfServiceAuthContext();
    const decision = decisionValue(formData);
    const rawMinutes = String(formData.get("approvedMinutes") ?? "").trim();
    const reason = String(formData.get("reason") ?? "").trim();
    await decideStaffOvertime({
      auth,
      finalResultId,
      expectedRevision: Number(formData.get("expectedRevision") ?? 0),
      decision,
      approvedMinutes: rawMinutes ? Number(rawMinutes) : undefined,
      reason,
      request: await getAuditRequestContext(),
    });
    revalidatePath("/staff/requests/overtime");
    revalidatePath("/staff/timesheet");
    const notice = decision === "REJECT"
      ? "Potential overtime rejected."
      : decision === "ADJUST"
        ? "Adjusted overtime approved."
        : "Overtime approved in full.";
    redirect(`/staff/requests/overtime?month=${encodeURIComponent(month)}&type=success&message=${encodeURIComponent(notice)}`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(`/staff/requests/overtime/${encodeURIComponent(finalResultId)}?type=error&message=${encodeURIComponent(overtimeErrorMessage(error))}`);
  }
}

function decisionValue(formData: FormData) {
  const value = String(formData.get("decision") ?? "");
  if (value !== "APPROVE" && value !== "ADJUST" && value !== "REJECT") {
    throw new Error("Choose an overtime decision.");
  }
  return value;
}

function overtimeErrorMessage(error: unknown) {
  if (error instanceof AttendanceOvertimeError) {
    switch (error.code) {
      case "TIMESHEET_LOCKED":
        return "This monthly Timesheet is locked. Reopen it before changing overtime.";
      case "SELF_APPROVAL_NOT_ALLOWED":
        return "You cannot approve your own overtime.";
      case "OUTSIDE_BRANCH_SCOPE":
        return "This employee is outside your authorized branch scope.";
      case "CONCURRENT_CHANGE":
        return "This overtime review changed after you opened it. Reload and review the latest version.";
      case "LEAVE_ATTENDANCE_CONFLICT":
        return "Resolve the Leave and Attendance conflict before reviewing overtime.";
      case "INVALID_APPROVED_MINUTES":
        return "Enter valid approved minutes and a reason for an adjustment or rejection.";
      case "CANDIDATE_NOT_FOUND":
        return "This overtime item is no longer available from the latest Attendance result.";
    }
  }
  const message = error instanceof Error ? error.message : "";
  if (/permission/i.test(message)) return "You no longer have permission to review overtime.";
  if (/Choose an overtime decision/i.test(message)) return message;
  return "The overtime decision could not be saved. Reload and try again.";
}
