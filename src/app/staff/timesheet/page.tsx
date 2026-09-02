import type { Metadata } from "next";
import { StaffTimesheetV2 } from "@/components/staff-pwa/staff-timesheet-v2";
import { getEmployeeTimesheetOverview } from "@/lib/attendance/employee-timesheet";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";
import {
  buildStaffTimesheetV2Rows,
  parseStaffTimesheetMonth,
  staffTimesheetMonthHref,
  summarizeStaffTimesheetV2,
  type StaffTimesheetV2Overtime,
} from "@/lib/staff-pwa/timesheet-v2";

export const metadata: Metadata = { title: "Timesheet & overtime" };
export const dynamic = "force-dynamic";

export default async function StaffTimesheetPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const auth = await requireEmployeeModulePage("HR");
  const query = await searchParams;
  const monthStart = parseStaffTimesheetMonth(query.month);
  const overview = await getEmployeeTimesheetOverview(auth, { now: monthStart });
  const overtime = normalizeOvertime(overview);
  const rows = buildStaffTimesheetV2Rows({ days: overview.days, overtime });
  const summary = summarizeStaffTimesheetV2(rows, overview.timesheetStatus);

  return (
    <StaffTimesheetV2
      monthStart={overview.monthStart}
      nextHref={staffTimesheetMonthHref(overview.monthStart, 1)}
      previousHref={staffTimesheetMonthHref(overview.monthStart, -1)}
      rows={rows}
      summary={summary}
      timesheetStatus={overview.timesheetStatus}
    />
  );
}

function normalizeOvertime(
  overview: Awaited<ReturnType<typeof getEmployeeTimesheetOverview>>,
): StaffTimesheetV2Overtime[] {
  if (overview.timesheetStatus === "LOCKED") {
    return overview.lockedOvertime.map((item) => ({
      key: item.id,
      membershipId: item.membershipId,
      workDate: item.workDate,
      finalResultId: item.finalResultId,
      status: item.otApprovalStatus,
      potentialMinutes: item.potentialOtMinutes,
      approvedMinutes: item.approvedOtMinutes,
      managerReason: null,
      locked: true,
    }));
  }

  return overview.overtime.map((item) => ({
    key: item.finalResultId,
    membershipId: item.membershipId,
    workDate: item.workDate,
    finalResultId: item.finalResultId,
    status: item.effectiveStatus,
    potentialMinutes: item.potentialOtMinutes,
    approvedMinutes: item.review?.approvedOtMinutes ?? 0,
    managerReason: item.review?.reason ?? null,
    locked: false,
  }));
}
