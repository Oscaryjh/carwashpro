import type { PrismaClient } from "@prisma/client";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { listAttendanceOvertimeCandidates } from "@/lib/attendance/overtime-service";
import { prisma } from "@/lib/prisma";

export async function getEmployeeTimesheetOverview(
  auth: EmployeeAuthContext,
  options: { database?: PrismaClient; now?: Date } = {},
) {
  const database = options.database ?? prisma;
  const now = options.now ?? new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEndExclusive = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const allowedBranchIds = [...new Set([auth.primaryBranchId, auth.attendanceBranchId].filter(Boolean))] as string[];
  const [rows, exceptions, overtime, timesheet] = await Promise.all([
    database.attendanceP2FinalResult.findMany({
      where: {
        businessId: auth.businessId,
        membershipId: auth.membershipId,
        workDate: { gte: monthStart },
      },
      orderBy: [{ workDate: "desc" }, { version: "desc" }],
    }),
    database.attendanceP2Exception.findMany({
      where: {
        businessId: auth.businessId,
        membershipId: auth.membershipId,
        status: { in: ["OPEN", "PENDING_EMPLOYEE", "PENDING_MANAGER"] },
      },
      orderBy: [{ workDate: "desc" }, { detectedAt: "desc" }],
    }),
    listAttendanceOvertimeCandidates({
      businessId: auth.businessId,
      allowedBranchIds,
      periodStart: monthStart,
      periodEndExclusive: monthEndExclusive,
      membershipId: auth.membershipId,
      database,
    }),
    database.attendanceMonthlyTimesheet.findUnique({
      where: {
        businessId_periodStart: {
          businessId: auth.businessId,
          periodStart: monthStart,
        },
      },
      select: { status: true, currentRevisionId: true },
    }),
  ]);
  const latest = [
    ...new Map(
      rows.map((row) => [row.workDate.toISOString().slice(0, 10), row]),
    ).values(),
  ];
  const lockedOvertime = timesheet?.status === "LOCKED" && timesheet.currentRevisionId
    ? await database.attendanceTimesheetP2DaySnapshot.findMany({
        where: {
          revisionId: timesheet.currentRevisionId,
          businessId: auth.businessId,
          membershipId: auth.membershipId,
          potentialOtMinutes: { gt: 0 },
        },
        orderBy: { workDate: "desc" },
        select: {
          id: true,
          workDate: true,
          potentialOtMinutes: true,
          approvedOtMinutes: true,
          otContext: true,
          otApprovalStatus: true,
        },
      })
    : [];
  return { monthStart, latest, exceptions, overtime, lockedOvertime, timesheetStatus: timesheet?.status ?? "DRAFT" };
}
