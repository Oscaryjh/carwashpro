import { z } from "zod";
import { getEmployeeAuthConfig } from "@/lib/attendance/employee-auth/config";
import { employeeSessionCookieOptions } from "@/lib/attendance/employee-auth/cookie";
import {
  assertEmployeeAuthSameOrigin,
  getEmployeeAuthRequestContext,
  readEmployeeAuthJson,
} from "@/lib/attendance/employee-auth/http";
import {
  requireEmployeeSelfServiceAuthContext,
  switchEmployeeWorkplace,
} from "@/lib/attendance/employee-auth/session";
import {
  employeeAuthErrorResponse,
  employeeAuthJson,
} from "@/lib/attendance/employee-auth/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const switchWorkplaceSchema = z.object({
  membershipId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    assertEmployeeAuthSameOrigin(request);
    const config = getEmployeeAuthConfig();
    const auth = await requireEmployeeSelfServiceAuthContext(request, { config });
    const input = await readEmployeeAuthJson(
      request,
      switchWorkplaceSchema,
      config.maxJsonBodyBytes,
    );
    const result = await switchEmployeeWorkplace(
      {
        auth,
        membershipId: input.membershipId,
        request: getEmployeeAuthRequestContext(request),
      },
      { config },
    );
    const response = employeeAuthJson({
      ok: true,
      workplace: result.workplace,
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
