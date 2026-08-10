import {
  getEmployeeAuthProfile,
  requireEmployeeSelfServiceAuthContext,
} from "@/lib/attendance/employee-auth/session";
import { employeeAuthErrorResponse, employeeAuthJson } from "@/lib/attendance/employee-auth/response";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await requireEmployeeSelfServiceAuthContext(request);
    const profile = await getEmployeeAuthProfile(context);

    return employeeAuthJson({
      ok: true,
      authenticated: true,
      profile,
    });
  } catch (error) {
    return employeeAuthErrorResponse(error);
  }
}
