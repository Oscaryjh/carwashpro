import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { assertEmployeeAuthSameOrigin, readEmployeeAuthJson } from "@/lib/attendance/employee-auth/http";
import { employeeAttendanceErrorResponse, employeeAttendanceJson } from "@/lib/attendance/response";
import { leaveCancelInputSchema, leaveRequestInputSchema } from "@/lib/leave/policy";
import { cancelEmployeeLeave, getEmployeeLeaveOverview, submitEmployeeLeave } from "@/lib/leave/service";
import { requireEmployeeBusinessModule } from "@/lib/modules/employee-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireEmployeeSelfServiceAuthContext(request);
    await requireEmployeeBusinessModule(auth, "HR");
    return employeeAttendanceJson({ ok: true, data: await getEmployeeLeaveOverview(auth) });
  } catch (error) {
    return employeeAttendanceErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertEmployeeAuthSameOrigin(request);
    const auth = await requireEmployeeSelfServiceAuthContext(request);
    await requireEmployeeBusinessModule(auth, "HR");
    const input = await readEmployeeAuthJson(request, leaveRequestInputSchema);
    const result = await submitEmployeeLeave(auth, input);
    return employeeAttendanceJson({ ok: true, data: result }, { status: 201 });
  } catch (error) {
    return employeeAttendanceErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertEmployeeAuthSameOrigin(request);
    const auth = await requireEmployeeSelfServiceAuthContext(request);
    await requireEmployeeBusinessModule(auth, "HR");
    const input = await readEmployeeAuthJson(request, leaveCancelInputSchema);
    await cancelEmployeeLeave(auth, input);
    return employeeAttendanceJson({ ok: true });
  } catch (error) {
    return employeeAttendanceErrorResponse(error);
  }
}
