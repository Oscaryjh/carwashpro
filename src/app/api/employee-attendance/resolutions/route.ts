import {
  assertEmployeeAuthSameOrigin,
  readEmployeeAuthJson,
} from "@/lib/attendance/employee-auth/http";
import {
  requireEmployeeAuthContext,
  requireEmployeePunchAuthContext,
} from "@/lib/attendance/employee-auth/session";
import { loadEmployeeAttendanceResolutionCases } from "@/lib/attendance/resolution-read-service";
import {
  employeeResolutionSubmissionSchema,
  submitEmployeeAttendanceResolution,
} from "@/lib/attendance/resolution-workflow-service";
import {
  employeeAttendanceErrorResponse,
  employeeAttendanceJson,
} from "@/lib/attendance/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireEmployeeAuthContext(request);
    const data = await loadEmployeeAttendanceResolutionCases({ auth });
    return employeeAttendanceJson({ ok: true, data });
  } catch (error) {
    return employeeAttendanceErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertEmployeeAuthSameOrigin(request);
    const auth = await requireEmployeePunchAuthContext(request);
    const input = await readEmployeeAuthJson(
      request,
      employeeResolutionSubmissionSchema,
    );
    const data = await submitEmployeeAttendanceResolution({ auth, input });
    return employeeAttendanceJson({ ok: true, data });
  } catch (error) {
    return employeeAttendanceErrorResponse(error);
  }
}
