import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { employeeAttendanceErrorResponse, employeeAttendanceJson } from "@/lib/attendance/response";
import { requireEmployeeBusinessModule } from "@/lib/modules/employee-access";
import { getStaffAppointmentDay } from "@/lib/staff-pwa/appointments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireEmployeeSelfServiceAuthContext(request);
    await requireEmployeeBusinessModule(auth, "SALON");
    const date = new URL(request.url).searchParams.get("date") ?? undefined;
    return employeeAttendanceJson({
      ok: true,
      data: await getStaffAppointmentDay({ auth, date }),
    });
  } catch (error) {
    return employeeAttendanceErrorResponse(error);
  }
}

