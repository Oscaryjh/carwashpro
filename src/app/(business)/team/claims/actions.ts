"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { getAuditRequestContext } from "@/lib/audit";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { markClaimReimbursementPaidOutsidePayroll, selectClaimReimbursementChannel } from "@/lib/claim/reimbursement";
import { cancelApprovedEmployeeClaim, createClaimCategoryRevision, installClaimCategoryStarters, reviewEmployeeClaim } from "@/lib/claim/service";
import { trySynchronizeClaimExpense } from "@/lib/expense/source-integration";

export async function installClaimStartersAction() {
  try {
    const { user, businessId } = await requireBusinessUser("MANAGE_CLAIM_SETTINGS");
    await installClaimCategoryStarters({ businessId, actor: user, request: await getAuditRequestContext() });
    done("success", "Company Claim starters installed. Statutory treatment remains fail-closed.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    done("error", message(error, "Unable to install Claim starters."));
  }
}

export async function createClaimPolicyRevisionAction(formData: FormData) {
  try {
    const { user, businessId } = await requireBusinessUser("MANAGE_CLAIM_SETTINGS");
    await createClaimCategoryRevision({
      businessId,
      actor: user,
      request: await getAuditRequestContext(),
      rawInput: {
        categoryId: formData.get("categoryId") || null,
        code: formData.get("code"),
        name: formData.get("name"),
        description: formData.get("description") || null,
        nature: formData.get("nature"),
        effectiveFrom: formData.get("effectiveFrom"),
        receiptRequired: formData.get("receiptRequired") === "on",
        descriptionRequired: formData.get("descriptionRequired") === "on",
        maxLineAmount: formData.get("maxLineAmount") || null,
        mileageRatePerKm: formData.get("mileageRatePerKm") || null,
        reason: formData.get("reason"),
      },
    });
    done("success", "Immutable Claim policy revision created.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    done("error", message(error, "Unable to create Claim policy revision."));
  }
}

export async function reviewClaimAction(formData: FormData) {
  try {
    const { access, user, businessId } = await requireBusinessUser("REVIEW_CLAIM");
    const scope = await resolveAttendanceScope(access);
    const lines = [...formData.entries()].flatMap(([key, value]) => {
      if (!key.startsWith("approved:")) return [];
      const lineId = key.slice("approved:".length);
      return [{ lineId, approvedAmount: value, reason: formData.get(`reason:${lineId}`) || null }];
    });
    const request = await getAuditRequestContext();
    const claimId = String(formData.get("claimId") ?? "");
    const result = await reviewEmployeeClaim({
      businessId,
      allowedBranchIds: [...scope.allowedBranchIds],
      actor: user,
      actorLevel: access.effectiveBusinessRole === "BUSINESS_OWNER" ? "OWNER" : "MANAGER",
      request,
      rawInput: {
        claimId: formData.get("claimId"),
        expectedRevision: formData.get("expectedRevision"),
        reason: formData.get("reason") || null,
        lines,
      },
    });
    if (!result.finalized) {
      done("success", "第一级审批已完成，Claim 已转交老板作最终审批；目前尚未建立报销义务。");
    }
    const sync = await trySynchronizeClaimExpense({ businessId, actor: user, claimId, request });
    done("success", sync.status === "DEFERRED" ? "Claim decision recorded. Expense representation is queued for reconciliation." : "Claim decision recorded. Approval remains separate from payment.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    done("error", message(error, "Unable to review Claim."));
  }
}

export async function cancelApprovedClaimAction(formData: FormData) {
  try {
    const { access, user, businessId } = await requireBusinessUser("REVIEW_CLAIM");
    const scope = await resolveAttendanceScope(access);
    const request = await getAuditRequestContext();
    const claimId = String(formData.get("claimId") ?? "");
    await cancelApprovedEmployeeClaim({
      businessId,
      allowedBranchIds: [...scope.allowedBranchIds],
      actor: user,
      request,
      rawInput: { claimId: formData.get("claimId"), expectedRevision: formData.get("expectedRevision"), reason: formData.get("reason") },
    });
    const sync = await trySynchronizeClaimExpense({ businessId, actor: user, claimId, request });
    done("success", sync.status === "DEFERRED" ? "Claim cancelled. Expense reversal is queued for reconciliation." : "Approved Claim and unpaid reimbursement obligation cancelled with immutable history.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    done("error", message(error, "Unable to cancel approved Claim."));
  }
}

export async function selectClaimChannelAction(formData: FormData) {
  const channel = String(formData.get("channel") ?? "");
  try {
    const capability = channel === "PAYROLL" ? "LINK_CLAIM_TO_PAYROLL" : "VERIFY_CLAIM";
    const { user, businessId } = await requireBusinessUser(capability);
    await selectClaimReimbursementChannel({
      businessId,
      actor: user,
      request: await getAuditRequestContext(),
      rawInput: {
        reimbursementId: formData.get("reimbursementId"),
        expectedRevision: formData.get("expectedRevision"),
        operationKey: formData.get("operationKey"),
        channel,
        payrollRunId: formData.get("payrollRunId") || null,
        note: formData.get("note") || null,
      },
    });
    done("success", channel === "PAYROLL" ? "Payroll bridge snapshot created. Unverified statutory treatment remains blocked." : "Outside-Payroll reimbursement selected.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    done("error", message(error, "Unable to select reimbursement channel."));
  }
}

export async function markClaimPaidAction(formData: FormData) {
  try {
    const { user, businessId } = await requireBusinessUser("VERIFY_CLAIM");
    const request = await getAuditRequestContext();
    const reimbursement = await markClaimReimbursementPaidOutsidePayroll({
      businessId,
      actor: user,
      request,
      rawInput: {
        reimbursementId: formData.get("reimbursementId"),
        expectedRevision: formData.get("expectedRevision"),
        operationKey: formData.get("operationKey"),
        paymentReference: formData.get("paymentReference"),
        note: formData.get("note") || null,
      },
    });
    const sync = await trySynchronizeClaimExpense({ businessId, actor: user, claimId: reimbursement.claimId, request });
    done("success", sync.status === "DEFERRED" ? "Reimbursement marked paid. Expense payment state is queued for reconciliation." : "Outside-Payroll reimbursement marked paid exactly once.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    done("error", message(error, "Unable to mark reimbursement paid."));
  }
}

function done(type: "success" | "error", text: string): never {
  revalidatePath("/team/claims");
  revalidatePath("/team/approvals");
  revalidatePath("/staff/claims");
  revalidatePath("/team/payroll");
  revalidatePath("/expenses");
  revalidatePath("/expenses/history");
  redirect(`/team/claims?type=${type}&message=${encodeURIComponent(text)}`);
}

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
