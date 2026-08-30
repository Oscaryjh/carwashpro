import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { AttendanceApiError } from "@/lib/attendance/api-error";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import type { AttendanceServiceContext } from "@/lib/attendance/employee-service";
import {
  assertAttendanceResolutionTransition,
} from "@/lib/attendance/resolution-state-machine";
import {
  AttendanceResolutionError,
  resolveAttendanceCaseInTransaction,
} from "@/lib/attendance/resolution-service";
import { parseBranchLocalDateTime } from "@/lib/attendance/work-date";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export const employeeResolutionSubmissionSchema = z.object({
  resolutionCaseId: z.string().uuid("Attendance Resolution Case is invalid."),
  reason: z
    .string()
    .trim()
    .min(3, "Explain the attendance issue in at least 3 characters.")
    .max(500, "Explanation cannot exceed 500 characters."),
  proposedClockInLocal: optionalLocalDateTime(),
  proposedClockOutLocal: optionalLocalDateTime(),
  proposedBreakMinutes: z.coerce.number().int().min(0).max(1_440).nullable().optional(),
});

export const employeeResolutionCancellationSchema = z.object({
  resolutionCaseId: z.string().uuid("Attendance Resolution Case is invalid."),
  expectedUpdatedAt: z.string().datetime(),
});

export const ATTENDANCE_RESOLUTION_CANCEL_WINDOW_MINUTES = 15;

const managerDecisionSchema = z.object({
  resolutionCaseId: z.string().uuid("Attendance Resolution Case is invalid."),
  action: z.enum([
    "ACCEPT_AS_RECORDED",
    "APPLY_CORRECTION",
    "RETURN_TO_EMPLOYEE",
    "EXCLUDE",
  ]),
  reason: z
    .string()
    .trim()
    .min(3, "Decision reason must contain at least 3 characters.")
    .max(500, "Decision reason cannot exceed 500 characters."),
  correctedClockInLocal: optionalLocalDateTime(),
  correctedClockOutLocal: optionalLocalDateTime(),
  correctedBreakMinutes: z.coerce.number().int().min(0).max(1_440).nullable().optional(),
  expectedUpdatedAt: z.string().datetime(),
  expectedCurrentResultId: z.string().uuid().nullable().optional(),
});

const transactionOptions = {
  isolationLevel: "Serializable" as const,
  maxWait: 5_000,
  timeout: 15_000,
};

export type AttendanceManagerResolutionAction = z.infer<
  typeof managerDecisionSchema
>["action"];

type CancellationEvent = Readonly<{
  type:
    | "EMPLOYEE_SUBMITTED"
    | "EMPLOYEE_CANCELLED"
    | "MANAGER_ACCEPTED_AS_RECORDED"
    | "MANAGER_APPLIED_CORRECTION"
    | "MANAGER_RETURNED"
    | "MANAGER_EXCLUDED";
  createdAt: Date;
}>;

export function getEmployeeResolutionCancellationState(input: {
  status: "OPEN" | "UNDER_REVIEW" | "RETURNED_FOR_CORRECTION" | "RESOLVED" | "SUPERSEDED";
  currentFinalResultId: string | null;
  events: readonly CancellationEvent[];
  now?: Date;
}) {
  const latest = [...input.events].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  )[0];
  const deadlineAt = latest?.type === "EMPLOYEE_SUBMITTED"
    ? new Date(
        latest.createdAt.getTime() +
          ATTENDANCE_RESOLUTION_CANCEL_WINDOW_MINUTES * 60_000,
      )
    : null;
  const canCancel = Boolean(
    input.status === "UNDER_REVIEW" &&
      !input.currentFinalResultId &&
      latest?.type === "EMPLOYEE_SUBMITTED" &&
      !input.events.some((event) => event.type === "MANAGER_RETURNED") &&
      deadlineAt &&
      deadlineAt.getTime() > (input.now ?? new Date()).getTime(),
  );

  return {
    canCancel,
    cancelDeadlineAt: canCancel ? deadlineAt : null,
  };
}

