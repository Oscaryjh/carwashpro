import { requireEmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { getEmployeeAttendanceHistory } from "@/lib/attendance/read-service";
import {
  employeeAttendanceErrorResponse,
  employeeAttendanceJson,
} from "@/lib/attendance/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireEmployeeAuthContext(request);
    const searchParams = new URL(request.url).searchParams;
    const result = await getEmployeeAttendanceHistory({
      auth,
      input: Object.fromEntries(searchParams.entries()),
    });

    return employeeAttendanceJson({
      ok: true,
      data: result,
    });
  } catch (error) {
    return employeeAttendanceErrorResponse(error);
  }
}
