import {
  assertEmployeeAuthSameOrigin,
  readEmployeeAuthJson,
} from "@/lib/attendance/employee-auth/http";
import { requireEmployeePunchAuthContext } from "@/lib/attendance/employee-auth/session";
import { submitAttendanceException } from "@/lib/attendance/exception-service";
import { attendanceExceptionInputSchema } from "@/lib/attendance/punch-input";
import {
  employeeAttendanceErrorResponse,
  employeeAttendanceJson,
} from "@/lib/attendance/response";
import { requireEmployeeBusinessModule } from "@/lib/modules/employee-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertEmployeeAuthSameOrigin(request);
    const auth = await requireEmployeePunchAuthContext(request);
    await requireEmployeeBusinessModule(auth, "HR");
    const input = await readEmployeeAuthJson(
      request,
      attendanceExceptionInputSchema,
    );
    const result = await submitAttendanceException({
      auth,
      input,
    });

    return employeeAttendanceJson({
      ok: true,
      data: result,
    });
  } catch (error) {
    return employeeAttendanceErrorResponse(error);
  }
}
