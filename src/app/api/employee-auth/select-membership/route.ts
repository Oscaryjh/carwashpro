import { getEmployeeAuthConfig } from "@/lib/attendance/employee-auth/config";
import { employeeSessionCookieOptions } from "@/lib/attendance/employee-auth/cookie";
import {
  assertEmployeeAuthSameOrigin,
  getEmployeeAuthRequestContext,
  readEmployeeAuthJson,
} from "@/lib/attendance/employee-auth/http";
import { selectEmployeeMembership } from "@/lib/attendance/employee-auth/otp-service";
import { employeeAuthErrorResponse, employeeAuthJson } from "@/lib/attendance/employee-auth/response";
import { selectEmployeeMembershipSchema } from "@/lib/attendance/employee-auth/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertEmployeeAuthSameOrigin(request);
    const config = getEmployeeAuthConfig();
    const input = await readEmployeeAuthJson(
      request,
      selectEmployeeMembershipSchema,
      config.maxJsonBodyBytes,
    );
    const result = await selectEmployeeMembership(
      {
        ...input,
        request: getEmployeeAuthRequestContext(request),
      },
      { config, requireAttendance: false },
    );
    const response = employeeAuthJson({
      ok: true,
      status: result.status,
      expiresAt: result.expiresAt.toISOString(),
    });
    response.cookies.set(
      config.session.cookieName,
      result.token,
      employeeSessionCookieOptions(config),
    );
    return response;
  } catch (error) {
    return employeeAuthErrorResponse(error);
  }
}
