import type { Prisma, PrismaClient } from "@prisma/client";
import {
  AttendanceApiError,
  normalizeAttendanceApiError,
} from "@/lib/attendance/api-error";
import { hashEmployeeIdentifier } from "@/lib/attendance/employee-auth/crypto";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { loadEmployeeAttendancePrincipal } from "@/lib/attendance/employee-principal";
import {
  attendanceExceptionInputSchema,
  type AttendanceExceptionInput,
} from "@/lib/attendance/punch-input";
import {
  enforceAttendanceWriteRateLimit,
  type AttendanceWriteRateLimitConfig,
} from "@/lib/attendance/write-rate-limit";
import { tryWriteAuditLog, writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export async function submitAttendanceException(args: {
  auth: EmployeeAuthContext;
  input: unknown;
  database?: PrismaClient;
  now?: Date;
  rateLimitConfig?: AttendanceWriteRateLimitConfig;
}) {
  const database = args.database ?? prisma;
  const now = args.now ?? new Date();
  const input = attendanceExceptionInputSchema.parse(args.input);
  const deviceIdentifierHash = hashEmployeeIdentifier(
    "device",
    input.deviceIdentifier,
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
        await enforceAttendanceWriteRateLimit({
          transaction,
          auth: args.auth,
          category: "EXCEPTION",
          now,
          config: args.rateLimitConfig,
        });
        assertExceptionPolicyAllowed(
          input,
          principal.setting?.allowOutsideGeofenceRequest === true,
        );

        const attendanceSession = input.attendanceSessionId
          ? await transaction.employeeAttendance.findFirst({
            where: {
              id: input.attendanceSessionId,
              employeeAccountId: args.auth.employeeAccountId,
              membershipId: args.auth.membershipId,
              businessId: args.auth.businessId,
              branchId: input.branchId,
              status: {
                not: "CANCELLED",
              },
            },
            select: {
              id: true,
              clockInAt: true,
              clockOutAt: true,
              status: true,
            },
          })
          : null;
        if (input.attendanceSessionId && !attendanceSession) {
          throw new AttendanceApiError("INVALID_ATTENDANCE_STATE");
        }

        const punch = input.attendancePunchId && attendanceSession
          ? await transaction.attendancePunch.findFirst({
              where: {
                id: input.attendancePunchId,
                attendanceSessionId: attendanceSession.id,
                employeeId: args.auth.membershipId,
                businessId: args.auth.businessId,
                branchId: input.branchId,
              },
              select: {
                id: true,
                geofenceStatus: true,
              },
            })
          : null;
        if (input.attendancePunchId && !punch) {
          throw new AttendanceApiError("INVALID_ATTENDANCE_STATE");
        }
        validateCorrectionRequest(input, attendanceSession, now);
        validateExceptionEvidence(input, punch);

        const duplicate = await findPendingException(
          transaction,
          args.auth,
          input,
          punch?.id ?? null,
        );
        if (duplicate) {
          return serializeException(duplicate, true);
        }

        const exception = await transaction.attendanceException.create({
          data: {
            attendancePunchId: punch?.id ?? null,
            attendanceSessionId: attendanceSession?.id ?? null,
            employeeId: args.auth.membershipId,
            businessId: args.auth.businessId,
            branchId: input.branchId,
            type: input.type,
            reason: input.reason,
            status: "PENDING",
            requestedClockInAt: input.requestedClockInAt ?? null,
            requestedClockOutAt: input.requestedClockOutAt ?? null,
          },
          select: exceptionResultSelect,
        });
        if (attendanceSession) {
          await transaction.employeeAttendance.update({
            where: {
              id: attendanceSession.id,
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
            action: "ATTENDANCE_EXCEPTION_SUBMITTED",
            entityType: "AttendanceException",
            entityId: exception.id,
            summary: "Employee attendance exception submitted.",
            metadata: {
              membershipId: args.auth.membershipId,
              attendanceSessionId: attendanceSession?.id ?? null,
              attendancePunchId: punch?.id ?? null,
              exceptionType: input.type,
              requestedClockInAt: input.requestedClockInAt?.toISOString() ?? null,
              requestedClockOutAt: input.requestedClockOutAt?.toISOString() ?? null,
            },
          },
          transaction,
        );

        return serializeException(exception, false);
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
      try {
        return await database.$transaction(async (transaction) => {
          const principal = await loadEmployeeAttendancePrincipal({
            transaction,
            auth: args.auth,
            now,
            branchId: input.branchId,
            deviceIdentifierHash,
            requirePunch: true,
            requireBranchSetting: true,
          });
          await enforceAttendanceWriteRateLimit({
            transaction,
            auth: args.auth,
            category: "EXCEPTION",
            now,
            config: args.rateLimitConfig,
          });
          assertExceptionPolicyAllowed(
            input,
            principal.setting?.allowOutsideGeofenceRequest === true,
          );
          const duplicate = await findPendingException(
            transaction,
            args.auth,
            input,
            input.attendancePunchId ?? null,
          );
          if (!duplicate) {
            throw new AttendanceApiError(
              "INVALID_ATTENDANCE_STATE",
              "A concurrent attendance exception request changed the session.",
            );
          }
          return serializeException(duplicate, true);
        });
      } catch (recoveryError) {
        failure = recoveryError;
      }
    }

    const normalized = normalizeAttendanceApiError(failure);
    await tryWriteAuditLog(
      {
        businessId: args.auth.businessId,
        action: "ATTENDANCE_EXCEPTION_REJECTED",
        entityType: "EmployeeBusinessMembership",
        entityId: args.auth.membershipId,
        summary: "Employee attendance exception request rejected.",
        status: "FAILED",
        metadata: {
          membershipId: args.auth.membershipId,
          errorCode: normalized.code,
        },
      },
      database,
    );
    throw normalized;
  }
}

const exceptionResultSelect = {
  id: true,
  type: true,
  status: true,
  createdAt: true,
} satisfies Prisma.AttendanceExceptionSelect;

async function findPendingException(
  transaction: Prisma.TransactionClient,
  auth: EmployeeAuthContext,
  input: AttendanceExceptionInput,
  attendancePunchId: string | null,
) {
  return transaction.attendanceException.findFirst({
    where: {
      attendanceSessionId: input.attendanceSessionId,
      attendancePunchId,
      employeeId: auth.membershipId,
      businessId: auth.businessId,
      branchId: input.branchId,
      type: input.type,
      status: "PENDING",
      requestedClockInAt: input.requestedClockInAt ?? null,
      requestedClockOutAt: input.requestedClockOutAt ?? null,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: exceptionResultSelect,
  });
}

function serializeException(
  exception: {
    id: string;
    type: string;
    status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
    createdAt: Date;
  },
  duplicate: boolean,
) {
  return {
    id: exception.id,
    type: exception.type,
    status: exception.status,
    createdAt: exception.createdAt.toISOString(),
    duplicate,
  };
}

function assertExceptionPolicyAllowed(
  input: AttendanceExceptionInput,
  allowOutsideGeofenceRequest: boolean,
) {
  const isGpsException =
    input.type === "OUTSIDE_GEOFENCE" ||
    input.type === "GPS_INACCURATE" ||
    input.type === "GPS_UNAVAILABLE";
  if (!isGpsException || allowOutsideGeofenceRequest) {
    return;
  }
  const code =
    input.type === "GPS_UNAVAILABLE"
      ? "GPS_REQUIRED"
      : input.type === "GPS_INACCURATE"
        ? "GPS_INACCURATE"
        : "OUTSIDE_GEOFENCE";
  throw new AttendanceApiError(
    code,
    "This branch does not allow GPS exception requests.",
  );
}

function validateCorrectionRequest(
  input: AttendanceExceptionInput,
  session: {
    id: string;
    clockInAt: Date;
    clockOutAt: Date | null;
    status: "OPEN" | "ON_BREAK" | "COMPLETED" | "INCOMPLETE" | "CANCELLED";
  } | null,
  now: Date,
) {
  const futureToleranceMilliseconds = 60_000;
  const latestAllowed = new Date(
    now.getTime() + futureToleranceMilliseconds,
  );
  if (
    (input.requestedClockInAt &&
      input.requestedClockInAt > latestAllowed) ||
    (input.requestedClockOutAt &&
      input.requestedClockOutAt > latestAllowed)
  ) {
    throw new AttendanceApiError(
      "VALIDATION_ERROR",
      "Requested Attendance times cannot be in the future.",
    );
  }
  if (input.type !== "FORGOT_CLOCK_OUT") return;
  if (!session || session.clockOutAt || session.status === "COMPLETED") {
    throw new AttendanceApiError(
      "INVALID_ATTENDANCE_STATE",
      "This Attendance shift already has a clock-out record.",
    );
  }
  if (
    input.requestedClockOutAt &&
    input.requestedClockOutAt <= session.clockInAt
  ) {
    throw new AttendanceApiError(
      "VALIDATION_ERROR",
      "Requested clock-out must be after clock-in.",
    );
  }
}

function validateExceptionEvidence(
  input: AttendanceExceptionInput,
  punch: {
    id: string;
    geofenceStatus:
      | "INSIDE"
      | "OUTSIDE"
      | "GPS_INACCURATE"
      | "GPS_UNAVAILABLE"
      | "GEOFENCE_DISABLED";
  } | null,
) {
  const expectedStatus = {
    OUTSIDE_GEOFENCE: "OUTSIDE",
    GPS_INACCURATE: "GPS_INACCURATE",
    GPS_UNAVAILABLE: "GPS_UNAVAILABLE",
  } as const;
  if (
    input.type === "OTHER" ||
    input.type === "FORGOT_CLOCK_IN" ||
    input.type === "FORGOT_CLOCK_OUT"
  ) {
    return;
  }
  if (!punch || punch.geofenceStatus !== expectedStatus[input.type]) {
    throw new AttendanceApiError(
      "VALIDATION_ERROR",
      "The selected punch does not support this exception type.",
    );
  }
}

function isConcurrencyError(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  return error.code === "P2002" || error.code === "P2034";
}
