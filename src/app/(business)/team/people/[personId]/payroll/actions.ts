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
import { updateEmployeeStatutoryProfile } from "@/lib/payroll/employee-profile-write/statutory";
import { updateEmployeeTaxProfile } from "@/lib/payroll/employee-profile-write/tax";

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

const statutoryProfileSchema = z.object({
  commandId: z.string().trim().min(1).max(128),
  expectedRevision: z.coerce.number().int().min(0),
  membershipId: z.string().uuid(),
  socsoCategory: z.enum(["FIRST", "SECOND"]).nullable(),
  statutoryNationality: z
    .enum(["MALAYSIAN", "PERMANENT_RESIDENT", "NON_MALAYSIAN"])
    .nullable(),
}).and(reasonSchema);

const replacementIdentifier = z
  .string()
  .trim()
  .max(30)
  .regex(/^$|^[A-Za-z0-9 /-]+$/, "Identifier contains unsupported characters.");

const taxProfileSchema = z.object({
  commandId: z.string().trim().min(1).max(128),
  epfMemberNumber: replacementIdentifier,
  expectedRevision: z.coerce.number().int().min(0),
  membershipId: z.string().uuid(),
  socsoMemberNumber: replacementIdentifier,
  statutoryCountryCode: z
    .string()
    .trim()
    .regex(/^$|^[A-Za-z]{2}$/, "Country code must contain two letters."),
  statutoryIdentityNumber: replacementIdentifier,
  statutoryIdentityType: z
    .enum(["NEW_IC", "OLD_IC", "PASSPORT", "OTHER"])
    .nullable(),
  taxIdentificationNumber: replacementIdentifier,
}).and(reasonSchema);

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

export async function updateEmployeeStatutoryProfileAction(formData: FormData) {
  let membershipId = safeMembershipId(formData.get("membershipId"));
  try {
    const input = statutoryProfileSchema.parse({
      commandId: formData.get("commandId"),
      expectedRevision: formData.get("expectedRevision"),
      membershipId: formData.get("membershipId"),
      reasonNote: formData.get("reasonNote"),
      reasonType: formData.get("reasonType"),
      socsoCategory: optionalFormValue(formData, "socsoCategory"),
      statutoryNationality: optionalFormValue(
        formData,
        "statutoryNationality",
      ),
    });
    membershipId = input.membershipId;
    const epfEnabled = formData.has("epfEnabled");
    const socsoEnabled = formData.has("socsoEnabled");
    const eisEnabled = formData.has("eisEnabled");
    const context = await requireWholeBusinessPayroll(
      "EDIT_STATUTORY_PROFILE",
    );
    const result = await updateEmployeeStatutoryProfile({
      command: {
        ...input,
        eisEnabled,
        eisPreviouslyContributed:
          eisEnabled && formData.has("eisPreviouslyContributed"),
        epfEnabled,
        epfMemberBeforeAug1998:
          epfEnabled && formData.has("epfMemberBeforeAug1998"),
        lindung24OptIn:
          socsoEnabled && formData.has("lindung24OptIn"),
        socsoCategory: socsoEnabled ? input.socsoCategory : null,
        socsoEnabled,
      },
      context: {
        access: context.access,
        actor: context.user,
        allowedBranchIds: context.allowedBranchIds,
        businessId: context.businessId,
        caller: "EMPLOYEE_ACTION",
        request: await getAuditRequestContext(),
      },
    });
    revalidatePayrollProfile(membershipId);
    redirect(profileNoticeUrl(membershipId, {
      affectedDrafts: result.affectedDrafts,
      artifactCount: result.artifactCount,
      changedFields: result.changedFields,
      existingArtifactWarning: result.existingArtifactWarning,
      finalizedCount: result.finalizedCount,
      kind: "statutory",
      message:
        "Statutory contribution profile updated. Existing locked payroll and statutory artifacts were not changed.",
      status: "success",
      newRevision: result.newRevision,
      reviewCount: result.reviewCount,
    }));
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(profileNoticeUrl(membershipId, {
      kind: "statutory",
      message: publicWriteError(error),
      status: "error",
    }));
  }
}

