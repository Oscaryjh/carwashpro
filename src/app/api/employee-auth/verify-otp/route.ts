import { getEmployeeAuthConfig } from "@/lib/attendance/employee-auth/config";
import { employeeSessionCookieOptions } from "@/lib/attendance/employee-auth/cookie";
import {
  assertEmployeeAuthSameOrigin,
  getEmployeeAuthRequestContext,
  readEmployeeAuthJson,
} from "@/lib/attendance/employee-auth/http";
import { verifyEmployeeOtp } from "@/lib/attendance/employee-auth/otp-service";
import { employeeAuthErrorResponse, employeeAuthJson } from "@/lib/attendance/employee-auth/response";
import { verifyEmployeeOtpSchema } from "@/lib/attendance/employee-auth/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertEmployeeAuthSameOrigin(request);
    const config = getEmployeeAuthConfig();
    const input = await readEmployeeAuthJson(
      request,
      verifyEmployeeOtpSchema,
      config.maxJsonBodyBytes,
    );
    const result = await verifyEmployeeOtp(
      {
        ...input,
        request: getEmployeeAuthRequestContext(request),
      },
      { config, requireAttendance: false },
    );

    if (result.status === "MEMBERSHIP_SELECTION_REQUIRED") {
      return employeeAuthJson({
        ok: true,
        status: result.status,
        selectionToken: result.selectionToken,
        memberships: result.memberships,
      });
    }

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
