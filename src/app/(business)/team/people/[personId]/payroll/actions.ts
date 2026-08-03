"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuditRequestContext } from "@/lib/audit";
import { requireWholeBusinessPayroll } from "@/lib/payroll/access";
import {
  scheduleEmployeeCompensationChange,
} from "@/lib/payroll/employee-profile-write/compensation";
import {
  payrollProfileReasonTypeSchema,
} from "@/lib/payroll/employee-profile-write/common";
import { PayrollProfileWriteError } from "@/lib/payroll/employee-profile-write/types";
import {
  updateEmployeePayrollWorkTarget,
} from "@/lib/payroll/employee-profile-write/work-target";

const reasonSchema = z.object({
  reasonNote: z.string().trim().min(5, "Enter a reason of at least 5 characters.").max(500),
  reasonType: payrollProfileReasonTypeSchema,
});

const compensationSchema = z.object({
  baseRate: z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/, "Enter a valid non-negative RM amount."),
  commandId: z.string().trim().min(1).max(128),
  effectiveFromMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  expectedRevision: z.coerce.number().int().min(0),
  membershipId: z.string().uuid(),
  payBasis: z.enum(["MONTHLY", "DAILY", "HOURLY"]),
}).and(reasonSchema);

const optionalMinutes = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  z.coerce.number().int().min(1).max(1_440).nullable(),
);

const workTargetSchema = z.object({
  commandId: z.string().trim().min(1).max(128),
  expectedRevision: z.coerce.number().int().min(0),
  membershipId: z.string().uuid(),
  normalWorkMinutesPerDay: optionalMinutes,
  targetBreakMinutes: optionalMinutes,
}).and(reasonSchema).superRefine((value, context) => {
  if (
    value.normalWorkMinutesPerDay !== null &&
    value.targetBreakMinutes !== null &&
    value.targetBreakMinutes > value.normalWorkMinutesPerDay
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Expected break cannot exceed paid work minutes.",
      path: ["targetBreakMinutes"],
    });
  }
});

export async function scheduleEmployeeCompensationChangeAction(formData: FormData) {
  let membershipId = safeMembershipId(formData.get("membershipId"));
  try {
    const input = compensationSchema.parse(Object.fromEntries(formData));
    membershipId = input.membershipId;
    const context = await requireWholeBusinessPayroll("EDIT_COMPENSATION");
    const request = await getAuditRequestContext();
    const result = await scheduleEmployeeCompensationChange({
      command: {
        ...input,
        effectiveFromMonth: new Date(`${input.effectiveFromMonth}-01T00:00:00.000Z`),
        source: "MANUAL",
      },
      context: {
        access: context.access,
        actor: context.user,
        allowedBranchIds: context.allowedBranchIds,
        businessId: context.businessId,
        caller: "EMPLOYEE_ACTION",
        request,
      },
    });
    revalidatePayrollProfile(membershipId);
    redirect(profileNoticeUrl(membershipId, {
      affectedDrafts: result.affectedDrafts,
      effectiveMonth: result.effectiveFromMonth,
      kind: "compensation",
      message: result.message,
      status: "success",
    }));
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(profileNoticeUrl(membershipId, {
      kind: "compensation",
      message: publicWriteError(error),
      status: "error",
    }));
  }
}

export async function updateEmployeePayrollWorkTargetAction(formData: FormData) {
  let membershipId = safeMembershipId(formData.get("membershipId"));
  try {
    const input = workTargetSchema.parse(Object.fromEntries(formData));
    membershipId = input.membershipId;
    const context = await requireWholeBusinessPayroll("EDIT_COMPENSATION");
    const request = await getAuditRequestContext();
    const result = await updateEmployeePayrollWorkTarget({
      command: input,
      context: {
        access: context.access,
        actor: context.user,
        allowedBranchIds: context.allowedBranchIds,
        businessId: context.businessId,
        caller: "EMPLOYEE_ACTION",
        request,
      },
    });
    revalidatePayrollProfile(membershipId);
    redirect(profileNoticeUrl(membershipId, {
      affectedDrafts: result.affectedDrafts,
      kind: "work-target",
      message: result.message,
      status: "success",
    }));
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(profileNoticeUrl(membershipId, {
      kind: "work-target",
      message: publicWriteError(error),
      status: "error",
    }));
  }
}

function revalidatePayrollProfile(membershipId: string) {
  revalidatePath(`/team/people/${membershipId}`);
  revalidatePath("/team/payroll/workspace");
  revalidatePath("/team/payroll/runs");
}

function profileNoticeUrl(
  membershipId: string,
  notice: {
    affectedDrafts?: number;
    effectiveMonth?: string;
    kind: "compensation" | "work-target";
    message: string;
    status: "error" | "success";
  },
) {
  const params = new URLSearchParams({
    section: "payroll",
    payrollUpdate: notice.kind,
    payrollUpdateMessage: notice.message.slice(0, 180),
    payrollUpdateStatus: notice.status,
  });
  if (notice.affectedDrafts !== undefined) {
    params.set("affectedDrafts", String(notice.affectedDrafts));
  }
  if (notice.effectiveMonth) params.set("effectiveMonth", notice.effectiveMonth);
  return `/team/people/${membershipId}?${params.toString()}`;
}

function publicWriteError(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "Check the payroll profile fields and try again.";
  }
  if (error instanceof PayrollProfileWriteError) {
    if (error.code === "CONFLICT") return "This payroll profile changed. Reload and try again.";
    if (error.code === "IMMUTABLE_HISTORY") return "Backdated compensation changes are not supported.";
    if (error.code === "NOT_FOUND") return "The employee payroll profile was not found.";
    if (error.code === "ACCESS_DENIED") return "You do not have access to edit this payroll profile.";
    if (error.code === "VALIDATION_ERROR") return error.message.slice(0, 180);
  }
  return "The payroll profile could not be updated. Refresh and try again.";
}

function safeMembershipId(value: FormDataEntryValue | null) {
  const parsed = z.string().uuid().safeParse(value);
  return parsed.success ? parsed.data : "";
}
