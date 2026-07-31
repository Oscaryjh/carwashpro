import { z } from "zod";
import {
  assertEmployeeAuthSameOrigin,
  readEmployeeAuthJson,
} from "@/lib/attendance/employee-auth/http";
import { requireEmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { switchEmployeeAttendanceBranch } from "@/lib/attendance/branch-switch-service";
import {
  employeeAttendanceErrorResponse,
  employeeAttendanceJson,
} from "@/lib/attendance/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  branchId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    assertEmployeeAuthSameOrigin(request);
    const auth = await requireEmployeeAuthContext(request);
    const input = await readEmployeeAuthJson(request, inputSchema);
    const result = await switchEmployeeAttendanceBranch({
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
