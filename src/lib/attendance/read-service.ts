import type { Prisma, PrismaClient } from "@prisma/client";
import { AttendanceApiError } from "@/lib/attendance/api-error";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { loadEmployeeAttendancePrincipal } from "@/lib/attendance/employee-principal";
import {
  ATTENDANCE_HISTORY_MAX_RANGE_DAYS,
  attendanceHistoryInputSchema,
  parseAttendanceDateKey,
} from "@/lib/attendance/punch-input";
import {
  calculateAttendanceDurations,
  getAllowedAttendanceActions,
} from "@/lib/attendance/state-machine";
import {
  formatBranchLocalDateTime,
  getAttendanceWorkDate,
} from "@/lib/attendance/work-date";
import { prisma } from "@/lib/prisma";

export async function getEmployeeAttendanceToday(args: {
  auth: EmployeeAuthContext;
  database?: PrismaClient;
  now?: Date;
}) {
  const database = args.database ?? prisma;
  const now = args.now ?? new Date();

  return database.$transaction(async (transaction) => {
    const activeSession =
      await transaction.employeeAttendance.findFirst({
        where: {
          employeeAccountId: args.auth.employeeAccountId,
          membershipId: args.auth.membershipId,
          businessId: args.auth.businessId,
          status: {
            in: ["OPEN", "ON_BREAK"],
          },
        },
        select: {
          id: true,
          branchId: true,
          workDate: true,
          status: true,
          clockInAt: true,
          clockOutAt: true,
          totalBreakMinutes: true,
          totalWorkedMinutes: true,
          requiresApproval: true,
          approvalStatus: true,
          punches: {
            where: {
              type: {
                in: ["BREAK_START", "BREAK_END"],
              },
            },
            orderBy: [
              {
                serverTimestamp: "asc",
              },
              {
                createdAt: "asc",
              },
            ],
            select: {
              type: true,
              serverTimestamp: true,
            },
          },
          exceptions: {
            where: {
              status: "PENDING",
            },
            orderBy: {
              createdAt: "asc",
            },
            select: {
              id: true,
              type: true,
              status: true,
              createdAt: true,
            },
          },
        },
      });
    const branchId =
      activeSession?.branchId ?? args.auth.primaryBranchId;
    const principal = await loadEmployeeAttendancePrincipal({
      transaction,
      auth: args.auth,
      now,
      branchId,
      requirePunch: false,
      requireBranchSetting: true,
    });
    if (!principal.setting) {
      throw new AttendanceApiError("ATTENDANCE_DISABLED");
    }
    const completedSession = activeSession
      ? null
      : await transaction.employeeAttendance.findFirst({
          where: {
            employeeAccountId: args.auth.employeeAccountId,
            membershipId: args.auth.membershipId,
            businessId: args.auth.businessId,
            branchId: principal.branch.id,
            workDate: getAttendanceWorkDate(now, principal.setting.timezone),
            status: "COMPLETED",
          },
          orderBy: [{ clockOutAt: "desc" }, { createdAt: "desc" }],
          select: {
            id: true,
            branchId: true,
            workDate: true,
            status: true,
            clockInAt: true,
            clockOutAt: true,
            totalBreakMinutes: true,
            totalWorkedMinutes: true,
            requiresApproval: true,
            approvalStatus: true,
            punches: {
              where: {
                type: {
                  in: ["BREAK_START", "BREAK_END"],
                },
              },
              orderBy: [
                {
                  serverTimestamp: "asc",
                },
                {
                  createdAt: "asc",
                },
              ],
              select: {
                type: true,
                serverTimestamp: true,
              },
            },
            exceptions: {
              where: {
                status: "PENDING",
              },
              orderBy: {
                createdAt: "asc",
              },
              select: {
                id: true,
                type: true,
                status: true,
                createdAt: true,
              },
            },
          },
        });
    const currentSession = activeSession ?? completedSession;

    const completedDurations = activeSession
      ? calculateAttendanceDurations({
          clockInAt: activeSession.clockInAt,
          endAt: now,
          breakPunches: activeSession.punches.map((punch) => ({
            type: punch.type as "BREAK_START" | "BREAK_END",
            serverTimestamp: punch.serverTimestamp,
          })),
        })
      : null;
    const currentDurations = activeSession
      ? calculateAttendanceDurations({
          clockInAt: activeSession.clockInAt,
          endAt: now,
          breakPunches: activeSession.punches.map((punch) => ({
            type: punch.type as "BREAK_START" | "BREAK_END",
            serverTimestamp: punch.serverTimestamp,
          })),
          includeOpenBreakUntilEnd:
            activeSession.status === "ON_BREAK",
        })
      : null;
    const status =
      activeSession?.status === "OPEN" ||
      activeSession?.status === "ON_BREAK"
        ? activeSession.status
        : completedSession?.status === "COMPLETED"
          ? "COMPLETED"
          : null;

    return {
      employee: {
        employeeCode: principal.membership.employeeCode,
        fullName: principal.membership.fullName,
      },
      business: {
        id: principal.business.id,
        name: principal.business.name,
      },
      branch: {
        id: principal.branch.id,
        name: principal.branch.name,
      },
      attendanceEnabled: principal.membership.attendanceEnabled,
      currentSession: currentSession
        ? {
            id: currentSession.id,
            workDate: currentSession.workDate
              .toISOString()
              .slice(0, 10),
            status: currentSession.status,
            clockInAt: currentSession.clockInAt.toISOString(),
            clockOutAt:
              currentSession.clockOutAt?.toISOString() ?? null,
            requiresApproval: currentSession.requiresApproval,
            approvalStatus: currentSession.approvalStatus,
          }
        : null,
      status,
      clockInAt: currentSession?.clockInAt.toISOString() ?? null,
      breakStartedAt:
        completedDurations?.openBreakStartedAt?.toISOString() ?? null,
      totalCompletedBreakMinutes:
        completedDurations?.totalBreakMinutes ??
        completedSession?.totalBreakMinutes ??
        0,
      currentWorkedMinutes:
        currentDurations?.totalWorkedMinutes ??
        completedSession?.totalWorkedMinutes ??
        0,
      geofenceRequirements: {
        requireGeofence: principal.setting.requireGeofence,
        geofenceRadiusMeters:
          principal.setting.geofenceRadiusMeters,
        maximumAcceptedGpsErrorMeters:
          principal.setting.minimumAccuracyMeters,
        allowOutsideGeofenceRequest:
          principal.setting.allowOutsideGeofenceRequest,
        requirePhoto: principal.setting.requirePhoto,
        timezone: principal.setting.timezone,
      },
      allowedActions:
        status === "COMPLETED" ? [] : getAllowedAttendanceActions(status),
      pendingExceptions:
        currentSession?.exceptions.map((exception) => ({
          id: exception.id,
          type: exception.type,
          status: exception.status,
          createdAt: exception.createdAt.toISOString(),
        })) ?? [],
      serverTime: now.toISOString(),
      branchLocalTime: formatBranchLocalDateTime(
        now,
        principal.setting.timezone,
      ),
    };
  });
}