export async function submitEmployeeAttendanceResolution(args: {
  auth: EmployeeAuthContext;
  input: unknown;
  database?: PrismaClient;
}) {
  const database = args.database ?? prisma;
  const input = employeeResolutionSubmissionSchema.parse(args.input);

  return database.$transaction(async (transaction) => {
    const resolutionCase = await transaction.attendanceResolutionCase.findFirst({
      where: {
        id: input.resolutionCaseId,
        businessId: args.auth.businessId,
        employeeId: args.auth.membershipId,
        status: { in: ["OPEN", "RETURNED_FOR_CORRECTION"] },
      },
      include: {
        branch: {
          select: {
            attendanceSetting: { select: { timezone: true } },
          },
        },
      },
    });
    if (!resolutionCase) {
      throw new AttendanceApiError(
        "INVALID_ATTENDANCE_STATE",
        "This attendance issue is no longer waiting for an employee response.",
      );
    }

    const timezone =
      resolutionCase.branch.attendanceSetting?.timezone ?? "Asia/Kuala_Lumpur";
    const correction = parseCorrectionValues(
      {
        clockInLocal: input.proposedClockInLocal,
        clockOutLocal: input.proposedClockOutLocal,
        breakMinutes: input.proposedBreakMinutes,
      },
      timezone,
      false,
    );

    assertAttendanceResolutionTransition(
      resolutionCase.status,
      "UNDER_REVIEW",
    );
    const event = await createResolutionEvent(transaction, {
      resolutionCase,
      type: "EMPLOYEE_SUBMITTED",
      actorType: "EMPLOYEE",
      actorUserId: null,
      actorEmployeeSessionId: args.auth.sessionId,
      reason: input.reason,
      proposedClockInAt: correction?.clockInAt ?? null,
      proposedClockOutAt: correction?.clockOutAt ?? null,
      proposedBreakMinutes: correction?.breakMinutes ?? null,
      finalResultId: null,
    });
    await transaction.attendanceResolutionCase.update({
      where: { id: resolutionCase.id },
      data: {
        status: "UNDER_REVIEW",
        resolvedById: null,
        resolvedAt: null,
      },
    });
    await writeAuditLog(
      {
        businessId: resolutionCase.businessId,
        branchId: resolutionCase.branchId,
        action: "ATTENDANCE_RESOLUTION_EMPLOYEE_SUBMITTED",
        entityType: "AttendanceResolutionCase",
        entityId: resolutionCase.id,
        summary: "Employee submitted an attendance resolution response.",
        metadata: {
          membershipId: resolutionCase.employeeId,
          attendanceSessionId: resolutionCase.attendanceSessionId,
          resolutionEventId: event.id,
          includesProposedCorrection: correction !== null,
        },
      },
      transaction,
    );

    return {
      resolutionCaseId: resolutionCase.id,
      status: "UNDER_REVIEW" as const,
      submittedAt: event.createdAt.toISOString(),
    };
  }, transactionOptions);
}

