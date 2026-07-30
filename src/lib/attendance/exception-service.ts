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

        const attendanceSession =
          await transaction.employeeAttendance.findFirst({
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
            },
          });
        if (!attendanceSession) {
          throw new AttendanceApiError("INVALID_ATTENDANCE_STATE");
        }

        const punch = input.attendancePunchId
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
            attendanceSessionId: attendanceSession.id,
            employeeId: args.auth.membershipId,
            businessId: args.auth.businessId,
            branchId: input.branchId,
            type: input.type,
            reason: input.reason,
            status: "PENDING",
          },
          select: exceptionResultSelect,
        });
        await transaction.employeeAttendance.update({
          where: {
            id: attendanceSession.id,
          },
          data: {
            requiresApproval: true,
            approvalStatus: "PENDING",
          },
        });
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
              attendanceSessionId: attendanceSession.id,
              attendancePunchId: punch?.id ?? null,
              exceptionType: input.type,
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
  if (input.type === "OTHER" || allowOutsideGeofenceRequest) {
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
  if (input.type === "OTHER") {
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
