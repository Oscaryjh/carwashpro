import { getEmployeeAuthConfig } from "@/lib/attendance/employee-auth/config";
import {
  employeeSessionCookieOptions,
  readEmployeeSessionToken,
} from "@/lib/attendance/employee-auth/cookie";
import { EmployeeAuthError } from "@/lib/attendance/employee-auth/errors";
import {
  getEmployeeAuthProfile,
  requireEmployeeSelfServiceAuthContext,
} from "@/lib/attendance/employee-auth/session";
import { employeeAuthErrorResponse, employeeAuthJson } from "@/lib/attendance/employee-auth/response";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const config = getEmployeeAuthConfig();
    const token = readEmployeeSessionToken(request);
    if (!token) throw new EmployeeAuthError("UNAUTHENTICATED");

    const context = await requireEmployeeSelfServiceAuthContext(request, {
      config,
    });
    const profile = await getEmployeeAuthProfile(context);

    const response = employeeAuthJson({
      ok: true,
      authenticated: true,
      profile,
    });
    response.cookies.set(
      config.session.cookieName,
      token,
      employeeSessionCookieOptions(config),
    );
    return response;
  } catch (error) {
    return employeeAuthErrorResponse(error);
  }
}
