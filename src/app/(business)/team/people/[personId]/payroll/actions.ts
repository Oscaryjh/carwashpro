"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { z } from "zod";
import { pcbProfileDataSchema, type EmployeePcbProfile } from "@/lib/payroll/pcb-profile";
import {
  PCB_2026_TP1_CATEGORIES,
  PCB_2026_TP3_CATEGORIES,
  type Pcb2026Tp1Category,
  type Pcb2026Tp3Category,
} from "@/lib/payroll/pcb-declarations";
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
import { isPayrollBankAccountMfaEnabled } from "@/lib/payroll/payment/bank-account-security";
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
import { updateEmployeeStatutoryAndTaxProfiles } from "@/lib/payroll/employee-profile-write/statutory-tax";
import { updateEmployeeTaxProfile } from "@/lib/payroll/employee-profile-write/tax";
import { recordEmployeeLindung24ParticipationAndRefreshDrafts } from "@/lib/payroll/lindung24-participation-service";

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
});

const recurringPaySchema = z.object({
  amount: z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/, "Enter a valid positive RM amount."),
  code: z.string().trim().toUpperCase().optional().default(""),
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
});

const optionalMinutes = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  z.coerce.number().int().min(1).max(1_440).nullable(),
);

const optionalWorkingDays = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  z.coerce.number().int().min(1).max(31).nullable(),
);

const workTargetSchema = z.object({
  commandId: z.string().trim().min(1).max(128),
  expectedRevision: z.coerce.number().int().min(0),
  membershipId: z.string().uuid(),
  workingDaysPerMonth: optionalWorkingDays,
  normalWorkMinutesPerDay: optionalMinutes,
  targetBreakMinutes: optionalMinutes,
}).superRefine((value, context) => {
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
    (value) => value === null || (typeof value === "string" && value.trim() === "")
      ? null
      : value,
    z.coerce.date().nullable(),
  ),
  evidenceNature: z.preprocess(
    (value) => value === null || value === "" ? "REAL" : value,
    z.enum(["REAL", "SYNTHETIC_TESTING"]),
  ),
  evidenceEnvironment: z.enum(["LOCAL", "TESTING"]).nullable().default(null),
  fixturePurpose: z.enum(["PAYROLL_PAYSLIP_UAT"]).nullable().default(null),
  statutoryNationalitySnapshot: z
    .enum(["MALAYSIAN", "PERMANENT_RESIDENT", "NON_MALAYSIAN"])
    .nullable()
    .default(null),
  reason: z.preprocess(
    (value) => typeof value !== "string" || value.trim() === ""
      ? "LINDUNG 24 coverage updated from the employee profile."
      : value,
    z.string().trim().min(5).max(500),
  ),
  selectedEmployer: z.enum(["CURRENT_BUSINESS", "OTHER_EMPLOYER", "PERKESO_SELECTION_PENDING"]),
  sourceReference: z.preprocess(
    (value) => typeof value !== "string" || value.trim() === ""
      ? null
      : value,
    z.string().trim().min(5).max(500).nullable(),
  ),
  sourceType: z.preprocess((value) => value === "" ? null : value, z.enum([
    "OFFICIAL_TRANSITION",
    "EMPLOYEE_OPT_IN",
    "EMPLOYEE_OPT_OUT",
    "PERKESO_EMPLOYER_SELECTION",
    "EMPLOYMENT_CHANGE",
    "LEGACY_REVIEW",
  ]).nullable()),
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
  pcbProfile: pcbProfileDataSchema.nullable().optional(),
}).and(reasonSchema);

