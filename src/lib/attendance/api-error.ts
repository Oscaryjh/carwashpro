import { ZodError } from "zod";

export const ATTENDANCE_ERROR_CODES = [
  "UNAUTHENTICATED",
  "SESSION_EXPIRED",
  "EMPLOYEE_INACTIVE",
  "ATTENDANCE_DISABLED",
  "DEVICE_NOT_AUTHORIZED",
  "BRANCH_NOT_AUTHORIZED",
  "GPS_REQUIRED",
  "GPS_INACCURATE",
  "OUTSIDE_GEOFENCE",
  "INVALID_ATTENDANCE_STATE",
  "IDEMPOTENCY_CONFLICT",
  "RATE_LIMITED",
  "VALIDATION_ERROR",
  "INTERNAL_ERROR",
] as const;

export type AttendanceErrorCode =
  (typeof ATTENDANCE_ERROR_CODES)[number];

const DEFAULT_ERROR_STATUS: Record<AttendanceErrorCode, number> = {
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  EMPLOYEE_INACTIVE: 403,
  ATTENDANCE_DISABLED: 403,
  DEVICE_NOT_AUTHORIZED: 403,
  BRANCH_NOT_AUTHORIZED: 403,
  GPS_REQUIRED: 422,
  GPS_INACCURATE: 422,
  OUTSIDE_GEOFENCE: 422,
  INVALID_ATTENDANCE_STATE: 409,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  VALIDATION_ERROR: 400,
  INTERNAL_ERROR: 500,
};

const DEFAULT_ERROR_MESSAGE: Record<AttendanceErrorCode, string> = {
  UNAUTHENTICATED: "Employee authentication is required.",
  SESSION_EXPIRED: "Employee session has expired.",
  EMPLOYEE_INACTIVE: "Employee account is not active.",
  ATTENDANCE_DISABLED: "Attendance is not enabled.",
  DEVICE_NOT_AUTHORIZED: "This device is not authorized for attendance.",
  BRANCH_NOT_AUTHORIZED: "This branch is not authorized for attendance.",
  GPS_REQUIRED: "GPS evidence is required.",
  GPS_INACCURATE: "GPS accuracy is outside the accepted limit.",
  OUTSIDE_GEOFENCE: "The device is outside the branch geofence.",
  INVALID_ATTENDANCE_STATE: "This attendance action is not allowed now.",
  IDEMPOTENCY_CONFLICT:
    "The idempotency key has already been used for a different request.",
  RATE_LIMITED: "Too many requests. Please try again later.",
  VALIDATION_ERROR: "The attendance request is invalid.",
  INTERNAL_ERROR: "Unable to process the attendance request.",
};

export class AttendanceApiError extends Error {
  readonly code: AttendanceErrorCode;
  readonly status: number;

  constructor(
    code: AttendanceErrorCode,
    message: string = DEFAULT_ERROR_MESSAGE[code],
    options?: {
      status?: number;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause === undefined ? undefined : {
      cause: options.cause,
    });
    this.name = "AttendanceApiError";
    this.code = code;
    this.status = options?.status ?? DEFAULT_ERROR_STATUS[code];
  }
}

export type AttendanceErrorResponse = Readonly<{
  status: number;
  body: {
    ok: false;
    error: {
      code: AttendanceErrorCode;
      message: string;
    };
  };
}>;

export function normalizeAttendanceApiError(
  error: unknown,
): AttendanceApiError {
  if (error instanceof AttendanceApiError) {
    return error;
  }

  if (error instanceof ZodError) {
    return new AttendanceApiError(
      "VALIDATION_ERROR",
      error.issues[0]?.message ?? DEFAULT_ERROR_MESSAGE.VALIDATION_ERROR,
    );
  }

  return new AttendanceApiError("INTERNAL_ERROR");
}

export function attendanceErrorResponse(
  error: unknown,
): AttendanceErrorResponse {
  const normalized = normalizeAttendanceApiError(error);

  return {
    status: normalized.status,
    body: {
      ok: false,
      error: {
        code: normalized.code,
        message: normalized.message,
      },
    },
  };
}
