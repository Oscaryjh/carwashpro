import { Prisma, type PrismaClient } from "@prisma/client";
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
  excludedMembershipId?: string;
  database?: PrismaClient;
}) {
  const database = args.database ?? prisma;
  const pageSize = Math.min(2_000, Math.max(1, args.pageSize ?? 20));
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
    ...(args.excludedMembershipId
      ? { employeeId: { not: args.excludedMembershipId } }
      : {}),
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

export async function loadPendingAttendanceExceptionQueue(args: {
  scope: AttendanceScope;
  page: number;
  pageSize?: number;
  excludedMembershipId?: string;
  database?: PrismaClient;
}) {
  const database = args.database ?? prisma;
  const pageSize = Math.min(2_000, Math.max(1, args.pageSize ?? 20));
  const requestedPage = Math.max(1, Math.floor(args.page));
  const where = buildPendingAttendanceExceptionQueueWhere({
    scope: args.scope,
    excludedMembershipId: args.excludedMembershipId,
  });
  const total = await database.attendanceException.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const items = await database.attendanceException.findMany({
    where,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      type: true,
      reason: true,
      status: true,
      requestedClockInAt: true,
      requestedClockOutAt: true,
      createdAt: true,
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
        },
      },
    },
  });

  return {
    items,
    pagination: { page, pageSize, total, totalPages },
  };
}

export type PendingAttendanceP2CorrectionQueueItem = Readonly<{
  id: string;
  exceptionId: string;
  exceptionRevision: number;
  exceptionType: "MISSING_CLOCK_IN" | "MISSING_CLOCK_OUT";
  workDate: Date;
  actualClockInAt: Date | null;
  actualClockOutAt: Date | null;
  requestedClockInAt: Date | null;
  requestedClockOutAt: Date | null;
  reason: string;
  createdAt: Date;
  employee: Readonly<{
    id: string;
    fullName: string;
    employeeCode: string;
  }>;
  branch: Readonly<{
    id: string;
    name: string;
    attendanceSetting: Readonly<{ timezone: string }> | null;
  }>;
}>;

type PendingAttendanceP2CorrectionRow = Readonly<{
  id: string;
  exceptionId: string;
  exceptionRevision: number;
  exceptionType: "MISSING_CLOCK_IN" | "MISSING_CLOCK_OUT";
  workDate: Date;
  actualClockInAt: Date | null;
  actualClockOutAt: Date | null;
  requestedClockInAt: Date | null;
  requestedClockOutAt: Date | null;
  reason: string;
  createdAt: Date;
  membershipId: string;
  fullName: string;
  employeeCode: string;
  branchId: string;
  branchName: string;
  timezone: string | null;
}>;

/**
 * Reads only employee-submitted P2 missing-punch corrections that are still
 * manager-actionable. The request and its owning exception are projected as
 * one row, with a defensive DISTINCT ON guard for malformed duplicate links.
 */
