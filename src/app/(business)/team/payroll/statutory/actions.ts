"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import {
  safeBusinessStatutoryAuditSnapshot,
  safeEmployeeSubmissionIdentityAuditSnapshot,
  writeSensitiveAuditLog,
} from "@/lib/audit/payroll-sensitive";
import { getPublicPayrollErrorMessage } from "@/lib/payroll/error-message";
import { requireWholeBusinessPayroll } from "@/lib/payroll/access";
import { STATUTORY_EXPORT_VERSION } from "@/lib/payroll/statutory-submission";
import { prisma } from "@/lib/prisma";

const optionalText = (max: number) => z.string().trim().max(max).optional();

const businessProfileSchema = z.object({
  epfEmployerNumber: optionalText(30),
  perkesoEmployerCode: optionalText(12),
  perkesoRegistrationNumber: optionalText(20),
  lhdnEmployerNumberHq: optionalText(10),
  lhdnEmployerNumber: optionalText(10),
});

const employeeProfileSchema = z.object({
  membershipId: z.string().uuid(),
  statutoryIdentityType: z.enum(["NEW_IC", "OLD_IC", "PASSPORT", "OTHER"]).optional(),
  statutoryIdentityNumber: optionalText(30),
  statutoryCountryCode: optionalText(2),
  epfMemberNumber: optionalText(30),
  socsoMemberNumber: optionalText(30),
  taxIdentificationNumber: optionalText(20),
});

const submissionSchema = z.object({
  submissionId: z.string().uuid(),
  targetStatus: z.enum(["SUBMITTED", "ACCEPTED", "REJECTED"]),
  submissionReference: optionalText(100),
  notes: optionalText(500),
});
const exportConfirmationSchema = z.object({
  payrollRunId: z.string().uuid(),
  provider: z.enum(["EPF", "PERKESO", "PCB"]),
});


export async function saveBusinessStatutoryProfileAction(formData: FormData) {
  const month = monthFrom(formData);
  try {
    const context = await requireWholeBusinessPayroll("EDIT_STATUTORY_PROFILE");
    await requireWholeBusinessPayroll("EDIT_TAX_PROFILE");
    const input = businessProfileSchema.parse({
      epfEmployerNumber: optionalValue(formData, "epfEmployerNumber"),
      perkesoEmployerCode: optionalValue(formData, "perkesoEmployerCode")?.toUpperCase(),
      perkesoRegistrationNumber: optionalValue(formData, "perkesoRegistrationNumber")?.toUpperCase(),
      lhdnEmployerNumberHq: digitsValue(formData, "lhdnEmployerNumberHq"),
      lhdnEmployerNumber: digitsValue(formData, "lhdnEmployerNumber"),
    });
    const request = await getAuditRequestContext();
    await prisma.$transaction(async (transaction) => {
      const before = await transaction.businessStatutoryProfile.findUnique({ where: { businessId: context.businessId } });
      const after = await transaction.businessStatutoryProfile.upsert({
        where: { businessId: context.businessId },
        create: { businessId: context.businessId, ...nullify(input) },
        update: nullify(input),
      });
      await writeSensitiveAuditLog({
        businessId: context.businessId,
        actor: context.user,
        request,
        action: "BUSINESS_STATUTORY_PROFILE_UPDATED",
        entityType: "BusinessStatutoryProfile",
        entityId: after.id,
        summary: "Company statutory registration profile updated.",
        before: before && safeBusinessStatutoryAuditSnapshot(before),
        after: safeBusinessStatutoryAuditSnapshot(after),
      }, transaction);
    });
    finish("success", "Company statutory registration saved.", month);
  } catch (error) {
    handleError(error, month, "Unable to save company statutory registration.");
  }
}

