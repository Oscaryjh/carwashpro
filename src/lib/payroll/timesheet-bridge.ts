import type { PayrollAttendanceSource, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type TimesheetBridgeDatabase =
  | Pick<PrismaClient, "attendanceMonthlyTimesheet" | "attendanceTimesheetP2DaySnapshot">
  | Prisma.TransactionClient;

export type LockedPayrollTimesheet = {
  timesheetId: string;
  revisionId: string;
  revision: number;
  periodStart: Date;
  sourceDigest: string;
  lockedAt: Date;
  entries: Array<{
    membershipId: string;
    branchId: string;
    workDate: Date;
    totalWorkedMinutes: number;
  }>;
  p2Days: Array<{
    id: string;
    membershipId: string;
    workDate: Date;
    outcome:
      | "PRESENT"
      | "PRESENT_LATE_AUTHORIZED"
      | "PRESENT_LATE_UNAUTHORIZED"
      | "PRESENT_EARLY_AUTHORIZED"
      | "PRESENT_EARLY_UNAUTHORIZED"
      | "AUTHORIZED_ABSENCE"
      | "UNAUTHORIZED_ABSENCE"
      | "APPROVED_PAID_LEAVE"
      | "APPROVED_UNPAID_LEAVE"
      | "AUTHORIZED_EMERGENCY_LEAVE"
      | "NOT_SCHEDULED"
      | "REST_DAY"
      | "PUBLIC_HOLIDAY"
      | "EXCLUDED";
    expectedDayKindSnapshot:
      | "WORKDAY"
      | "NOT_SCHEDULED"
      | "REST_DAY"
      | "PUBLIC_HOLIDAY"
      | null;
    leaveDayFractionSnapshot: { toString(): string } | null;
    totalWorkedMinutes: number;
    sourceDigest: string;
  }>;
};

export type PayrollRunAttendanceProvenance = {
  attendanceSource: PayrollAttendanceSource;
  attendanceTimesheetRevisionId: string | null;
  attendanceTimesheetRevisionSnapshot: number | null;
  attendanceTimesheetDigestSnapshot: string | null;
  attendanceTimesheetLockedAtSnapshot: Date | null;
  periodStart: Date;
};

export class PayrollTimesheetBridgeError extends Error {
  constructor(
    public readonly code:
      | "LOCKED_TIMESHEET_REQUIRED"
      | "PAYROLL_REFRESH_REQUIRED",
    message: string,
  ) {
    super(message);
    this.name = "PayrollTimesheetBridgeError";
  }
}

export async function resolveLockedPayrollTimesheet(
  args: { businessId: string; periodStart: Date },
  database: TimesheetBridgeDatabase = prisma,
): Promise<LockedPayrollTimesheet> {
  const timesheet = await database.attendanceMonthlyTimesheet.findUnique({
    where: {
      businessId_periodStart: {
        businessId: args.businessId,
        periodStart: args.periodStart,
      },
    },
    select: {
      id: true,
      periodStart: true,
      status: true,
      currentRevision: {
        select: {
          id: true,
          revision: true,
          periodStart: true,
          sourceDigest: true,
          lockedAt: true,
          entries: {
            where: { disposition: "INCLUDED" },
            orderBy: [{ workDate: "asc" }, { id: "asc" }],
            select: {
              employeeId: true,
              branchId: true,
              workDate: true,
              totalWorkedMinutes: true,
            },
          },
        },
      },
    },
  });
  const revision = timesheet?.status === "LOCKED" ? timesheet.currentRevision : null;
  if (!timesheet || !revision || revision.periodStart.getTime() !== args.periodStart.getTime()) {
    throw new PayrollTimesheetBridgeError(
      "LOCKED_TIMESHEET_REQUIRED",
      "Lock the monthly Attendance Timesheet before creating or refreshing Payroll.",
    );
  }

  const p2Days = await database.attendanceTimesheetP2DaySnapshot.findMany({
    where: { businessId: args.businessId, revisionId: revision.id },
    orderBy: [{ workDate: "asc" }, { membershipId: "asc" }, { id: "asc" }],
    select: {
      id: true,
      membershipId: true,
      workDate: true,
      outcome: true,
      expectedDayKindSnapshot: true,
      leaveDayFractionSnapshot: true,
      totalWorkedMinutes: true,
      sourceDigest: true,
    },
  });

  return {
    timesheetId: timesheet.id,
    revisionId: revision.id,
    revision: revision.revision,
    periodStart: revision.periodStart,
    sourceDigest: revision.sourceDigest,
    lockedAt: revision.lockedAt,
    entries: revision.entries.map((entry) => ({
      membershipId: entry.employeeId,
      branchId: entry.branchId,
      workDate: entry.workDate,
      totalWorkedMinutes: entry.totalWorkedMinutes,
    })),
    p2Days,
  };
}

export async function assertPayrollRunUsesCurrentLockedTimesheet(
  args: { businessId: string; run: PayrollRunAttendanceProvenance },
  database: TimesheetBridgeDatabase = prisma,
) {
  const current = await resolveLockedPayrollTimesheet(
    { businessId: args.businessId, periodStart: args.run.periodStart },
    database,
  );
  if (
    args.run.attendanceSource !== "LOCKED_TIMESHEET_REVISION" ||
    args.run.attendanceTimesheetRevisionId !== current.revisionId ||
    args.run.attendanceTimesheetRevisionSnapshot !== current.revision ||
    args.run.attendanceTimesheetDigestSnapshot !== current.sourceDigest ||
    args.run.attendanceTimesheetLockedAtSnapshot?.getTime() !==
      current.lockedAt.getTime()
  ) {
    throw new PayrollTimesheetBridgeError(
      "PAYROLL_REFRESH_REQUIRED",
      "Attendance has a newer locked Timesheet revision. Return this Payroll Run to Draft and refresh it before continuing.",
    );
  }
  return current;
}
