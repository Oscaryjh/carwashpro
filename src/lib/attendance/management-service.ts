import type {
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { z } from "zod";
import type { AttendanceServiceContext } from "@/lib/attendance/employee-service";
import {
  buildAttendanceExceptionWhere,
  buildAttendanceSessionWhere,
} from "@/lib/attendance/scope";
import { getAttendanceWorkDate } from "@/lib/attendance/work-date";
import { materializeAttendanceResolutionFoundationInTransaction } from "@/lib/attendance/resolution-service";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const reviewInputSchema = z.object({
  exceptionId: z.string().uuid("Attendance exception is invalid."),
  decision: z.enum(["APPROVED", "REJECTED"]),
  reviewNote: z
    .string()
    .trim()
    .max(500, "Review note cannot exceed 500 characters.")
    .default(""),
}).superRefine((value, context) => {
  if (value.decision === "REJECTED" && value.reviewNote.length < 3) {
    context.addIssue({
      code: "custom",
      path: ["reviewNote"],
      message: "A rejection reason is required.",
    });
  }
});

const adjustmentInputSchema = z.object({
  sessionId: z.string().uuid("Attendance session is invalid."),
  adjustedClockInLocal: z.string().trim().min(1, "Clock-in time is required."),
  adjustedClockOutLocal: z.string().trim().min(1, "Clock-out time is required."),
  adjustedBreakMinutes: z.coerce
    .number()
    .int()
    .min(0, "Break cannot be negative.")
    .max(24 * 60, "Break cannot exceed 24 hours."),
  reason: z
    .string()
    .trim()
    .min(3, "Adjustment reason is too short.")
    .max(500, "Adjustment reason cannot exceed 500 characters."),
  expectedUpdatedAt: z.string().datetime().optional(),
});

export async function reviewAttendanceException(
  args: AttendanceServiceContext & { input: unknown },
  database: PrismaClient = prisma,
) {
  const input = reviewInputSchema.parse(args.input);
  return database.$transaction(
    async (transaction) => {
      const exception = await transaction.attendanceException.findFirst({
        where: buildAttendanceExceptionWhere<Prisma.AttendanceExceptionWhereInput>(
          {
            businessId: args.businessId,
            allowedBranchIds: args.allowedBranchIds,
          },
          {
            id: input.exceptionId,
            status: "PENDING",
          },
        ),
        include: {
          attendanceSession: {
            include: {
              punches: {
                orderBy: [
                  { serverTimestamp: "asc" },
                  { createdAt: "asc" },
                ],
                select: {
                  id: true,
                  type: true,
                  serverTimestamp: true,
                },
              },
            },
          },
          branch: {
            select: {
              attendanceSetting: {
                select: { timezone: true },
              },
            },
          },
          employee: {
            select: { staffUser: { select: { id: true } } },
          },
        },
      });
      if (!exception) {
        throw new Error(
          "The pending Attendance exception was not found in your branch scope.",
        );
      }
      if (exception.employee.staffUser?.id === args.actor.userId) {
        throw new Error("A manager cannot review their own Attendance exception.");
      }

      let attendanceSessionId = exception.attendanceSessionId;
      if (input.decision === "APPROVED") {
        attendanceSessionId = await applyApprovedCorrection(
          transaction,
          exception,
          args.actor.userId,
        );
      }

      const reviewed = await transaction.attendanceException.update({
        where: { id: exception.id },
        data: {
          status: input.decision,
          reviewedBy: args.actor.userId,
          reviewedAt: new Date(),
          reviewNote: input.reviewNote || null,
          attendanceSessionId,
        },
      });

      if (attendanceSessionId) {
        await synchronizeSessionApproval(
          transaction,
          attendanceSessionId,
        );
        const sessionState = await transaction.employeeAttendance.findUnique({
          where: { id: attendanceSessionId },
          select: { status: true },
        });
        if (
          sessionState &&
          !["OPEN", "ON_BREAK"].includes(sessionState.status)
        ) {
          await materializeAttendanceResolutionFoundationInTransaction(
            {
              businessId: args.businessId,
              allowedBranchIds: args.allowedBranchIds,
              actor: args.actor,
              request: args.request,
              attendanceSessionId,
            },
            transaction,
          );
        }
      }

      await writeAuditLog(
        {
          businessId: args.businessId,
          branchId: exception.branchId,
          actor: args.actor,
          request: args.request,
          action:
            input.decision === "APPROVED"
              ? "ATTENDANCE_EXCEPTION_APPROVED"
              : "ATTENDANCE_EXCEPTION_REJECTED",
          entityType: "AttendanceException",
          entityId: exception.id,
          summary: `Attendance exception ${input.decision.toLowerCase()}.`,
          before: {
            status: exception.status,
            reviewNote: exception.reviewNote,
          },
          after: {
            status: reviewed.status,
            reviewNote: reviewed.reviewNote,
          },
          metadata: {
            membershipId: exception.employeeId,
            attendanceSessionId,
            exceptionType: exception.type,
          },
        },
        transaction,
      );

      return reviewed;
    },
    {
      isolationLevel: "Serializable",
      maxWait: 5_000,
      timeout: 15_000,
    },
  );
}

export async function adjustAttendanceSession(
  args: AttendanceServiceContext & { input: unknown },
  database: PrismaClient = prisma,
) {
  const input = adjustmentInputSchema.parse(args.input);
  return database.$transaction(
    async (transaction) => {
      const session = await transaction.employeeAttendance.findFirst({
        where: buildAttendanceSessionWhere<Prisma.EmployeeAttendanceWhereInput>(
          {
            businessId: args.businessId,
            allowedBranchIds: args.allowedBranchIds,
          },
          {
            id: input.sessionId,
            status: { not: "CANCELLED" },
          },
        ),
        include: {
          branch: {
            select: {
              attendanceSetting: {
                select: { timezone: true },
              },
            },
          },
          membership: {
            select: { staffUser: { select: { id: true } } },
          },
        },
      });
      if (!session) {
        throw new Error(
          "The Attendance session was not found in your branch scope.",
        );
      }
      if (session.membership.staffUser?.id === args.actor.userId) {
        throw new Error("A manager cannot adjust their own Attendance session.");
      }
      if (
        input.expectedUpdatedAt &&
        session.updatedAt.toISOString() !== input.expectedUpdatedAt
      ) {
        throw new Error(
          "This Attendance session changed. Refresh before adjusting it.",
        );
      }

      const timezone =
        session.branch.attendanceSetting?.timezone ??
        "Asia/Kuala_Lumpur";
      const adjustedClockInAt = parseLocalDateTime(
        input.adjustedClockInLocal,
        timezone,
      );
      const adjustedClockOutAt = parseLocalDateTime(
        input.adjustedClockOutLocal,
        timezone,
      );
      const totalElapsedMinutes = Math.floor(
        (adjustedClockOutAt.getTime() - adjustedClockInAt.getTime()) /
          60_000,
      );
      if (totalElapsedMinutes <= 0) {
        throw new Error("Clock-out time must be after clock-in time.");
      }
      if (input.adjustedBreakMinutes > totalElapsedMinutes) {
        throw new Error("Break cannot exceed the attendance duration.");
      }
      const totalWorkedMinutes =
        totalElapsedMinutes - input.adjustedBreakMinutes;

      await transaction.attendanceAdjustment.create({
        data: {
          businessId: session.businessId,
          branchId: session.branchId,
          attendanceSessionId: session.id,
          employeeId: session.membershipId,
          originalClockInAt: session.clockInAt,
          adjustedClockInAt,
          originalClockOutAt: session.clockOutAt,
          adjustedClockOutAt,
          originalBreakMinutes: session.totalBreakMinutes,
          adjustedBreakMinutes: input.adjustedBreakMinutes,
          reason: input.reason,
          adjustedBy: args.actor.userId,
        },
      });

      const updated = await transaction.employeeAttendance.update({
        where: { id: session.id },
        data: {
          workDate: getAttendanceWorkDate(
            adjustedClockInAt,
            timezone,
          ),
          clockInAt: adjustedClockInAt,
          clockOutAt: adjustedClockOutAt,
          totalBreakMinutes: input.adjustedBreakMinutes,
          totalWorkedMinutes,
          status: "COMPLETED",
        },
      });

      await writeAuditLog(
        {
          businessId: args.businessId,
          branchId: session.branchId,
          actor: args.actor,
          request: args.request,
          action: "ATTENDANCE_SESSION_ADJUSTED",
          entityType: "EmployeeAttendance",
          entityId: session.id,
          summary: "Attendance session adjusted by an authorized manager.",
          before: {
            clockInAt: session.clockInAt,
            clockOutAt: session.clockOutAt,
            totalBreakMinutes: session.totalBreakMinutes,
            totalWorkedMinutes: session.totalWorkedMinutes,
            status: session.status,
          },
          after: {
            clockInAt: updated.clockInAt,
            clockOutAt: updated.clockOutAt,
            totalBreakMinutes: updated.totalBreakMinutes,
            totalWorkedMinutes: updated.totalWorkedMinutes,
            status: updated.status,
          },
          metadata: {
            membershipId: session.membershipId,
            reason: input.reason,
          },
        },
        transaction,
      );

      await materializeAttendanceResolutionFoundationInTransaction(
        {
          businessId: args.businessId,
          allowedBranchIds: args.allowedBranchIds,
          actor: args.actor,
          request: args.request,
          attendanceSessionId: session.id,
        },
        transaction,
      );

      return updated;
    },
    {
      isolationLevel: "Serializable",
      maxWait: 5_000,
      timeout: 15_000,
    },
  );
}

type ReviewableException = Prisma.AttendanceExceptionGetPayload<{
  include: {
    attendanceSession: {
      include: {
        punches: {
          select: {
            id: true;
            type: true;
            serverTimestamp: true;
          };
        };
      };
    };
    branch: {
      select: {
        attendanceSetting: {
          select: { timezone: true };
        };
      };
    };
    employee: {
      select: {
        staffUser: { select: { id: true } };
      };
    };
  };
}>;

async function applyApprovedCorrection(
  transaction: Prisma.TransactionClient,
  exception: ReviewableException,
  actorId: string,
) {
  if (exception.type === "FORGOT_CLOCK_IN") {
    return createMissingClockInSession(
      transaction,
      exception,
      actorId,
    );
  }
  if (exception.type === "FORGOT_CLOCK_OUT") {
    return completeMissingClockOutSession(
      transaction,
      exception,
      actorId,
    );
  }
  return exception.attendanceSessionId;
}

async function createMissingClockInSession(
  transaction: Prisma.TransactionClient,
  exception: ReviewableException,
  actorId: string,
) {
  const clockInAt = exception.requestedClockInAt;
  const clockOutAt = exception.requestedClockOutAt;
  if (!clockInAt) {
    throw new Error("Requested clock-in time is missing.");
  }
  if (clockOutAt && clockOutAt <= clockInAt) {
    throw new Error("Requested clock-out must be after clock-in.");
  }
  if (!clockOutAt) {
    const active = await transaction.employeeAttendance.findFirst({
      where: {
        membershipId: exception.employeeId,
        status: { in: ["OPEN", "ON_BREAK"] },
      },
      select: { id: true },
    });
    if (active) {
      throw new Error(
        "The employee already has an active Attendance session.",
      );
    }
  }

  const timezone =
    exception.branch.attendanceSetting?.timezone ??
    "Asia/Kuala_Lumpur";
  const elapsedMinutes = clockOutAt
    ? Math.floor((clockOutAt.getTime() - clockInAt.getTime()) / 60_000)
    : 0;
  const session = await transaction.employeeAttendance.create({
    data: {
      employeeAccountId: await resolveEmployeeAccountId(
        transaction,
        exception.employeeId,
      ),
      membershipId: exception.employeeId,
      businessId: exception.businessId,
      branchId: exception.branchId,
      workDate: getAttendanceWorkDate(clockInAt, timezone),
      status: clockOutAt ? "COMPLETED" : "OPEN",
      clockInAt,
      clockOutAt,
      totalBreakMinutes: 0,
      totalWorkedMinutes: elapsedMinutes,
      requiresApproval: true,
      approvalStatus: "PENDING",
    },
  });
  const clockInPunch = await createAdminPunch(
    transaction,
    session,
    "CLOCK_IN",
    clockInAt,
  );
  const clockOutPunch = clockOutAt
    ? await createAdminPunch(
        transaction,
        session,
        "CLOCK_OUT",
        clockOutAt,
      )
    : null;
  await transaction.employeeAttendance.update({
    where: { id: session.id },
    data: {
      clockInPunchId: clockInPunch.id,
      clockOutPunchId: clockOutPunch?.id ?? null,
    },
  });
  await transaction.attendanceAdjustment.create({
    data: {
      businessId: session.businessId,
      branchId: session.branchId,
      attendanceSessionId: session.id,
      employeeId: session.membershipId,
      originalClockInAt: null,
      adjustedClockInAt: clockInAt,
      originalClockOutAt: null,
      adjustedClockOutAt: clockOutAt,
      originalBreakMinutes: null,
      adjustedBreakMinutes: 0,
      reason: exception.reason,
      adjustedBy: actorId,
    },
  });
  return session.id;
}

async function completeMissingClockOutSession(
  transaction: Prisma.TransactionClient,
  exception: ReviewableException,
  actorId: string,
) {
  const session = exception.attendanceSession;
  const clockOutAt = exception.requestedClockOutAt;
  if (!session || !clockOutAt || session.clockOutAt) {
    throw new Error(
      "Attendance session must be open and include a requested clock-out time.",
    );
  }
  if (session.status === "COMPLETED" || session.status === "CANCELLED") {
    throw new Error("This Attendance session cannot be clocked out again.");
  }
  if (clockOutAt <= session.clockInAt) {
    throw new Error("Requested clock-out must be after clock-in.");
  }
  const elapsedMinutes = Math.floor(
    (clockOutAt.getTime() - session.clockInAt.getTime()) / 60_000,
  );
  const breakMinutes = Math.min(
    elapsedMinutes,
    Math.max(0, session.totalBreakMinutes),
  );
  const punch = await createAdminPunch(
    transaction,
    session,
    "CLOCK_OUT",
    clockOutAt,
  );
  await transaction.attendanceAdjustment.create({
    data: {
      businessId: session.businessId,
      branchId: session.branchId,
      attendanceSessionId: session.id,
      employeeId: session.membershipId,
      originalClockInAt: session.clockInAt,
      adjustedClockInAt: session.clockInAt,
      originalClockOutAt: session.clockOutAt,
      adjustedClockOutAt: clockOutAt,
      originalBreakMinutes: session.totalBreakMinutes,
      adjustedBreakMinutes: breakMinutes,
      reason: exception.reason,
      adjustedBy: actorId,
    },
  });
  await transaction.employeeAttendance.update({
    where: { id: session.id },
    data: {
      clockOutPunchId: punch.id,
      clockOutAt,
      totalBreakMinutes: breakMinutes,
      totalWorkedMinutes: elapsedMinutes - breakMinutes,
      status: "COMPLETED",
    },
  });
  return session.id;
}

async function createAdminPunch(
  transaction: Prisma.TransactionClient,
  session: {
    id: string;
    businessId: string;
    branchId: string;
    membershipId: string;
  },
  type: "CLOCK_IN" | "CLOCK_OUT",
  timestamp: Date,
) {
  return transaction.attendancePunch.create({
    data: {
      businessId: session.businessId,
      branchId: session.branchId,
      employeeId: session.membershipId,
      attendanceSessionId: session.id,
      type,
      serverTimestamp: timestamp,
      deviceTimestamp: null,
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      distanceFromBranchMeters: null,
      insideGeofence: false,
      geofenceStatus: "GEOFENCE_DISABLED",
      source: "ADMIN_MANUAL",
      deviceId: null,
      ipAddress: null,
    },
  });
}

async function resolveEmployeeAccountId(
  transaction: Prisma.TransactionClient,
  membershipId: string,
) {
  const membership =
    await transaction.employeeBusinessMembership.findUniqueOrThrow({
      where: { id: membershipId },
      select: { employeeAccountId: true },
    });
  return membership.employeeAccountId;
}

async function synchronizeSessionApproval(
  transaction: Prisma.TransactionClient,
  sessionId: string,
) {
  const statuses = await transaction.attendanceException.findMany({
    where: {
      attendanceSessionId: sessionId,
      status: { not: "CANCELLED" },
    },
    select: { status: true },
  });
  const approvalStatus = statuses.some(
    (item) => item.status === "PENDING",
  )
    ? "PENDING"
    : statuses.some((item) => item.status === "REJECTED")
      ? "REJECTED"
      : statuses.length
        ? "APPROVED"
        : "NOT_REQUIRED";
  await transaction.employeeAttendance.update({
    where: { id: sessionId },
    data: {
      requiresApproval: statuses.length > 0,
      approvalStatus,
    },
  });
}

function parseLocalDateTime(value: string, timeZone: string) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    throw new Error("Enter a valid local date and time.");
  }
  const [year, month, day, hour, minute] = match
    .slice(1)
    .map(Number);
  const localEpoch = Date.UTC(year, month - 1, day, hour, minute);
  let result = new Date(localEpoch);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    result = new Date(
      localEpoch - getTimeZoneOffsetMilliseconds(result, timeZone),
    );
  }
  if (
    formatLocalDateTime(result, timeZone) !==
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`
  ) {
    throw new Error("The local date and time does not exist.");
  }
  return result;
}

function getTimeZoneOffsetMilliseconds(date: Date, timeZone: string) {
  const parts = localParts(date, timeZone);
  const zonedEpoch = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return zonedEpoch - Math.floor(date.getTime() / 1000) * 1000;
}

function formatLocalDateTime(date: Date, timeZone: string) {
  const parts = localParts(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(
    parts.hour,
  )}:${pad(parts.minute)}`;
}

function localParts(date: Date, timeZone: string) {
  const values = new Map(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  const hour = values.get("hour");
  const minute = values.get("minute");
  const second = values.get("second");
  if (
    [year, month, day, hour, minute, second].some(
      (part) => part === undefined || !Number.isInteger(part),
    )
  ) {
    throw new Error("Unable to resolve branch local time.");
  }
  return {
    year: year!,
    month: month!,
    day: day!,
    hour: hour!,
    minute: minute!,
    second: second!,
  };
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