export async function saveEmployeeSubmissionProfileAction(formData: FormData) {
  const month = monthFrom(formData);
  try {
    const context = await requireWholeBusinessPayroll("EDIT_STATUTORY_PROFILE");
    await requireWholeBusinessPayroll("EDIT_TAX_PROFILE");
    const input = employeeProfileSchema.parse({
      membershipId: formData.get("membershipId"),
      statutoryIdentityType: optionalValue(formData, "statutoryIdentityType"),
      statutoryIdentityNumber: optionalValue(formData, "statutoryIdentityNumber"),
      statutoryCountryCode: optionalValue(formData, "statutoryCountryCode")?.toUpperCase(),
      epfMemberNumber: optionalValue(formData, "epfMemberNumber"),
      socsoMemberNumber: optionalValue(formData, "socsoMemberNumber"),
      taxIdentificationNumber: digitsValue(formData, "taxIdentificationNumber"),
    });
    const request = await getAuditRequestContext();
    await prisma.$transaction(async (transaction) => {
      const before = await transaction.employeeBusinessMembership.findFirst({
        where: { id: input.membershipId, businessId: context.businessId },
        select: employeeSelect,
      });
      if (!before) throw new Error("The employee was not found in your payroll scope.");
      const after = await transaction.employeeBusinessMembership.update({
        where: { id: before.id },
        data: {
          statutoryIdentityType: input.statutoryIdentityType ?? null,
          statutoryIdentityNumber: input.statutoryIdentityNumber ?? null,
          statutoryCountryCode: input.statutoryCountryCode ?? null,
          epfMemberNumber: input.epfMemberNumber ?? null,
          socsoMemberNumber: input.socsoMemberNumber ?? null,
          taxIdentificationNumber: input.taxIdentificationNumber ?? null,
          statutoryProfileUpdatedAt: new Date(),
        },
        select: employeeSelect,
      });
      await writeSensitiveAuditLog({
        businessId: context.businessId,
        actor: context.user,
        request,
        action: "EMPLOYEE_STATUTORY_IDENTITY_UPDATED",
        entityType: "EmployeeBusinessMembership",
        entityId: after.id,
        summary: `Statutory submission identity updated for ${after.fullName}.`,
        before: safeEmployeeSubmissionIdentityAuditSnapshot(before),
        after: safeEmployeeSubmissionIdentityAuditSnapshot(after),
      }, transaction);
    });
    finish("success", "Employee statutory identity saved.", month);
  } catch (error) {
    handleError(error, month, "Unable to save employee statutory identity.");
  }
}

export async function markStatutoryFileExportedAction(formData: FormData) {
  const month = monthFrom(formData);
  try {
    const context = await requireWholeBusinessPayroll("EXPORT_STATUTORY");
    const input = exportConfirmationSchema.parse({
      payrollRunId: formData.get("payrollRunId"),
      provider: formData.get("provider"),
    });
    const request = await getAuditRequestContext();
    await prisma.$transaction(async (transaction) => {
      const run = await transaction.payrollRun.findFirst({
        where: {
          id: input.payrollRunId,
          businessId: context.businessId,
          status: "FINALIZED",
        },
        select: { id: true },
      });
      if (!run) throw new Error("Only finalized payroll can be marked as exported.");
      const current = await transaction.payrollStatutorySubmission.findUnique({
        where: {
          payrollRunId_provider: {
            payrollRunId: run.id,
            provider: input.provider,
          },
        },
      });
      if (current?.status === "SUBMITTED" || current?.status === "ACCEPTED") {
        throw new Error("Submitted statutory records cannot be reset by an export confirmation.");
      }
      const submission = await transaction.payrollStatutorySubmission.upsert({
        where: {
          payrollRunId_provider: {
            payrollRunId: run.id,
            provider: input.provider,
          },
        },
        create: {
          payrollRunId: run.id,
          businessId: context.businessId,
          provider: input.provider,
          status: "EXPORTED",
          exportVersion: STATUTORY_EXPORT_VERSION[input.provider],
          exportedById: context.user.userId,
        },
        update: {
          status: "EXPORTED",
          exportVersion: STATUTORY_EXPORT_VERSION[input.provider],
          exportedAt: new Date(),
          exportedById: context.user.userId,
          rejectionReason: null,
        },
      });
      await writeAuditLog({
        businessId: context.businessId,
        actor: context.user,
        request,
        action: "PAYROLL_STATUTORY_EXPORT_CONFIRMED",
        entityType: "PayrollStatutorySubmission",
        entityId: submission.id,
        summary: `${input.provider} statutory file export confirmed.`,
        before: current ? { status: current.status } : null,
        after: { status: submission.status, exportVersion: submission.exportVersion },
      }, transaction);
    });
    finish("success", "Statutory export confirmed.", month);
  } catch (error) {
    handleError(error, month, "Unable to confirm statutory export.");
  }
}

