export type EmployeeAuthErrorCode =
  | "UNAUTHENTICATED"
  | "SESSION_REVOKED"
  | "EMPLOYEE_INACTIVE"
  | "MEMBERSHIP_INACTIVE"
  | "ATTENDANCE_DISABLED"
  | "DEVICE_REVOKED"
  | "DEVICE_NOT_ALLOWED"
  | "PRIMARY_BRANCH_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "RATE_LIMITED"
  | "OTP_INVALID"
  | "OTP_EXPIRED"
  | "OTP_LOCKED"
  | "OTP_PROVIDER_UNAVAILABLE"
  | "MEMBERSHIP_SELECTION_REQUIRED"
  | "MEMBERSHIP_NOT_AVAILABLE"
  | "CONFIGURATION_ERROR";

type EmployeeAuthErrorOptions = {
  cause?: unknown;
  publicMessage?: string;
  status?: number;
};

const DEFAULT_STATUS: Record<EmployeeAuthErrorCode, number> = {
  UNAUTHENTICATED: 401,
  SESSION_REVOKED: 401,
  EMPLOYEE_INACTIVE: 403,
  MEMBERSHIP_INACTIVE: 403,
  ATTENDANCE_DISABLED: 403,
  DEVICE_REVOKED: 401,
  DEVICE_NOT_ALLOWED: 403,
  PRIMARY_BRANCH_UNAVAILABLE: 403,
  INVALID_REQUEST: 400,
  RATE_LIMITED: 429,
  OTP_INVALID: 400,
  OTP_EXPIRED: 400,
  OTP_LOCKED: 429,
  OTP_PROVIDER_UNAVAILABLE: 503,
  MEMBERSHIP_SELECTION_REQUIRED: 409,
  MEMBERSHIP_NOT_AVAILABLE: 403,
  CONFIGURATION_ERROR: 503,
};

const DEFAULT_PUBLIC_MESSAGE: Record<EmployeeAuthErrorCode, string> = {
  UNAUTHENTICATED: "Employee session is required.",
  SESSION_REVOKED: "Employee session is no longer valid.",
  EMPLOYEE_INACTIVE: "Employee access is not available.",
  MEMBERSHIP_INACTIVE: "Employee access is not available.",
  ATTENDANCE_DISABLED: "Employee access is not available.",
  DEVICE_REVOKED: "Employee session is no longer valid.",
  DEVICE_NOT_ALLOWED: "This device is not allowed for this action.",
  PRIMARY_BRANCH_UNAVAILABLE: "No active primary branch is available.",
  INVALID_REQUEST: "Invalid request.",
  RATE_LIMITED: "Please wait before trying again.",
  OTP_INVALID: "The verification code is invalid or expired.",
  OTP_EXPIRED: "The verification code has expired. Request a new code.",
  OTP_LOCKED: "Too many verification attempts. Request a new code.",
  OTP_PROVIDER_UNAVAILABLE: "Unable to send OTP. Please try again.",
  MEMBERSHIP_SELECTION_REQUIRED: "Select a workplace to continue.",
  MEMBERSHIP_NOT_AVAILABLE: "The selected workplace is not available.",
  CONFIGURATION_ERROR: "Employee authentication is temporarily unavailable.",
};

export class EmployeeAuthError extends Error {
  readonly code: EmployeeAuthErrorCode;
  readonly publicMessage: string;
  readonly status: number;

  constructor(
    code: EmployeeAuthErrorCode,
    message?: string,
    options: EmployeeAuthErrorOptions = {},
  ) {
    super(message ?? DEFAULT_PUBLIC_MESSAGE[code], {
      cause: options.cause,
    });
    this.name = "EmployeeAuthError";
    this.code = code;
    this.publicMessage =
      options.publicMessage ?? DEFAULT_PUBLIC_MESSAGE[code];
    this.status = options.status ?? DEFAULT_STATUS[code];
  }
}

export function isEmployeeAuthError(
  error: unknown,
): error is EmployeeAuthError {
  return error instanceof EmployeeAuthError;
}

export function toEmployeeAuthError(error: unknown) {
  if (isEmployeeAuthError(error)) {
    return error;
  }

  return new EmployeeAuthError(
    "CONFIGURATION_ERROR",
    "Unexpected employee authentication failure.",
    { cause: error },
  );
}
