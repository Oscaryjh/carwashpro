"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import {
  cancelApprovedLeaveRequest,
  createCompanyLeavePolicy,
  createCompanyLeavePolicyVersion,
  deactivateCompanyLeavePolicy,
  generateLeaveEntitlementsForYear,
  installCompanyLeaveStarter,
  processDueCarryForwardExpiries,
  processDueLeavePeriodRollovers,
  reviewLeaveRequest,
  upsertEmployeeLeaveBalance,
} from "@/lib/leave/service";
import { reviewLeaveDocument } from "@/lib/leave/document-service";
import {
  installSabahStatutoryRulePackDraft,
  markStatutoryRuleSetReadyForHumanSignOff,
  submitStatutoryRuleSetForReview,
} from "@/lib/leave/statutory-service";

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
        statutoryCategory: formData.get("statutoryCategory"),
        entitlementPeriodType: formData.get("entitlementPeriodType") || "CALENDAR_YEAR",
        customYearStartMonth: formData.get("customYearStartMonth"),
        customYearStartDay: formData.get("customYearStartDay"),
        prorationMethod: formData.get("prorationMethod") || "NONE",
        entitlementRounding: formData.get("entitlementRounding") || "NONE",
        eligibleEmploymentTypes: formData.getAll("eligibleEmploymentTypes"),
        carryForwardEnabled: formData.get("carryForwardEnabled") === "on",
        carryForwardLimitUnits: formData.get("carryForwardLimitUnits"),
        carryForwardExpiryRule: formData.get("carryForwardExpiryRule") || "NO_EXPIRY",
        carryForwardExpiryValue: formData.get("carryForwardExpiryValue"),
        consumptionPriority: formData.get("consumptionPriority") || "EARLIEST_EXPIRY_FIRST",
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

