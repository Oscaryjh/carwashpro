import type { EmployeeAttendanceStatus, Prisma, PrismaClient } from "@prisma/client";
import { effectiveAttendanceSession } from "./effective-session";

export const approvedAttendanceResolutionSelect = {
  select: {
    status: true,
    currentFinalResult: {
      select: {
        attendanceSessionId: true,
        source: true,
        disposition: true,
        clockInAt: true,
        clockOutAt: true,
        totalBreakMinutes: true,
        totalWorkedMinutes: true,
      },
    },
  },
} satisfies Prisma.AttendanceResolutionCaseDefaultArgs;

/** Read-only overlays; the caller's business/branch/date scope is always retained. */
export async function loadApprovedAttendanceCorrections(
  scopedWhere: Prisma.EmployeeAttendanceWhereInput,
  database: Pick<PrismaClient, "employeeAttendance">,
) {
  const rows = await database.employeeAttendance.findMany({
    where: {
      AND: [scopedWhere, { resolutionCase: { is: {
        status: "RESOLVED",
        currentFinalResult: { is: { source: "CORRECTION", disposition: "INCLUDED" } },
      } } }],
    },
    select: {
      id: true, status: true, clockInAt: true, clockOutAt: true,
      totalBreakMinutes: true, totalWorkedMinutes: true,
      resolutionCase: approvedAttendanceResolutionSelect,
    },
  });
  return rows.flatMap((raw) => {
    const effective = effectiveAttendanceSession(raw);
    return effective === raw ? [] : [{ id: raw.id, minuteDelta: effective.totalWorkedMinutes - raw.totalWorkedMinutes }];
  });
}

/** Apply effective status before pagination/counts, not after fetching a page. */
export function effectiveAttendanceStatusWhere(
  status: EmployeeAttendanceStatus | "ALL",
  correctionIds: string[],
): Prisma.EmployeeAttendanceWhereInput {
  if (status === "ALL") return {};
  if (!correctionIds.length) return { status };
  return status === "COMPLETED"
    ? { OR: [{ status: "COMPLETED" }, { id: { in: correctionIds } }] }
    : { AND: [{ status }, { id: { notIn: correctionIds } }] };
}

type MonthlyAttendanceMember = {
  id: string;
  employeeCode: string;
  fullName: string;
};

type MonthlyAttendanceSession = {
  id: string;
  membershipId: string;
  workDate: Date;
  status: string;
  totalBreakMinutes: number;
  totalWorkedMinutes: number;
  requiresApproval: boolean;
  approvalStatus: string;
};

type MonthlyP2Exception = {
  id: string;
  membershipId: string;
  attendanceSessionId: string | null;
  type: string;
  status: string;
};

type MonthlyResolutionCase = {
  id: string;
  employeeId: string;
  attendanceSessionId: string;
  status: string;
};

const activeP2Statuses = ["OPEN", "PENDING_EMPLOYEE", "PENDING_MANAGER"] as const;
const activeResolutionStatuses = [
  "OPEN",
  "UNDER_REVIEW",
  "RETURNED_FOR_CORRECTION",
] as const;

const p2AttentionLabels: Record<string, string> = {
  MISSING_CLOCK_IN: "Missing clock in",
  MISSING_CLOCK_OUT: "Missing clock out",
  LATE_ARRIVAL: "Late arrival",
  EARLY_DEPARTURE: "Early departure",
  NO_ATTENDANCE_RECORDED: "No attendance recorded",
  SUSPECTED_NO_SHOW: "Suspected no-show",
  LEAVE_ATTENDANCE_CONFLICT: "Leave conflict",
};

export function buildManagerAttendanceMonthlyIssueWhere(args: {
  businessId: string;
  allowedBranchIds: readonly string[];
  requestedBranchId: string;
  membershipIds: string[];
  from: Date;
  to: Date;
}) {
  const branchId = args.requestedBranchId || { in: [...args.allowedBranchIds] };
  return {
    p2: {
      businessId: args.businessId,
      branchId,
      membershipId: { in: [...args.membershipIds] },
      workDate: { gte: args.from, lt: args.to },
      status: { in: [...activeP2Statuses] },
    } satisfies Prisma.AttendanceP2ExceptionWhereInput,
    resolutionCases: {
      businessId: args.businessId,
      branchId,
      employeeId: { in: [...args.membershipIds] },
      status: { in: [...activeResolutionStatuses] },
      attendanceSession: {
        is: { workDate: { gte: args.from, lt: args.to } },
      },
    } satisfies Prisma.AttendanceResolutionCaseWhereInput,
  };
}

export function buildManagerAttendanceMonthlySummary(args: {
  members: MonthlyAttendanceMember[];
  sessions: MonthlyAttendanceSession[];
  p2Exceptions: MonthlyP2Exception[];
  resolutionCases: MonthlyResolutionCase[];
}) {
  return args.members.map((member) => {
    const sessions = args.sessions.filter(
      (session) => session.membershipId === member.id,
    );
    const completedSessions = sessions.filter(
      (session) => session.status === "COMPLETED",
    );
    const workedDays = new Set(
      completedSessions.map((session) =>
        session.workDate.toISOString().slice(0, 10),
      ),
    ).size;
    const attention = new Map<string, string>();

    for (const session of sessions) {
      if (session.status === "INCOMPLETE") {
        attention.set(`session:${session.id}`, "Incomplete clock record");
      } else if (
        session.requiresApproval &&
        session.approvalStatus === "PENDING"
      ) {
        attention.set(`session:${session.id}`, "Approval pending");
      }
    }
    for (const resolutionCase of args.resolutionCases) {
      if (
        resolutionCase.employeeId === member.id &&
        activeResolutionStatuses.includes(
          resolutionCase.status as (typeof activeResolutionStatuses)[number],
        )
      ) {
        const key = `session:${resolutionCase.attendanceSessionId}`;
        if (!attention.has(key)) {
          attention.set(key, "Resolution pending");
        }
      }
    }
    for (const exception of args.p2Exceptions) {
      if (
        exception.membershipId === member.id &&
        activeP2Statuses.includes(
          exception.status as (typeof activeP2Statuses)[number],
        )
      ) {
        const key = exception.attendanceSessionId
          ? `session:${exception.attendanceSessionId}`
          : `p2:${exception.id}`;
        attention.set(
          key,
          p2AttentionLabels[exception.type] ?? "Attendance issue",
        );
      }
    }

    const attentionLabels = [...attention.values()];
    return {
      ...member,
      workedDays,
      completedShifts: completedSessions.length,
      workedMinutes: completedSessions.reduce(
        (total, session) => total + session.totalWorkedMinutes,
        0,
      ),
      breakMinutes: completedSessions.reduce(
        (total, session) => total + session.totalBreakMinutes,
        0,
      ),
      attentionCount: attention.size,
      attentionLabel: attentionLabels[0] ?? "Clear",
    };
  });
}
