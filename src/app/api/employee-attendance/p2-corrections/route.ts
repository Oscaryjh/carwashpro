import { z } from "zod";
import { assertEmployeeAuthSameOrigin, readEmployeeAuthJson } from "@/lib/attendance/employee-auth/http";
import { requireEmployeePunchAuthContext } from "@/lib/attendance/employee-auth/session";
import { submitAttendanceCorrectionRequest } from "@/lib/attendance/p2-service";
import { employeeAttendanceErrorResponse, employeeAttendanceJson } from "@/lib/attendance/response";
import { requireEmployeeBusinessModule } from "@/lib/modules/employee-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  exceptionId: z.string().uuid(),
  requestKey: z.string().trim().min(8).max(160),
  requestedClockInAt: z.string().datetime().nullable().optional().transform((value) => value ? new Date(value) : null),
  requestedClockOutAt: z.string().datetime().nullable().optional().transform((value) => value ? new Date(value) : null),
  reason: z.string().trim().min(3).max(500),
});

export async function POST(request: Request) {
  try {
    assertEmployeeAuthSameOrigin(request);
    const auth = await requireEmployeePunchAuthContext(request);
    await requireEmployeeBusinessModule(auth, "HR");
    const input = await readEmployeeAuthJson(request, inputSchema);
    const data = await submitAttendanceCorrectionRequest({ auth, ...input });
    return employeeAttendanceJson({ ok: true, data });
  } catch (error) {
    return employeeAttendanceErrorResponse(error);
  }
}
