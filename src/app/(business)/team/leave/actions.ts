"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { installPeninsularLabuanLeavePreset, reviewLeaveRequest, upsertEmployeeLeaveBalance } from "@/lib/leave/service";

export async function installLeavePresetAction() {
  try {
    const { user, businessId } = await requireBusinessUser("MODIFY_ATTENDANCE_EMPLOYEES");
    await installPeninsularLabuanLeavePreset(businessId);
    await writeAuditLog({ businessId, actor: user, request: await getAuditRequestContext(), action: "LEAVE_POLICY_PRESET_INSTALLED", entityType: "LeavePolicy", summary: "Peninsular Malaysia/Labuan leave template installed." });
    revalidateLeavePaths();
    redirectWithMessage("success", "Leave policies installed. Review them before accepting requests.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("error", error instanceof Error ? error.message : "Unable to install leave policies.");
  }
}

export async function reviewLeaveRequestAction(formData: FormData) {
  try {
    const { access, user, businessId } = await requireBusinessUser("MODIFY_ATTENDANCE_EMPLOYEES");
    const scope = await resolveAttendanceScope(access);
    const decision = String(formData.get("decision") ?? "");
    await reviewLeaveRequest({
      businessId,
      allowedBranchIds: scope.allowedBranchIds,
      actor: user,
      request: await getAuditRequestContext(),
      rawInput: { requestId: formData.get("requestId"), decision, reviewNote: formData.get("reviewNote") },
    });
    revalidateLeavePaths();
    redirectWithMessage("success", decision === "APPROVED" ? "Leave approved." : "Leave rejected.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("error", error instanceof Error ? error.message : "Unable to review leave.");
  }
}

export async function updateLeaveBalanceAction(formData: FormData) {
  try {
    const { access, user, businessId } = await requireBusinessUser("MODIFY_ATTENDANCE_EMPLOYEES");
    const scope = await resolveAttendanceScope(access);
    await upsertEmployeeLeaveBalance({
      businessId,
      allowedBranchIds: scope.allowedBranchIds,
      actor: user,
      request: await getAuditRequestContext(),
      rawInput: {
        membershipId: formData.get("membershipId"),
        policyId: formData.get("policyId"),
        year: formData.get("year"),
        entitlementOverrideDays: formData.get("entitlementOverrideDays"),
        carriedForwardDays: formData.get("carriedForwardDays"),
        adjustmentDays: formData.get("adjustmentDays"),
        note: formData.get("note"),
      },
    });
    revalidateLeavePaths();
    redirectWithMessage("success", "Employee leave balance saved.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("error", error instanceof Error ? error.message : "Unable to save leave balance.");
  }
}

function revalidateLeavePaths() {
  revalidatePath("/team");
  revalidatePath("/team/leave");
  revalidatePath("/team/attendance");
  revalidatePath("/team/payroll/workspace");
  revalidatePath("/team/payroll/runs");
}

function redirectWithMessage(type: "success" | "error", message: string): never {
  redirect(`/team/leave?type=${type}&message=${encodeURIComponent(message)}`);
}
