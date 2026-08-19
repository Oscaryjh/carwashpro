"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import {
  assertServerActionSameOrigin,
  getAuthRequestContext,
} from "@/lib/auth/security";
import type { SensitiveActionKey } from "@/lib/auth/sensitive-actions";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import {
  addManualPayrollAdjustment,
  editManualPayrollAdjustment,
  removeManualPayrollAdjustment,
} from "@/lib/payroll/component-service";
import { getPublicPayrollErrorMessage } from "@/lib/payroll/error-message";
import {
  issuePayrollHighRiskAuthorization,
  payrollMfaFactor,
  payrollMfaPassword,
} from "@/lib/payroll/high-risk-mfa";
import {
  assertPayrollReadinessCanProceed,
  getPayrollPeriodReadiness,
} from "@/lib/payroll/readiness";
import { payrollRunReturnPath } from "@/lib/payroll/runs";
import { publishPayrollPayslips } from "@/lib/payroll/payslip-publication";
import {
  finalizePayrollRun,
  decidePayrollHolidayPay,
  generatePayrollRun,
  parsePayrollMonth,
  reopenPayrollRun,
  returnPayrollRunToDraft,
  submitPayrollRunForReview,
  updatePayrollEntry,
} from "@/lib/payroll/service";
import { assertPayrollRunUsesCurrentLockedTimesheet } from "@/lib/payroll/timesheet-bridge";
import {
  approvePayrollCorrection,
  approvePayrollVariablePay,
  cancelPayrollCorrection,
  cancelPayrollVariablePay,
  createPayrollCorrection,
  createPayrollVariablePay,
} from "@/lib/payroll/variable-pay";
import { prisma } from "@/lib/prisma";
import { trySynchronizePayrollExpense } from "@/lib/expense/source-integration";

const settingSchema = z.object({
  workingDaysPerMonth: z.coerce.number().int().min(1).max(31),
  normalWorkMinutesPerDay: z.coerce.number().int().min(1).max(1440),
  breakMinutesPerDay: z.coerce.number().int().min(0).max(720),
  overtimeMultiplier: z.coerce.number().min(1).max(10),
  publicHolidayExtraMultiplier: z.coerce.number().min(0).max(10),
  publicHolidayPayEnabled: z.boolean(),
  stateCode: z.string().trim().max(80).optional(),
});

