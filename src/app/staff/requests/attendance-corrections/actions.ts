"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { getAuditRequestContext } from "@/lib/audit";
import { reviewStaffAttendanceCorrection } from "@/lib/staff-pwa/team-approvals";

export async function reviewMobileAttendanceCorrectionAction(formData: FormData) {
  try {
    const action = String(formData.get("action") ?? "");
    if (action !== "APPLY_CORRECTION" && action !== "RETURN_TO_EMPLOYEE") {
      throw new Error("Choose an attendance correction decision.");
    }
    const auth = await requireEmployeeSelfServiceAuthContext();
    const breakValue = String(formData.get("correctedBreakMinutes") ?? "").trim();
    await reviewStaffAttendanceCorrection({
      auth,
      resolutionCaseId: String(formData.get("resolutionCaseId") ?? ""),
      action,
      reason: String(formData.get("reason") ?? "").trim(),
      correctedClockInLocal: String(formData.get("correctedClockInLocal") ?? "").trim() || null,
      correctedClockOutLocal: String(formData.get("correctedClockOutLocal") ?? "").trim() || null,
      correctedBreakMinutes: breakValue ? Number(breakValue) : null,
      expectedUpdatedAt: String(formData.get("expectedUpdatedAt") ?? ""),
      expectedCurrentResultId: String(formData.get("expectedCurrentResultId") ?? "").trim() || null,
      request: await getAuditRequestContext(),
    });
    revalidatePath("/staff/requests");
    revalidatePath("/staff/requests/attendance-corrections");
    complete(action === "APPLY_CORRECTION"
      ? "Attendance correction approved."
      : "Attendance correction returned to the employee.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    failed(error);
  }
}

function complete(message: string): never {
  redirect(`/staff/requests/attendance-corrections?type=success&message=${encodeURIComponent(message)}`);
}

function failed(error: unknown): never {
  const technicalMessage = error instanceof Error ? error.message : "";
  let message = "This attendance correction could not be saved. Refresh the queue and try again.";
  if (/permission|authorized branch scope|not ready/i.test(technicalMessage)) {
    message = "This request is no longer available in your approval scope.";
  } else if (/own Attendance|SELF_RESOLUTION/i.test(technicalMessage)) {
    message = "You cannot review your own attendance correction.";
  } else if (/changed|Reload before deciding|CONCURRENT_CHANGE/i.test(technicalMessage)) {
    message = "This request changed after you opened it. Refresh and review the latest details.";
  } else if (/reason|at least 3 characters/i.test(technicalMessage)) {
    message = "Add a short decision note before continuing.";
  } else if (/clock-in|clock-out|break minutes|correction/i.test(technicalMessage)) {
    message = "Check the corrected clock-in, clock-out and break minutes.";
  }
  redirect(`/staff/requests/attendance-corrections?type=error&message=${encodeURIComponent(message)}`);
}
