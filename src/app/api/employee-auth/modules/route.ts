import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth/session";
import { employeeAuthErrorResponse, employeeAuthJson } from "@/lib/attendance/employee-auth/response";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireEmployeeSelfServiceAuthContext(request);
    const context = await loadBusinessModuleContext(auth.businessId);
    return employeeAuthJson({
      ok: true,
      enabledModules: [...context.enabledModules],
    });
  } catch (error) {
    return employeeAuthErrorResponse(error);
  }
}
