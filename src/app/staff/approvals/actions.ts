"use server";

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { getAuditRequestContext } from "@/lib/audit";
import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { reviewStaffClaim, reviewStaffLeave } from "@/lib/staff-pwa/team-approvals";

export async function reviewMobileLeaveAction(formData: FormData) {
  try {
    const auth = await requireEmployeeSelfServiceAuthContext();
    const decision = decisionValue(formData);
    await reviewStaffLeave({
      auth,
      requestId: String(formData.get("requestId") ?? ""),
      expectedRevision: Number(formData.get("expectedRevision")),
      decision,
      reviewNote: String(formData.get("reason") ?? "").trim() || null,
      request: await getAuditRequestContext(),
    });
    complete("Leave decision saved.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    failed(error);
  }
}

export async function reviewMobileClaimAction(formData: FormData) {
  try {
    const auth = await requireEmployeeSelfServiceAuthContext();
    const decision = decisionValue(formData);
    await reviewStaffClaim({
      auth,
      claimId: String(formData.get("claimId") ?? ""),
      expectedRevision: Number(formData.get("expectedRevision")),
      decision,
      reason: String(formData.get("reason") ?? "").trim() || null,
      request: await getAuditRequestContext(),
    });
    complete("Claim decision saved. Payment remains a separate step.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    failed(error);
  }
}

function decisionValue(formData: FormData) {
  const value = String(formData.get("decision") ?? "");
  if (value !== "APPROVED" && value !== "REJECTED") throw new Error("Choose Approve or Reject.");
  return value;
}

function complete(message: string) {
  redirect(`/staff/approvals?type=success&message=${encodeURIComponent(message)}`);
}

function failed(error: unknown) {
  const message = approvalErrorMessage(error);
  redirect(`/staff/approvals?type=error&message=${encodeURIComponent(message)}`);
}

function approvalErrorMessage(error: unknown) {
  const technicalMessage = error instanceof Error ? error.message.trim() : "";

  if (/permission|authorized scope/i.test(technicalMessage)) {
    return "You no longer have access to review this request.";
  }
  if (/own (Leave application|Claims?)/i.test(technicalMessage)) {
    return "You cannot review your own request.";
  }
  if (/supporting document/i.test(technicalMessage)) {
    return "Required supporting documents must be verified before approval.";
  }
  if (/rejection requires a reason|Partial approval or rejection requires a reason/i.test(technicalMessage)) {
    return "Enter a reason before rejecting this request.";
  }
  if (/changed|updated|concurrently|no longer available|unavailable/i.test(technicalMessage)) {
    return "This request changed after you opened it. Refresh the inbox and review it again.";
  }
  if (/Insufficient leave balance/i.test(technicalMessage)) {
    return technicalMessage;
  }
  if (/Choose Approve or Reject/i.test(technicalMessage)) {
    return "Choose Approve or Reject.";
  }

  return "This approval could not be saved. Refresh the inbox and try again.";
}
