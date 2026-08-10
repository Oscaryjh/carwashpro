import { redirect } from "next/navigation";
import { AttendanceApiError } from "@/lib/attendance/api-error";
import {
  getEmployeeSelfServiceAuthContext,
  type EmployeeAuthContext,
} from "@/lib/attendance/employee-auth/session";
import {
  ModuleNotEnabledError,
  requireBusinessModule,
} from "./entitlements";
import type { ModuleKey } from "./registry";

export async function requireEmployeeBusinessModule(
  auth: Pick<EmployeeAuthContext, "businessId">,
  moduleKey: ModuleKey,
) {
  try {
    return await requireBusinessModule(auth.businessId, moduleKey);
  } catch (error) {
    if (error instanceof ModuleNotEnabledError) {
      throw new AttendanceApiError(
        "MODULE_NOT_ENABLED",
        `${moduleKey} is not enabled for this business.`,
      );
    }
    throw error;
  }
}

export async function requireEmployeeModulePage(moduleKey: ModuleKey) {
  const auth = await getEmployeeSelfServiceAuthContext();
  if (!auth) redirect("/staff/login");
  try {
    await requireBusinessModule(auth.businessId, moduleKey);
  } catch (error) {
    if (error instanceof ModuleNotEnabledError) {
      redirect(`/staff/module-not-enabled?module=${moduleKey}`);
    }
    throw error;
  }
  return auth;
}
