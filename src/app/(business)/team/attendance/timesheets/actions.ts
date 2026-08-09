"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import {
  approveMonthlyAttendanceTimesheet,
  beginMonthlyAttendanceTimesheetRevision,
  lockMonthlyAttendanceTimesheet,
  markAttendanceTimesheetBranchReady,
} from "@/lib/attendance/timesheet-service";
import { getAuditRequestContext } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";

export async function markTimesheetBranchReadyAction(formData: FormData) {
  const month = String(formData.get("month") ?? "");
  try {
    const context = await getTimesheetWriteContext();
    await markAttendanceTimesheetBranchReady({
      context,
      month,
      branchId: String(formData.get("branchId") ?? ""),
    });
    refresh(month, "success", "Branch attendance is ready for monthly approval.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    refresh(month, "error", message(error, "Unable to mark this branch ready."));
  }
}

export async function lockTimesheetAction(formData: FormData) {
  const month = String(formData.get("month") ?? "");
  try {
    const context = await getTimesheetWriteContext();
    const result = await lockMonthlyAttendanceTimesheet({
      context,
      month,
      reason: String(formData.get("reason") ?? ""),
      expectedUpdatedAt: String(formData.get("expectedUpdatedAt") ?? "") || undefined,
    });
    refresh(month, "success", `Approved monthly Timesheet locked as revision ${result.revision}.`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    refresh(month, "error", message(error, "Unable to lock this monthly Timesheet."));
  }
}

export async function approveTimesheetAction(formData: FormData) {
  const month = String(formData.get("month") ?? "");
  try {
    const context = await getTimesheetWriteContext();
    const result = await approveMonthlyAttendanceTimesheet({
      context,
      month,
      reason: String(formData.get("reason") ?? ""),
      expectedUpdatedAt: String(formData.get("expectedUpdatedAt") ?? "") || undefined,
    });
    refresh(month, "success", `Monthly Timesheet approval ${result.approvalRevision} recorded. It is ready to lock.`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    refresh(month, "error", message(error, "Unable to approve this monthly Timesheet."));
  }
}

export async function beginTimesheetRevisionAction(formData: FormData) {
  const month = String(formData.get("month") ?? "");
  try {
    const context = await getTimesheetWriteContext();
    await beginMonthlyAttendanceTimesheetRevision({
      context,
      month,
      reason: String(formData.get("reason") ?? ""),
      expectedUpdatedAt: String(formData.get("expectedUpdatedAt") ?? "") || undefined,
    });
    refresh(month, "success", "Controlled Timesheet revision started. The prior locked revision is unchanged.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    refresh(month, "error", message(error, "Unable to start a Timesheet revision."));
  }
}

async function getTimesheetWriteContext() {
  const { access, user, businessId } = await requireBusinessUser("MODIFY_ATTENDANCE_EMPLOYEES");
  const [scope, activeBranchCount, request] = await Promise.all([
    resolveAttendanceScope(access),
    prisma.branch.count({ where: { businessId, status: "ACTIVE" } }),
    getAuditRequestContext(),
  ]);
  const wholeBusinessScope =
    scope.allowedBranchIds.length === activeBranchCount &&
    (access.effectiveBusinessRole !== "STAFF" || access.permissions.includes("ALL_BRANCHES"));
  return {
    businessId,
    allowedBranchIds: [...scope.allowedBranchIds],
    wholeBusinessScope,
    actor: user,
    request,
  };
}

function refresh(month: string, type: "success" | "error", notice: string): never {
  revalidatePath("/team/attendance/timesheets");
  redirect(`/team/attendance/timesheets?month=${encodeURIComponent(month)}&type=${type}&message=${encodeURIComponent(notice)}`);
}

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
