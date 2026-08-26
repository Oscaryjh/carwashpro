import type { Prisma, PrismaClient } from "@prisma/client";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import type { AttendanceScope } from "@/lib/attendance/scope";
import { getEmployeeResolutionCancellationState } from "@/lib/attendance/resolution-workflow-service";
import { prisma } from "@/lib/prisma";

export async function loadEmployeeAttendanceResolutionCases(args: {
  auth: EmployeeAuthContext;
  database?: PrismaClient;
}) {
  const database = args.database ?? prisma;
  const cases = await database.attendanceResolutionCase.findMany({
    where: {
      businessId: args.auth.businessId,
      employeeId: args.auth.membershipId,
      status: { in: ["OPEN", "UNDER_REVIEW", "RETURNED_FOR_CORRECTION"] },
    },
    orderBy: [{ openedAt: "desc" }, { id: "asc" }],
    take: 20,
    select: {
      id: true,
      status: true,
      openedReason: true,
      openedAt: true,
      updatedAt: true,
      currentFinalResultId: true,
      attendanceSession: {
        select: {
          workDate: true,
          clockInAt: true,
          clockOutAt: true,
          totalBreakMinutes: true,
        },
      },
      branch: {
        select: {
          name: true,
          attendanceSetting: { select: { timezone: true } },
        },
      },
      events: {
        orderBy: { sequence: "desc" },
        select: {
          type: true,
          reason: true,
          createdAt: true,
        },
      },
    },
  });

  return cases.map((item) => {
    const cancellation = getEmployeeResolutionCancellationState({
      status: item.status,
      currentFinalResultId: item.currentFinalResultId,
      events: item.events,
    });
    return {
      id: item.id,
      status: item.status,
      openedReason: item.openedReason,
      openedAt: item.openedAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      workDate: item.attendanceSession.workDate.toISOString().slice(0, 10),
      clockInAt: item.attendanceSession.clockInAt.toISOString(),
      clockOutAt: item.attendanceSession.clockOutAt?.toISOString() ?? null,
      totalBreakMinutes: item.attendanceSession.totalBreakMinutes,
      canCancel: cancellation.canCancel,
      cancelDeadlineAt: cancellation.cancelDeadlineAt?.toISOString() ?? null,
      branch: {
        name: item.branch.name,
        timezone:
          item.branch.attendanceSetting?.timezone ?? "Asia/Kuala_Lumpur",
      },
      latestEvent: item.events[0]
        ? {
            type: item.events[0].type,
            reason: item.events[0].reason,
            createdAt: item.events[0].createdAt.toISOString(),
          }
        : null,
    };
  });
}

export async function loadAttendanceResolutionQueue(args: {
  scope: AttendanceScope;
  page: number;
  pageSize?: number;
  status?:
    | "ACTION_REQUIRED"
    | "OPEN"
    | "UNDER_REVIEW"
    | "RETURNED_FOR_CORRECTION"
    | "RESOLVED";
  branchId?: string;
  employeeQuery?: string;
  excludedStaffUserId?: string;
  database?: PrismaClient;
}) {
  const database = args.database ?? prisma;
  const pageSize = Math.min(50, Math.max(1, args.pageSize ?? 20));
  const requestedPage = Math.max(1, Math.floor(args.page));
  const statuses =
    !args.status || args.status === "ACTION_REQUIRED"
      ? ["OPEN", "UNDER_REVIEW", "RETURNED_FOR_CORRECTION"] as const
      : [args.status] as const;
  const branchIds = args.branchId && args.scope.allowedBranchIds.includes(args.branchId)
    ? [args.branchId]
    : [...args.scope.allowedBranchIds];
  const query = args.employeeQuery?.trim().slice(0, 100) ?? "";
  const where = {
    businessId: args.scope.businessId,
    branchId: { in: branchIds },
    status: { in: [...statuses] },
    ...(query || args.excludedStaffUserId
      ? {
          employee: {
            ...(query
              ? {
                  OR: [
                    { fullName: { contains: query, mode: "insensitive" as const } },
                    { employeeCode: { contains: query, mode: "insensitive" as const } },
                  ],
                }
              : {}),
            ...(args.excludedStaffUserId
              ? { staffUser: { isNot: { id: args.excludedStaffUserId } } }
              : {}),
          },
        }
      : {}),
  } satisfies Prisma.AttendanceResolutionCaseWhereInput;
  const total = await database.attendanceResolutionCase.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const items = await database.attendanceResolutionCase.findMany({
    where,
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      status: true,
      openedReason: true,
      openedAt: true,
      updatedAt: true,
      currentFinalResultId: true,
      currentFinalResult: {
        select: {
          disposition: true,
          clockInAt: true,
          clockOutAt: true,
          totalBreakMinutes: true,
          version: true,
        },
      },
      employee: {
        select: { id: true, fullName: true, employeeCode: true },
      },
      branch: {
        select: {
          id: true,
          name: true,
          attendanceSetting: { select: { timezone: true } },
        },
      },
      attendanceSession: {
        select: {
          id: true,
          workDate: true,
          status: true,
          clockInAt: true,
          clockOutAt: true,
          totalBreakMinutes: true,
          totalWorkedMinutes: true,
          approvalStatus: true,
          exceptions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { type: true, reason: true, status: true, createdAt: true },
          },
        },
      },
      events: {
        orderBy: { sequence: "desc" },
        take: 10,
        select: {
          id: true,
          sequence: true,
          type: true,
          actorType: true,
          reason: true,
          proposedClockInAt: true,
          proposedClockOutAt: true,
          proposedBreakMinutes: true,
          createdAt: true,
        },
      },
    },
  });

  return {
    items,
    pagination: { page, pageSize, total, totalPages },
  };
}
