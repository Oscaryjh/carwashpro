import { Prisma } from "@prisma/client";
import { AttendanceApiError } from "@/lib/attendance/api-error";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { writeAuditLog } from "@/lib/audit";

export type AttendanceWriteRateLimitConfig = Readonly<{
  windowMilliseconds: number;
  punchRequests: number;
  exceptionRequests: number;
}>;

export type AttendanceWriteCategory = "PUNCH" | "EXCEPTION";

const DEFAULT_WINDOW_MILLISECONDS = 60_000;
const DEFAULT_PUNCH_REQUESTS = 60;
const DEFAULT_EXCEPTION_REQUESTS = 30;

export function getAttendanceWriteRateLimitConfig(
  env: NodeJS.ProcessEnv = process.env,
): AttendanceWriteRateLimitConfig {
  return {
    windowMilliseconds: readPositiveInteger(
      env.ATTENDANCE_WRITE_RATE_WINDOW_MILLISECONDS,
      DEFAULT_WINDOW_MILLISECONDS,
      1_000,
      60 * 60_000,
      "ATTENDANCE_WRITE_RATE_WINDOW_MILLISECONDS",
    ),
    punchRequests: readPositiveInteger(
      env.ATTENDANCE_PUNCH_REQUESTS_PER_WINDOW,
      DEFAULT_PUNCH_REQUESTS,
      1,
      10_000,
      "ATTENDANCE_PUNCH_REQUESTS_PER_WINDOW",
    ),
    exceptionRequests: readPositiveInteger(
      env.ATTENDANCE_EXCEPTION_REQUESTS_PER_WINDOW,
      DEFAULT_EXCEPTION_REQUESTS,
      1,
      10_000,
      "ATTENDANCE_EXCEPTION_REQUESTS_PER_WINDOW",
    ),
  };
}

export async function enforceAttendanceWriteRateLimit(input: {
  transaction: Prisma.TransactionClient;
  auth: EmployeeAuthContext;
  category: AttendanceWriteCategory;
  now: Date;
  config?: AttendanceWriteRateLimitConfig;
}) {
  const config =
    input.config ?? getAttendanceWriteRateLimitConfig();
  const limit =
    input.category === "PUNCH"
      ? config.punchRequests
      : config.exceptionRequests;
  const windowStart = new Date(
    input.now.getTime() - config.windowMilliseconds,
  );
  const lockKey = [
    "attendance-write-rate",
    input.auth.businessId,
    input.auth.membershipId,
    input.category,
  ].join(":");

  await input.transaction.$queryRaw<Array<{ acquired: string }>>(
    Prisma.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${lockKey}, 0)
      )::text AS acquired
    `,
  );

  const rejectedActions =
    input.category === "PUNCH"
      ? ["ATTENDANCE_PUNCH_REJECTED"]
      : [
          "ATTENDANCE_EXCEPTION_REQUESTED",
          "ATTENDANCE_EXCEPTION_REJECTED",
        ];
  const [auditEvents, punchRequests] = await Promise.all([
    input.transaction.auditLog.count({
      where: {
        businessId: input.auth.businessId,
        entityType: "EmployeeBusinessMembership",
        entityId: input.auth.membershipId,
        action: { in: rejectedActions },
        createdAt: { gte: windowStart },
      },
    }),
    input.category === "PUNCH"
      ? input.transaction.attendanceRequestIdempotency.count({
          where: {
            businessId: input.auth.businessId,
            membershipId: input.auth.membershipId,
            createdAt: { gte: windowStart },
          },
        })
      : Promise.resolve(0),
  ]);

  if (auditEvents + punchRequests >= limit) {
    throw new AttendanceApiError("RATE_LIMITED");
  }

  if (input.category === "EXCEPTION") {
    await writeAuditLog(
      {
        businessId: input.auth.businessId,
        action: "ATTENDANCE_EXCEPTION_REQUESTED",
        entityType: "EmployeeBusinessMembership",
        entityId: input.auth.membershipId,
        summary: "Employee attendance exception request received.",
        metadata: {
          employeeSessionId: input.auth.sessionId,
          deviceId: input.auth.deviceId,
        },
      },
      input.transaction,
    );
  }
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
) {
  const parsed = value === undefined ? fallback : Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new AttendanceApiError(
      "INTERNAL_ERROR",
      `${name} is invalid.`,
    );
  }

  return parsed;
}
