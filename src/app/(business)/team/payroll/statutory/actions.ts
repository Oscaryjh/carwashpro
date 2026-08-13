"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import {
  sensitiveActionCookieOptions,
  SENSITIVE_ACTION_COOKIE,
} from "@/lib/auth/sensitive-action-service";
import {
  assertServerActionSameOrigin,
  getAuthRequestContext,
} from "@/lib/auth/security";
import { getSensitiveActionPolicy } from "@/lib/auth/sensitive-actions";
import {
  safeBusinessStatutoryAuditSnapshot,
  writeSensitiveAuditLog,
} from "@/lib/audit/payroll-sensitive";
import { getPublicPayrollErrorMessage } from "@/lib/payroll/error-message";
import { requireWholeBusinessPayroll } from "@/lib/payroll/access";
import { createStatutoryCorrectionRevision } from "@/lib/payroll/statutory-artifact";
import {
  consumePayrollHighRiskAuthorization,
  issuePayrollHighRiskAuthorization,
  payrollMfaFactor,
  payrollMfaPassword,
  statutoryExportStepUpResourceId,
} from "@/lib/payroll/high-risk-mfa";
import { parsePayrollMonth } from "@/lib/payroll/service";
import { prisma } from "@/lib/prisma";

const optionalText = (max: number) => z.string().trim().max(max).optional();

const businessProfileSchema = z.object({
  epfEmployerNumber: optionalText(30),
  perkesoEmployerCode: optionalText(12),
  perkesoRegistrationNumber: optionalText(20),
  lhdnEmployerNumberHq: optionalText(10),
  lhdnEmployerNumber: optionalText(10),
});

const submissionSchema = z.object({
  submissionId: z.string().uuid(),
  targetStatus: z.enum(["SUBMITTED", "ACCEPTED", "REJECTED"]),
  submissionReference: optionalText(100),
  notes: optionalText(500),
});
const correctionRevisionSchema = z.object({
  submissionId: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
});
const exportAuthorizationSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  provider: z.enum(["EPF", "PERKESO", "PCB"]),
  revision: z.preprocess(
    (value) => value === "" || value === null ? undefined : value,
    z.coerce.number().int().positive().optional(),
  ),
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

export async function createStatutoryCorrectionRevisionAction(formData: FormData) {
  const month = monthFrom(formData);
  try {
    const context = await requireWholeBusinessPayroll("RESOLVE_STATUTORY_SUBMISSION");
    const input = correctionRevisionSchema.parse({
      submissionId: formData.get("submissionId"),
      reason: formData.get("reason"),
    });
    await createStatutoryCorrectionRevision({
      actor: context.user,
      businessId: context.businessId,
      reason: input.reason,
      request: await getAuditRequestContext(),
      submissionId: input.submissionId,
    });
    finish("success", "Statutory correction revision created.", month);
  } catch (error) {
    handleError(error, month, "Unable to create a statutory correction revision.");
  }
}