export async function updateEmployeeTaxProfileAction(formData: FormData) {
  let membershipId = safeMembershipId(formData.get("membershipId"));
  try {
    const input = taxProfileSchema.parse({
      commandId: formData.get("commandId"),
      epfMemberNumber: formData.get("epfMemberNumber"),
      expectedRevision: formData.get("expectedRevision"),
      membershipId: formData.get("membershipId"),
      reasonNote: formData.get("reasonNote"),
      reasonType: formData.get("reasonType"),
      socsoMemberNumber: formData.get("socsoMemberNumber"),
      statutoryCountryCode: formData.get("statutoryCountryCode"),
      statutoryIdentityNumber: formData.get("statutoryIdentityNumber"),
      statutoryIdentityType:
        optionalFormValue(formData, "statutoryIdentityType"),
      taxIdentificationNumber: formData.get("taxIdentificationNumber"),
    });
    membershipId = input.membershipId;
    const context = await requireWholeBusinessPayroll("EDIT_TAX_PROFILE");
    const clearIdentity = formData.has("clearIdentity");
    const result = await updateEmployeeTaxProfile({
      command: {
        commandId: input.commandId,
        epfMemberNumber: replacementValue(
          input.epfMemberNumber,
          formData.has("clearEpfMemberNumber"),
        ),
        expectedRevision: input.expectedRevision,
        membershipId: input.membershipId,
        reasonNote: input.reasonNote,
        reasonType: input.reasonType,
        socsoMemberNumber: replacementValue(
          input.socsoMemberNumber,
          formData.has("clearSocsoMemberNumber"),
        ),
        statutoryCountryCode:
          input.statutoryCountryCode.trim().toUpperCase() || null,
        statutoryIdentityNumber: clearIdentity
          ? null
          : replacementValue(input.statutoryIdentityNumber, false),
        statutoryIdentityType: clearIdentity
          ? null
          : input.statutoryIdentityType ?? undefined,
        taxIdentificationNumber: replacementValue(
          input.taxIdentificationNumber,
          formData.has("clearTaxIdentificationNumber"),
        ),
      },
      context: {
        access: context.access,
        actor: context.user,
        allowedBranchIds: context.allowedBranchIds,
        businessId: context.businessId,
        caller: "EMPLOYEE_ACTION",
        request: await getAuditRequestContext(),
      },
    });
    revalidatePayrollProfile(membershipId);
    redirect(profileNoticeUrl(membershipId, {
      affectedDrafts: result.affectedDrafts,
      artifactCount: result.artifactCount,
      changedFields: result.changedFields,
      existingArtifactWarning: result.existingArtifactWarning,
      finalizedCount: result.finalizedCount,
      kind: "tax",
      message:
        "Tax and submission identity updated. Existing locked payroll and statutory artifacts were not changed.",
      status: "success",
      newRevision: result.newRevision,
      reviewCount: result.reviewCount,
    }));
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(profileNoticeUrl(membershipId, {
      kind: "tax",
      message: publicWriteError(error),
      status: "error",
    }));
  }
}

function revalidatePayrollProfile(membershipId: string) {
  revalidatePath(`/team/people/${membershipId}`);
  revalidatePath("/team/payroll");
  revalidatePath("/team/payroll/statutory");
  revalidatePath("/team/payroll/workspace");
  revalidatePath("/team/payroll/runs");
}

function profileNoticeUrl(
  membershipId: string,
  notice: {
    affectedDrafts?: number;
    artifactCount?: number;
    changedFields?: string[];
    effectiveMonth?: string;
    existingArtifactWarning?: boolean;
    finalizedCount?: number;
    kind: "compensation" | "statutory" | "tax" | "work-target";
    message: string;
    status: "error" | "success";
    newRevision?: number;
    reviewCount?: number;
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
  if (notice.artifactCount !== undefined) {
    params.set("artifactCount", String(notice.artifactCount));
  }
  if (notice.changedFields?.length) {
    params.set("changedFields", notice.changedFields.join(","));
  }
  if (notice.effectiveMonth) params.set("effectiveMonth", notice.effectiveMonth);
  if (notice.existingArtifactWarning) params.set("artifactWarning", "true");
  if (notice.finalizedCount !== undefined) {
    params.set("finalizedCount", String(notice.finalizedCount));
  }
  if (notice.newRevision !== undefined) {
    params.set("newRevision", String(notice.newRevision));
  }
  if (notice.reviewCount !== undefined) {
    params.set("reviewCount", String(notice.reviewCount));
  }
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

function optionalFormValue(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function replacementValue(value: string, clear: boolean) {
  if (clear) return null;
  return value.trim() || undefined;
}
