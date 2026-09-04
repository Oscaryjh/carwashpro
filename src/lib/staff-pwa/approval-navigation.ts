import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { resolveStaffOvertimeAccess } from "@/lib/staff-pwa/overtime-approvals";
import { resolveStaffTeamApprovalAccess } from "@/lib/staff-pwa/team-approvals";

type ApprovalNavigationDependencies = {
  resolveTeamAccess: typeof resolveStaffTeamApprovalAccess;
  resolveOvertimeAccess: typeof resolveStaffOvertimeAccess;
};

// Reuse the canonical tenant/module/permission gates. Pending counts must never
// control navigation, and an unavailable permission check must not grant access.
export async function canAccessStaffApprovals(
  auth: EmployeeAuthContext,
  dependencies: Partial<ApprovalNavigationDependencies> = {},
): Promise<boolean> {
  const results = await Promise.allSettled([
    (dependencies.resolveTeamAccess ?? resolveStaffTeamApprovalAccess)(auth),
    (dependencies.resolveOvertimeAccess ?? resolveStaffOvertimeAccess)(auth),
  ]);
  return results.some(result => result.status === "fulfilled" && Boolean(result.value));
}
