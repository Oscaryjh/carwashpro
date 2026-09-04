import { getEmployeeAttendanceHistory } from "@/lib/attendance/read-service";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { getEmployeeTimesheetOverview } from "@/lib/attendance/employee-timesheet";
import {
  getMissingClockOutCorrectionHref,
  getMissingClockOutCorrectionState,
} from "@/lib/staff-pwa/attendance-correction-eligibility";

export type StaffTimeHubModel = Readonly<{
  attention: Readonly<{
    count: number;
    meta: string;
    href: string;
  }> | null;
  timesheet: Readonly<{
    month: string;
    summary: string;
  }> | null;
}>;

export async function getStaffTimeHub(
  auth: EmployeeAuthContext,
): Promise<StaffTimeHubModel> {
  const [historyResult, timesheetResult] = await Promise.allSettled([
    getEmployeeAttendanceHistory({ auth, input: { page: 1, pageSize: 100 } }),
    getEmployeeTimesheetOverview(auth),
  ]);

  const history = historyResult.status === "fulfilled"
    ? historyResult.value
    : null;
  const actionable = history?.items.filter(
    (item) => getMissingClockOutCorrectionState(item) === "ACTIONABLE",
  ) ?? [];
  const timesheet = timesheetResult.status === "fulfilled"
    ? summarizeTimesheet(timesheetResult.value)
    : null;

  return {
    attention: actionable.length
      ? {
          count: actionable.length,
          href: getMissingClockOutCorrectionHref(actionable[0]!),
          meta: actionable.length === 1
            ? `${formatShortDate(actionable[0]!.workDate)} · Missing clock out`
            : `${actionable.length} items to fix`,
        }
      : null,
    timesheet,
  };
}

function summarizeTimesheet(
  overview: Awaited<ReturnType<typeof getEmployeeTimesheetOverview>>,
): { month: string; summary: string } {
  const actionCount = overview.days.filter((day) => day.status === "ACTION_NEEDED").length;
  const waitingDays = overview.days.filter((day) => day.status === "WAITING_FOR_MANAGER").length;
  const overtimeRows = overview.timesheetStatus === "LOCKED"
    ? overview.lockedOvertime
    : overview.overtime;
  const waitingOvertime = overtimeRows.filter((item) => (
    "otApprovalStatus" in item
      ? item.otApprovalStatus === "PENDING_REVIEW"
      : item.effectiveStatus === "PENDING_REVIEW"
  )).length;
  const waitingCount = waitingDays + waitingOvertime;
  return {
    month: formatMonth(overview.monthStart),
    summary: actionCount
      ? `${actionCount} ${actionCount === 1 ? "item needs" : "items need"} attention`
      : waitingCount
        ? `${waitingCount} ${waitingCount === 1 ? "item" : "items"} awaiting manager review`
        : overview.timesheetStatus === "LOCKED"
          ? "Final"
          : "Up to date",
  };
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatMonth(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(value);
}