export async function authorizeStatutoryExportAction(formData: FormData) {
  const input = exportAuthorizationSchema.parse(Object.fromEntries(formData));
  const context = await requireWholeBusinessPayroll("EXPORT_STATUTORY");
  const period = parsePayrollMonth(input.month);
  const run = await prisma.payrollRun.findUnique({
    where: {
      businessId_periodStart_periodEnd: {
        businessId: context.businessId,
        periodStart: period.start,
        periodEnd: period.end,
      },
    },
    select: { id: true, status: true },
  });
  if (!run || run.status !== "FINALIZED") {
    throw new Error("Only finalized payroll can produce official submission files.");
  }
  if (input.revision) {
    const retained = await prisma.payrollStatutorySubmission.count({
      where: {
        businessId: context.businessId,
        payrollRunId: run.id,
        provider: input.provider,
        revision: input.revision,
        artifact: { isNot: null },
      },
    });
    if (retained !== 1) throw new Error("The retained statutory artifact revision was not found.");
  }
  const resourceId = statutoryExportStepUpResourceId(
    input.month,
    input.provider,
    input.revision,
  );
  const requestHeaders = await headers();
  assertServerActionSameOrigin(requestHeaders);
  const stepUp = await issuePayrollHighRiskAuthorization({
    access: context.access,
    actionKey: "STATUTORY_EXPORT",
    businessId: context.businessId,
    enabledModules: context.moduleContext.enabledModules,
    factor: payrollMfaFactor(formData),
    password: payrollMfaPassword(formData),
    request: getAuthRequestContext(requestHeaders),
    resourceId,
    user: context.user,
  });
  const policy = getSensitiveActionPolicy("STATUTORY_EXPORT");
  const cookieStore = await cookies();
  cookieStore.set(
    SENSITIVE_ACTION_COOKIE,
    stepUp.rawToken,
    sensitiveActionCookieOptions(policy.ttlSeconds),
  );
  const query = new URLSearchParams({
    month: input.month,
    provider: input.provider,
  });
  if (input.revision) query.set("revision", String(input.revision));
  redirect(`/team/payroll/statutory/export?${query.toString()}`);
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
    let stepUp: Awaited<ReturnType<typeof issuePayrollHighRiskAuthorization>> | undefined;
    if (input.targetStatus === "SUBMITTED") {
      const beforeStepUp = await prisma.payrollStatutorySubmission.findFirst({
        where: { businessId: context.businessId, id: input.submissionId },
        include: { artifact: { select: { id: true } }, payrollRun: { select: { status: true } } },
      });
      if (
        !beforeStepUp ||
        beforeStepUp.status !== "EXPORTED" ||
        beforeStepUp.integrityStatus !== "VERIFIED" ||
        !beforeStepUp.artifact ||
        beforeStepUp.payrollRun.status !== "FINALIZED"
      ) {
        throw new Error("Only an artifact-backed statutory revision can advance submission status.");
      }
      const latest = await prisma.payrollStatutorySubmission.findFirst({
        where: {
          businessId: context.businessId,
          payrollRunId: beforeStepUp.payrollRunId,
          provider: beforeStepUp.provider,
        },
        orderBy: { revision: "desc" },
        select: { id: true },
      });
      if (latest?.id !== beforeStepUp.id) {
        throw new Error("Only the latest statutory revision can change status.");
      }
      const requestHeaders = await headers();
      assertServerActionSameOrigin(requestHeaders);
      stepUp = await issuePayrollHighRiskAuthorization({
        access: context.access,
        actionKey: "STATUTORY_SUBMIT",
        businessId: context.businessId,
        enabledModules: context.moduleContext.enabledModules,
        factor: payrollMfaFactor(formData),
        password: payrollMfaPassword(formData),
        request: getAuthRequestContext(requestHeaders),
        resourceId: input.submissionId,
        user: context.user,
      });
    }
    const request = await getAuditRequestContext();
    await prisma.$transaction(async (transaction) => {
      const before = await transaction.payrollStatutorySubmission.findFirst({
        where: { id: input.submissionId, businessId: context.businessId },
        include: {
          artifact: { select: { id: true } },
          payrollRun: { select: { status: true } },
        },
      });
      if (!before) throw new Error("Statutory submission record was not found.");
      if (before.payrollRun.status !== "FINALIZED") throw new Error("Only finalized payroll can update statutory submissions.");
      if (before.integrityStatus !== "VERIFIED" || !before.artifact) {
        throw new Error("Only an artifact-backed statutory revision can advance submission status.");
      }
      const latest = await transaction.payrollStatutorySubmission.findFirstOrThrow({
        where: {
          businessId: context.businessId,
          payrollRunId: before.payrollRunId,
          provider: before.provider,
        },
        orderBy: { revision: "desc" },
        select: { id: true },
      });
      if (latest.id !== before.id) throw new Error("Only the latest statutory revision can change status.");
      if (!validTransition(before.status, input.targetStatus)) throw new Error("This statutory submission status change is not allowed.");
      if (input.targetStatus === "REJECTED" && (!input.notes || input.notes.length < 5)) {
        throw new Error("Enter a rejection reason of at least 5 characters.");
      }
      if (input.targetStatus === "SUBMITTED" && !input.submissionReference) {
        throw new Error("Enter the portal submission reference.");
      }
      const stepUpAudit = input.targetStatus === "SUBMITTED"
        ? await consumePayrollHighRiskAuthorization({
            actionKey: "STATUTORY_SUBMIT",
            businessId: context.businessId,
            resourceId: before.id,
            stepUp,
            userId: context.user.userId,
          }, transaction)
        : undefined;
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
        metadata: {
          provider: after.provider,
          notes: input.notes ?? null,
          ...stepUpAudit,
        },
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
