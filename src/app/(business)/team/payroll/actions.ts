"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import {
  finalizePayrollRun,
  generatePayrollRun,
  parsePayrollMonth,
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

export async function savePayrollSettingAction(formData: FormData) {
  try {
    const context = await requireWholeBusinessPayroll("MODIFY_PAYROLL");
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
    const context = await requireWholeBusinessPayroll("MODIFY_PAYROLL");
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
    const context = await requireWholeBusinessPayroll("MODIFY_PAYROLL");
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
  try {
    parsePayrollMonth(month);
    const context = await requireWholeBusinessPayroll("MODIFY_PAYROLL");
    await generatePayrollRun({
      businessId: context.businessId,
      actor: context.user,
      request: await getAuditRequestContext(),
      month,
    });
    finish("success", "Payroll draft generated from approved Attendance.", month);
  } catch (error) {
    handleActionError(error, month, "Unable to generate payroll draft.");
  }
}

export async function updatePayrollEntryAction(formData: FormData) {
  const month = monthFrom(formData);
  try {
    const context = await requireWholeBusinessPayroll("MODIFY_PAYROLL");
    await updatePayrollEntry({
      businessId: context.businessId,
      actor: context.user,
      request: await getAuditRequestContext(),
      entryId: z.string().uuid().parse(formData.get("entryId")),
      values: {
        allowances: formData.get("allowances"),
        otherDeductions: formData.get("otherDeductions"),
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
    finish("success", "Payroll entry updated.", month);
  } catch (error) {
    handleActionError(error, month, "Unable to update payroll entry.");
  }
}

export async function finalizePayrollRunAction(formData: FormData) {
  const month = monthFrom(formData);
  try {
    const context = await requireWholeBusinessPayroll("MODIFY_PAYROLL");
    await finalizePayrollRun({
      businessId: context.businessId,
      actor: context.user,
      request: await getAuditRequestContext(),
      runId: z.string().uuid().parse(formData.get("runId")),
    });
    finish("success", "Payroll finalized and locked.", month);
  } catch (error) {
    handleActionError(error, month, "Unable to finalize payroll.");
  }
}

async function requireWholeBusinessPayroll(
  capability: "VIEW_PAYROLL" | "MODIFY_PAYROLL",
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

function monthFrom(formData: FormData) {
  return String(formData.get("month") ?? new Date().toISOString().slice(0, 7));
}

function finish(type: "success" | "error", message: string, month: string): never {
  revalidatePath("/team/payroll");
  redirect(`/team/payroll?month=${encodeURIComponent(month)}&type=${type}&message=${encodeURIComponent(message)}`);
}

function handleActionError(error: unknown, month: string, fallback: string): never {
  if (isRedirectError(error)) throw error;
  const message = error instanceof z.ZodError
    ? error.issues[0]?.message ?? fallback
    : error instanceof Error
      ? error.message
      : fallback;
  finish("error", message, month);
}
