import { requireEmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { getEmployeeAttendanceToday } from "@/lib/attendance/read-service";
import {
  employeeAttendanceErrorResponse,
  employeeAttendanceJson,
} from "@/lib/attendance/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireEmployeeAuthContext(request);
    const result = await getEmployeeAttendanceToday({
      auth,
    });

    return employeeAttendanceJson({
      ok: true,
      data: result,
    });
  } catch (error) {
    return employeeAttendanceErrorResponse(error);
  }
}
