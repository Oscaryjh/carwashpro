"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import {
  cancelApprovedLeaveRequest,
  createCompanyLeavePolicyVersion,
  installCompanyLeaveStarter,
  reviewLeaveRequest,
  upsertEmployeeLeaveBalance,
} from "@/lib/leave/service";

export async function installLeaveStarterAction() {
  try {
    const { user, businessId } = await requireBusinessUser("EDIT_LEAVE_POLICY");
    await installCompanyLeaveStarter(businessId, user.userId);
    await writeAuditLog({ businessId, actor: user, request: await getAuditRequestContext(), action: "LEAVE_COMPANY_STARTER_INSTALLED", entityType: "LeavePolicy", summary: "Company-only Leave starters installed without asserting statutory minimums." });
    revalidateLeavePaths();
    redirectWithMessage("success", "Company Leave starters installed. Configure entitlement revisions before approval.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("error", error instanceof Error ? error.message : "Unable to install Leave starters.");
  }
}

export async function createLeavePolicyVersionAction(formData: FormData) {
  try {
    const { user, businessId } = await requireBusinessUser("EDIT_LEAVE_POLICY");
    await createCompanyLeavePolicyVersion({
      businessId,
      actor: user,
      request: await getAuditRequestContext(),
      rawInput: {
        policyId: formData.get("policyId"),
        effectiveFrom: formData.get("effectiveFrom"),
        name: formData.get("name"),
        payTreatment: formData.get("payTreatment"),
        countMode: formData.get("countMode"),
        balanceTracked: formData.get("balanceTracked") === "on",
        defaultEntitlementDays: formData.get("defaultEntitlementDays"),
        underTwoYearsDays: formData.get("underTwoYearsDays"),
        twoToFiveYearsDays: formData.get("twoToFiveYearsDays"),
        fiveYearsPlusDays: formData.get("fiveYearsPlusDays"),
        requiresDocument: formData.get("requiresDocument") === "on",
        allowNegativeBalance: formData.get("allowNegativeBalance") === "on",
        reason: formData.get("reason"),
      },
    });
    revalidateLeavePaths();
    redirectWithMessage("success", "New immutable company Leave policy revision created.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("error", error instanceof Error ? error.message : "Unable to create Leave policy revision.");
  }
}

export async function reviewLeaveRequestAction(formData: FormData) {
  try {
    const { access, user, businessId } = await requireBusinessUser("APPROVE_LEAVE");
    const scope = await resolveAttendanceScope(access);
    const decision = String(formData.get("decision") ?? "");
    await reviewLeaveRequest({
      businessId,
      allowedBranchIds: scope.allowedBranchIds,
      actor: user,
      request: await getAuditRequestContext(),
      rawInput: {
        requestId: formData.get("requestId"),
        expectedRevision: formData.get("expectedRevision"),
        decision,
        reviewNote: formData.get("reviewNote"),
      },
    });
    revalidateLeavePaths();
    redirectWithMessage("success", decision === "APPROVED" ? "Leave approved using its frozen treatment." : "Leave rejected.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("error", error instanceof Error ? error.message : "Unable to review Leave.");
  }
}

export async function cancelApprovedLeaveAction(formData: FormData) {
  try {
    const { access, user, businessId } = await requireBusinessUser("APPROVE_LEAVE");
    const scope = await resolveAttendanceScope(access);
    await cancelApprovedLeaveRequest({
      businessId,
      allowedBranchIds: scope.allowedBranchIds,
      actor: user,
      request: await getAuditRequestContext(),
      rawInput: { requestId: formData.get("requestId"), expectedRevision: formData.get("expectedRevision"), reason: formData.get("reason") },
    });
    revalidateLeavePaths();
    redirectWithMessage("success", "Approved Leave cancelled; any tracked balance was restored exactly once.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("error", error instanceof Error ? error.message : "Unable to cancel approved Leave.");
  }
}

export async function updateLeaveBalanceAction(formData: FormData) {
  try {
    const { access, user, businessId } = await requireBusinessUser("ADJUST_LEAVE_BALANCE");
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
        units: formData.get("units"),
        reason: formData.get("reason"),
        sourceKey: formData.get("sourceKey"),
      },
    });
    revalidateLeavePaths();
    redirectWithMessage("success", "Immutable Leave balance adjustment appended.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("error", error instanceof Error ? error.message : "Unable to adjust Leave balance.");
  }
}

function revalidateLeavePaths() {
  revalidatePath("/team");
  revalidatePath("/team/leave");
  revalidatePath("/staff/leave");
  revalidatePath("/team/attendance");
  revalidatePath("/team/payroll/workspace");
  revalidatePath("/team/payroll/runs");
}

function redirectWithMessage(type: "success" | "error", message: string): never {
  redirect(`/team/leave?type=${type}&message=${encodeURIComponent(message)}`);
}