export async function cancelEmployeeAttendanceResolution(args: {
  auth: EmployeeAuthContext;
  input: unknown;
  now?: Date;
  database?: PrismaClient;
}) {
  const database = args.database ?? prisma;
  const input = employeeResolutionCancellationSchema.parse(args.input);
  const now = args.now ?? new Date();

  return database.$transaction(async (transaction) => {
    const resolutionCase = await transaction.attendanceResolutionCase.findFirst({
      where: {
        id: input.resolutionCaseId,
        businessId: args.auth.businessId,
        employeeId: args.auth.membershipId,
        status: "UNDER_REVIEW",
        currentFinalResultId: null,
      },
      include: {
        events: {
          select: { type: true, createdAt: true },
        },
      },
    });
    if (!resolutionCase) {
      throw new AttendanceApiError(
        "INVALID_ATTENDANCE_STATE",
        "This attendance response can no longer be cancelled.",
      );
    }
    if (resolutionCase.updatedAt.toISOString() !== input.expectedUpdatedAt) {
      throw new AttendanceApiError(
        "INVALID_ATTENDANCE_STATE",
        "This attendance issue changed. Reload before cancelling.",
      );
    }

    const cancellation = getEmployeeResolutionCancellationState({
      status: resolutionCase.status,
      currentFinalResultId: resolutionCase.currentFinalResultId,
      events: resolutionCase.events,
      now,
    });
    if (!cancellation.canCancel) {
      throw new AttendanceApiError(
        "INVALID_ATTENDANCE_STATE",
        "This attendance response can no longer be cancelled.",
      );
    }

    assertAttendanceResolutionTransition(resolutionCase.status, "OPEN");
    const event = await createResolutionEvent(transaction, {
      resolutionCase,
      type: "EMPLOYEE_CANCELLED",
      actorType: "EMPLOYEE",
      actorUserId: null,
      actorEmployeeSessionId: args.auth.sessionId,
      reason: "Employee cancelled the pending attendance resolution request.",
      proposedClockInAt: null,
      proposedClockOutAt: null,
      proposedBreakMinutes: null,
      finalResultId: null,
    });
    await transaction.attendanceResolutionCase.update({
      where: { id: resolutionCase.id },
      data: {
        status: "OPEN",
        resolvedById: null,
        resolvedAt: null,
      },
    });
    await writeAuditLog(
      {
        businessId: resolutionCase.businessId,
        branchId: resolutionCase.branchId,
        action: "ATTENDANCE_RESOLUTION_EMPLOYEE_CANCELLED",
        entityType: "AttendanceResolutionCase",
        entityId: resolutionCase.id,
        summary: "Employee cancelled a pending attendance resolution response.",
        metadata: {
          membershipId: resolutionCase.employeeId,
          attendanceSessionId: resolutionCase.attendanceSessionId,
          resolutionEventId: event.id,
        },
      },
      transaction,
    );

    return {
      resolutionCaseId: resolutionCase.id,
      status: "ACTION_REQUIRED" as const,
      cancelledAt: event.createdAt.toISOString(),
    };
  }, transactionOptions);
}

