"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuditRequestContext } from "@/lib/audit";
import { requireWholeBusinessPayroll } from "@/lib/payroll/access";
import {
  approvePayrollPaymentBatch,
  cancelPayrollPaymentBatch,
  createCorrectionPaymentBatch,
  createPayrollPaymentBatch,
  submitPayrollPaymentBatch,
} from "@/lib/payroll/payment/payment-batch-service";
import { PayrollPaymentError } from "@/lib/payroll/payment/types";

const baseSchema = z.object({
  commandId: z.string().uuid(),
  expectedRevision: z.coerce.number().int().min(0),
  reason: z.string().trim().min(5, "Enter a reason of at least 5 characters.").max(500),
  reasonType: z.string().trim().min(1).max(64),
});
const createSchema = baseSchema.extend({ payrollRunId: z.string().uuid() });
const batchSchema = baseSchema.extend({ paymentBatchId: z.string().uuid() });
const correctionSchema = baseSchema.extend({ supersedesBatchId: z.string().uuid() });

export async function createPaymentBatchAction(formData: FormData) {
  try {
    const input = createSchema.parse(Object.fromEntries(formData));
    const context = await requireWholeBusinessPayroll("CREATE_PAYMENT_BATCH");
    const result = await createPayrollPaymentBatch(
      paymentContext(context, await getAuditRequestContext()),
      input,
    );
    revalidatePaymentPaths(result.runId, result.paymentBatchId);
    redirect(noticePath(result.paymentBatchId, "Draft payment batch created.", "success"));
  } catch (error) {
    if (isRedirectError(error)) throw error;
    const runId = safeUuid(formData.get("payrollRunId"));
    redirect(`/team/payroll/payments/new?${new URLSearchParams({
      ...(runId ? { runId } : {}),
      message: publicPaymentError(error),
      type: "error",
    })}`);
  }
}

export async function submitPaymentBatchAction(formData: FormData) {
  return runBatchAction(formData, "SUBMIT_PAYMENT_BATCH", submitPayrollPaymentBatch, "Payment batch submitted for independent approval.");
}

export async function approvePaymentBatchAction(formData: FormData) {
  return runBatchAction(formData, "APPROVE_PAYMENT_BATCH", approvePayrollPaymentBatch, "Payment batch approved for future instruction preparation. It has not been paid or submitted to a bank.");
}

export async function cancelPaymentBatchAction(formData: FormData) {
  return runBatchAction(formData, "CANCEL_PAYMENT_BATCH", cancelPayrollPaymentBatch, "Payment batch cancelled. Its immutable history remains available.");
}

export async function createCorrectionPaymentBatchAction(formData: FormData) {
  let sourceId = safeUuid(formData.get("supersedesBatchId"));
  try {
    const input = correctionSchema.parse(Object.fromEntries(formData));
    sourceId = input.supersedesBatchId;
    const context = await requireWholeBusinessPayroll("CREATE_PAYMENT_BATCH");
    const result = await createCorrectionPaymentBatch(
      paymentContext(context, await getAuditRequestContext()),
      input,
    );
    revalidatePaymentPaths(result.runId, result.paymentBatchId);
    redirect(noticePath(result.paymentBatchId, "Correction draft created. The cancelled source remains in history.", "success"));
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(noticePath(sourceId, publicPaymentError(error), "error"));
  }
}

async function runBatchAction(
  formData: FormData,
  capability: "SUBMIT_PAYMENT_BATCH" | "APPROVE_PAYMENT_BATCH" | "CANCEL_PAYMENT_BATCH",
  operation: typeof submitPayrollPaymentBatch,
  successMessage: string,
) {
  let batchId = safeUuid(formData.get("paymentBatchId"));
  try {
    const input = batchSchema.parse(Object.fromEntries(formData));
    batchId = input.paymentBatchId;
    const context = await requireWholeBusinessPayroll(capability);
    const result = await operation(
      paymentContext(context, await getAuditRequestContext()),
      input,
    );
    revalidatePaymentPaths(result.runId, result.paymentBatchId);
    redirect(noticePath(result.paymentBatchId, successMessage, "success"));
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(noticePath(batchId, publicPaymentError(error), "error"));
  }
}

function paymentContext(
  context: Awaited<ReturnType<typeof requireWholeBusinessPayroll>>,
  request: Awaited<ReturnType<typeof getAuditRequestContext>>,
) {
  return {
    access: context.access,
    actor: context.user,
    allowedBranchIds: context.allowedBranchIds,
    businessId: context.businessId,
    request,
  };
}

function revalidatePaymentPaths(runId: string, batchId: string) {
  revalidatePath("/team/payroll/payments");
  revalidatePath(`/team/payroll/payments/${batchId}`);
  revalidatePath(`/team/payroll/runs/${runId}`);
  revalidatePath("/team/payroll/workspace");
}

function noticePath(batchId: string, message: string, type: "error" | "success") {
  if (!batchId) return `/team/payroll/payments?${new URLSearchParams({ message, type })}`;
  return `/team/payroll/payments/${batchId}?${new URLSearchParams({ message: message.slice(0, 180), type })}`;
}

function publicPaymentError(error: unknown) {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? "Check the payment fields and try again.";
  if (error instanceof PayrollPaymentError) {
    if (error.code === "NOT_FOUND") return "The payment record was not found.";
    if (error.code === "ACCESS_DENIED") return "You do not have access to perform this payment action.";
    if (error.code === "CONFLICT") return "Payment readiness or this batch changed. Reload and try again.";
    if (error.code === "DUPLICATE_COMMAND") return "This request was already submitted with different details.";
    if (error.code === "BLOCKED") return "Resolve every payment blocker before continuing.";
    if (error.code === "IMMUTABLE_HISTORY") return "Approved payment history cannot be changed by this action.";
    if (error.code === "VALIDATION_ERROR") return error.message.slice(0, 180);
  }
  return "The payment action could not be completed. Refresh and try again.";
}

function safeUuid(value: FormDataEntryValue | null) {
  const result = z.string().uuid().safeParse(value);
  return result.success ? result.data : "";
}
