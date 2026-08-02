"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import {
  safeStatutoryContributionAuditSnapshot,
  writeSensitiveAuditLog,
} from "@/lib/audit/payroll-sensitive";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";
import { getPublicPayrollErrorMessage } from "@/lib/payroll/error-message";
import { payrollRunReturnPath } from "@/lib/payroll/runs";
import {
  finalizePayrollRun,
  generatePayrollRun,
  parsePayrollMonth,
  reopenPayrollRun,
  returnPayrollRunToDraft,
  submitPayrollRunForReview,
  updatePayrollEntry,
} from "@/lib/payroll/service";
import { prisma } from "@/lib/prisma";

const settingSchema = z.object({
  workingDaysPerMonth: z.coerce.number().int().min(1).max(31),
  normalWorkMinutesPerDay: z.coerce.number().int().min(1).max(1440),
  breakMinutesPerDay: z.coerce.number().int().min(0).max(720),
  overtimeMultiplier: z.coerce.number().min(1).max(10),
  publicHolidayExtraMultiplier: z.coerce.number().min(0).max(10),
  stateCode: z.string().trim().max(80).optional(),
});

const holidaySchema = z.object({
  branchId: z.string().uuid(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().trim().min(2).max(120),
});

const statutoryProfileSchema = z.object({
  membershipId: z.string().uuid(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  statutoryNationality: z.enum(["MALAYSIAN", "PERMANENT_RESIDENT", "NON_MALAYSIAN"]).optional(),
  socsoCategory: z.enum(["FIRST", "SECOND"]).optional(),
});

const workflowReasonSchema = z.string().trim().min(5).max(500);

export async function savePayrollSettingAction(formData: FormData) {
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
      stateCode: formData.get("stateCode"),
    });
    const request = await getAuditRequestContext();
    await prisma.$transaction(async (transaction) => {
      const before = await transaction.payrollSetting.findUnique({
        where: { businessId: context.businessId },
      });
      const after = await transaction.payrollSetting.upsert({
        where: { businessId: context.businessId },
        create: { businessId: context.businessId, ...input },
        update: input,
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
    finish("success", "Payroll settings saved.", monthFrom(formData));
  } catch (error) {
    handleActionError(error, monthFrom(formData), "Unable to save payroll settings.");
  }
}

export async function addPayrollHolidayAction(formData: FormData) {
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
    finish("success", "Public holiday saved.", monthFrom(formData));
  } catch (error) {
    handleActionError(error, monthFrom(formData), "Unable to save public holiday.");
  }
}

export async function deletePayrollHolidayAction(formData: FormData) {
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
    finish("success", "Public holiday removed.", monthFrom(formData));
  } catch (error) {
    handleActionError(error, monthFrom(formData), "Unable to remove public holiday.");
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
        ? "Payroll draft generated from approved Attendance."
        : "Payroll draft refreshed from current approved Attendance and Leave.",
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
    const context = await requireWholeBusinessPayroll("EDIT_PAYROLL_ENTRY");
    await updatePayrollEntry({
      businessId: context.businessId,
      actor: context.user,
      request: await getAuditRequestContext(),
      entryId: z.string().uuid().parse(formData.get("entryId")),
      values: {
        allowances: formData.get("allowances"),
        otherDeductions: formData.get("otherDeductions"),
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

export async function saveEmployeeStatutoryProfileAction(formData: FormData) {
  const month = monthFrom(formData);
  try {
    const context = await requireWholeBusinessPayroll("EDIT_STATUTORY_PROFILE");
    const input = statutoryProfileSchema.parse({
      membershipId: formData.get("membershipId"),
      dateOfBirth: optionalFormValue(formData, "dateOfBirth"),
      statutoryNationality: optionalFormValue(formData, "statutoryNationality"),
      socsoCategory: optionalFormValue(formData, "socsoCategory"),
    });
    const epfEnabled = formData.has("epfEnabled");
    const socsoEnabled = formData.has("socsoEnabled");
    const eisEnabled = formData.has("eisEnabled");
    if (
      (epfEnabled || socsoEnabled || eisEnabled) &&
      (!input.dateOfBirth || !input.statutoryNationality)
    ) {
      throw new Error("Date of birth and statutory nationality are required when automatic contributions are enabled.");
    }
    if (socsoEnabled && !input.socsoCategory) {
      throw new Error("Select the employee's SOCSO contribution category.");
    }
    const dateOfBirth = input.dateOfBirth
      ? new Date(`${input.dateOfBirth}T00:00:00.000Z`)
      : null;
    if (dateOfBirth && dateOfBirth >= new Date()) {
      throw new Error("Date of birth must be in the past.");
    }
    const request = await getAuditRequestContext();
    await prisma.$transaction(async (transaction) => {
      const before = await transaction.employeeBusinessMembership.findFirst({
        where: { id: input.membershipId, businessId: context.businessId },
        select: statutoryProfileSelect,
      });
      if (!before) {
        throw new Error("The employee was not found in your payroll scope.");
      }
      const after = await transaction.employeeBusinessMembership.update({
        where: { id: before.id },
        data: {
          dateOfBirth,
          statutoryNationality: input.statutoryNationality ?? null,
          epfEnabled,
          epfMemberBeforeAug1998: formData.has("epfMemberBeforeAug1998"),
          socsoEnabled,
          socsoCategory: socsoEnabled ? input.socsoCategory : null,
          eisEnabled,
          eisPreviouslyContributed: formData.has("eisPreviouslyContributed"),
          lindung24OptIn: socsoEnabled && formData.has("lindung24OptIn"),
          statutoryProfileUpdatedAt: new Date(),
        },
        select: statutoryProfileSelect,
      });
      await writeSensitiveAuditLog(
        {
          businessId: context.businessId,
          actor: context.user,
          request,
          action: "EMPLOYEE_STATUTORY_PROFILE_UPDATED",
          entityType: "EmployeeBusinessMembership",
          entityId: after.id,
          summary: "Employee statutory contribution profile updated.",
          before: safeStatutoryContributionAuditSnapshot(before),
          after: safeStatutoryContributionAuditSnapshot(after),
        },
        transaction,
      );
    });
    finish("success", "Statutory profile saved. Regenerate the draft to apply official schedules.", month);
  } catch (error) {
    handleActionError(error, month, "Unable to save statutory profile.");
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
    await finalizePayrollRun({
      businessId: context.businessId,
      actor: context.user,
      request: await getAuditRequestContext(),
      runId: z.string().uuid().parse(formData.get("runId")),
      allowSelfApprovalOverride:
        context.access.effectiveBusinessRole === "BUSINESS_OWNER",
      overrideReason: optionalFormValue(formData, "reason"),
    });
    finish("success", "Payroll finalized and locked.", month, returnPath);
  } catch (error) {
    handleActionError(error, month, "Unable to finalize payroll.", returnPath);
  }
}

export async function reopenPayrollRunAction(formData: FormData) {
  const month = monthFrom(formData);
  const returnPath = payrollRunReturnPath(formData.get("runId"), formData.get("returnPath"));
  try {
    const context = await requireWholeBusinessPayroll("REOPEN_PAYROLL");
    await reopenPayrollRun({
      businessId: context.businessId,
      actor: context.user,
      request: await getAuditRequestContext(),
      runId: z.string().uuid().parse(formData.get("runId")),
      reason: workflowReasonSchema.parse(formData.get("reason")),
    });
    finish("success", "Finalized payroll reopened as a draft.", month, returnPath);
  } catch (error) {
    handleActionError(error, month, "Unable to reopen finalized payroll.", returnPath);
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

function settingAudit(setting: {
  workingDaysPerMonth: number;
  normalWorkMinutesPerDay: number;
  breakMinutesPerDay: number;
  overtimeMultiplier: { toString(): string };
  publicHolidayExtraMultiplier: { toString(): string };
  stateCode: string | null;
}) {
  return {
    workingDaysPerMonth: setting.workingDaysPerMonth,
    normalWorkMinutesPerDay: setting.normalWorkMinutesPerDay,
    breakMinutesPerDay: setting.breakMinutesPerDay,
    overtimeMultiplier: setting.overtimeMultiplier.toString(),
    publicHolidayExtraMultiplier:
      setting.publicHolidayExtraMultiplier.toString(),
    stateCode: setting.stateCode,
  };
}

const statutoryProfileSelect = {
  id: true,
  dateOfBirth: true,
  statutoryNationality: true,
  epfEnabled: true,
  epfMemberBeforeAug1998: true,
  socsoEnabled: true,
  socsoCategory: true,
  eisEnabled: true,
  eisPreviouslyContributed: true,
  lindung24OptIn: true,
} as const;

function optionalFormValue(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || undefined;
}

function monthFrom(formData: FormData) {
  return String(formData.get("month") ?? new Date().toISOString().slice(0, 7));
}

function finish(
  type: "success" | "error",
  message: string,
  month: string,
  returnPath?: string | null,
): never {
  revalidatePath("/team/payroll");
  revalidatePath("/team/payroll/runs");
  if (returnPath) revalidatePath(returnPath.split("?", 1)[0]);
  const destination = returnPath ?? `/team/payroll?month=${encodeURIComponent(month)}`;
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
