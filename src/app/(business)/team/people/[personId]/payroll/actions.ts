"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuditRequestContext } from "@/lib/audit";
import {
  assertServerActionSameOrigin,
  getAuthRequestContext,
} from "@/lib/auth/security";
import { requireWholeBusinessPayroll } from "@/lib/payroll/access";
import {
  scheduleEmployeeCompensationChange,
} from "@/lib/payroll/employee-profile-write/compensation";
import {
  payrollProfileReasonTypeSchema,
} from "@/lib/payroll/employee-profile-write/common";
import { PayrollProfileWriteError } from "@/lib/payroll/employee-profile-write/types";
import { scheduleRecurringPayComponent } from "@/lib/payroll/recurring-pay";
import { findSalaryBank } from "@/lib/payroll/payment/bank-directory";
import {
  assertEmployeeBankResource,
  createEmployeeBankVersion,
  deactivateEmployeeBankVersion,
  verifyEmployeeBankVersion,
} from "@/lib/payroll/payment/bank-account-service";
import { PayrollPaymentError } from "@/lib/payroll/payment/types";
import {
  issuePayrollHighRiskAuthorization,
  payrollMfaFactor,
  payrollMfaPassword,
  type PayrollHighRiskStepUp,
  publicPayrollMfaError,
} from "@/lib/payroll/high-risk-mfa";
import {
  updateEmployeePayrollWorkTarget,
} from "@/lib/payroll/employee-profile-write/work-target";
import { updateEmployeeStatutoryProfile } from "@/lib/payroll/employee-profile-write/statutory";
import { updateEmployeeTaxProfile } from "@/lib/payroll/employee-profile-write/tax";
import { recordEmployeeLindung24Participation } from "@/lib/payroll/lindung24-participation-service";

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

const recurringPaySchema = z.object({
  amount: z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/, "Enter a valid positive RM amount."),
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,63}$/, "Use an uppercase component code."),
  commandId: z.string().trim().min(1).max(128),
  componentId: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? null : value,
    z.string().uuid().nullable(),
  ),
  effectiveFromMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  expectedRevision: z.coerce.number().int().min(0),
  membershipId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  operation: z.enum(["SET", "END"]),
  type: z.enum(["EARNING", "DEDUCTION"]),
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

const lindung24ParticipationSchema = z.object({
  act4Covered: z.enum(["true", "false"]).transform((value) => value === "true"),
  effectiveFromMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  employerContext: z.enum(["SINGLE_EMPLOYER", "MULTIPLE_EMPLOYER"]),
  expectedRevision: z.coerce.number().int().min(0),
  membershipId: z.string().uuid(),
  officialSubmittedAt: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? null : value,
    z.coerce.date().nullable(),
  ),
  reason: z.string().trim().min(5).max(500),
  selectedEmployer: z.enum(["CURRENT_BUSINESS", "OTHER_EMPLOYER", "PERKESO_SELECTION_PENDING"]),
  sourceReference: z.string().trim().min(5).max(500),
  sourceType: z.enum([
    "OFFICIAL_TRANSITION",
    "EMPLOYEE_OPT_IN",
    "EMPLOYEE_OPT_OUT",
    "PERKESO_EMPLOYER_SELECTION",
    "EMPLOYMENT_CHANGE",
    "LEGACY_REVIEW",
  ]),
  status: z.enum(["MANDATORY", "DEFAULT_PARTICIPATING", "VOLUNTARY_OPT_IN", "VOLUNTARY_OPT_OUT"]),
});

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

const bankVersionBaseSchema = z.object({
  commandId: z.string().trim().min(1).max(128),
  expectedRevision: z.coerce.number().int().min(0),
  membershipId: z.string().uuid(),
  reason: z.string().trim().min(5, "Enter a reason of at least 5 characters.").max(500),
  reasonType: z.string().trim().min(1).max(64),
});

const createBankVersionSchema = bankVersionBaseSchema.extend({
  accountHolderName: z.string().trim().min(1).max(160),
  accountNumber: z
    .string()
    .trim()
    .min(5, "Enter a valid bank account number.")
    .max(48)
    .regex(/^[A-Za-z0-9 -]+$/, "Enter a valid bank account number."),
  bankCode: z.string().trim().min(1).max(32),
  effectiveFrom: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/),
});

