import type { EmployeeAuthConfig } from "./config";
import {
  EMPLOYEE_SESSION_COOKIE,
  getEmployeeAuthConfig,
} from "./config";

export function employeeSessionCookieOptions(
  config: EmployeeAuthConfig = getEmployeeAuthConfig(),
) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: config.session.secureCookie,
    path: "/",
    maxAge: config.session.expiresInSeconds,
  };
}

export function expiredEmployeeSessionCookieOptions(
  config: EmployeeAuthConfig = getEmployeeAuthConfig(),
) {
  return {
    ...employeeSessionCookieOptions(config),
    maxAge: 0,
    expires: new Date(0),
  };
}

export function readEmployeeSessionToken(request: Request) {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");

    if (separatorIndex < 0) {
      continue;
    }

    const name = part.slice(0, separatorIndex).trim();

    if (name !== EMPLOYEE_SESSION_COOKIE) {
      continue;
    }

    const value = part.slice(separatorIndex + 1).trim();

    if (!value) {
      return null;
    }

    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }

  return null;
}