const pcbFormSchema = z.object({
  pcbTaxYear: z.coerce.number().int().refine((value) => value === 2026),
  pcbTaxRegime: z.enum([
    "RESIDENT_STANDARD",
    "NON_RESIDENT",
    "RETURNING_EXPERT_PROGRAM",
    "KNOWLEDGE_WORKER",
    "C_SUITE_NON_CITIZEN",
  ]),
  pcbEmployeeCategory: z.enum(["CATEGORY_1", "CATEGORY_2", "CATEGORY_3"]),
  pcbUnder18Full: z.coerce.number().int().min(0).max(99),
  pcbUnder18Half: z.coerce.number().int().min(0).max(99),
  pcbStudying18PlusFull: z.coerce.number().int().min(0).max(99),
  pcbStudying18PlusHalf: z.coerce.number().int().min(0).max(99),
  pcbDiplomaOrDegreeFull: z.coerce.number().int().min(0).max(99),
  pcbDiplomaOrDegreeHalf: z.coerce.number().int().min(0).max(99),
  pcbDisabledFull: z.coerce.number().int().min(0).max(99),
  pcbDisabledHalf: z.coerce.number().int().min(0).max(99),
  pcbDisabledStudyingFull: z.coerce.number().int().min(0).max(99),
  pcbDisabledStudyingHalf: z.coerce.number().int().min(0).max(99),
  pcbPriorEmployerGross: z.coerce.number().min(0),
  pcbPriorEmployerEpf: z.coerce.number().min(0),
  pcbPriorEmployerPcb: z.coerce.number().min(0),
  pcbPriorEmployerZakat: z.coerce.number().min(0),
  pcbReligiousTravelLevy: z.coerce.number().min(0),
  pcbTp1Reference: z.string().trim().max(240).optional().default(""),
  pcbTp3Reference: z.string().trim().max(240).optional().default(""),
  pcbReligiousTravelLevyReference: z.string().trim().max(240).optional().default(""),
  pcbProfileRevision: z.coerce.number().int().min(0).optional().default(0),
});

