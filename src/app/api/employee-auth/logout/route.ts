import { getEmployeeAuthConfig } from "@/lib/attendance/employee-auth/config";
import {
  expiredEmployeeSessionCookieOptions,
  readEmployeeSessionToken,
} from "@/lib/attendance/employee-auth/cookie";
import { assertEmployeeAuthSameOrigin } from "@/lib/attendance/employee-auth/http";
import { employeeAuthErrorResponse, employeeAuthJson } from "@/lib/attendance/employee-auth/response";
import { revokeEmployeeSessionToken } from "@/lib/attendance/employee-auth/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertEmployeeAuthSameOrigin(request);
    const config = getEmployeeAuthConfig();
    const token = readEmployeeSessionToken(request);
    await revokeEmployeeSessionToken(token, {
      config,
      reason: "Employee logged out.",
    });

    const response = employeeAuthJson({ ok: true });
    response.cookies.set(
      config.session.cookieName,
      "",
      expiredEmployeeSessionCookieOptions(config),
    );
    return response;
  } catch (error) {
    return employeeAuthErrorResponse(error);
  }
}
