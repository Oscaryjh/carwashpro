import type { PayrollAttendanceSource, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type TimesheetBridgeDatabase =
  | Pick<
      PrismaClient,
      | "attendanceMonthlyTimesheet"
      | "attendanceTimesheetP2DaySnapshot"
      | "attendanceTimesheetP2SegmentSnapshot"
    >
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
    leaveRequestIdSnapshot: string | null;
    leaveRequestRevisionSnapshot: number | null;
    leaveRequestDigestSnapshot: string | null;
    leavePolicyIdSnapshot: string | null;
    leavePolicyVersionIdSnapshot: string | null;
    leavePolicyNameSnapshot: string | null;
    leavePayTreatmentSnapshot: "PAID" | "UNPAID" | null;
    leaveUnitSnapshot: "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | null;
    leaveLegalStatusSnapshot:
      | "COMPANY_POLICY_ONLY"
      | "VERIFIED_LEGAL"
      | "LEGAL_RULE_NOT_READY"
      | "LEGACY_REVIEW_REQUIRED"
      | null;
    leaveJurisdictionCodeSnapshot: string | null;
    leaveStatutoryRuleSetVersionSnapshot: string | null;
    leaveStatutoryRuleSetStatusSnapshot:
      | "DRAFT"
      | "READY_FOR_REVIEW"
      | "READY_FOR_HUMAN_SIGN_OFF"
      | "ACTIVE"
      | "SUPERSEDED"
      | null;
    leaveStatutoryCategorySnapshot:
      | "ANNUAL_LEAVE"
      | "SICK_LEAVE"
      | "HOSPITALISATION_LEAVE"
      | "MATERNITY_LEAVE"
      | "PATERNITY_LEAVE"
      | "UNPAID_LEAVE"
      | null;
    leaveStatutoryEligibilitySnapshot: Prisma.JsonValue | null;
    leaveStatutoryPayTreatmentSnapshot: Prisma.JsonValue | null;
    leaveComplianceStatusSnapshot:
      | "COMPLIANT"
      | "BELOW_MINIMUM"
      | "REVIEW_REQUIRED"
      | "NOT_APPLICABLE"
      | null;
    expectedStartAt: Date | null;
    expectedEndAt: Date | null;
    actualClockInAt: Date | null;
    actualClockOutAt: Date | null;
    timezoneSnapshot: string | null;
    crossMidnightSnapshot: boolean;
    potentialOtMinutes: number;
    approvedOtMinutes: number;
    otContext: "NORMAL" | "REST_DAY" | "PUBLIC_HOLIDAY" | null;
    otApprovalStatus:
      | "PENDING_REVIEW"
      | "APPROVED"
      | "REJECTED"
      | "ADJUSTED"
      | "NOT_APPLICABLE";
    otApprovalRef: string | null;
    otApprovalRevision: number | null;
    totalWorkedMinutes: number;
    sourceDigest: string;
  }>;
  p2Segments: Array<{
    id: string;
    sourceDaySnapshotId: string;
    sourceFinalResultId: string;
    sourceAttendanceId: string | null;
    membershipId: string;
    branchId: string;
    segmentIndex: number;
    localDate: Date;
    startAt: Date;
    endAt: Date;
    timezoneSnapshot: string;
    context: "NORMAL" | "REST_DAY" | "PUBLIC_HOLIDAY";
    expectedDayKindSnapshot:
      | "WORKDAY"
      | "NOT_SCHEDULED"
      | "REST_DAY"
      | "PUBLIC_HOLIDAY"
      | null;
    expectedStartAt: Date | null;
    expectedEndAt: Date | null;
    isRestDay: boolean;
    isPublicHoliday: boolean;
    isUnscheduled: boolean;
    holidayContextSnapshot: Prisma.JsonValue | null;
    leaveRequestIdSnapshot: string | null;
    leaveDayFractionSnapshot: { toString(): string } | null;
    grossMinutes: number;
    breakMinutes: number;
    workedMinutes: number;
    potentialOtMinutes: number;
    approvedOtMinutes: number;
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
      leaveRequestIdSnapshot: true,
      leaveRequestRevisionSnapshot: true,
      leaveRequestDigestSnapshot: true,
      leavePolicyIdSnapshot: true,
      leavePolicyVersionIdSnapshot: true,
      leavePolicyNameSnapshot: true,
      leavePayTreatmentSnapshot: true,
      leaveUnitSnapshot: true,
      leaveLegalStatusSnapshot: true,
      leaveJurisdictionCodeSnapshot: true,
      leaveStatutoryRuleSetVersionSnapshot: true,
      leaveStatutoryRuleSetStatusSnapshot: true,
      leaveStatutoryCategorySnapshot: true,
      leaveStatutoryEligibilitySnapshot: true,
      leaveStatutoryPayTreatmentSnapshot: true,
      leaveComplianceStatusSnapshot: true,
      expectedStartAt: true,
      expectedEndAt: true,
      actualClockInAt: true,
      actualClockOutAt: true,
      timezoneSnapshot: true,
      crossMidnightSnapshot: true,
      potentialOtMinutes: true,
      approvedOtMinutes: true,
      otContext: true,
      otApprovalStatus: true,
      otApprovalRef: true,
      otApprovalRevision: true,
      totalWorkedMinutes: true,
      sourceDigest: true,
    },
  });

  const p2Segments = await database.attendanceTimesheetP2SegmentSnapshot.findMany({
    where: { businessId: args.businessId, revisionId: revision.id },
    orderBy: [
      { localDate: "asc" },
      { membershipId: "asc" },
      { startAt: "asc" },
      { segmentIndex: "asc" },
      { id: "asc" },
    ],
    select: {
      id: true,
      sourceDaySnapshotId: true,
      sourceFinalResultId: true,
      sourceAttendanceId: true,
      membershipId: true,
      branchId: true,
      segmentIndex: true,
      localDate: true,
      startAt: true,
      endAt: true,
      timezoneSnapshot: true,
      context: true,
      expectedDayKindSnapshot: true,
      expectedStartAt: true,
      expectedEndAt: true,
      isRestDay: true,
      isPublicHoliday: true,
      isUnscheduled: true,
      holidayContextSnapshot: true,
      leaveRequestIdSnapshot: true,
      leaveDayFractionSnapshot: true,
      grossMinutes: true,
      breakMinutes: true,
      workedMinutes: true,
      potentialOtMinutes: true,
      approvedOtMinutes: true,
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
    p2Segments,
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