const holidaySchema = z.object({
  branchId: z.string().uuid(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().trim().min(2).max(120),
});

const workflowReasonSchema = z.string().trim().min(5).max(500);

export async function savePayrollSettingAction(formData: FormData) {
  const month = monthFrom(formData);
  try {
    const context = await requireWholeBusinessPayroll("EDIT_PAYROLL_ENTRY");
    const input = settingSchema.parse({
      workingDaysPerMonth: formData.get("workingDaysPerMonth"),
      normalWorkMinutesPerDay: formData.get("normalWorkMinutesPerDay"),
      breakMinutesPerDay: formData.get("breakMinutesPerDay"),
      overtimeMultiplier: formData.get("overtimeMultiplier"),
      publicHolidayExtraMultiplier: formData.get(
        "publicHolidayExtraMultiplier",
      ),
      publicHolidayPayEnabled:
        formData.get("publicHolidayPayEnabled") === "true",
      stateCode: formData.get("stateCode"),
    });
    const request = await getAuditRequestContext();
    await prisma.$transaction(async (transaction) => {
      const before = await transaction.payrollSetting.findUnique({
        where: { businessId: context.businessId },
      });
      const policyChanged = before
        ? before.publicHolidayPayEnabled !== input.publicHolidayPayEnabled ||
          before.publicHolidayExtraMultiplier.toString() !==
            String(input.publicHolidayExtraMultiplier)
        : false;
      const policyRevision = before
        ? before.publicHolidayPayPolicyRevision + (policyChanged ? 1 : 0)
        : 1;
      const after = await transaction.payrollSetting.upsert({
        where: { businessId: context.businessId },
        create: {
          businessId: context.businessId,
          ...input,
          publicHolidayPayPolicyRevision: policyRevision,
        },
        update: {
          ...input,
          publicHolidayPayPolicyRevision: policyRevision,
        },
      });
      await writeAuditLog(
        {
          businessId: context.businessId,
          actor: context.user,
          request,
          action: "PAYROLL_SETTING_UPDATED",
          entityType: "PayrollSetting",
          entityId: after.id,
          summary: "Payroll calculation settings updated.",
          before: before && settingAudit(before),
          after: settingAudit(after),
        },
        transaction,
      );
    });
    finish("success", "Payroll settings saved.", month, settingsPath(month));
  } catch (error) {
    handleActionError(
      error,
      month,
      "Unable to save payroll settings.",
      settingsPath(month),
    );
  }
}

export async function addPayrollHolidayAction(formData: FormData) {
  const month = monthFrom(formData);
  try {
    const context = await requireWholeBusinessPayroll("EDIT_PAYROLL_ENTRY");
    const input = holidaySchema.parse({
      branchId: formData.get("branchId"),
      workDate: formData.get("workDate"),
      name: formData.get("name"),
    });
    if (!context.allowedBranchIds.includes(input.branchId)) {
      throw new Error("The selected branch is outside your payroll scope.");
    }
    const workDate = new Date(`${input.workDate}T00:00:00.000Z`);
    const request = await getAuditRequestContext();
    await prisma.$transaction(async (transaction) => {
      const holiday = await transaction.payrollHoliday.upsert({
        where: { branchId_workDate: { branchId: input.branchId, workDate } },
        create: { ...input, workDate, businessId: context.businessId },
        update: { name: input.name },
      });
      await writeAuditLog(
        {
          businessId: context.businessId,
          branchId: input.branchId,
          actor: context.user,
          request,
          action: "PAYROLL_HOLIDAY_SAVED",
          entityType: "PayrollHoliday",
          entityId: holiday.id,
          summary: `${input.name} saved as a payroll public holiday.`,
          metadata: { workDate: input.workDate },
        },
        transaction,
      );
    });
    finish("success", "Public holiday saved.", month, settingsPath(month));
  } catch (error) {
    handleActionError(
      error,
      month,
      "Unable to save public holiday.",
      settingsPath(month),
    );
  }
}

export async function deletePayrollHolidayAction(formData: FormData) {
  const month = monthFrom(formData);
  try {
    const context = await requireWholeBusinessPayroll("EDIT_PAYROLL_ENTRY");
    const holidayId = z.string().uuid().parse(formData.get("holidayId"));
    const request = await getAuditRequestContext();
    await prisma.$transaction(async (transaction) => {
      const holiday = await transaction.payrollHoliday.findFirst({
        where: { id: holidayId, businessId: context.businessId },
      });
      if (!holiday || !context.allowedBranchIds.includes(holiday.branchId)) {
        throw new Error("The public holiday was not found in your payroll scope.");
      }
      await transaction.payrollHoliday.delete({ where: { id: holiday.id } });
      await writeAuditLog(
        {
          businessId: context.businessId,
          branchId: holiday.branchId,
          actor: context.user,
          request,
          action: "PAYROLL_HOLIDAY_DELETED",
          entityType: "PayrollHoliday",
          entityId: holiday.id,
          summary: `${holiday.name} removed from payroll public holidays.`,
        },
        transaction,
      );
    });
    finish("success", "Public holiday removed.", month, settingsPath(month));
  } catch (error) {
    handleActionError(
      error,
      month,
      "Unable to remove public holiday.",
      settingsPath(month),
    );
  }
}

export async function generatePayrollRunAction(formData: FormData) {
  const month = monthFrom(formData);
  const requestedReturnPath = payrollRunReturnPath(
    formData.get("runId"),
    formData.get("returnPath"),
  );
  try {
    const period = parsePayrollMonth(month);
    const context = await requireWholeBusinessPayroll("CREATE_PAYROLL_RUN");
    const createOnly = formData.get("generationMode") === "CREATE_ONLY";
    if (createOnly) {
      const existing = await prisma.payrollRun.findUnique({
        where: {
          businessId_periodStart_periodEnd: {
            businessId: context.businessId,
            periodStart: period.start,
            periodEnd: period.end,
          },
        },
        select: { id: true },
      });
      if (existing) {
        finish(
          "success",
          "Payroll run already exists. Opened the existing run.",
          month,
          `/team/payroll/runs/${existing.id}`,
        );
      }
    }
    const run = await generatePayrollRun({
      businessId: context.businessId,
      actor: context.user,
      request: await getAuditRequestContext(),
      month,
    });
    const returnPath =
      requestedReturnPath && formData.get("runId") === run.id
        ? requestedReturnPath
        : formData.get("returnToRun") === "true"
          ? `/team/payroll/runs/${run.id}`
          : null;
    finish(
      "success",
      createOnly
        ? "Payroll draft generated from the current locked Attendance Timesheet."
        : "Payroll draft refreshed from the current locked Attendance Timesheet and Leave.",
      month,
      returnPath,
    );
  } catch (error) {
    handleActionError(
      error,
      month,
      "Unable to generate payroll draft.",
      requestedReturnPath,
    );
  }
}

export async function updatePayrollEntryAction(formData: FormData) {
  const month = monthFrom(formData);
  const returnPath = payrollRunReturnPath(
    formData.get("runId"),
    formData.get("returnPath"),
  );
  try {
    const context = await requirePayrollComponentEdit();
    await updatePayrollEntry({
      businessId: context.businessId,
      actor: context.user,
      request: await getAuditRequestContext(),
      entryId: z.string().uuid().parse(formData.get("entryId")),
      expectedRevision: z.coerce.number().int().min(0).parse(formData.get("expectedRevision")),
      values: {
        epfWageBase: formData.get("epfWageBase"),
        perkesoWageBase: formData.get("perkesoWageBase"),
        lindung24Employee: formData.get("lindung24Employee"),
        epfEmployee: formData.get("epfEmployee"),
        socsoEmployee: formData.get("socsoEmployee"),
        eisEmployee: formData.get("eisEmployee"),
        pcb: formData.get("pcb"),
        employerEpf: formData.get("employerEpf"),
        employerSocso: formData.get("employerSocso"),
        employerEis: formData.get("employerEis"),
        notes: formData.get("notes"),
      },
    });
    finish("success", "Payroll entry updated.", month, returnPath);
  } catch (error) {
    handleActionError(error, month, "Unable to update payroll entry.", returnPath);
  }
}

export async function decidePayrollHolidayPayAction(formData: FormData) {
  const month = monthFrom(formData);
  const runId = String(formData.get("runId") ?? "");
  const entryId = String(formData.get("entryId") ?? "");
  const parentReturnPath = payrollRunReturnPath(
    runId,
    formData.get("returnPath"),
  );
  const entryReturnPath = `/team/payroll/runs/${runId}/entries/${entryId}${
    parentReturnPath
      ? `?returnPath=${encodeURIComponent(parentReturnPath)}`
      : ""
  }`;
  try {
    const context = await requirePayrollComponentEdit();
    z.string().uuid().parse(runId);
    z.string().uuid().parse(entryId);
    const decision = z
      .enum(["CONFIRMED", "EXCLUDED"])
      .parse(formData.get("decision"));
    await decidePayrollHolidayPay({
      businessId: context.businessId,
      actor: context.user,
      request: await getAuditRequestContext(),
      entryId,
      expectedRevision: z.coerce
        .number()
        .int()
        .min(0)
        .parse(formData.get("expectedRevision")),
      decision,
      reason:
        decision === "EXCLUDED"
          ? String(formData.get("reason") ?? "")
          : undefined,
    });
    finish(
      "success",
      decision === "CONFIRMED"
        ? "Public holiday pay confirmed and included in this payroll draft."
        : "Public holiday pay excluded from this payroll draft with an audit reason.",
      month,
      entryReturnPath,
    );
  } catch (error) {
    handleActionError(
      error,
      month,
      "Unable to update the public holiday pay decision.",
      entryReturnPath,
    );
  }
}

export async function addManualPayrollAdjustmentAction(formData: FormData) {
  const month = monthFrom(formData);
  const returnPath = payrollRunReturnPath(formData.get("runId"), formData.get("returnPath"));
  try {
    const context = await requirePayrollComponentEdit();
    await addManualPayrollAdjustment({
      businessId: context.businessId,
      actor: context.user,
      request: await getAuditRequestContext(),
      entryId: z.string().uuid().parse(formData.get("entryId")),
      expectedRevision: z.coerce.number().int().min(0).parse(formData.get("expectedRevision")),
      type: z.enum(["EARNING", "DEDUCTION"]).parse(formData.get("type")),
      category: z.enum(["ONE_OFF", "CORRECTION", "ARREARS", "RECOVERY", "BONUS", "OTHER"]).parse(formData.get("category")),
      name: formData.get("description"),
      amount: formData.get("amount"),
      reason: formData.get("reason"),
    });
    finish("success", "Manual payroll adjustment added.", month, returnPath);
  } catch (error) {
    handleActionError(error, month, "Unable to add manual payroll adjustment.", returnPath);
  }
}

export async function createPayrollVariablePayAction(formData: FormData) {
  const month = monthFrom(formData);
  const returnPath = payrollRunReturnPath(formData.get("runId"), formData.get("returnPath"));
  try {
    const context = await requirePayrollComponentEdit();
    await createPayrollVariablePay(p4cEditContext(context, await getAuditRequestContext()), {
      membershipId: z.string().uuid().parse(formData.get("membershipId")),
      type: z.enum(["BONUS", "COMMISSION", "INCENTIVE", "ONE_OFF_EARNING", "ONE_OFF_DEDUCTION", "ARREARS", "RECOVERY"]).parse(formData.get("variableType")),
      name: formData.get("description"),
      amount: formData.get("amount"),
      earnedPeriodStart: formData.get("earnedPeriodStart"),
      earnedPeriodEnd: formData.get("earnedPeriodEnd"),
      payrollPeriod: month,
      origin: "MANUAL",
      sourceReference: formData.get("sourceReference"),
      reason: formData.get("reason"),
    });
    finish("success", "Variable pay draft created. A different approver must approve it before payroll refresh.", month, returnPath);
  } catch (error) {
    handleActionError(error, month, "Unable to create variable pay.", returnPath);
  }
}

export async function approvePayrollVariablePayAction(formData: FormData) {
  const month = monthFrom(formData);
  const returnPath = payrollRunReturnPath(formData.get("runId"), formData.get("returnPath"));
  try {
    const context = await requireP4CApprove();
    await approvePayrollVariablePay(p4cApproveContext(context, await getAuditRequestContext()), {
      variablePayId: z.string().uuid().parse(formData.get("variablePayId")),
      expectedRevision: z.coerce.number().int().positive().parse(formData.get("sourceRevision")),
    });
    finish("success", "Variable pay approved. Refresh the Draft payroll to apply it.", month, returnPath);
  } catch (error) {
    handleActionError(error, month, "Unable to approve variable pay.", returnPath);
  }
}

export async function cancelPayrollVariablePayAction(formData: FormData) {
  const month = monthFrom(formData);
  const returnPath = payrollRunReturnPath(formData.get("runId"), formData.get("returnPath"));
  try {
    const context = await requirePayrollComponentEdit();
    await cancelPayrollVariablePay(p4cEditContext(context, await getAuditRequestContext()), {
      variablePayId: z.string().uuid().parse(formData.get("variablePayId")),
      expectedRevision: z.coerce.number().int().positive().parse(formData.get("sourceRevision")),
      reason: formData.get("cancellationReason"),
    });
    finish("success", "Variable pay cancelled.", month, returnPath);
  } catch (error) {
    handleActionError(error, month, "Unable to cancel variable pay.", returnPath);
  }
}

export async function createPayrollCorrectionAction(formData: FormData) {
  const month = monthFrom(formData);
  const returnPath = payrollRunReturnPath(formData.get("runId"), formData.get("returnPath"));
  try {
    const context = await requirePayrollComponentEdit();
    await createPayrollCorrection(p4cEditContext(context, await getAuditRequestContext()), {
      originalPayrollEntryId: z.string().uuid().parse(formData.get("originalPayrollEntryId")),
      applyToPeriod: month,
      originalAmount: formData.get("originalAmount"),
      correctedAmount: formData.get("correctedAmount"),
      name: formData.get("description"),
      sourceReference: formData.get("sourceReference"),
      reason: formData.get("reason"),
    });
    finish("success", "Correction draft created. A different approver must approve it.", month, returnPath);
  } catch (error) {
    handleActionError(error, month, "Unable to create payroll correction.", returnPath);
  }
}

export async function approvePayrollCorrectionAction(formData: FormData) {
  const month = monthFrom(formData);
  const returnPath = payrollRunReturnPath(formData.get("runId"), formData.get("returnPath"));
  try {
    const context = await requireP4CApprove();
    await approvePayrollCorrection(p4cApproveContext(context, await getAuditRequestContext()), {
      correctionId: z.string().uuid().parse(formData.get("correctionId")),
      expectedRevision: z.coerce.number().int().positive().parse(formData.get("sourceRevision")),
    });
    finish("success", "Payroll correction approved. Refresh the Draft payroll to apply it.", month, returnPath);
  } catch (error) {
    handleActionError(error, month, "Unable to approve payroll correction.", returnPath);
  }
}

export async function cancelPayrollCorrectionAction(formData: FormData) {
  const month = monthFrom(formData);
  const returnPath = payrollRunReturnPath(formData.get("runId"), formData.get("returnPath"));
  try {
    const context = await requirePayrollComponentEdit();
    await cancelPayrollCorrection(p4cEditContext(context, await getAuditRequestContext()), {
      correctionId: z.string().uuid().parse(formData.get("correctionId")),
      expectedRevision: z.coerce.number().int().positive().parse(formData.get("sourceRevision")),
      reason: formData.get("cancellationReason"),
    });
    finish("success", "Payroll correction cancelled.", month, returnPath);
  } catch (error) {
    handleActionError(error, month, "Unable to cancel payroll correction.", returnPath);
  }
}

export async function editManualPayrollAdjustmentAction(formData: FormData) {
  const month = monthFrom(formData);
  const returnPath = payrollRunReturnPath(formData.get("runId"), formData.get("returnPath"));
  try {
    const context = await requirePayrollComponentEdit();
    await editManualPayrollAdjustment({
      businessId: context.businessId,
      actor: context.user,
      request: await getAuditRequestContext(),
      entryId: z.string().uuid().parse(formData.get("entryId")),
      componentId: z.string().uuid().parse(formData.get("componentId")),
      expectedRevision: z.coerce.number().int().min(0).parse(formData.get("expectedRevision")),
      name: formData.get("description"),
      amount: formData.get("amount"),
      reason: formData.get("reason"),
    });
    finish("success", "Manual payroll adjustment updated.", month, returnPath);
  } catch (error) {
    handleActionError(error, month, "Unable to update manual payroll adjustment.", returnPath);
  }
}

export async function removeManualPayrollAdjustmentAction(formData: FormData) {
  const month = monthFrom(formData);
  const returnPath = payrollRunReturnPath(formData.get("runId"), formData.get("returnPath"));
  try {
    const context = await requirePayrollComponentEdit();
    await removeManualPayrollAdjustment({
      businessId: context.businessId,
      actor: context.user,
      request: await getAuditRequestContext(),
      entryId: z.string().uuid().parse(formData.get("entryId")),
      componentId: z.string().uuid().parse(formData.get("componentId")),
      expectedRevision: z.coerce.number().int().min(0).parse(formData.get("expectedRevision")),
      reason: formData.get("removalReason"),
    });
    finish("success", "Manual payroll adjustment removed.", month, returnPath);
  } catch (error) {
    handleActionError(error, month, "Unable to remove manual payroll adjustment.", returnPath);
  }
}

export async function submitPayrollRunForReviewAction(formData: FormData) {
  const month = monthFrom(formData);
  const returnPath = payrollRunReturnPath(formData.get("runId"), formData.get("returnPath"));
  try {
    const context = await requireWholeBusinessPayroll("SUBMIT_PAYROLL_REVIEW");
    await submitPayrollRunForReview({
      businessId: context.businessId,
      actor: context.user,
      request: await getAuditRequestContext(),
      runId: z.string().uuid().parse(formData.get("runId")),
    });
    finish("success", "Payroll submitted for review.", month, returnPath);
  } catch (error) {
    handleActionError(error, month, "Unable to submit payroll for review.", returnPath);
  }
}

export async function returnPayrollRunToDraftAction(formData: FormData) {
  const month = monthFrom(formData);
  const returnPath = payrollRunReturnPath(formData.get("runId"), formData.get("returnPath"));
  try {
    const context = await requireWholeBusinessPayroll("RETURN_PAYROLL_TO_DRAFT");
    await returnPayrollRunToDraft({
      businessId: context.businessId,
      actor: context.user,
      request: await getAuditRequestContext(),
      runId: z.string().uuid().parse(formData.get("runId")),
      reason: workflowReasonSchema.parse(formData.get("reason")),
    });
    finish("success", "Payroll returned to draft.", month, returnPath);
  } catch (error) {
    handleActionError(error, month, "Unable to return payroll to draft.", returnPath);
  }
}

export async function finalizePayrollRunAction(formData: FormData) {
  const month = monthFrom(formData);
  const returnPath = payrollRunReturnPath(formData.get("runId"), formData.get("returnPath"));
  try {
    const context = await requireWholeBusinessPayroll("APPROVE_PAYROLL");
    const runId = z.string().uuid().parse(formData.get("runId"));
    await preflightPayrollFinalize(context.businessId, runId);
    const stepUp = await issuePayrollStepUp(
      context,
      formData,
      "PAYROLL_FINALIZE",
      runId,
    );
    const request = await getAuditRequestContext();
    await finalizePayrollRun({
      businessId: context.businessId,
      actor: context.user,
      request,
      runId,
      stepUp,
      allowSelfApprovalOverride:
        context.access.effectiveBusinessRole === "BUSINESS_OWNER",
      overrideReason: optionalFormValue(formData, "reason"),
    });
    const sync = await trySynchronizePayrollExpense({ businessId: context.businessId, actor: context.user, payrollRunId: runId, request });
    finish("success", sync.status === "DEFERRED" ? "Payroll finalized and locked. Expense cost is queued for reconciliation." : "Payroll finalized and locked; business-wide Expense cost recorded.", month, returnPath);
  } catch (error) {
    handleActionError(error, month, "Unable to finalize payroll.", returnPath);
  }
}

export async function reopenPayrollRunAction(formData: FormData) {
  const month = monthFrom(formData);
  const returnPath = payrollRunReturnPath(formData.get("runId"), formData.get("returnPath"));
  try {
    const context = await requireWholeBusinessPayroll("REOPEN_PAYROLL");
    const runId = z.string().uuid().parse(formData.get("runId"));
    const reason = workflowReasonSchema.parse(formData.get("reason"));
    await preflightPayrollReopen(context.businessId, runId);
    const stepUp = await issuePayrollStepUp(
      context,
      formData,
      "PAYROLL_REOPEN",
      runId,
    );
    const request = await getAuditRequestContext();
    await reopenPayrollRun({
      businessId: context.businessId,
      actor: context.user,
      request,
      runId,
      reason,
      stepUp,
    });
    const sync = await trySynchronizePayrollExpense({ businessId: context.businessId, actor: context.user, payrollRunId: runId, request });
    finish("success", sync.status === "DEFERRED" ? "Finalized payroll reopened. Expense supersession is queued for reconciliation." : "Finalized payroll reopened; prior Expense cost is now void with history retained.", month, returnPath);
  } catch (error) {
    handleActionError(error, month, "Unable to reopen finalized payroll.", returnPath);
  }
}

export async function publishPayrollPayslipsAction(formData: FormData) {
  const month = monthFrom(formData);
  const returnPath = payrollRunReturnPath(formData.get("runId"), formData.get("returnPath"));
  try {
    const context = await requireWholeBusinessPayroll("PUBLISH_PAYSLIP");
    const result = await publishPayrollPayslips({
      businessId: context.businessId,
      actor: context.user,
      request: await getAuditRequestContext(),
      runId: z.string().uuid().parse(formData.get("runId")),
    });
    finish(
      "success",
      result.publishedCount
        ? `${result.publishedCount} payslip(s) published from the frozen payroll snapshot.`
        : "All payslips were already published.",
      month,
      returnPath,
    );
  } catch (error) {
    handleActionError(error, month, "Unable to publish payslips.", returnPath);
  }
}

async function requireWholeBusinessPayroll(
  capability: BusinessCapability,
) {
  const context = await requireBusinessUser(capability);
  const scope = await resolveAttendanceScope(context.access);
  const activeBranchCount = await prisma.branch.count({
    where: { businessId: context.businessId, status: "ACTIVE" },
  });
  if (
    scope.allowedBranchIds.length !== activeBranchCount ||
    (context.access.effectiveBusinessRole === "STAFF" &&
      !context.access.permissions.includes("ALL_BRANCHES"))
  ) {
    throw new Error("Payroll requires authorized access to every active branch.");
  }
  return { ...context, allowedBranchIds: [...scope.allowedBranchIds] };
}

async function requirePayrollComponentEdit() {
  const context = await requireWholeBusinessPayroll("EDIT_PAYROLL_ENTRY");
  if (!hasBusinessCapability(context.access, "VIEW_COMPENSATION")) {
    throw new Error("Payroll component editing requires compensation access.");
  }
  return context;
}

async function requireP4CApprove() {
  const context = await requireWholeBusinessPayroll("APPROVE_PAYROLL");
  if (!hasBusinessCapability(context.access, "VIEW_COMPENSATION")) {
    throw new Error("Variable pay and correction approval requires compensation access.");
  }
  return context;
}

async function issuePayrollStepUp(
  context: Awaited<ReturnType<typeof requireWholeBusinessPayroll>>,
  formData: FormData,
  actionKey: SensitiveActionKey,
  resourceId: string,
) {
  const requestHeaders = await headers();
  assertServerActionSameOrigin(requestHeaders);
  return issuePayrollHighRiskAuthorization({
    access: context.access,
    actionKey,
    businessId: context.businessId,
    enabledModules: context.moduleContext.enabledModules,
    factor: payrollMfaFactor(formData),
    password: payrollMfaPassword(formData),
    request: getAuthRequestContext(requestHeaders),
    resourceId,
    user: context.user,
  });
}

async function preflightPayrollFinalize(businessId: string, runId: string) {
  const run = await prisma.payrollRun.findFirst({
    where: { businessId, id: runId },
    select: {
      attendanceSource: true,
      attendanceTimesheetDigestSnapshot: true,
      attendanceTimesheetLockedAtSnapshot: true,
      attendanceTimesheetRevisionId: true,
      attendanceTimesheetRevisionSnapshot: true,
      id: true,
      periodStart: true,
      status: true,
      _count: { select: { entries: true } },
    },
  });
  if (!run) throw new Error("Payroll run not found.");
  if (run.status !== "REVIEW") {
    throw new Error("Only payroll in Review can be finalized.");
  }
  await assertPayrollRunUsesCurrentLockedTimesheet({ businessId, run });
  if (run._count.entries === 0) {
    throw new Error("An empty payroll run cannot be finalized.");
  }
  const readiness = await getPayrollPeriodReadiness({
    businessId,
    month: run.periodStart.toISOString().slice(0, 7),
    runId,
  });
  assertPayrollReadinessCanProceed(readiness);
}

async function preflightPayrollReopen(businessId: string, runId: string) {
  const run = await prisma.payrollRun.findFirst({
    where: { businessId, id: runId },
    select: {
      id: true,
      status: true,
      paymentBatches: {
        where: {
          OR: [
            { status: { in: ["DRAFT", "AWAITING_APPROVAL", "APPROVED", "INSTRUCTION_READY"] } },
            { currentArtifactId: { not: null } },
          ],
        },
        take: 1,
        select: { id: true },
      },
      _count: {
        select: { payslipPublications: true, statutorySubmissions: true },
      },
    },
  });
  if (!run) throw new Error("Payroll run not found.");
  if (run.status !== "FINALIZED") {
    throw new Error("Only finalized payroll can be reopened.");
  }
  if (run.paymentBatches.length) {
    throw new Error("Payroll with an active or approved payment instruction cannot be reopened.");
  }
  if (run._count.statutorySubmissions) {
    throw new Error("Payroll with a statutory export or correction record cannot be reopened directly.");
  }
  if (run._count.payslipPublications) {
    throw new Error("Payroll with published payslips cannot be reopened.");
  }
}

function p4cEditContext(context: Awaited<ReturnType<typeof requirePayrollComponentEdit>>, request: Awaited<ReturnType<typeof getAuditRequestContext>>) {
  return { businessId: context.businessId, actor: context.user, request, capabilities: ["VIEW_COMPENSATION", "EDIT_PAYROLL_ENTRY"] as const };
}

function p4cApproveContext(context: Awaited<ReturnType<typeof requireP4CApprove>>, request: Awaited<ReturnType<typeof getAuditRequestContext>>) {
  return { businessId: context.businessId, actor: context.user, request, capabilities: ["VIEW_COMPENSATION", "APPROVE_PAYROLL"] as const };
}

function settingAudit(setting: {
  workingDaysPerMonth: number;
  normalWorkMinutesPerDay: number;
  breakMinutesPerDay: number;
  overtimeMultiplier: { toString(): string };
  publicHolidayExtraMultiplier: { toString(): string };
  publicHolidayPayEnabled: boolean;
  publicHolidayPayPolicyRevision: number;
  stateCode: string | null;
}) {
  return {
    workingDaysPerMonth: setting.workingDaysPerMonth,
    normalWorkMinutesPerDay: setting.normalWorkMinutesPerDay,
    breakMinutesPerDay: setting.breakMinutesPerDay,
    overtimeMultiplier: setting.overtimeMultiplier.toString(),
    publicHolidayExtraMultiplier:
      setting.publicHolidayExtraMultiplier.toString(),
    publicHolidayPayEnabled: setting.publicHolidayPayEnabled,
    publicHolidayPayPolicyRevision: setting.publicHolidayPayPolicyRevision,
    stateCode: setting.stateCode,
  };
}

function optionalFormValue(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || undefined;
}

function monthFrom(formData: FormData) {
  return String(formData.get("month") ?? new Date().toISOString().slice(0, 7));
}

function settingsPath(month: string) {
  return `/team/payroll/settings?month=${encodeURIComponent(month)}`;
}

function finish(
  type: "success" | "error",
  message: string,
  month: string,
  returnPath?: string | null,
): never {
  revalidatePath("/team/payroll/settings");
  revalidatePath("/team/payroll/workspace");
  revalidatePath("/team/approvals");
  revalidatePath("/team/payroll/runs");
  revalidatePath("/expenses");
  revalidatePath("/expenses/history");
  if (returnPath) revalidatePath(returnPath.split("?", 1)[0]);
  const destination = returnPath ?? "/team/payroll/workspace";
  const separator = destination.includes("?") ? "&" : "?";
  redirect(`${destination}${separator}type=${type}&message=${encodeURIComponent(message)}`);
}

function handleActionError(
  error: unknown,
  month: string,
  fallback: string,
  returnPath?: string | null,
): never {
  if (isRedirectError(error)) throw error;
  const message = error instanceof z.ZodError
    ? error.issues[0]?.message ?? fallback
    : getPublicPayrollErrorMessage(error, fallback);
  if (message === fallback) {
    console.error("[payroll-action] unexpected failure", error);
  }
  finish("error", message, month, returnPath);
}
