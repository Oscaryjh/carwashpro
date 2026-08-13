import { NextResponse } from "next/server";
import {
  AttendanceApiError,
  attendanceErrorResponse,
} from "@/lib/attendance/api-error";
import {
  isEmployeeAuthError,
  type EmployeeAuthError,
} from "@/lib/attendance/employee-auth/errors";

export function employeeAttendanceJson(
  body: Record<string, unknown>,
  init?: ResponseInit,
) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store, max-age=0");
  response.headers.set("pragma", "no-cache");
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}

export function employeeAttendanceErrorResponse(error: unknown) {
  const mapped = isEmployeeAuthError(error)
    ? mapEmployeeAuthError(error)
    : error;
  const response = attendanceErrorResponse(mapped);

  if (
    !(mapped instanceof AttendanceApiError) ||
    mapped.code === "INTERNAL_ERROR"
  ) {
    console.error("[employee-attendance] Request failed", {
      errorName:
        error instanceof Error ? error.name : "UnknownError",
      errorCode:
        mapped instanceof AttendanceApiError
          ? mapped.code
          : "INTERNAL_ERROR",
    });
  }

  return employeeAttendanceJson(response.body, {
    status: response.status,
  });
}

function mapEmployeeAuthError(
  error: EmployeeAuthError,
): AttendanceApiError {
  switch (error.code) {
    case "UNAUTHENTICATED":
      return new AttendanceApiError("UNAUTHENTICATED");
    case "SESSION_REVOKED":
      return new AttendanceApiError("SESSION_EXPIRED");
    case "EMPLOYEE_INACTIVE":
    case "MEMBERSHIP_INACTIVE":
    case "MEMBERSHIP_NOT_AVAILABLE":
      return new AttendanceApiError("EMPLOYEE_INACTIVE");
    case "ATTENDANCE_DISABLED":
      return new AttendanceApiError("ATTENDANCE_DISABLED");
    case "DEVICE_REVOKED":
    case "DEVICE_NOT_ALLOWED":
      return new AttendanceApiError("DEVICE_NOT_AUTHORIZED");
    case "PRIMARY_BRANCH_UNAVAILABLE":
      return new AttendanceApiError("BRANCH_NOT_AUTHORIZED");
    case "RATE_LIMITED":
      return new AttendanceApiError("RATE_LIMITED");
    case "CONFIGURATION_ERROR":
    case "OTP_PROVIDER_UNAVAILABLE":
      return new AttendanceApiError(
        "INTERNAL_ERROR",
        "Employee attendance is temporarily unavailable.",
        {
          status: 503,
        },
      );
    case "INVALID_REQUEST":
    case "OTP_INVALID":
    case "OTP_EXPIRED":
    case "OTP_LOCKED":
    case "MEMBERSHIP_SELECTION_REQUIRED":
      return new AttendanceApiError("VALIDATION_ERROR");
  }
}
