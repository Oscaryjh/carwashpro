import { requireEmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { loadEmployeeCorrectionArchive } from "@/lib/attendance/employee-correction-archive";
import {
  employeeAttendanceErrorResponse,
  employeeAttendanceJson,
} from "@/lib/attendance/response";
import { requireEmployeeBusinessModule } from "@/lib/modules/employee-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireEmployeeAuthContext(request);
    await requireEmployeeBusinessModule(auth, "HR");
    const searchParams = new URL(request.url).searchParams;
    const data = await loadEmployeeCorrectionArchive({
      auth,
      input: {
        cursor: searchParams.get("cursor") || undefined,
        limit: searchParams.get("limit") || undefined,
      },
    });
    return employeeAttendanceJson({ ok: true, data });
  } catch (error) {
    return employeeAttendanceErrorResponse(error);
  }
}