const existingBankVersionSchema = bankVersionBaseSchema.extend({
  bankAccountVersionId: z.string().uuid(),
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

export async function scheduleEmployeeRecurringPayAction(formData: FormData) {
  let membershipId = safeMembershipId(formData.get("membershipId"));
  try {
    const input = recurringPaySchema.parse(Object.fromEntries(formData));
    membershipId = input.membershipId;
    const context = await requireWholeBusinessPayroll("EDIT_COMPENSATION");
    const result = await scheduleRecurringPayComponent({
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
        request: await getAuditRequestContext(),
      },
    });
    revalidatePayrollProfile(membershipId);
    redirect(profileNoticeUrl(membershipId, {
      affectedDrafts: result.affectedDrafts,
      effectiveMonth: result.effectiveFromMonth,
      kind: "compensation",
      message: result.message,
      newRevision: result.newRevision,
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
          socsoEnabled && formData.get("lindung24OptIn") === "on",
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

export async function recordEmployeeLindung24ParticipationAction(formData: FormData) {
  let membershipId = safeMembershipId(formData.get("membershipId"));
  try {
    const command = lindung24ParticipationSchema.parse({
      act4Covered: formData.get("act4Covered"),
      effectiveFromMonth: formData.get("effectiveFromMonth"),
      employerContext: formData.get("employerContext"),
      expectedRevision: formData.get("expectedRevision"),
      membershipId: formData.get("membershipId"),
      officialSubmittedAt: formData.get("officialSubmittedAt"),
      reason: formData.get("reason"),
      selectedEmployer: formData.get("selectedEmployer"),
      sourceReference: formData.get("sourceReference"),
      sourceType: formData.get("sourceType"),
      status: formData.get("status"),
    });
    membershipId = command.membershipId;
    const context = await requireWholeBusinessPayroll("EDIT_STATUTORY_PROFILE");
    const result = await recordEmployeeLindung24Participation({
      command: {
        ...command,
        effectiveFromMonth: new Date(`${command.effectiveFromMonth}-01T00:00:00.000Z`),
      },
      context: {
        access: context.access,
        actor: context.user,
        allowedBranchIds: context.allowedBranchIds,
        businessId: context.businessId,
        caller: "STATUTORY_ACTION",
        request: await getAuditRequestContext(),
      },
    });
    revalidatePayrollProfile(membershipId);
    redirect(profileNoticeUrl(membershipId, {
      kind: "statutory",
      message: "LINDUNG24 participation evidence recorded. Draft payroll must be recalculated explicitly.",
      newRevision: result.revision,
      status: "success",
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

export async function createEmployeeBankVersionAction(formData: FormData) {
  let membershipId = safeMembershipId(formData.get("membershipId"));
  try {
    const input = createBankVersionSchema.parse(Object.fromEntries(formData));
    membershipId = input.membershipId;
    const bank = findSalaryBank(input.bankCode);
    if (!bank) throw new PayrollPaymentError("VALIDATION_ERROR", "Select a supported bank.");
    const context = await requireWholeBusinessPayroll("EDIT_BANK_ACCOUNT");
    await assertEmployeeBankResource(context.businessId, input.membershipId);
    const stepUp = await issueBankStepUp(context, formData, input.membershipId);
    const result = await createEmployeeBankVersion(
      paymentContext(context, await getAuditRequestContext(), stepUp),
      {
        accountHolderName: input.accountHolderName,
        accountNumber: input.accountNumber,
        bankCode: bank.code,
        bankName: bank.name,
        commandId: input.commandId,
        effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00.000Z`),
        expectedRevision: input.expectedRevision,
        membershipId: input.membershipId,
        reason: input.reason,
        reasonType: input.reasonType,
      },
    );
    revalidatePayrollProfile(membershipId);
    redirect(profileNoticeUrl(membershipId, {
      changedFields: ["bank", "holderName", "accountNumber", "effectiveDate"],
      kind: "bank",
      message: `Salary bank account ending ${result.last4} saved. Existing payment batches were not changed.`,
      newRevision: result.revision,
      status: "success",
    }));
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(bankEditNoticeUrl(membershipId, publicWriteError(error)));
  }
}

export async function verifyEmployeeBankVersionAction(formData: FormData) {
  let membershipId = safeMembershipId(formData.get("membershipId"));
  try {
    const input = existingBankVersionSchema.parse(Object.fromEntries(formData));
    membershipId = input.membershipId;
    const context = await requireWholeBusinessPayroll("VERIFY_BANK_ACCOUNT");
    await assertEmployeeBankResource(context.businessId, input.membershipId);
    const stepUp = await issueBankStepUp(context, formData, input.membershipId);
    const result = await verifyEmployeeBankVersion(
      paymentContext(context, await getAuditRequestContext(), stepUp),
      input,
    );
    revalidatePayrollProfile(membershipId);
    redirect(profileNoticeUrl(membershipId, {
      changedFields: ["verificationStatus"],
      kind: "bank",
      message: "Salary bank account marked as manually verified. This is not confirmation from the bank.",
      newRevision: result.revision,
      status: "success",
    }));
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(profileNoticeUrl(membershipId, {
      kind: "bank",
      message: publicWriteError(error),
      status: "error",
    }));
  }
}

export async function deactivateEmployeeBankVersionAction(formData: FormData) {
  let membershipId = safeMembershipId(formData.get("membershipId"));
  try {
    const input = existingBankVersionSchema.parse(Object.fromEntries(formData));
    membershipId = input.membershipId;
    const context = await requireWholeBusinessPayroll("EDIT_BANK_ACCOUNT");
    await assertEmployeeBankResource(context.businessId, input.membershipId);
    const stepUp = await issueBankStepUp(context, formData, input.membershipId);
    const result = await deactivateEmployeeBankVersion(
      paymentContext(context, await getAuditRequestContext(), stepUp),
      input,
    );
    revalidatePayrollProfile(membershipId);
    redirect(profileNoticeUrl(membershipId, {
      changedFields: ["status", "effectiveUntil"],
      kind: "bank",
      message: "Salary bank account deactivated. Historical versions and existing payment batches remain unchanged.",
      newRevision: result.revision,
      status: "success",
    }));
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(profileNoticeUrl(membershipId, {
      kind: "bank",
      message: publicWriteError(error),
      status: "error",
    }));
  }
}

function revalidatePayrollProfile(membershipId: string) {
  revalidatePath(`/team/people/${membershipId}`);
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
    kind: "bank" | "compensation" | "statutory" | "tax" | "work-target";
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

function bankEditNoticeUrl(membershipId: string, message: string) {
  const params = new URLSearchParams({
    message: message.slice(0, 180),
    type: "error",
  });
  return `/team/people/${membershipId}/payroll/bank/edit?${params.toString()}`;
}

function paymentContext(
  context: Awaited<ReturnType<typeof requireWholeBusinessPayroll>>,
  request: Awaited<ReturnType<typeof getAuditRequestContext>>,
  stepUp?: PayrollHighRiskStepUp,
) {
  return {
    access: context.access,
    actor: context.user,
    allowedBranchIds: context.allowedBranchIds,
    businessId: context.businessId,
    request,
    stepUp,
  };
}

async function issueBankStepUp(
  context: Awaited<ReturnType<typeof requireWholeBusinessPayroll>>,
  formData: FormData,
  membershipId: string,
) {
  const requestHeaders = await headers();
  assertServerActionSameOrigin(requestHeaders);
  return issuePayrollHighRiskAuthorization({
    access: context.access,
    actionKey: "BANK_ACCOUNT_EDIT",
    businessId: context.businessId,
    enabledModules: context.moduleContext.enabledModules,
    factor: payrollMfaFactor(formData),
    password: payrollMfaPassword(formData),
    request: getAuthRequestContext(requestHeaders),
    resourceId: membershipId,
    user: context.user,
  });
}

function publicWriteError(error: unknown) {
  const mfaMessage = publicPayrollMfaError(error);
  if (mfaMessage) return mfaMessage;
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "Check the payroll profile fields and try again.";
  }
  if (error instanceof PayrollProfileWriteError) {
    if (error.code === "CONFLICT") return "This payroll profile changed. Reload and try again.";
    if (error.code === "IMMUTABLE_HISTORY") return "Backdated payroll profile changes are not supported.";
    if (error.code === "NOT_FOUND") return "The employee payroll profile was not found.";
    if (error.code === "ACCESS_DENIED") return "You do not have access to edit this payroll profile.";
    if (error.code === "VALIDATION_ERROR") return error.message.slice(0, 180);
  }
  if (error instanceof PayrollPaymentError) {
    if (error.code === "CONFLICT") return "This bank profile changed. Reload and try again.";
    if (error.code === "DUPLICATE_COMMAND") return "This bank request was already submitted with different details.";
    if (error.code === "NOT_FOUND") return "The employee bank profile was not found.";
    if (error.code === "ACCESS_DENIED") return "You do not have access to maintain this bank profile.";
    if (error.code === "VALIDATION_ERROR") return error.message.slice(0, 180);
    if (error.code === "IMMUTABLE_HISTORY") return "Historical bank records cannot be changed.";
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
