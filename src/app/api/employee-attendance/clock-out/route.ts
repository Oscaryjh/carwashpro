import {
  assertEmployeeAuthSameOrigin,
  getEmployeeAuthRequestContext,
  readEmployeeAuthJson,
} from "@/lib/attendance/employee-auth/http";
import { requireEmployeePunchAuthContext } from "@/lib/attendance/employee-auth/session";
import { attendancePunchInputSchema } from "@/lib/attendance/punch-input";
import { performAttendancePunch } from "@/lib/attendance/punch-service";
import {
  employeeAttendanceErrorResponse,
  employeeAttendanceJson,
} from "@/lib/attendance/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertEmployeeAuthSameOrigin(request);
    const auth = await requireEmployeePunchAuthContext(request);
    const input = await readEmployeeAuthJson(
      request,
      attendancePunchInputSchema,
    );
    const requestContext = getEmployeeAuthRequestContext(request);
    const result = await performAttendancePunch({
      auth,
      type: "CLOCK_OUT",
      input,
      ipAddress: requestContext.ipAddress,
    });

    return employeeAttendanceJson({
      ok: true,
      data: result,
    });
  } catch (error) {
    return employeeAttendanceErrorResponse(error);
  }
}