export async function getEmployeeAttendanceHistory(args: {
  auth: EmployeeAuthContext;
  input: unknown;
  database?: PrismaClient;
  now?: Date;
}) {
  const database = args.database ?? prisma;
  const now = args.now ?? new Date();
  const input = attendanceHistoryInputSchema.parse(args.input);

  return database.$transaction(async (transaction) => {
    const principal = await loadEmployeeAttendancePrincipal({
      transaction,
      auth: args.auth,
      now,
      branchId: args.auth.primaryBranchId,
      requirePunch: false,
      requireBranchSetting: true,
    });
    if (!principal.setting) {
      throw new AttendanceApiError("ATTENDANCE_DISABLED");
    }

    if (input.branchId) {
      const branch = await transaction.branch.findFirst({
        where: {
          id: input.branchId,
          businessId: args.auth.businessId,
        },
        select: {
          id: true,
        },
      });
      if (!branch) {
        throw new AttendanceApiError("BRANCH_NOT_AUTHORIZED");
      }
    }

    const dateRange = resolveHistoryDateRange(
      input.from,
      input.to,
      now,
      principal.setting.timezone,
    );
    const where = {
      employeeAccountId: args.auth.employeeAccountId,
      membershipId: args.auth.membershipId,
      businessId: args.auth.businessId,
      workDate: {
        gte: dateRange.from,
        lte: dateRange.to,
      },
      ...(input.branchId
        ? {
            branchId: input.branchId,
          }
        : {}),
      ...(input.status
        ? {
            status: input.status,
          }
        : {}),
    } satisfies Prisma.EmployeeAttendanceWhereInput;

    const [total, sessions] = await Promise.all([
      transaction.employeeAttendance.count({
        where,
      }),
      transaction.employeeAttendance.findMany({
        where,
        orderBy: [
          {
            workDate: "desc",
          },
          {
            clockInAt: "desc",
          },
          {
            id: "desc",
          },
        ],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          workDate: true,
          clockInAt: true,
          clockOutAt: true,
          totalBreakMinutes: true,
          totalWorkedMinutes: true,
          status: true,
          requiresApproval: true,
          approvalStatus: true,
          branch: {
            select: {
              id: true,
              name: true,
            },
          },
          punches: {
            orderBy: [
              {
                serverTimestamp: "asc",
              },
              {
                createdAt: "asc",
              },
            ],
            select: {
              id: true,
              type: true,
              serverTimestamp: true,
              geofenceStatus: true,
              insideGeofence: true,
            },
          },
          adjustments: {
            take: 1,
            select: {
              id: true,
            },
          },
        },
      }),
    ]);

    return {
      items: sessions.map((session) => ({
        id: session.id,
        workDate: session.workDate.toISOString().slice(0, 10),
        branch: session.branch,
        clockInAt: session.clockInAt.toISOString(),
        clockOutAt: session.clockOutAt?.toISOString() ?? null,
        totalBreakMinutes: session.totalBreakMinutes,
        totalWorkedMinutes: session.totalWorkedMinutes,
        status: session.status,
        geofenceStatus:
          session.punches.find((punch) => punch.type === "CLOCK_IN")
            ?.geofenceStatus ?? null,
        geofenceEvidence: session.punches.map((punch) => ({
          punchId: punch.id,
          type: punch.type,
          serverTimestamp: punch.serverTimestamp.toISOString(),
          geofenceStatus: punch.geofenceStatus,
          insideGeofence: punch.insideGeofence,
        })),
        approvalStatus: session.approvalStatus,
        requiresApproval: session.requiresApproval,
        adjusted: session.adjustments.length > 0,
      })),
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        totalPages: Math.ceil(total / input.pageSize),
      },
      range: {
        from: dateRange.from.toISOString().slice(0, 10),
        to: dateRange.to.toISOString().slice(0, 10),
        maximumDays: ATTENDANCE_HISTORY_MAX_RANGE_DAYS,
      },
      serverTime: now.toISOString(),
    };
  });
}

function resolveHistoryDateRange(
  fromValue: string | undefined,
  toValue: string | undefined,
  now: Date,
  timezone: string,
) {
  const defaultTo = getAttendanceWorkDate(now, timezone);
  const to = toValue
    ? parseAttendanceDateKey(toValue)
    : defaultTo;
  if (!to) {
    throw new AttendanceApiError("VALIDATION_ERROR");
  }
  const from = fromValue
    ? parseAttendanceDateKey(fromValue)
    : new Date(
        to.getTime() -
          (ATTENDANCE_HISTORY_MAX_RANGE_DAYS - 1) * 86_400_000,
      );
  if (!from) {
    throw new AttendanceApiError("VALIDATION_ERROR");
  }
  const inclusiveDays =
    Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (
    inclusiveDays < 1 ||
    inclusiveDays > ATTENDANCE_HISTORY_MAX_RANGE_DAYS
  ) {
    throw new AttendanceApiError(
      "VALIDATION_ERROR",
      `History range must be between 1 and ${ATTENDANCE_HISTORY_MAX_RANGE_DAYS} days.`,
    );
  }

  return {
    from,
    to,
  };
}