export async function applyManagerAttendanceResolution(args: {
  context: AttendanceServiceContext;
  input: unknown;
  database?: PrismaClient;
}) {
  const database = args.database ?? prisma;
  const input = managerDecisionSchema.parse(args.input);

  return database.$transaction(async (transaction) => {
    const resolutionCase = await transaction.attendanceResolutionCase.findFirst({
      where: {
        id: input.resolutionCaseId,
        businessId: args.context.businessId,
        branchId: { in: [...args.context.allowedBranchIds] },
        status:
          input.action === "APPLY_CORRECTION"
            ? { in: ["UNDER_REVIEW", "RESOLVED"] }
            : "UNDER_REVIEW",
      },
      include: {
        attendanceSession: true,
        currentFinalResult: true,
        employee: { select: { staffUser: { select: { id: true } } } },
        branch: {
          select: {
            attendanceSetting: { select: { timezone: true } },
          },
        },
      },
    });
    if (!resolutionCase) {
      throw new AttendanceResolutionError(
        "CASE_NOT_FOUND",
        "Attendance Resolution Case is not ready for manager review in the authorized branch scope.",
      );
    }
    if (resolutionCase.employee.staffUser?.id === args.context.actor.userId) {
      throw new AttendanceResolutionError(
        "SELF_RESOLUTION_FORBIDDEN",
        "A manager cannot resolve their own Attendance Session.",
      );
    }
    if (resolutionCase.updatedAt.toISOString() !== input.expectedUpdatedAt) {
      throw new AttendanceResolutionError(
        "CONCURRENT_CHANGE",
        "This Attendance Resolution Case changed. Reload before deciding.",
      );
    }

    if (input.action === "RETURN_TO_EMPLOYEE") {
      assertAttendanceResolutionTransition(
        resolutionCase.status,
        "RETURNED_FOR_CORRECTION",
      );
      const event = await createResolutionEvent(transaction, {
        resolutionCase,
        type: "MANAGER_RETURNED",
        actorType: "MANAGER",
        actorUserId: args.context.actor.userId,
        actorEmployeeSessionId: null,
        reason: input.reason,
        proposedClockInAt: null,
        proposedClockOutAt: null,
        proposedBreakMinutes: null,
        finalResultId: null,
      });
      await transaction.attendanceResolutionCase.update({
        where: { id: resolutionCase.id },
        data: {
          status: "RETURNED_FOR_CORRECTION",
          resolvedById: null,
          resolvedAt: null,
        },
      });
      await writeManagerDecisionAudit(args.context, transaction, {
        resolutionCase,
        eventId: event.id,
        action: input.action,
      });
      return { status: "RETURNED_FOR_CORRECTION" as const, finalResultId: null };
    }

    let resultOverride:
      | {
          clockInAt: Date;
          clockOutAt: Date;
          totalBreakMinutes: number;
          totalWorkedMinutes: number;
          confirmedBreakMinutes: number;
        }
      | undefined;
    if (input.action === "APPLY_CORRECTION") {
      const timezone =
        resolutionCase.branch.attendanceSetting?.timezone ?? "Asia/Kuala_Lumpur";
      const correction = parseCorrectionValues(
        {
          clockInLocal: input.correctedClockInLocal,
          clockOutLocal: input.correctedClockOutLocal,
          breakMinutes: input.correctedBreakMinutes,
        },
        timezone,
        true,
      )!;
      resultOverride = {
        clockInAt: correction.clockInAt,
        clockOutAt: correction.clockOutAt,
        totalBreakMinutes: correction.breakMinutes,
        totalWorkedMinutes: correction.workedMinutes,
        confirmedBreakMinutes: correction.breakMinutes,
      };
      const adjustmentBaseline =
        resolutionCase.currentFinalResult ?? resolutionCase.attendanceSession;
      await transaction.attendanceAdjustment.create({
        data: {
          businessId: resolutionCase.businessId,
          branchId: resolutionCase.branchId,
          attendanceSessionId: resolutionCase.attendanceSessionId,
          employeeId: resolutionCase.employeeId,
          originalClockInAt: adjustmentBaseline.clockInAt,
          adjustedClockInAt: correction.clockInAt,
          originalClockOutAt: adjustmentBaseline.clockOutAt,
          adjustedClockOutAt: correction.clockOutAt,
          originalBreakMinutes: adjustmentBaseline.totalBreakMinutes,
          adjustedBreakMinutes: correction.breakMinutes,
          reason: input.reason,
          adjustedBy: args.context.actor.userId,
        },
      });
    }

    const resolved = await resolveAttendanceCaseInTransaction(
      args.context,
      {
        resolutionCaseId: resolutionCase.id,
        disposition: input.action === "EXCLUDE" ? "EXCLUDED" : "INCLUDED",
        source:
          input.action === "ACCEPT_AS_RECORDED" ? "RAW_SESSION" : "CORRECTION",
        expectedCurrentResultId: input.expectedCurrentResultId,
        resultOverride,
      },
      transaction,
    );
    const eventType =
      input.action === "ACCEPT_AS_RECORDED"
        ? "MANAGER_ACCEPTED_AS_RECORDED"
        : input.action === "APPLY_CORRECTION"
          ? "MANAGER_APPLIED_CORRECTION"
          : "MANAGER_EXCLUDED";
    const event = await createResolutionEvent(transaction, {
      resolutionCase,
      type: eventType,
      actorType: "MANAGER",
      actorUserId: args.context.actor.userId,
      actorEmployeeSessionId: null,
      reason: input.reason,
      proposedClockInAt: resultOverride?.clockInAt ?? null,
      proposedClockOutAt: resultOverride?.clockOutAt ?? null,
      proposedBreakMinutes: resultOverride?.totalBreakMinutes ?? null,
      finalResultId: resolved.currentFinalResultId,
    });
    await writeManagerDecisionAudit(args.context, transaction, {
      resolutionCase,
      eventId: event.id,
      action: input.action,
    });

    return {
      status: "RESOLVED" as const,
      finalResultId: resolved.currentFinalResultId,
    };
  }, transactionOptions);
}

function optionalLocalDateTime() {
  return z
    .union([
      z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
      z.literal(""),
      z.null(),
    ])
    .optional()
    .transform((value) => value || null);
}

