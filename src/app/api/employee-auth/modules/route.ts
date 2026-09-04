import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth/session";
import { employeeAuthErrorResponse, employeeAuthJson } from "@/lib/attendance/employee-auth/response";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import { canAccessStaffApprovals } from "@/lib/staff-pwa/approval-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireEmployeeSelfServiceAuthContext(request);
    const [context, canApprove] = await Promise.all([
      loadBusinessModuleContext(auth.businessId),
      canAccessStaffApprovals(auth),
    ]);
    return employeeAuthJson({
      ok: true,
      enabledModules: [...context.enabledModules],
      canApprove,
    });
  } catch (error) {
    return employeeAuthErrorResponse(error);
  }
}
