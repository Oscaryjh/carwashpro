import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildAttendanceExceptionWhere,
  buildAttendanceSessionWhere,
} from "@/lib/attendance/scope";
import { calculateAttendanceDurations } from "@/lib/attendance/state-machine";
import { getBranchLocalDateKey } from "@/lib/attendance/work-date";
import { prisma } from "@/lib/prisma";
import {
  buildCurrentPeopleAssignmentWhere,
  buildPeopleMembershipScopeWhere,
  type PeopleScopeInput,
} from "@/lib/team/people-scope";

type EmployeeAttendanceSectionInput = PeopleScopeInput & {
  membershipId: string;
};

export async function loadEmployeeAttendanceSection(
  input: EmployeeAttendanceSectionInput,
  database: PrismaClient = prisma,
) {
  const currentAssignmentWhere = buildCurrentPeopleAssignmentWhere(input);
  const membership = await database.employeeBusinessMembership.findFirst({
    where: {
      ...buildPeopleMembershipScopeWhere(input),
      id: input.membershipId,
    },
    select: {
      id: true,
      attendanceEnabled: true,
      normalWorkMinutesPerDay: true,
      targetBreakMinutes: true,
      business: {
        select: {
          timezone: true,
        },
      },
      branchAssignments: {
        where: currentAssignmentWhere,
        orderBy: [{ isPrimary: "desc" }, { branch: { name: "asc" } }],
        select: {
          id: true,
          canClockIn: true,
          isPrimary: true,
          branch: {
            select: {
              id: true,
              name: true,
              attendanceSetting: {
                select: {
                  normalWorkMinutesPerDay: true,
                  targetBreakMinutes: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!membership) {
    return null;
  }

  const attendanceScope = {
    allowedBranchIds: input.allowedBranchIds,
    businessId: input.businessId,
  };
  const monthKey = getBranchLocalDateKey(
    input.now,
    membership.business.timezone,
  ).slice(0, 7);
  const [year, month] = monthKey.split("-").map(Number);
  const monthFrom = new Date(Date.UTC(year, month - 1, 1));
  const monthTo = new Date(Date.UTC(year, month, 1));
  const todayWorkDate = new Date(
    `${getBranchLocalDateKey(input.now, membership.business.timezone)}T00:00:00.000Z`,
  );
  const sessionScope = {
    membershipId: membership.id,
  };

  const [activeSession, todaySessions, monthlySessions, recentAttendance, pendingApprovalCount, pendingExceptionCount] =
    await Promise.all([
      database.employeeAttendance.findFirst({
        where: buildAttendanceSessionWhere<Prisma.EmployeeAttendanceWhereInput>(attendanceScope, {
          ...sessionScope,
          status: { in: ["OPEN", "ON_BREAK"] },
        }),
        orderBy: { clockInAt: "desc" },
        select: {
          id: true,
          status: true,
          branch: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      database.employeeAttendance.findMany({
        where: buildAttendanceSessionWhere<Prisma.EmployeeAttendanceWhereInput>(attendanceScope, {
          ...sessionScope,
          workDate: todayWorkDate,
          status: { not: "CANCELLED" },
        }),
        orderBy: { clockInAt: "asc" },
        select: {
          id: true,
          status: true,
          clockInAt: true,
          clockOutAt: true,
          totalBreakMinutes: true,
          totalWorkedMinutes: true,
          punches: {
            where: { type: { in: ["BREAK_START", "BREAK_END"] } },
            orderBy: [{ serverTimestamp: "asc" }, { createdAt: "asc" }],
            select: {
              type: true,
              serverTimestamp: true,
            },
          },
        },
      }),
      database.employeeAttendance.findMany({
        where: buildAttendanceSessionWhere<Prisma.EmployeeAttendanceWhereInput>(attendanceScope, {
          ...sessionScope,
          workDate: { gte: monthFrom, lt: monthTo },
        }),
        select: {
          workDate: true,
          status: true,
        },
      }),
      database.employeeAttendance.findMany({
        where: buildAttendanceSessionWhere<Prisma.EmployeeAttendanceWhereInput>(attendanceScope, sessionScope),
        orderBy: { clockInAt: "desc" },
        take: 10,
        select: {
          id: true,
          workDate: true,
          status: true,
          clockInAt: true,
          clockOutAt: true,
          totalBreakMinutes: true,
          totalWorkedMinutes: true,
          requiresApproval: true,
          approvalStatus: true,
          branch: {
            select: {
              id: true,
              name: true,
              attendanceSetting: {
                select: {
                  timezone: true,
                },
              },
            },
          },
        },
      }),
      database.employeeAttendance.count({
        where: buildAttendanceSessionWhere<Prisma.EmployeeAttendanceWhereInput>(attendanceScope, {
          ...sessionScope,
          requiresApproval: true,
          approvalStatus: "PENDING",
        }),
      }),
      database.attendanceException.count({
        where: buildAttendanceExceptionWhere<Prisma.AttendanceExceptionWhereInput>(attendanceScope, {
          employeeId: membership.id,
          status: "PENDING",
        }),
      }),
    ]);

  const todayDurations = todaySessions.reduce(
    (totals, session) => {
      const durations = getAttendanceDurations(session, input.now);
      return {
        breakMinutes: totals.breakMinutes + durations.breakMinutes,
        workedMinutes: totals.workedMinutes + durations.workedMinutes,
      };
    },
    { breakMinutes: 0, workedMinutes: 0 },
  );
  const primaryAssignment =
    membership.branchAssignments.find((assignment) => assignment.isPrimary) ??
    membership.branchAssignments[0] ??
    null;
  const branchPolicy = primaryAssignment?.branch.attendanceSetting ?? null;
  const normalWorkMinutesPerDay =
    membership.normalWorkMinutesPerDay ??
    branchPolicy?.normalWorkMinutesPerDay ??
    null;
  const targetBreakMinutes =
    membership.targetBreakMinutes ?? branchPolicy?.targetBreakMinutes ?? null;

  return {
    id: membership.id,
    attendanceEnabled: membership.attendanceEnabled,
    businessTimezone: membership.business.timezone,
    monthKey,
    currentClockStatus: activeSession?.status ?? null,
    currentBranchName: activeSession?.branch.name ?? null,
    todayClockInAt: todaySessions[0]?.clockInAt ?? null,
    todayClockOutAt:
      [...todaySessions]
        .reverse()
        .find((session) => session.clockOutAt !== null)?.clockOutAt ?? null,
    todayWorkedMinutes: todayDurations.workedMinutes,
    todayBreakMinutes: todayDurations.breakMinutes,
    monthlyWorkedDays: new Set(
      monthlySessions
        .filter((session) => session.status === "COMPLETED")
        .map((session) => session.workDate.toISOString().slice(0, 10)),
    ).size,
    completedShiftCount: monthlySessions.filter(
      (session) => session.status === "COMPLETED",
    ).length,
    incompleteShiftCount: monthlySessions.filter(
      (session) => session.status === "INCOMPLETE",
    ).length,
    pendingApprovalCount,
    pendingExceptionCount,
    normalWorkMinutesPerDay,
    normalWorkPolicySource:
      membership.normalWorkMinutesPerDay !== null
        ? "Employee attendance setting"
        : branchPolicy
          ? "Primary branch attendance setting"
          : "Not configured",
    targetBreakMinutes,
    targetBreakPolicySource:
      membership.targetBreakMinutes !== null
        ? "Employee attendance setting"
        : branchPolicy
          ? "Primary branch attendance setting"
          : "Not configured",
    clockInBranches: membership.branchAssignments
      .filter((assignment) => assignment.canClockIn)
      .map((assignment) => ({
        id: assignment.branch.id,
        isPrimary: assignment.isPrimary,
        name: assignment.branch.name,
      })),
    recentAttendance,
  };
}

type DurationSession = {
  status: string;
  clockInAt: Date;
  clockOutAt?: Date | null;
  totalBreakMinutes: number;
  totalWorkedMinutes?: number;
  punches: Array<{
    type: string;
    serverTimestamp: Date;
  }>;
};

function getAttendanceDurations(session: DurationSession, now: Date) {
  if (session.status !== "OPEN" && session.status !== "ON_BREAK") {
    return {
      breakMinutes: Math.max(0, session.totalBreakMinutes),
      workedMinutes: Math.max(0, session.totalWorkedMinutes ?? 0),
    };
  }

  try {
    const durations = calculateAttendanceDurations({
      clockInAt: session.clockInAt,
      endAt: now,
      breakPunches: session.punches.map((punch) => ({
        type: punch.type as "BREAK_START" | "BREAK_END",
        serverTimestamp: punch.serverTimestamp,
      })),
      includeOpenBreakUntilEnd: session.status === "ON_BREAK",
    });
    return {
      breakMinutes: durations.totalBreakMinutes,
      workedMinutes: durations.totalWorkedMinutes,
    };
  } catch {
    const elapsedMinutes = Math.max(
      0,
      Math.floor((now.getTime() - session.clockInAt.getTime()) / 60_000),
    );
    return {
      breakMinutes: Math.max(0, session.totalBreakMinutes),
      workedMinutes: Math.max(0, elapsedMinutes - session.totalBreakMinutes),
    };
  }
}