function pcbProfileFromForm(
  formData: FormData,
): EmployeePcbProfile | null | undefined {
  if (formData.get("pcbProfilePresent") !== "1") return undefined;
  if (formData.get("pcbProfileMode") !== "CONFIRMED") return null;
  const value = pcbFormSchema.parse(Object.fromEntries(formData));
  const cents = (amount: number) => Math.round(amount * 100);
  const confirmedAt = new Date().toISOString();
  const tp1Status = formData.has("pcbTp1Confirmed")
    ? "CONFIRMED"
    : "NOT_APPLICABLE";
  const tp3Status = formData.has("pcbTp3Confirmed")
    ? "CONFIRMED"
    : "NOT_APPLICABLE";
  const religiousTravelLevyStatus = formData.has("pcbReligiousTravelLevyConfirmed")
    ? "CONFIRMED"
    : "NOT_APPLICABLE";
  const priorEmployerGrossRemunerationCents =
    tp3Status === "CONFIRMED" ? cents(value.pcbPriorEmployerGross) : 0;
  const priorEmployerEpfCents =
    tp3Status === "CONFIRMED" ? cents(value.pcbPriorEmployerEpf) : 0;
  const priorEmployerPcbCents =
    tp3Status === "CONFIRMED" ? cents(value.pcbPriorEmployerPcb) : 0;
  const priorEmployerZakatCents =
    tp3Status === "CONFIRMED" ? cents(value.pcbPriorEmployerZakat) : 0;
  const currentReligiousTravelLevyCents =
    religiousTravelLevyStatus === "CONFIRMED"
      ? cents(value.pcbReligiousTravelLevy)
      : 0;
  const declarationEntries = <T extends Pcb2026Tp1Category | Pcb2026Tp3Category>(
    categories: readonly { code: T; limitCents: number }[],
    prefix: "pcbTp1" | "pcbTp3",
    sourceForm: "HASIL_TP1_1_2026_BM" | "HASIL_TP3_1_2026_BM",
    sourceReference: string,
  ) => categories.flatMap(({ code, limitCents }) => {
    const raw = String(formData.get(`${prefix}${code}`) ?? "").trim();
    if (!raw) return [];
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`Enter a valid non-negative amount for ${code}.`);
    }
    const amountCents = cents(amount);
    if (amountCents === 0) return [];
    return [{
      taxYear: 2026 as const,
      categoryCode: code,
      amountCents,
      categoryLimitCents: limitCents,
      sourceForm,
      sourceReference,
      declarationStatus: "CONFIRMED" as const,
      reviewStatus: "REVIEWED" as const,
      revision: value.pcbProfileRevision + 1,
    }];
  });
  const tp1Entries = tp1Status === "CONFIRMED"
    ? declarationEntries(PCB_2026_TP1_CATEGORIES, "pcbTp1", "HASIL_TP1_1_2026_BM", value.pcbTp1Reference)
    : [];
  const tp3Entries = tp3Status === "CONFIRMED"
    ? declarationEntries(PCB_2026_TP3_CATEGORIES, "pcbTp3", "HASIL_TP3_1_2026_BM", value.pcbTp3Reference)
    : [];
  const structuredCurrentDeductionsCents = tp1Entries
    .filter((entry) => entry.categoryCode !== "D1")
    .reduce((total, entry) => total + entry.amountCents, 0);
  const structuredCurrentZakatCents = tp1Entries
    .filter((entry) => entry.categoryCode === "D1")
    .reduce((total, entry) => total + entry.amountCents, 0);
  const structuredPriorDeductionsCents = tp3Entries
    .reduce((total, entry) => total + entry.amountCents, 0);
  return pcbProfileDataSchema.parse({
    version: 3,
    profileRevision: value.pcbProfileRevision + 1,
    taxYear: value.pcbTaxYear,
    taxRegime: value.pcbTaxRegime,
    employeeCategory: value.pcbEmployeeCategory,
    individualDisabled: formData.has("pcbIndividualDisabled"),
    spouseDisabled: formData.has("pcbSpouseDisabled"),
    children: {
      under18Full: value.pcbUnder18Full,
      under18Half: value.pcbUnder18Half,
      studying18PlusFull: value.pcbStudying18PlusFull,
      studying18PlusHalf: value.pcbStudying18PlusHalf,
      diplomaOrDegreeFull: value.pcbDiplomaOrDegreeFull,
      diplomaOrDegreeHalf: value.pcbDiplomaOrDegreeHalf,
      disabledFull: value.pcbDisabledFull,
      disabledHalf: value.pcbDisabledHalf,
      disabledStudyingFull: value.pcbDisabledStudyingFull,
      disabledStudyingHalf: value.pcbDisabledStudyingHalf,
    },
    priorEmployerGrossRemunerationCents,
    priorEmployerEpfCents,
    priorEmployerPcbCents,
    priorEmployerAllowableDeductionsCents: structuredPriorDeductionsCents,
    priorEmployerZakatCents,
    currentAllowableDeductionsCents: structuredCurrentDeductionsCents,
    currentZakatCents: structuredCurrentZakatCents,
    currentReligiousTravelLevyCents,
    tp1Declaration: {
      formVersion: "HASIL_TP1_1_2026_BM",
      status: tp1Status,
      entries: tp1Entries,
      sourceReference:
        tp1Status === "CONFIRMED" ? value.pcbTp1Reference || null : null,
      declaredAt: confirmedAt,
      reviewedAt: confirmedAt,
    },
    tp3Declaration: {
      formVersion: "HASIL_TP3_1_2026_BM",
      status: tp3Status,
      grossRemunerationCents: priorEmployerGrossRemunerationCents,
      epfCents: priorEmployerEpfCents,
      pcbCents: priorEmployerPcbCents,
      zakatCents: priorEmployerZakatCents,
      entries: tp3Entries,
      sourceReference:
        tp3Status === "CONFIRMED" ? value.pcbTp3Reference || null : null,
      declaredAt: confirmedAt,
      reviewedAt: confirmedAt,
    },
    religiousTravelLevyDeclaration: {
      status: religiousTravelLevyStatus,
      amountCents: currentReligiousTravelLevyCents,
      sourceReference:
        religiousTravelLevyStatus === "CONFIRMED"
          ? value.pcbReligiousTravelLevyReference || null
          : null,
      declaredAt: confirmedAt,
      reviewedAt: confirmedAt,
    },
    confirmedAt,
  });
}

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
        reasonNote: "Salary updated from the employee payroll profile.",
        reasonType: "PAYROLL_POLICY_CHANGE",
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
        reasonNote: input.operation === "END"
          ? "Monthly payroll item ended from the employee payroll profile."
          : input.componentId
            ? "Monthly payroll item updated from the employee payroll profile."
            : "Monthly payroll item added from the employee payroll profile.",
        reasonType: "PAYROLL_POLICY_CHANGE",
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
      command: {
        ...input,
        reasonNote: "Payroll work hours updated from the employee payroll profile.",
        reasonType: "PAYROLL_POLICY_CHANGE",
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

export async function updateEmployeeStatutoryAndTaxProfilesAction(
  formData: FormData,
) {
  let membershipId = safeMembershipId(formData.get("membershipId"));
  try {
    const statutoryInput = statutoryProfileSchema.parse({
      commandId: formData.get("statutoryCommandId"),
      expectedRevision: formData.get("statutoryExpectedRevision"),
      membershipId: formData.get("membershipId"),
      reasonNote:
        "Statutory contribution settings updated from the employee profile.",
      reasonType: "STATUTORY_CORRECTION",
      socsoCategory: optionalFormValue(formData, "socsoCategory"),
      statutoryNationality: optionalFormValue(
        formData,
        "statutoryNationality",
      ),
    });
    const taxInput = taxProfileSchema.parse({
      commandId: formData.get("taxCommandId"),
      epfMemberNumber: formData.get("epfMemberNumber"),
      expectedRevision: formData.get("taxExpectedRevision"),
      membershipId: formData.get("membershipId"),
      reasonNote: "Tax and government IDs updated from the employee profile.",
      reasonType: "TAX_INFORMATION_UPDATE",
      socsoMemberNumber: formData.get("socsoMemberNumber"),
      statutoryCountryCode: formData.get("statutoryCountryCode"),
      statutoryIdentityNumber: formData.get("statutoryIdentityNumber"),
      statutoryIdentityType: optionalFormValue(
        formData,
        "statutoryIdentityType",
      ),
      taxIdentificationNumber: formData.get("taxIdentificationNumber"),
      pcbProfile: pcbProfileFromForm(formData),
    });
    membershipId = statutoryInput.membershipId;
    if (taxInput.membershipId !== membershipId) {
      throw new PayrollProfileWriteError(
        "VALIDATION_ERROR",
        "The statutory and tax records must belong to the same employee.",
      );
    }

    const [statutoryContext, taxContext, request] = await Promise.all([
      requireWholeBusinessPayroll("EDIT_STATUTORY_PROFILE"),
      requireWholeBusinessPayroll("EDIT_TAX_PROFILE"),
      getAuditRequestContext(),
    ]);
    if (statutoryContext.businessId !== taxContext.businessId) {
      throw new PayrollProfileWriteError(
        "ACCESS_DENIED",
        "The statutory and tax records must belong to the same business.",
      );
    }

    const epfEnabled = formData.has("epfEnabled");
    const socsoEnabled = formData.has("socsoEnabled");
    const eisEnabled = formData.has("eisEnabled");
    const clearIdentity = formData.has("clearIdentity");
    const result = await updateEmployeeStatutoryAndTaxProfiles({
      statutory: {
        command: {
          ...statutoryInput,
          eisEnabled,
          eisPreviouslyContributed:
            eisEnabled && formData.has("eisPreviouslyContributed"),
          epfEnabled,
          epfMemberBeforeAug1998:
            epfEnabled && formData.has("epfMemberBeforeAug1998"),
          lindung24OptIn:
            socsoEnabled && formData.get("lindung24OptIn") === "on",
          socsoCategory: socsoEnabled ? statutoryInput.socsoCategory : null,
          socsoEnabled,
        },
        context: {
          access: statutoryContext.access,
          actor: statutoryContext.user,
          allowedBranchIds: statutoryContext.allowedBranchIds,
          businessId: statutoryContext.businessId,
          caller: "EMPLOYEE_ACTION",
          request,
        },
      },
      tax: {
        command: {
          commandId: taxInput.commandId,
          epfMemberNumber: replacementValue(
            taxInput.epfMemberNumber,
            formData.has("clearEpfMemberNumber"),
          ),
          expectedRevision: taxInput.expectedRevision,
          membershipId: taxInput.membershipId,
          reasonNote: taxInput.reasonNote,
          reasonType: taxInput.reasonType,
          socsoMemberNumber: replacementValue(
            taxInput.socsoMemberNumber,
            formData.has("clearSocsoMemberNumber"),
          ),
          statutoryCountryCode:
            taxInput.statutoryCountryCode.trim().toUpperCase() || null,
          statutoryIdentityNumber: clearIdentity
            ? null
            : replacementValue(taxInput.statutoryIdentityNumber, false),
          statutoryIdentityType: clearIdentity
            ? null
            : taxInput.statutoryIdentityType ?? undefined,
          taxIdentificationNumber: replacementValue(
            taxInput.taxIdentificationNumber,
            formData.has("clearTaxIdentificationNumber"),
          ),
          pcbProfile: taxInput.pcbProfile,
        },
        context: {
          access: taxContext.access,
          actor: taxContext.user,
          allowedBranchIds: taxContext.allowedBranchIds,
          businessId: taxContext.businessId,
          caller: "EMPLOYEE_ACTION",
          request,
        },
      },
    });

    revalidatePayrollProfile(membershipId);
    redirect(profileNoticeUrl(membershipId, {
      affectedDrafts: Math.max(
        result.statutory.affectedDrafts,
        result.tax.affectedDrafts,
      ),
      changedFields: [
        ...new Set([
          ...result.statutory.changedFields,
          ...result.tax.changedFields,
        ]),
      ],
      kind: "statutory",
      message: "Statutory and tax details updated.",
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

export async function recordEmployeeLindung24ParticipationAction(formData: FormData) {
  let membershipId = safeMembershipId(formData.get("membershipId"));
  try {
    const command = lindung24ParticipationSchema.parse({
      act4Covered: formData.get("act4Covered"),
      effectiveFromMonth: formData.get("effectiveFromMonth"),
        employerContext: formData.get("employerContext"),
        evidenceNature: formData.get("evidenceNature"),
        evidenceEnvironment: optionalFormValue(formData, "evidenceEnvironment"),
        fixturePurpose: optionalFormValue(formData, "fixturePurpose"),
        statutoryNationalitySnapshot: optionalFormValue(
          formData,
          "statutoryNationalitySnapshot",
        ),
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
    const request = await getAuditRequestContext();
    const result = await recordEmployeeLindung24ParticipationAndRefreshDrafts({
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
        request,
      },
    });
    revalidatePayrollProfile(membershipId);
    redirect(profileNoticeUrl(membershipId, {
      affectedDrafts: result.refreshedDrafts,
      kind: "statutory",
      message:
        result.draftCount === 0
          ? "LINDUNG 24 coverage saved. It will apply automatically to the next payroll."
          : result.refreshedDrafts === result.draftCount
            ? `LINDUNG 24 coverage saved. ${result.refreshedDrafts} draft payroll${result.refreshedDrafts === 1 ? "" : "s"} refreshed.`
            : "LINDUNG 24 coverage saved. Refresh any open draft payroll that could not be updated.",
      newRevision: result.participation.revision,
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
      pcbProfile: pcbProfileFromForm(formData),
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
        pcbProfile: input.pcbProfile,
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
  const returnToProfile = formData.get("returnTo") === "profile";
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
    if (returnToProfile) {
      const params = new URLSearchParams({
        bankDialog: "1",
        bankDialogError: publicWriteError(error).slice(0, 180),
        section: "payroll",
      });
      redirect(`/team/people/${membershipId}?${params.toString()}`);
    }
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
    section:
      notice.kind === "statutory" || notice.kind === "tax"
        ? "statutory"
        : "payroll",
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
  if (!isPayrollBankAccountMfaEnabled()) return undefined;

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
