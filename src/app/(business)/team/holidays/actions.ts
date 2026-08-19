"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { getAuditRequestContext } from "@/lib/audit";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import {
  cancelHolidayOccurrence,
  createHolidayOccurrence,
  importOfficialHolidayCalendar,
  reviseHolidayOccurrence,
  updateBranchHolidayJurisdiction,
} from "@/lib/holidays/service";

export async function importOfficialHolidayCalendarAction(formData: FormData) {
  const year = holidayYear(formData);
  try {
    const context = await holidayWriteContext();
    const result = await importOfficialHolidayCalendar({
      ...context,
      countryCode: text(formData, "countryCode") || "MY",
      stateCode: text(formData, "stateCode") || null,
      year,
    });
    done(year, result.createdCount === 0
      ? "Official holiday calendar is already complete. No records were changed."
      : `${result.createdCount} missing official holidays added. Existing records and historical evidence were not changed.`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    done(year, message(error), "error");
  }
}

export async function createHolidayAction(formData: FormData) {
  const year = holidayYear(formData);
  try {
    const context = await holidayWriteContext();
    await createHolidayOccurrence({ ...context, input: holidayInput(formData) });
    done(year, "Holiday added. Roster, Attendance, Timesheet and Payroll facts were not changed.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    done(year, message(error), "error");
  }
}

export async function reviseHolidayAction(formData: FormData) {
  const year = holidayYear(formData);
  try {
    const context = await holidayWriteContext();
    await reviseHolidayOccurrence({
      ...context,
      holidayId: text(formData, "holidayId"),
      input: holidayInput(formData),
    });
    done(year, "Holiday correction saved as a new audited version. Locked history was not rewritten.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    done(year, message(error), "error");
  }
}

export async function cancelHolidayAction(formData: FormData) {
  const year = holidayYear(formData);
  try {
    const context = await holidayWriteContext();
    await cancelHolidayOccurrence({
      ...context,
      holidayId: text(formData, "holidayId"),
      reason: text(formData, "reason"),
    });
    done(year, "Company holiday cancelled. Existing locked evidence remains unchanged.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    done(year, message(error), "error");
  }
}

export async function updateHolidayJurisdictionAction(formData: FormData) {
  const year = holidayYear(formData);
  try {
    const context = await holidayWriteContext();
    await updateBranchHolidayJurisdiction({
      ...context,
      branchId: text(formData, "branchId"),
      countryCode: text(formData, "countryCode") || "MY",
      stateCode: text(formData, "stateCode") || null,
    });
    done(year, "Branch holiday jurisdiction saved.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    done(year, message(error), "error");
  }
}

async function holidayWriteContext() {
  const { access, user, businessId } = await requireBusinessUser("MANAGE_SHIFT_TEMPLATES");
  const [scope, request] = await Promise.all([
    resolveAttendanceScope(access),
    getAuditRequestContext(),
  ]);
  return { businessId, allowedBranchIds: scope.allowedBranchIds, actor: user, request };
}

function holidayInput(formData: FormData) {
  return {
    branchId: text(formData, "branchId") || null,
    workDate: utcDate(text(formData, "workDate")),
    name: text(formData, "name"),
    holidayType: text(formData, "holidayType"),
    source: text(formData, "source"),
    scope: text(formData, "scope"),
    countryCode: text(formData, "countryCode") || "MY",
    stateCode: text(formData, "stateCode") || null,
    statutory: formData.get("statutory") === "on",
    officialReference: text(formData, "officialReference") || null,
    reason: text(formData, "reason") || null,
  };
}

function utcDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Select a valid holiday date.");
  return new Date(`${value}T00:00:00.000Z`);
}

function holidayYear(formData: FormData) {
  const value = Number(text(formData, "year"));
  return Number.isInteger(value) && value >= 2000 && value <= 2200 ? value : new Date().getFullYear();
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function done(year: number, messageText: string, type: "success" | "error" = "success"): never {
  revalidatePath("/team/holidays");
  revalidatePath("/team/roster");
  revalidatePath("/staff/roster");
  revalidatePath("/team/attendance/timesheets");
  redirect(`/team/holidays?year=${year}&type=${type}&message=${encodeURIComponent(messageText)}`);
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Unable to update the holiday calendar.";
}
