import type { Prisma, PrismaClient } from "@prisma/client";
import { AttendanceApiError } from "@/lib/attendance/api-error";
import { resolveAttendanceDailyWorkTarget } from "@/lib/attendance/daily-work-target";
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
import { reconcileStaleEmployeeAttendance } from "@/lib/attendance/stale-session-service";
import {
  formatBranchLocalDateTime,
  getAttendanceWorkDate,
} from "@/lib/attendance/work-date";
import { prisma } from "@/lib/prisma";
import { ensureEffectiveRosterExpectedDayInTransaction } from "@/lib/roster/service";
import {
  buildStaffAttendancePrimaryStatus,
  staffAttendanceIssueCopy,
  type StaffAttendanceIssue,
} from "@/lib/staff-pwa/attendance-history";

export async function getEmployeeAttendanceToday(args: {
  auth: EmployeeAuthContext;
  database?: PrismaClient;
  now?: Date;
}) {
  const database = args.database ?? prisma;
  const now = args.now ?? new Date();

  await reconcileStaleEmployeeAttendance({
    auth: args.auth,
    database,
    now,
  });

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
          breakPolicySnapshot: true,
          expectedBreakMinutes: true,
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
      activeSession?.branchId ??
      args.auth.attendanceBranchId ??
      args.auth.primaryBranchId;
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
    const workDate =
      activeSession?.workDate ??
      getAttendanceWorkDate(now, principal.setting.timezone);
    const completedSessions =
      await transaction.employeeAttendance.findMany({
          where: {
            employeeAccountId: args.auth.employeeAccountId,
            membershipId: args.auth.membershipId,
            businessId: args.auth.businessId,
            branchId: principal.branch.id,
            workDate,
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
            breakPolicySnapshot: true,
            expectedBreakMinutes: true,
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
    const completedSession =
      activeSession ? null : completedSessions[0] ?? null;
    const currentSession = activeSession ?? completedSession;
    const completedWorkedMinutes = completedSessions.reduce(
      (total, session) => total + session.totalWorkedMinutes,
      0,
    );
    const completedBreakMinutes = completedSessions.reduce(
      (total, session) => total + session.totalBreakMinutes,
      0,
    );

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
    const activeStatus =
      activeSession?.status === "OPEN" ||
      activeSession?.status === "ON_BREAK"
        ? activeSession.status
        : null;
    const status =
      activeStatus ??
      (completedSession?.status === "COMPLETED" ? "COMPLETED" : null);
    const lastBreakEndedAt = currentSession?.punches
      .filter((punch) => punch.type === "BREAK_END")
      .at(-1)?.serverTimestamp ?? null;
    const availableBranches =
      await transaction.employeeBranchAssignment.findMany({
        where: {
          membershipId: args.auth.membershipId,
          businessId: args.auth.businessId,
          status: "ACTIVE",
          canClockIn: true,
          effectiveFrom: { lte: now },
          OR: [
            { effectiveUntil: null },
            { effectiveUntil: { gte: now } },
          ],
          branch: {
            status: "ACTIVE",
            attendanceSetting: {
              is: {
                businessId: args.auth.businessId,
                isEnabled: true,
              },
            },
          },
        },
        orderBy: [{ isPrimary: "desc" }, { branch: { name: "asc" } }],
        select: {
          branch: {
            select: { id: true, name: true },
          },
        },
      });
    await ensureEffectiveRosterExpectedDayInTransaction({
      businessId: args.auth.businessId,
      branchId: principal.branch.id,
      membershipId: args.auth.membershipId,
      workDate,
      transaction,
    });
    const expectedAttendance =
      await transaction.attendanceExpectedDay.findFirst({
        where: {
          businessId: args.auth.businessId,
          branchId: principal.branch.id,
          membershipId: args.auth.membershipId,
          workDate,
          status: "CURRENT",
        },
        orderBy: { revision: "desc" },
        select: {
          kind: true,
          source: true,
          expectedStartAt: true,
          expectedEndAt: true,
          graceMinutes: true,
          policySnapshot: true,
          timezoneSnapshot: true,
          revision: true,
        },
      });
    const dailyWorkTarget = resolveAttendanceDailyWorkTarget({
      branchNormalWorkMinutesPerDay:
        principal.setting.normalWorkMinutesPerDay,
      branchTargetBreakMinutes: principal.setting.targetBreakMinutes,
      employeeNormalWorkMinutesPerDay:
        principal.membership.normalWorkMinutesPerDay,
      employeeTargetBreakMinutes: principal.membership.targetBreakMinutes,
      expectedDay: expectedAttendance,
    });

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
      availableBranches: availableBranches.map((item) => item.branch),
      attendanceEnabled: principal.membership.attendanceEnabled,
      sessionCount:
        completedSessions.length + (activeSession ? 1 : 0),
      completedSessionCount: completedSessions.length,
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
      lastBreakEndedAt: lastBreakEndedAt?.toISOString() ?? null,
      totalCompletedBreakMinutes:
        completedBreakMinutes +
        (completedDurations?.totalBreakMinutes ?? 0),
      currentWorkedMinutes:
        completedWorkedMinutes +
        (currentDurations?.totalWorkedMinutes ?? 0),
      geofenceRequirements: {
        requireGeofence: principal.setting.requireGeofence,
        geofenceRadiusMeters:
          principal.setting.geofenceRadiusMeters,
        maximumAcceptedGpsErrorMeters:
          principal.setting.minimumAccuracyMeters,
        allowOutsideGeofenceRequest:
          principal.setting.allowOutsideGeofenceRequest,
        timezone: principal.setting.timezone,
      },
      workPolicy: {
        breakPolicy:
          currentSession?.breakPolicySnapshot ?? principal.setting.breakPolicy,
        expectedBreakMinutes:
          currentSession?.expectedBreakMinutes ??
          dailyWorkTarget.expectedBreakMinutes,
        expectedBreakSource: currentSession
          ? "SESSION_SNAPSHOT"
          : dailyWorkTarget.expectedBreakSource,
        normalWorkMinutesPerDay: dailyWorkTarget.normalWorkMinutesPerDay,
        normalWorkMinutesSource: dailyWorkTarget.normalWorkMinutesSource,
      },
      expectedAttendance: expectedAttendance
        ? {
            kind: expectedAttendance.kind,
            source: expectedAttendance.source,
            expectedStartAt:
              expectedAttendance.expectedStartAt?.toISOString() ?? null,
            expectedEndAt:
              expectedAttendance.expectedEndAt?.toISOString() ?? null,
            graceMinutes: expectedAttendance.graceMinutes,
            timezone: expectedAttendance.timezoneSnapshot,
            revision: expectedAttendance.revision,
          }
        : null,
      allowedActions: getAllowedAttendanceActions(activeStatus),
      pendingExceptions: [
        ...(activeSession ? [activeSession] : []),
        ...completedSessions,
      ].flatMap((session) =>
        session.exceptions.map((exception) => ({
          id: exception.id,
          type: exception.type,
          status: exception.status,
          createdAt: exception.createdAt.toISOString(),
        })),
      ),
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
      branchId:
        args.auth.attendanceBranchId ?? args.auth.primaryBranchId,
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
    } satisfies Prisma.EmployeeAttendanceWhereInput;

    const [sessions, expectedDays, p2Exceptions, p2FinalResults, lockedTimesheets, availableBranchRows] = await Promise.all([
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
              attendanceSetting: {
                select: {
                  timezone: true,
                },
              },
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
              accuracyMeters: true,
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
              type: true,
              status: true,
            },
          },
          adjustments: {
            take: 1,
            select: {
              id: true,
            },
          },
          resolutionCase: {
            select: {
              status: true,
              openedReason: true,
              currentFinalResult: {
                select: {
                  source: true,
                },
              },
            },
          },
        },
      }),
      transaction.attendanceExpectedDay.findMany({
        where: {
          businessId: args.auth.businessId,
          membershipId: args.auth.membershipId,
          workDate: { gte: dateRange.from, lte: dateRange.to },
          status: "CURRENT",
          ...(input.branchId ? { branchId: input.branchId } : {}),
        },
        orderBy: [{ workDate: "desc" }, { revision: "desc" }],
        select: {
          branchId: true,
          workDate: true,
          kind: true,
          expectedStartAt: true,
          expectedEndAt: true,
          timezoneSnapshot: true,
        },
      }),
      transaction.attendanceP2Exception.findMany({
        where: {
          businessId: args.auth.businessId,
          membershipId: args.auth.membershipId,
          workDate: { gte: dateRange.from, lte: dateRange.to },
          status: { in: ["OPEN", "PENDING_EMPLOYEE", "PENDING_MANAGER"] },
          ...(input.branchId ? { branchId: input.branchId } : {}),
        },
        orderBy: [{ workDate: "desc" }, { detectedAt: "desc" }],
        select: {
          branchId: true,
          workDate: true,
          type: true,
          status: true,
        },
      }),
      transaction.attendanceP2FinalResult.findMany({
        where: {
          businessId: args.auth.businessId,
          membershipId: args.auth.membershipId,
          workDate: { gte: dateRange.from, lte: dateRange.to },
          ...(input.branchId ? { branchId: input.branchId } : {}),
        },
        orderBy: [{ workDate: "desc" }, { version: "desc" }],
        select: {
          branchId: true,
          workDate: true,
          outcome: true,
          actualClockInAt: true,
          actualClockOutAt: true,
          totalBreakMinutes: true,
          totalWorkedMinutes: true,
        },
      }),
      transaction.attendanceMonthlyTimesheet.findMany({
        where: {
          businessId: args.auth.businessId,
          status: "LOCKED",
          periodStart: {
            gte: startOfUtcMonth(dateRange.from),
            lte: dateRange.to,
          },
        },
        select: {
          periodStart: true,
        },
      }),
      transaction.employeeBranchAssignment.findMany({
        where: {
          membershipId: args.auth.membershipId,
          businessId: args.auth.businessId,
          status: "ACTIVE",
          canClockIn: true,
          effectiveFrom: { lte: now },
          OR: [
            { effectiveUntil: null },
            { effectiveUntil: { gte: now } },
          ],
        },
        orderBy: [{ isPrimary: "desc" }, { branch: { name: "asc" } }],
        select: {
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
    ]);

    type SessionRow = (typeof sessions)[number];
    type ExpectedRow = (typeof expectedDays)[number];
    type ExceptionRow = (typeof p2Exceptions)[number];
    type FinalRow = (typeof p2FinalResults)[number];
    type DayGroup = {
      workDate: string;
      branchId: string;
      sessions: SessionRow[];
      expected: ExpectedRow | null;
      exceptions: ExceptionRow[];
      finalResult: FinalRow | null;
    };

    const groups = new Map<string, DayGroup>();
    const groupFor = (workDate: Date, branchId: string) => {
      const dateKey = workDate.toISOString().slice(0, 10);
      const key = `${dateKey}:${branchId}`;
      let group = groups.get(key);
      if (!group) {
        group = { workDate: dateKey, branchId, sessions: [], expected: null, exceptions: [], finalResult: null };
        groups.set(key, group);
      }
      return group;
    };

    for (const session of sessions) groupFor(session.workDate, session.branch.id).sessions.push(session);
    for (const exception of p2Exceptions) groupFor(exception.workDate, exception.branchId).exceptions.push(exception);
    const finalResultDates = new Set<string>();
    for (const finalResult of p2FinalResults) {
      const dateKey = finalResult.workDate.toISOString().slice(0, 10);
      if (finalResultDates.has(dateKey)) continue;
      finalResultDates.add(dateKey);
      const group = groupFor(finalResult.workDate, finalResult.branchId);
      if (!group.finalResult) group.finalResult = finalResult;
    }
    const expectedByDay = new Map(expectedDays.map((expected) => [
      `${expected.workDate.toISOString().slice(0, 10)}:${expected.branchId}`,
      expected,
    ]));
    for (const [key, group] of groups) group.expected = expectedByDay.get(key) ?? null;

    const branchMap = new Map(availableBranchRows.map(({ branch }) => [branch.id, branch]));
    for (const session of sessions) branchMap.set(session.branch.id, session.branch);
    const lockedMonths = new Set(lockedTimesheets.map(({ periodStart }) => periodStart.toISOString().slice(0, 7)));

    const allItems = [...groups.values()]
      .map((group) => {
        const orderedSessions = [...group.sessions].sort((left, right) => left.clockInAt.getTime() - right.clockInAt.getTime());
        const sessionIssues = orderedSessions.flatMap((session) => session.exceptions.map((item) => ({ type: item.type, status: item.status })));
        const resolutionIssues = orderedSessions.flatMap((session) => {
          const resolution = session.resolutionCase;
          if (!resolution || resolution.status === "RESOLVED" || resolution.status === "SUPERSEDED") return [];
          return [{ type: resolutionReasonType(resolution.openedReason, session.status), status: resolution.status }];
        });
        const issueSources = [
          ...group.exceptions.map((item) => ({ type: item.type, status: item.status })),
          ...sessionIssues,
          ...resolutionIssues,
        ];
        const issues: StaffAttendanceIssue[] = issueSources.map((issue) => ({
          ...issue,
          ...staffAttendanceIssueCopy(issue.type),
        }));
        const adjusted = orderedSessions.some((session) => session.adjustments.length > 0);
        const resolved = orderedSessions.some((session) => session.resolutionCase?.status === "RESOLVED");
        const finalOutcome = group.finalResult?.outcome ?? null;
        const primaryStatus = buildStaffAttendancePrimaryStatus({
          sessionStatuses: orderedSessions.map((session) => session.status),
          issues,
          finalOutcome,
          adjusted,
          resolved,
        });
        const branch = branchMap.get(group.branchId);
        const timezone = group.expected?.timezoneSnapshot ?? branch?.attendanceSetting?.timezone ?? principal.setting?.timezone ?? "Asia/Kuala_Lumpur";
        const locked = lockedMonths.has(group.workDate.slice(0, 7));
        const active = orderedSessions.some((session) => session.status === "OPEN" || session.status === "ON_BREAK");
        const firstClockIn = orderedSessions[0]?.clockInAt ?? null;
        const lastClockOut = [...orderedSessions].reverse().find((session) => session.clockOutAt)?.clockOutAt ?? null;
        const actual = group.finalResult ? {
          clockInAt: group.finalResult.actualClockInAt?.toISOString() ?? null,
          clockOutAt: group.finalResult.actualClockOutAt?.toISOString() ?? null,
          totalBreakMinutes: group.finalResult.totalBreakMinutes,
          totalWorkedMinutes: group.finalResult.totalWorkedMinutes,
        } : {
          clockInAt: firstClockIn?.toISOString() ?? null,
          clockOutAt: active ? null : lastClockOut?.toISOString() ?? null,
          totalBreakMinutes: orderedSessions.reduce((total, session) => total + session.totalBreakMinutes, 0),
          totalWorkedMinutes: orderedSessions.reduce((total, session) => total + session.totalWorkedMinutes, 0),
        };
        const flags = [
          adjusted && primaryStatus.key !== "ADJUSTED" ? "Adjusted" : null,
          orderedSessions.length > 1 ? `${orderedSessions.length} sessions` : null,
        ].filter((flag): flag is string => Boolean(flag)).slice(0, 2);

        return {
          id: `${group.workDate}-${group.branchId}`,
          workDate: group.workDate,
          branch: { id: group.branchId, name: branch?.name ?? "Workplace", timezone },
          primaryStatus,
          attention: issues[0] ?? null,
          scheduled: group.expected ? {
            kind: group.expected.kind,
            startAt: group.expected.expectedStartAt?.toISOString() ?? null,
            endAt: group.expected.expectedEndAt?.toISOString() ?? null,
          } : null,
          actual,
          finalOutcome,
          flags,
          locked,
          sessions: orderedSessions.map((session) => ({
            id: session.id,
            clockInAt: session.clockInAt.toISOString(),
            clockOutAt: session.clockOutAt?.toISOString() ?? null,
            totalBreakMinutes: session.totalBreakMinutes,
            totalWorkedMinutes: session.totalWorkedMinutes,
            punchStatus: session.status,
            approvalLabel: attendanceApprovalLabel(session),
            adjusted: session.adjustments.length > 0,
            locked,
            breakPeriods: pairBreakPeriods(session.punches),
            geofenceEvidence: session.punches.map((punch) => ({
              punchId: punch.id,
              type: punch.type,
              serverTimestamp: punch.serverTimestamp.toISOString(),
              geofenceStatus: punch.geofenceStatus,
              insideGeofence: punch.insideGeofence,
              accuracyMeters: punch.accuracyMeters === null ? null : Number(punch.accuracyMeters),
            })),
          })),
        };
      })
      .filter((item) => matchesAttendanceHistoryStatus(item.primaryStatus.key, input.status))
      .sort((left, right) => {
        const attentionOrder = Number(Boolean(right.attention)) - Number(Boolean(left.attention));
        return attentionOrder || right.workDate.localeCompare(left.workDate);
      });

    const total = allItems.length;
    const items = allItems.slice((input.page - 1) * input.pageSize, input.page * input.pageSize);

    return {
      items,
      availableBranches: availableBranchRows.map(({ branch }) => ({ id: branch.id, name: branch.name })),
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

function startOfUtcMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function resolutionReasonType(reason: string, sessionStatus: string) {
  if (reason === "INCOMPLETE_SESSION" && sessionStatus === "INCOMPLETE") return "MISSING_CLOCK_OUT";
  return reason;
}

function attendanceApprovalLabel(session: {
  requiresApproval: boolean;
  approvalStatus: string;
  adjustments: Array<{ id: string }>;
}) {
  const adjusted = session.adjustments.length > 0;
  if (adjusted && session.approvalStatus === "APPROVED") return "Adjustment approved";
  if (adjusted && session.approvalStatus === "PENDING") return "Adjustment pending";
  if (adjusted) return "Attendance adjusted";
  if (!session.requiresApproval) return null;
  if (session.approvalStatus === "APPROVED") return "Attendance correction approved";
  if (session.approvalStatus === "PENDING") return "Attendance correction pending";
  if (session.approvalStatus === "REJECTED") return "Attendance correction declined";
  return null;
}

function pairBreakPeriods(punches: Array<{ type: string; serverTimestamp: Date }>) {
  const periods: Array<{ startAt: string; endAt: string | null }> = [];
  for (const punch of punches) {
    if (punch.type === "BREAK_START") {
      periods.push({ startAt: punch.serverTimestamp.toISOString(), endAt: null });
    } else if (punch.type === "BREAK_END") {
      const open = [...periods].reverse().find((period) => period.endAt === null);
      if (open) open.endAt = punch.serverTimestamp.toISOString();
    }
  }
  return periods;
}

function matchesAttendanceHistoryStatus(primaryStatus: string, filter: string | undefined) {
  if (!filter) return true;
  if (filter === "OPEN" || filter === "ON_BREAK") return primaryStatus === "IN_PROGRESS";
  if (filter === "INCOMPLETE") return primaryStatus === "NEEDS_REVIEW" || primaryStatus === "MISSING_PUNCH";
  return primaryStatus === filter;
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
