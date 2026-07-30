import { createHash } from "node:crypto";
import type {
  AttendanceExceptionType,
  AttendancePunchType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import {
  AttendanceApiError,
  normalizeAttendanceApiError,
} from "@/lib/attendance/api-error";
import { hashEmployeeIdentifier } from "@/lib/attendance/employee-auth/crypto";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { loadEmployeeAttendancePrincipal } from "@/lib/attendance/employee-principal";
import {
  evaluateAttendanceGeofence,
  type GeofenceEvaluation,
} from "@/lib/attendance/geofence";
import {
  attendancePunchInputSchema,
  type AttendancePunchInput,
} from "@/lib/attendance/punch-input";
import {
  calculateAttendanceDurations,
  getAllowedAttendanceActions,
  getNextAttendanceStatus,
} from "@/lib/attendance/state-machine";
import { getAttendanceWorkDate } from "@/lib/attendance/work-date";
import {
  enforceAttendanceWriteRateLimit,
  type AttendanceWriteRateLimitConfig,
} from "@/lib/attendance/write-rate-limit";
import { tryWriteAuditLog, writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export type AttendancePunchResult = Readonly<{
  attendanceSessionId: string;
  attendancePunchId: string;
  punchType: AttendancePunchType;
  resultingStatus: "OPEN" | "ON_BREAK" | "COMPLETED";
  serverTimestamp: string;
  workDate: string;
  geofenceStatus:
    | "INSIDE"
    | "OUTSIDE"
    | "GPS_INACCURATE"
    | "GPS_UNAVAILABLE"
    | "GEOFENCE_DISABLED";
  insideGeofence: boolean;
  distanceFromBranchMeters: number | null;
  requiresApproval: boolean;
  exceptionId: string | null;
  totalBreakMinutes: number | null;
  totalWorkedMinutes: number | null;
  replayed: boolean;
}>;

export async function performAttendancePunch(args: {
  auth: EmployeeAuthContext;
  type: AttendancePunchType;
  input: unknown;
  database?: PrismaClient;
  now?: Date;
  ipAddress?: string | null;
  rateLimitConfig?: AttendanceWriteRateLimitConfig;
}): Promise<AttendancePunchResult> {
  const database = args.database ?? prisma;
  const now = args.now ?? new Date();
  const input = attendancePunchInputSchema.parse(args.input);
  const deviceIdentifierHash = hashEmployeeIdentifier(
    "device",
    input.deviceIdentifier,
  );
  const payloadHash = hashPunchPayload(
    args.type,
    input,
    deviceIdentifierHash,
  );

  try {
    return await database.$transaction(
      async (transaction) => {
        const principal = await loadEmployeeAttendancePrincipal({
          transaction,
          auth: args.auth,
          now,
          branchId: input.branchId,
          deviceIdentifierHash,
          requirePunch: true,
          requireBranchSetting: true,
        });
        if (!principal.setting) {
          throw new AttendanceApiError("ATTENDANCE_DISABLED");
        }

        const replay = await resolveExistingIdempotency({
          transaction,
          auth: args.auth,
          branchId: input.branchId,
          idempotencyKey: input.idempotencyKey,
          payloadHash,
          punchType: args.type,
        });
        if (replay) {
          return replay;
        }

        await enforceAttendanceWriteRateLimit({
          transaction,
          auth: args.auth,
          category: "PUNCH",
          now,
          config: args.rateLimitConfig,
        });

        const evaluation = evaluateAttendanceGeofence(
          {
            latitude: Number(principal.setting.latitude),
            longitude: Number(principal.setting.longitude),
            geofenceRadiusMeters:
              principal.setting.geofenceRadiusMeters,
            minimumAccuracyMeters:
              principal.setting.minimumAccuracyMeters,
            requireGeofence: principal.setting.requireGeofence,
          },
          input,
        );
        const gpsException = resolveGpsException(
          evaluation,
          principal.setting.allowOutsideGeofenceRequest,
          input.exceptionReason,
        );

        const idempotency =
          await transaction.attendanceRequestIdempotency.create({
            data: {
              membershipId: args.auth.membershipId,
              employeeSessionId: args.auth.sessionId,
              businessId: args.auth.businessId,
              branchId: input.branchId,
              idempotencyKey: input.idempotencyKey,
              requestPayloadHash: payloadHash,
              punchType: args.type,
              status: "PROCESSING",
              createdAt: now,
            },
            select: {
              id: true,
            },
          });

        const writeResult =
          args.type === "CLOCK_IN"
            ? await createClockIn({
                transaction,
                auth: args.auth,
                input,
                now,
                ipAddress: args.ipAddress,
                timezone: principal.setting.timezone,
                evaluation,
              })
            : await createActiveSessionPunch({
                transaction,
                auth: args.auth,
                input,
                type: args.type,
                now,
                ipAddress: args.ipAddress,
                evaluation,
              });

        let exceptionId: string | null = null;
        if (gpsException) {
          const exception = await transaction.attendanceException.create({
            data: {
              attendancePunchId: writeResult.punch.id,
              attendanceSessionId: writeResult.attendanceSession.id,
              employeeId: args.auth.membershipId,
              businessId: args.auth.businessId,
              branchId: input.branchId,
              type: gpsException.type,
              reason: gpsException.reason,
              status: "PENDING",
            },
            select: {
              id: true,
            },
          });
          exceptionId = exception.id;
          await transaction.employeeAttendance.update({
            where: {
              id: writeResult.attendanceSession.id,
            },
            data: {
              requiresApproval: true,
              approvalStatus: "PENDING",
            },
          });
        }

        await writeAuditLog(
          {
            businessId: args.auth.businessId,
            branchId: input.branchId,
            action: auditActionForPunch(args.type),
            entityType: "AttendancePunch",
            entityId: writeResult.punch.id,
            summary: auditSummaryForPunch(args.type),
            metadata: {
              membershipId: args.auth.membershipId,
              attendanceSessionId: writeResult.attendanceSession.id,
              punchType: args.type,
              geofenceStatus: evaluation.geofenceStatus,
              requiresApproval: gpsException !== null,
            },
          },
          transaction,
        );

        if (exceptionId) {
          await writeAuditLog(
            {
              businessId: args.auth.businessId,
              branchId: input.branchId,
              action: "ATTENDANCE_EXCEPTION_SUBMITTED",
              entityType: "AttendanceException",
              entityId: exceptionId,
              summary: "Employee attendance exception submitted.",
              metadata: {
                membershipId: args.auth.membershipId,
                attendanceSessionId: writeResult.attendanceSession.id,
                attendancePunchId: writeResult.punch.id,
                exceptionType: gpsException?.type,
              },
            },
            transaction,
          );
        }

        await transaction.attendanceRequestIdempotency.update({
          where: {
            id: idempotency.id,
          },
          data: {
            status: "COMPLETED",
            attendanceSessionId: writeResult.attendanceSession.id,
            attendancePunchId: writeResult.punch.id,
            completedAt: now,
          },
        });

        return serializePunchResult({
          attendanceSession: writeResult.attendanceSession,
          punch: writeResult.punch,
          exceptionId,
          replayed: false,
        });
      },
      {
        isolationLevel: "Serializable",
        maxWait: 5_000,
        timeout: 15_000,
      },
    );
  } catch (error) {
    let failure = error;
    if (isConcurrencyError(failure)) {
      const { replay } = await recoverConcurrentPunch({
        database,
        auth: args.auth,
        input,
        now,
        deviceIdentifierHash,
        payloadHash,
        punchType: args.type,
      });
      if (replay) {
        return replay;
      }
      failure = new AttendanceApiError(
        "INVALID_ATTENDANCE_STATE",
        "A concurrent attendance action already changed the session.",
      );
    }

    const normalized = normalizeAttendanceApiError(failure);
    await tryWriteAuditLog({
      businessId: args.auth.businessId,
      action: "ATTENDANCE_PUNCH_REJECTED",
      entityType: "EmployeeBusinessMembership",
      entityId: args.auth.membershipId,
      summary: "Employee attendance punch rejected.",
      status: "FAILED",
      metadata: {
        membershipId: args.auth.membershipId,
        punchType: args.type,
        errorCode: normalized.code,
      },
    }, database);
    throw normalized;
  }
}

async function createClockIn(input: {
  transaction: Prisma.TransactionClient;
  auth: EmployeeAuthContext;
  input: AttendancePunchInput;
  now: Date;
  ipAddress?: string | null;
  timezone: string;
  evaluation: GeofenceEvaluation;
}) {
  const attendanceSession = await input.transaction.employeeAttendance.create({
    data: {
      employeeAccountId: input.auth.employeeAccountId,
      membershipId: input.auth.membershipId,
      businessId: input.auth.businessId,
      branchId: input.input.branchId,
      workDate: getAttendanceWorkDate(input.now, input.timezone),
      status: "OPEN",
      clockInAt: input.now,
      totalBreakMinutes: 0,
      totalWorkedMinutes: 0,
      requiresApproval: false,
      approvalStatus: "NOT_REQUIRED",
    },
    select: attendanceSessionResultSelect,
  });
  const punch = await createPunch({
    ...input,
    attendanceSessionId: attendanceSession.id,
    type: "CLOCK_IN",
  });
  await input.transaction.employeeAttendance.update({
    where: {
      id: attendanceSession.id,
    },
    data: {
      clockInPunchId: punch.id,
    },
  });

  return {
    attendanceSession,
    punch,
  };
}

async function createActiveSessionPunch(input: {
  transaction: Prisma.TransactionClient;
  auth: EmployeeAuthContext;
  input: AttendancePunchInput;
  type: Exclude<AttendancePunchType, "CLOCK_IN">;
  now: Date;
  ipAddress?: string | null;
  evaluation: GeofenceEvaluation;
}) {
  const existing = await input.transaction.employeeAttendance.findFirst({
    where: {
      membershipId: input.auth.membershipId,
      employeeAccountId: input.auth.employeeAccountId,
      businessId: input.auth.businessId,
      status: {
        in: ["OPEN", "ON_BREAK"],
      },
    },
    select: {
      ...attendanceSessionResultSelect,
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
    },
  });
  if (!existing || existing.branchId !== input.input.branchId) {
    throw new AttendanceApiError("INVALID_ATTENDANCE_STATE");
  }

  const resultingStatus = getNextAttendanceStatus(
    existing.status === "OPEN" ? "OPEN" : "ON_BREAK",
    input.type,
  );
  const punch = await createPunch({
    ...input,
    attendanceSessionId: existing.id,
  });
  const updateData: Prisma.EmployeeAttendanceUncheckedUpdateManyInput = {
    status: resultingStatus,
  };

  if (input.type === "BREAK_END") {
    const durations = calculateAttendanceDurations({
      clockInAt: existing.clockInAt,
      endAt: input.now,
      breakPunches: [
        ...existing.punches.map((item) => ({
          type: item.type as "BREAK_START" | "BREAK_END",
          serverTimestamp: item.serverTimestamp,
        })),
        {
          type: "BREAK_END",
          serverTimestamp: input.now,
        },
      ],
    });
    updateData.totalBreakMinutes = durations.totalBreakMinutes;
  }

  if (input.type === "CLOCK_OUT") {
    const durations = calculateAttendanceDurations({
      clockInAt: existing.clockInAt,
      endAt: input.now,
      breakPunches: existing.punches.map((item) => ({
        type: item.type as "BREAK_START" | "BREAK_END",
        serverTimestamp: item.serverTimestamp,
      })),
    });
    updateData.clockOutPunchId = punch.id;
    updateData.clockOutAt = input.now;
    updateData.totalBreakMinutes = durations.totalBreakMinutes;
    updateData.totalWorkedMinutes = durations.totalWorkedMinutes;
  }

  const updated = await input.transaction.employeeAttendance.updateMany({
    where: {
      id: existing.id,
      employeeAccountId: input.auth.employeeAccountId,
      membershipId: input.auth.membershipId,
      businessId: input.auth.businessId,
      branchId: input.input.branchId,
      status: existing.status,
    },
    data: updateData,
  });
  if (updated.count !== 1) {
    throw new AttendanceApiError("INVALID_ATTENDANCE_STATE");
  }

  const attendanceSession =
    await input.transaction.employeeAttendance.findUniqueOrThrow({
      where: {
        id: existing.id,
      },
      select: attendanceSessionResultSelect,
    });

  return {
    attendanceSession,
    punch,
  };
}

async function createPunch(input: {
  transaction: Prisma.TransactionClient;
  auth: EmployeeAuthContext;
  input: AttendancePunchInput;
  attendanceSessionId: string;
  type: AttendancePunchType;
  now: Date;
  ipAddress?: string | null;
  evaluation: GeofenceEvaluation;
}) {
  return input.transaction.attendancePunch.create({
    data: {
      businessId: input.auth.businessId,
      branchId: input.input.branchId,
      employeeId: input.auth.membershipId,
      attendanceSessionId: input.attendanceSessionId,
      type: input.type,
      serverTimestamp: input.now,
      deviceTimestamp: input.input.deviceTimestamp ?? null,
      latitude: input.input.latitude ?? null,
      longitude: input.input.longitude ?? null,
      accuracyMeters: input.input.accuracyMeters ?? null,
      distanceFromBranchMeters:
        input.evaluation.distanceFromBranchMeters,
      insideGeofence: input.evaluation.insideGeofence,
      geofenceStatus: input.evaluation.geofenceStatus,
      source: "STAFF_PWA",
      deviceId: input.auth.deviceId,
      ipAddress: input.ipAddress?.slice(0, 64) ?? null,
    },
    select: attendancePunchResultSelect,
  });
}

function resolveGpsException(
  evaluation: GeofenceEvaluation,
  allowException: boolean,
  reason: string | null | undefined,
): {
  type: AttendanceExceptionType;
  reason: string;
} | null {
  if (!evaluation.exceptionType) {
    return null;
  }

  const code =
    evaluation.geofenceStatus === "GPS_UNAVAILABLE"
      ? "GPS_REQUIRED"
      : evaluation.geofenceStatus === "GPS_INACCURATE"
        ? "GPS_INACCURATE"
        : "OUTSIDE_GEOFENCE";
  if (!allowException || !reason) {
    throw new AttendanceApiError(
      code,
      allowException
        ? "Provide an exception reason to submit this attendance punch."
        : undefined,
    );
  }

  return {
    type: evaluation.exceptionType,
    reason,
  };
}

async function resolveExistingIdempotency(input: {
  transaction: Prisma.TransactionClient;
  auth: EmployeeAuthContext;
  branchId: string;
  idempotencyKey: string;
  payloadHash: string;
  punchType: AttendancePunchType;
}): Promise<AttendancePunchResult | null> {
  const existing =
    await input.transaction.attendanceRequestIdempotency.findUnique({
      where: {
        membershipId_idempotencyKey: {
          membershipId: input.auth.membershipId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      select: {
        employeeSessionId: true,
        businessId: true,
        branchId: true,
        requestPayloadHash: true,
        punchType: true,
        status: true,
        attendanceSession: {
          select: attendanceSessionResultSelect,
        },
        attendancePunch: {
          select: {
            ...attendancePunchResultSelect,
            exceptions: {
              orderBy: {
                createdAt: "asc",
              },
              take: 1,
              select: {
                id: true,
              },
            },
          },
        },
      },
    });

  if (!existing) {
    return null;
  }
  if (
    existing.businessId !== input.auth.businessId ||
    existing.branchId !== input.branchId ||
    existing.requestPayloadHash !== input.payloadHash ||
    existing.punchType !== input.punchType
  ) {
    throw new AttendanceApiError("IDEMPOTENCY_CONFLICT");
  }
  if (
    existing.status !== "COMPLETED" ||
    !existing.attendanceSession ||
    !existing.attendancePunch
  ) {
    throw new AttendanceApiError(
      "IDEMPOTENCY_CONFLICT",
      "The original attendance request is still processing.",
    );
  }

  return serializePunchResult({
    attendanceSession: existing.attendanceSession,
    punch: existing.attendancePunch,
    exceptionId: existing.attendancePunch.exceptions[0]?.id ?? null,
    replayed: true,
  });
}

async function recoverConcurrentPunch(input: {
  database: PrismaClient;
  auth: EmployeeAuthContext;
  input: AttendancePunchInput;
  now: Date;
  deviceIdentifierHash: string;
  payloadHash: string;
  punchType: AttendancePunchType;
}) {
  return input.database.$transaction(async (transaction) => {
    await loadEmployeeAttendancePrincipal({
      transaction,
      auth: input.auth,
      now: input.now,
      branchId: input.input.branchId,
      deviceIdentifierHash: input.deviceIdentifierHash,
      requirePunch: true,
      requireBranchSetting: true,
    });
    const replay = await resolveExistingIdempotency({
      transaction,
      auth: input.auth,
      branchId: input.input.branchId,
      idempotencyKey: input.input.idempotencyKey,
      payloadHash: input.payloadHash,
      punchType: input.punchType,
    });
    if (replay) {
      return {
        replay,
        stateChanged: false,
      };
    }

    const activeSession =
      await transaction.employeeAttendance.findFirst({
        where: {
          employeeAccountId: input.auth.employeeAccountId,
          membershipId: input.auth.membershipId,
          businessId: input.auth.businessId,
          status: {
            in: ["OPEN", "ON_BREAK"],
          },
        },
        select: {
          branchId: true,
          status: true,
        },
      });
    const activeStatus =
      activeSession?.status === "OPEN"
        ? "OPEN"
        : activeSession?.status === "ON_BREAK"
          ? "ON_BREAK"
          : null;
    const stateChanged =
      input.punchType === "CLOCK_IN"
        ? activeSession !== null
        : !activeSession ||
          activeSession.branchId !== input.input.branchId ||
          activeStatus === null ||
          !getAllowedAttendanceActions(activeStatus).includes(
            input.punchType,
          );

    return {
      replay: null,
      stateChanged,
    };
  });
}

const attendanceSessionResultSelect = {
  id: true,
  branchId: true,
  workDate: true,
  status: true,
  clockInAt: true,
  clockOutAt: true,
  totalBreakMinutes: true,
  totalWorkedMinutes: true,
  requiresApproval: true,
} satisfies Prisma.EmployeeAttendanceSelect;

const attendancePunchResultSelect = {
  id: true,
  type: true,
  serverTimestamp: true,
  geofenceStatus: true,
  insideGeofence: true,
  distanceFromBranchMeters: true,
} satisfies Prisma.AttendancePunchSelect;

function serializePunchResult(input: {
  attendanceSession: {
    id: string;
    workDate: Date;
    totalBreakMinutes: number;
    totalWorkedMinutes: number;
    requiresApproval: boolean;
  };
  punch: {
    id: string;
    type: AttendancePunchType;
    serverTimestamp: Date;
    geofenceStatus: AttendancePunchResult["geofenceStatus"];
    insideGeofence: boolean;
    distanceFromBranchMeters: unknown;
  };
  exceptionId: string | null;
  replayed: boolean;
}): AttendancePunchResult {
  const isClockOut = input.punch.type === "CLOCK_OUT";
  return {
    attendanceSessionId: input.attendanceSession.id,
    attendancePunchId: input.punch.id,
    punchType: input.punch.type,
    resultingStatus: resultingStatusForPunch(input.punch.type),
    serverTimestamp: input.punch.serverTimestamp.toISOString(),
    workDate: input.attendanceSession.workDate
      .toISOString()
      .slice(0, 10),
    geofenceStatus: input.punch.geofenceStatus,
    insideGeofence: input.punch.insideGeofence,
    distanceFromBranchMeters:
      input.punch.distanceFromBranchMeters === null
        ? null
        : Number(input.punch.distanceFromBranchMeters),
    requiresApproval:
      input.attendanceSession.requiresApproval || input.exceptionId !== null,
    exceptionId: input.exceptionId,
    totalBreakMinutes: isClockOut
      ? input.attendanceSession.totalBreakMinutes
      : null,
    totalWorkedMinutes: isClockOut
      ? input.attendanceSession.totalWorkedMinutes
      : null,
    replayed: input.replayed,
  };
}

function resultingStatusForPunch(type: AttendancePunchType) {
  switch (type) {
    case "CLOCK_IN":
    case "BREAK_END":
      return "OPEN" as const;
    case "BREAK_START":
      return "ON_BREAK" as const;
    case "CLOCK_OUT":
      return "COMPLETED" as const;
  }
}

function hashPunchPayload(
  type: AttendancePunchType,
  input: AttendancePunchInput,
  deviceIdentifierHash: string,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        type,
        branchId: input.branchId,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        accuracyMeters: input.accuracyMeters ?? null,
        deviceTimestamp: input.deviceTimestamp?.toISOString() ?? null,
        deviceIdentifierHash,
        exceptionReason: input.exceptionReason ?? null,
      }),
    )
    .digest("hex");
}

function isConcurrencyError(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  return error.code === "P2002" || error.code === "P2034";
}

function auditActionForPunch(type: AttendancePunchType) {
  switch (type) {
    case "CLOCK_IN":
      return "ATTENDANCE_CLOCK_IN";
    case "BREAK_START":
      return "ATTENDANCE_BREAK_STARTED";
    case "BREAK_END":
      return "ATTENDANCE_BREAK_ENDED";
    case "CLOCK_OUT":
      return "ATTENDANCE_CLOCK_OUT";
  }
}

function auditSummaryForPunch(type: AttendancePunchType) {
  switch (type) {
    case "CLOCK_IN":
      return "Employee clocked in.";
    case "BREAK_START":
      return "Employee started a break.";
    case "BREAK_END":
      return "Employee ended a break.";
    case "CLOCK_OUT":
      return "Employee clocked out.";
  }
}