export async function updateStatutorySubmissionStatusAction(formData: FormData) {
  const month = monthFrom(formData);
  try {
    const requestedStatus = String(formData.get("targetStatus") ?? "");
    const context = await requireWholeBusinessPayroll(
      requestedStatus === "SUBMITTED" ? "SUBMIT_STATUTORY" : "RESOLVE_STATUTORY_SUBMISSION",
    );
    const input = submissionSchema.parse({
      submissionId: formData.get("submissionId"),
      targetStatus: formData.get("targetStatus"),
      submissionReference: optionalValue(formData, "submissionReference"),
      notes: optionalValue(formData, "notes"),
    });
    const request = await getAuditRequestContext();
    await prisma.$transaction(async (transaction) => {
      const before = await transaction.payrollStatutorySubmission.findFirst({
        where: { id: input.submissionId, businessId: context.businessId },
        include: { payrollRun: { select: { status: true } } },
      });
      if (!before) throw new Error("Statutory submission record was not found.");
      if (before.payrollRun.status !== "FINALIZED") throw new Error("Only finalized payroll can update statutory submissions.");
      if (!validTransition(before.status, input.targetStatus)) throw new Error("This statutory submission status change is not allowed.");
      if (input.targetStatus === "REJECTED" && (!input.notes || input.notes.length < 5)) {
        throw new Error("Enter a rejection reason of at least 5 characters.");
      }
      if (input.targetStatus === "SUBMITTED" && !input.submissionReference) {
        throw new Error("Enter the portal submission reference.");
      }
      const now = new Date();
      const after = await transaction.payrollStatutorySubmission.update({
        where: { id: before.id },
        data: input.targetStatus === "SUBMITTED" ? {
          status: "SUBMITTED",
          submittedAt: now,
          submittedById: context.user.userId,
          submissionReference: input.submissionReference,
          notes: input.notes ?? null,
          resolvedAt: null,
          resolvedById: null,
          rejectionReason: null,
        } : {
          status: input.targetStatus,
          resolvedAt: now,
          resolvedById: context.user.userId,
          rejectionReason: input.targetStatus === "REJECTED" ? input.notes : null,
          notes: input.targetStatus === "ACCEPTED" ? input.notes ?? before.notes : before.notes,
        },
      });
      await writeAuditLog({
        businessId: context.businessId,
        actor: context.user,
        request,
        action: "PAYROLL_STATUTORY_SUBMISSION_STATUS_UPDATED",
        entityType: "PayrollStatutorySubmission",
        entityId: after.id,
        summary: `${after.provider} submission marked ${after.status.toLowerCase()}.`,
        before: { status: before.status, submissionReference: before.submissionReference },
        after: { status: after.status, submissionReference: after.submissionReference },
        metadata: { provider: after.provider, notes: input.notes ?? null },
      }, transaction);
    });
    finish("success", "Statutory submission status updated.", month);
  } catch (error) {
    handleError(error, month, "Unable to update statutory submission status.");
  }
}

function validTransition(current: string, target: string) {
  return (current === "EXPORTED" && target === "SUBMITTED") ||
    (current === "SUBMITTED" && (target === "ACCEPTED" || target === "REJECTED"));
}

const employeeSelect = {
  id: true,
  fullName: true,
  statutoryIdentityType: true,
  statutoryIdentityNumber: true,
  statutoryCountryCode: true,
  epfMemberNumber: true,
  socsoMemberNumber: true,
  taxIdentificationNumber: true,
} as const;

function nullify<T extends Record<string, string | undefined>>(value: T) {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, entry ?? null])) as { [K in keyof T]: string | null };
}
function optionalValue(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim() || undefined; }
function digitsValue(formData: FormData, key: string) { return optionalValue(formData, key)?.replace(/\D/g, ""); }
function monthFrom(formData: FormData) { return String(formData.get("month") ?? new Date().toISOString().slice(0, 7)); }
function finish(type: "success" | "error", message: string, month: string): never {
  revalidatePath("/team/payroll/statutory");
  redirect(`/team/payroll/statutory?month=${encodeURIComponent(month)}&type=${type}&message=${encodeURIComponent(message)}`);
}
function handleError(error: unknown, month: string, fallback: string): never {
  if (isRedirectError(error)) throw error;
  const message = error instanceof z.ZodError
    ? error.issues[0]?.message ?? fallback
    : getPublicPayrollErrorMessage(error, fallback);
  if (message === fallback) console.error("[statutory-submission-action] unexpected failure", error);
  finish("error", message, month);
}