export async function loadPendingAttendanceP2CorrectionQueue(args: {
  scope: AttendanceScope;
  page: number;
  pageSize?: number;
  excludedMembershipId?: string;
  database?: PrismaClient;
}) {
  const database = args.database ?? prisma;
  const pageSize = Math.min(2_000, Math.max(1, args.pageSize ?? 20));
  const requestedPage = Math.max(1, Math.floor(args.page));
  const branchIds = [...args.scope.allowedBranchIds];
  if (!branchIds.length) {
    return {
      items: [] as PendingAttendanceP2CorrectionQueueItem[],
      pagination: { page: 1, pageSize, total: 0, totalPages: 1 },
    };
  }

  const actorFilter = args.excludedMembershipId
    ? Prisma.sql`AND request.membership_id <> ${args.excludedMembershipId}::uuid`
    : Prisma.empty;
  const actionable = Prisma.sql`
    FROM attendance_correction_requests request
    INNER JOIN attendance_p2_exceptions issue
      ON issue.id = request.exception_id
      AND issue.business_id = request.business_id
      AND issue.membership_id = request.membership_id
    INNER JOIN employee_business_memberships membership
      ON membership.id = issue.membership_id
      AND membership.business_id = issue.business_id
    INNER JOIN branches branch
      ON branch.id = issue.branch_id
      AND branch.business_id = issue.business_id
    LEFT JOIN branch_attendance_settings attendance_setting
      ON attendance_setting.branch_id = branch.id
      AND attendance_setting.business_id = branch.business_id
    WHERE request.business_id = ${args.scope.businessId}::uuid
      AND request.status = 'PENDING'
      AND issue.status = 'PENDING_MANAGER'
      AND issue.current_resolution_id IS NULL
      AND issue.type IN ('MISSING_CLOCK_IN', 'MISSING_CLOCK_OUT')
      AND issue.branch_id IN (${Prisma.join(branchIds.map((id) => Prisma.sql`${id}::uuid`))})
      ${actorFilter}
  `;
  const totals = await database.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
    SELECT COUNT(DISTINCT request.exception_id)::bigint AS total
    ${actionable}
  `);
  const total = Number(totals[0]?.total ?? 0n);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;
  const rows = await database.$queryRaw<PendingAttendanceP2CorrectionRow[]>(Prisma.sql`
    SELECT candidate.*
    FROM (
      SELECT DISTINCT ON (request.exception_id)
        request.id,
        request.exception_id AS "exceptionId",
        issue.revision AS "exceptionRevision",
        issue.type::text AS "exceptionType",
        issue.work_date AS "workDate",
        issue.actual_clock_in_at AS "actualClockInAt",
        issue.actual_clock_out_at AS "actualClockOutAt",
        request.requested_clock_in_at AS "requestedClockInAt",
        request.requested_clock_out_at AS "requestedClockOutAt",
        request.reason,
        request.created_at AS "createdAt",
        membership.id AS "membershipId",
        membership.full_name AS "fullName",
        membership.employee_code AS "employeeCode",
        branch.id AS "branchId",
        branch.name AS "branchName",
        attendance_setting.timezone
      ${actionable}
      ORDER BY request.exception_id, request.created_at ASC, request.id ASC
    ) candidate
    ORDER BY candidate."createdAt" ASC, candidate.id ASC
    LIMIT ${pageSize}
    OFFSET ${offset}
  `);
  const items = rows
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))
    .map((row): PendingAttendanceP2CorrectionQueueItem => ({
      id: row.id,
      exceptionId: row.exceptionId,
      exceptionRevision: row.exceptionRevision,
      exceptionType: row.exceptionType,
      workDate: row.workDate,
      actualClockInAt: row.actualClockInAt,
      actualClockOutAt: row.actualClockOutAt,
      requestedClockInAt: row.requestedClockInAt,
      requestedClockOutAt: row.requestedClockOutAt,
      reason: row.reason,
      createdAt: row.createdAt,
      employee: {
        id: row.membershipId,
        fullName: row.fullName,
        employeeCode: row.employeeCode,
      },
      branch: {
        id: row.branchId,
        name: row.branchName,
        attendanceSetting: row.timezone ? { timezone: row.timezone } : null,
      },
    }));

  return { items, pagination: { page, pageSize, total, totalPages } };
}

export function buildPendingAttendanceExceptionQueueWhere(args: {
  scope: AttendanceScope;
  excludedMembershipId?: string;
}): Prisma.AttendanceExceptionWhereInput {
  return {
    businessId: args.scope.businessId,
    branchId: { in: [...args.scope.allowedBranchIds] },
    status: "PENDING" as const,
    ...(args.excludedMembershipId
      ? { employeeId: { not: args.excludedMembershipId } }
      : {}),
    OR: [
      { attendanceSessionId: null },
      {
        attendanceSession: {
          is: { resolutionCase: { is: null } },
        },
      },
    ],
  };
}