function parseCorrectionValues(
  input: {
    clockInLocal: string | null;
    clockOutLocal: string | null;
    breakMinutes: number | null | undefined;
  },
  timezone: string,
  required: boolean,
) {
  const hasAnyValue = Boolean(
    input.clockInLocal || input.clockOutLocal || input.breakMinutes !== null && input.breakMinutes !== undefined,
  );
  if (!hasAnyValue && !required) return null;
  if (
    !input.clockInLocal ||
    !input.clockOutLocal ||
    input.breakMinutes === null ||
    input.breakMinutes === undefined
  ) {
    throw new AttendanceApiError(
      "VALIDATION_ERROR",
      "Provide clock-in, clock-out, and break minutes for a correction.",
    );
  }
  const clockInAt = parseBranchLocalDateTime(input.clockInLocal, timezone);
  const clockOutAt = parseBranchLocalDateTime(input.clockOutLocal, timezone);
  const elapsedMinutes = Math.floor(
    (clockOutAt.getTime() - clockInAt.getTime()) / 60_000,
  );
  if (elapsedMinutes <= 0 || input.breakMinutes > elapsedMinutes) {
    throw new AttendanceApiError(
      "VALIDATION_ERROR",
      "Clock-out must be after clock-in and break cannot exceed the shift.",
    );
  }
  return {
    clockInAt,
    clockOutAt,
    breakMinutes: input.breakMinutes,
    workedMinutes: elapsedMinutes - input.breakMinutes,
  };
}

async function createResolutionEvent(
  transaction: Prisma.TransactionClient,
  input: {
    resolutionCase: {
      id: string;
      businessId: string;
      branchId: string;
      employeeId: string;
    };
    type:
      | "EMPLOYEE_SUBMITTED"
      | "EMPLOYEE_CANCELLED"
      | "MANAGER_ACCEPTED_AS_RECORDED"
      | "MANAGER_APPLIED_CORRECTION"
      | "MANAGER_RETURNED"
      | "MANAGER_EXCLUDED";
    actorType: "EMPLOYEE" | "MANAGER";
    actorUserId: string | null;
    actorEmployeeSessionId: string | null;
    reason: string;
    proposedClockInAt: Date | null;
    proposedClockOutAt: Date | null;
    proposedBreakMinutes: number | null;
    finalResultId: string | null;
  },
) {
  const latest = await transaction.attendanceResolutionEvent.findFirst({
    where: { resolutionCaseId: input.resolutionCase.id },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  const sequence = (latest?.sequence ?? 0) + 1;
  const evidenceChecksum = createHash("sha256")
    .update(
      JSON.stringify([
        input.resolutionCase.id,
        sequence,
        input.type,
        input.actorType,
        input.actorUserId,
        input.actorEmployeeSessionId,
        input.reason,
        input.proposedClockInAt?.toISOString() ?? null,
        input.proposedClockOutAt?.toISOString() ?? null,
        input.proposedBreakMinutes,
        input.finalResultId,
      ]),
      "utf8",
    )
    .digest("hex");

  return transaction.attendanceResolutionEvent.create({
    data: {
      businessId: input.resolutionCase.businessId,
      branchId: input.resolutionCase.branchId,
      resolutionCaseId: input.resolutionCase.id,
      employeeId: input.resolutionCase.employeeId,
      sequence,
      type: input.type,
      actorType: input.actorType,
      actorUserId: input.actorUserId,
      actorEmployeeSessionId: input.actorEmployeeSessionId,
      reason: input.reason,
      proposedClockInAt: input.proposedClockInAt,
      proposedClockOutAt: input.proposedClockOutAt,
      proposedBreakMinutes: input.proposedBreakMinutes,
      finalResultId: input.finalResultId,
      evidenceChecksum,
    },
  });
}

async function writeManagerDecisionAudit(
  context: AttendanceServiceContext,
  transaction: Prisma.TransactionClient,
  input: {
    resolutionCase: {
      id: string;
      branchId: string;
      employeeId: string;
      attendanceSessionId: string;
    };
    eventId: string;
    action: AttendanceManagerResolutionAction;
  },
) {
  await writeAuditLog(
    {
      businessId: context.businessId,
      branchId: input.resolutionCase.branchId,
      actor: context.actor,
      request: context.request,
      action: `ATTENDANCE_RESOLUTION_${input.action}`,
      entityType: "AttendanceResolutionCase",
      entityId: input.resolutionCase.id,
      summary: "Attendance Resolution Case decision recorded.",
      metadata: {
        membershipId: input.resolutionCase.employeeId,
        attendanceSessionId: input.resolutionCase.attendanceSessionId,
        resolutionEventId: input.eventId,
        decision: input.action,
      },
    },
    transaction,
  );
}