export async function deactivateLeavePolicyAction(formData: FormData) {
  const year = String(formData.get("year") ?? "");
  try {
    const { user, businessId } = await requireBusinessUser("EDIT_LEAVE_POLICY");
    await deactivateCompanyLeavePolicy({
      businessId,
      policyId: String(formData.get("policyId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      actor: user,
      request: await getAuditRequestContext(),
    });
    revalidateLeavePaths();
    redirectWithMessage("success", "Leave type deactivated. Past requests and balance history were kept.", { year });
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("error", error instanceof Error ? error.message : "Unable to deactivate Leave type.", { year });
  }
}

export async function submitStatutoryRuleSetAction(formData: FormData) {
  const year = String(formData.get("year") ?? "");
  try {
    const { user, businessId } = await requireBusinessUser("EDIT_LEAVE_POLICY");
    await submitStatutoryRuleSetForReview({
      businessId,
      actor: user,
      request: await getAuditRequestContext(),
      rawInput: { ruleSetId: formData.get("ruleSetId"), expectedStatus: "DRAFT" },
    });
    revalidateLeavePaths();
    redirectWithMessage("success", "Rule pack is ready for independent review.", { year });
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("error", error instanceof Error ? error.message : "Unable to submit rule pack.", { year });
  }
}

export async function installSabahStatutoryRulePackDraftAction(formData: FormData) {
  const year = String(formData.get("year") ?? "");
  try {
    const { user, businessId } = await requireBusinessUser("EDIT_LEAVE_POLICY");
    await installSabahStatutoryRulePackDraft({
      businessId,
      actor: user,
      request: await getAuditRequestContext(),
    });
    revalidateLeavePaths();
    redirectWithMessage("success", "Official Sabah statutory rule pack installed as Draft. No legal rule was activated.", { year });
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("error", error instanceof Error ? error.message : "Unable to install Sabah statutory rule pack.", { year });
  }
}

export async function markStatutoryRuleSetReadyForHumanSignOffAction(formData: FormData) {
  const year = String(formData.get("year") ?? "");
  try {
    const { user, businessId } = await requireBusinessUser("EDIT_LEAVE_POLICY");
    await markStatutoryRuleSetReadyForHumanSignOff({
      businessId,
      actor: user,
      request: await getAuditRequestContext(),
      rawInput: {
        ruleSetId: formData.get("ruleSetId"),
        expectedStatus: "READY_FOR_REVIEW",
        reviewNote: formData.get("reviewNote"),
        confirmed: formData.get("confirmed") === "on",
      },
    });
    revalidateLeavePaths();
    redirectWithMessage("success", "Independent review complete. The rule pack now awaits explicit human sign-off; it is not active.", { year });
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("error", error instanceof Error ? error.message : "Unable to complete independent review.", { year });
  }
}

export async function generateLeaveEntitlementsAction(formData: FormData) {
  const year = Number(formData.get("year"));
  try {
    const { user, businessId } = await requireBusinessUser("EDIT_LEAVE_POLICY");
    const result = await generateLeaveEntitlementsForYear({ businessId, actor: user, request: await getAuditRequestContext(), year });
    revalidateLeavePaths();
    redirectWithMessage("success", `Entitlement run complete: ${result.created} created, ${result.unchanged} unchanged, ${result.reviewRequired.length} need review.`, { year: String(year) });
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("error", error instanceof Error ? error.message : "Unable to generate entitlements.", { year: String(year) });
  }
}

export async function processLeaveLifecycleAction(formData: FormData) {
  const year = String(formData.get("year") ?? "");
  try {
    const { user, businessId } = await requireBusinessUser("EDIT_LEAVE_POLICY");
    const rawAsOf = String(formData.get("asOf") ?? "");
    const asOf = /^\d{4}-\d{2}-\d{2}$/.test(rawAsOf)
      ? new Date(`${rawAsOf}T00:00:00.000Z`)
      : new Date();
    const request = await getAuditRequestContext();
    const rollover = await processDueLeavePeriodRollovers({ businessId, actor: user, request, asOf });
    const expiry = await processDueCarryForwardExpiries({ businessId, actor: user, request, asOf });
    revalidateLeavePaths();
    redirectWithMessage(
      "success",
      `Leave lifecycle checked: ${rollover.created} rollover(s), ${expiry.expiredBuckets} expired carry-forward bucket(s), ${rollover.reviewRequired.length} item(s) need review.`,
      { year },
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("error", error instanceof Error ? error.message : "Unable to process Leave lifecycle.", { year });
  }
}

export async function createLeavePolicyAction(formData: FormData) {
  const year = String(formData.get("year") ?? "");
  const balanceEmployee = String(formData.get("membershipId") ?? "");
  const returnTarget =
    formData.get("returnTarget") === "employee-profile"
      ? "employee-profile"
      : "leave-management";
  try {
    const { user, businessId } = await requireBusinessUser("EDIT_LEAVE_POLICY");
    await createCompanyLeavePolicy({
      businessId,
      actor: user,
      request: await getAuditRequestContext(),
      rawInput: {
        effectiveFrom: formData.get("effectiveFrom"),
        name: formData.get("name"),
        payTreatment: formData.get("payTreatment"),
        countMode: formData.get("countMode"),
        balanceTracked: formData.get("allowanceMode") === "FIXED" || formData.get("balanceTracked") === "on",
        defaultEntitlementDays: formData.get("defaultEntitlementDays"),
        requiresDocument: formData.get("requiresDocument") === "on",
        allowNegativeBalance: formData.get("allowNegativeBalance") === "on",
        reason: formData.get("reason") || "New company Leave type created.",
      },
    });
    revalidateLeavePaths();
    if (returnTarget === "employee-profile" && isUuid(balanceEmployee)) {
      revalidatePath(`/team/people/${balanceEmployee}`);
    }
    redirectLeavePolicyMessage(
      "success",
      "New Leave type created. It is now available in employee Leave Management.",
      { balanceEmployee, returnTarget, year },
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectLeavePolicyMessage(
      "error",
      error instanceof Error ? error.message : "Unable to create Leave type.",
      { balanceEmployee, returnTarget, year, reopenCreate: true },
    );
  }
}

export async function reviewLeaveRequestAction(formData: FormData) {
  try {
    const { access, user, businessId } = await requireBusinessUser("APPROVE_LEAVE");
    const scope = await resolveAttendanceScope(access);
    const decision = String(formData.get("decision") ?? "");
    const result = await reviewLeaveRequest({
      businessId,
      allowedBranchIds: scope.allowedBranchIds,
      actor: user,
      actorLevel: access.effectiveBusinessRole === "BUSINESS_OWNER" ? "OWNER" : "MANAGER",
      request: await getAuditRequestContext(),
      rawInput: {
        requestId: formData.get("requestId"),
        expectedRevision: formData.get("expectedRevision"),
        decision,
        reviewNote: formData.get("reviewNote"),
      },
    });
    revalidateLeavePaths();
    redirectWithMessage(
      "success",
      !result.finalized
        ? "第一级审批已完成，申请已转交老板作最终审批。"
        : decision === "APPROVED"
          ? "Leave approved using its frozen treatment."
          : "Leave rejected.",
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("error", error instanceof Error ? error.message : "Unable to review Leave.");
  }
}

export async function reviewLeaveDocumentAction(formData: FormData) {
  try {
    const { access, user, businessId } = await requireBusinessUser("APPROVE_LEAVE");
    const scope = await resolveAttendanceScope(access);
    const status = String(formData.get("status") ?? "");
    if (!(["VERIFIED", "REJECTED", "REVIEW_REQUIRED"] as const).includes(status as "VERIFIED" | "REJECTED" | "REVIEW_REQUIRED")) {
      throw new Error("Choose a valid supporting-document review result.");
    }
    await reviewLeaveDocument({
      documentId: String(formData.get("documentId") ?? ""),
      businessId,
      allowedBranchIds: scope.allowedBranchIds,
      actor: user,
      request: await getAuditRequestContext(),
      status: status as "VERIFIED" | "REJECTED" | "REVIEW_REQUIRED",
      note: String(formData.get("note") ?? ""),
    });
    revalidateLeavePaths();
    redirectWithMessage("success", status === "VERIFIED" ? "Supporting document verified." : "Supporting document review updated.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("error", error instanceof Error ? error.message : "Unable to review supporting document.");
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
  const year = String(formData.get("year") ?? "");
  const balanceEmployee = String(formData.get("membershipId") ?? "");
  const returnTarget = formData.get("returnTarget") === "employee-profile"
    ? "employee-profile"
    : "leave-management";
  try {
    const { access, user, businessId } = await requireBusinessUser("ADJUST_LEAVE_BALANCE");
    const scope = await resolveAttendanceScope(access);
    const days = formData.get("days");
    const direction = String(formData.get("direction") ?? "");
    const legacyUnits = formData.get("units");
    const units = legacyUnits ?? (
      direction === "DEDUCT"
        ? -Math.abs(Number(days))
        : direction === "ADD"
          ? Math.abs(Number(days))
          : days
    );
    const adjustmentReason = String(formData.get("reason") ?? "").trim();
    await upsertEmployeeLeaveBalance({
      businessId,
      allowedBranchIds: scope.allowedBranchIds,
      actor: user,
      request: await getAuditRequestContext(),
      rawInput: {
        membershipId: formData.get("membershipId"),
        policyId: formData.get("policyId"),
        year: formData.get("year"),
        units,
        reason: adjustmentReason,
        sourceKey: formData.get("sourceKey"),
      },
    });
    revalidateLeavePaths();
    if (returnTarget === "employee-profile" && isUuid(balanceEmployee)) {
      revalidatePath(`/team/people/${balanceEmployee}`);
    }
    redirectLeaveBalanceMessage(
      "success",
      "Leave balance updated. The change was added to the audit history.",
      { balanceEmployee, returnTarget, year },
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectLeaveBalanceMessage(
      "error",
      error instanceof Error ? error.message : "Unable to adjust Leave balance.",
      { balanceEmployee, returnTarget, year },
    );
  }
}

function revalidateLeavePaths() {
  revalidatePath("/team");
  revalidatePath("/team/approvals");
  revalidatePath("/team/leave");
  revalidatePath("/staff/leave");
  revalidatePath("/team/attendance");
  revalidatePath("/team/payroll/workspace");
  revalidatePath("/team/payroll/runs");
}

function redirectWithMessage(
  type: "success" | "error",
  message: string,
  context?: { year?: string; balanceEmployee?: string; newLeaveType?: boolean },
): never {
  const query = new URLSearchParams({ type, message });
  if (/^\d{4}$/.test(context?.year ?? "")) query.set("year", context!.year!);
  if (/^[0-9a-f-]{36}$/i.test(context?.balanceEmployee ?? "")) query.set("balanceEmployee", context!.balanceEmployee!);
  if (context?.newLeaveType) query.set("newLeaveType", "1");
  redirect(`/team/leave?${query.toString()}`);
}

function redirectLeaveBalanceMessage(
  type: "success" | "error",
  message: string,
  context: {
    balanceEmployee: string;
    returnTarget: "employee-profile" | "leave-management";
    year: string;
  },
): never {
  if (
    context.returnTarget === "employee-profile" &&
    isUuid(context.balanceEmployee)
  ) {
    const query = new URLSearchParams({
      manageLeave: "1",
      message,
      section: "leave",
      type,
    });
    redirect(`/team/people/${context.balanceEmployee}?${query.toString()}`);
  }

  redirectWithMessage(type, message, {
    balanceEmployee: context.balanceEmployee,
    year: context.year,
  });
}

function redirectLeavePolicyMessage(
  type: "success" | "error",
  message: string,
  context: {
    balanceEmployee: string;
    reopenCreate?: boolean;
    returnTarget: "employee-profile" | "leave-management";
    year: string;
  },
): never {
  if (
    context.returnTarget === "employee-profile" &&
    isUuid(context.balanceEmployee)
  ) {
    const query = new URLSearchParams({
      manageLeave: "1",
      message,
      section: "leave",
      type,
    });
    if (context.reopenCreate) query.set("newLeaveType", "1");
    redirect(`/team/people/${context.balanceEmployee}?${query.toString()}`);
  }

  redirectWithMessage(type, message, {
    newLeaveType: context.reopenCreate,
    year: context.year,
  });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
