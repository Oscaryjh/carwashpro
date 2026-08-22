import type { PrismaClient } from "@prisma/client";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { listAttendanceOvertimeCandidates } from "@/lib/attendance/overtime-service";
import { parseAttendanceTimesheetMonth } from "@/lib/attendance/timesheet-service";
import { prisma } from "@/lib/prisma";
import type { StaffTimesheetDay } from "@/lib/staff-pwa/timesheet";

export async function getEmployeeTimesheetOverview(
  auth: EmployeeAuthContext,
  options: { database?: PrismaClient; now?: Date; month?: string } = {},
) {
  const database = options.database ?? prisma;
  const now = options.now ?? new Date();
  const business = await database.business.findUniqueOrThrow({
    where: { id: auth.businessId },
    select: { timezone: true },
  });
  const currentMonth = monthKeyInTimezone(now, business.timezone);
  const period = parseAttendanceTimesheetMonth(options.month ?? currentMonth);
  const allowedBranchIds = [...new Set([
    auth.primaryBranchId,
    auth.attendanceBranchId,
  ].filter(Boolean))] as string[];
  const timesheet = await database.attendanceMonthlyTimesheet.findUnique({
    where: {
      businessId_periodStart: {
        businessId: auth.businessId,
        periodStart: period.periodStart,
      },
    },
    select: {
      status: true,
      currentRevisionId: true,
      currentRevision: { select: { revision: true, lockedAt: true } },
    },
  });

  if (timesheet?.status === "LOCKED" && timesheet.currentRevisionId) {
    const snapshots = await database.attendanceTimesheetP2DaySnapshot.findMany({
      where: {
        revisionId: timesheet.currentRevisionId,
        businessId: auth.businessId,
        membershipId: auth.membershipId,
      },
      orderBy: { workDate: "desc" },
      select: {
        id: true,
        workDate: true,
        outcome: true,
        expectedDayKindSnapshot: true,
        leavePolicyNameSnapshot: true,
        leaveDayFractionSnapshot: true,
        expectedStartAt: true,
        expectedEndAt: true,
        actualClockInAt: true,
        actualClockOutAt: true,
        timezoneSnapshot: true,
        totalBreakMinutes: true,
        totalWorkedMinutes: true,
        potentialOtMinutes: true,
        approvedOtMinutes: true,
        otContext: true,
        otApprovalStatus: true,
        finalResultVersion: true,
      },
    });
    const latest: StaffTimesheetDay[] = snapshots.map((row) => ({
      id: row.id,
      workDate: row.workDate,
      outcome: row.outcome,
      expectedDayKind: row.expectedDayKindSnapshot,
      leaveName: row.leavePolicyNameSnapshot,
      leaveDayFraction: row.leaveDayFractionSnapshot === null
        ? null
        : Number(row.leaveDayFractionSnapshot),
      expectedStartAt: row.expectedStartAt,
      expectedEndAt: row.expectedEndAt,
      actualClockInAt: row.actualClockInAt,
      actualClockOutAt: row.actualClockOutAt,
      timezone: row.timezoneSnapshot ?? business.timezone,
      totalBreakMinutes: row.totalBreakMinutes,
      totalWorkedMinutes: row.totalWorkedMinutes,
      potentialOtMinutes: row.potentialOtMinutes,
      approvedOtMinutes: row.approvedOtMinutes,
      otApprovalStatus: row.otApprovalStatus,
      version: row.finalResultVersion,
      locked: true,
    }));
    return {
      month: period.month,
      monthStart: period.periodStart,
      monthEndExclusive: period.periodEndExclusive,
      currentMonth,
      isFutureMonth: period.month > currentMonth,
      businessTimezone: business.timezone,
      latest,
      exceptions: [],
      overtime: [],
      lockedOvertime: snapshots.filter((row) => row.potentialOtMinutes > 0),
      timesheetStatus: timesheet.status,
      lockedRevision: timesheet.currentRevision?.revision ?? null,
      lockedAt: timesheet.currentRevision?.lockedAt ?? null,
    };
  }

  const [rows, exceptions, overtime] = await Promise.all([
    database.attendanceP2FinalResult.findMany({
      where: {
        businessId: auth.businessId,
        membershipId: auth.membershipId,
        workDate: { gte: period.periodStart, lt: period.periodEndExclusive },
      },
      orderBy: [{ workDate: "desc" }, { version: "desc" }],
    }),
    database.attendanceP2Exception.findMany({
      where: {
        businessId: auth.businessId,
        membershipId: auth.membershipId,
        workDate: { gte: period.periodStart, lt: period.periodEndExclusive },
        status: { in: ["OPEN", "PENDING_EMPLOYEE", "PENDING_MANAGER"] },
      },
      orderBy: [{ workDate: "desc" }, { detectedAt: "desc" }],
    }),
    listAttendanceOvertimeCandidates({
      businessId: auth.businessId,
      allowedBranchIds,
      periodStart: period.periodStart,
      periodEndExclusive: period.periodEndExclusive,
      membershipId: auth.membershipId,
      database,
    }),
  ]);
  const finalRows = [
    ...new Map(rows.map((row) => [row.workDate.toISOString().slice(0, 10), row])).values(),
  ];
  const leaveIds = [...new Set(finalRows.flatMap((row) => row.leaveRequestId ? [row.leaveRequestId] : []))];
  const leaveNames = leaveIds.length
    ? new Map((await database.leaveRequest.findMany({
        where: { businessId: auth.businessId, id: { in: leaveIds } },
        select: { id: true, policyNameSnapshot: true },
      })).map((leave) => [leave.id, leave.policyNameSnapshot]))
    : new Map<string, string>();
  const overtimeByDate = new Map(overtime.map((item) => [
    item.workDate.toISOString().slice(0, 10),
    item,
  ]));
  const latest: StaffTimesheetDay[] = finalRows.map((row) => {
    const overtimeItem = overtimeByDate.get(row.workDate.toISOString().slice(0, 10));
    const approvedOtMinutes = overtimeItem &&
      (overtimeItem.effectiveStatus === "APPROVED" || overtimeItem.effectiveStatus === "ADJUSTED")
      ? overtimeItem.review?.approvedOtMinutes ?? 0
      : 0;
    return {
      id: row.id,
      workDate: row.workDate,
      outcome: row.outcome,
      expectedDayKind: row.expectedDayKindSnapshot,
      leaveName: row.leaveRequestId ? leaveNames.get(row.leaveRequestId) ?? null : null,
      leaveDayFraction: row.leaveDayFractionSnapshot === null
        ? null
        : Number(row.leaveDayFractionSnapshot),
      expectedStartAt: row.expectedStartAt,
      expectedEndAt: row.expectedEndAt,
      actualClockInAt: row.actualClockInAt,
      actualClockOutAt: row.actualClockOutAt,
      timezone: business.timezone,
      totalBreakMinutes: row.totalBreakMinutes,
      totalWorkedMinutes: row.totalWorkedMinutes,
      potentialOtMinutes: overtimeItem?.potentialOtMinutes ?? 0,
      approvedOtMinutes,
      otApprovalStatus: overtimeItem?.effectiveStatus ?? "NOT_APPLICABLE",
      version: row.version,
      locked: false,
    };
  });
  return {
    month: period.month,
    monthStart: period.periodStart,
    monthEndExclusive: period.periodEndExclusive,
    currentMonth,
    isFutureMonth: period.month > currentMonth,
    businessTimezone: business.timezone,
    latest,
    exceptions,
    overtime,
    lockedOvertime: [],
    timesheetStatus: timesheet?.status ?? "DRAFT",
    lockedRevision: null,
    lockedAt: null,
  };
}

function monthKeyInTimezone(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    timeZone: timezone,
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) throw new Error("Unable to resolve the business month.");
  return `${year}-${month}`;
}
