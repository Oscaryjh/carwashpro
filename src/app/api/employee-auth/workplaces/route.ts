import {
  getEmployeeWorkplaces,
  requireEmployeeSelfServiceAuthContext,
} from "@/lib/attendance/employee-auth/session";
import {
  employeeAuthErrorResponse,
  employeeAuthJson,
} from "@/lib/attendance/employee-auth/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireEmployeeSelfServiceAuthContext(request);
    const workplaces = await getEmployeeWorkplaces(auth);

    return employeeAuthJson({ ok: true, workplaces });
  } catch (error) {
    return employeeAuthErrorResponse(error);
  }
}
