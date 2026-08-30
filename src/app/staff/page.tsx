import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  StaffHomeOverview,
  StaffManagerApprovalEntry,
} from "@/components/staff-pwa/staff-home-overview";
import { StaffToday } from "@/components/staff-pwa/staff-today";
import { getEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth/session";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import { getStaffHomeOverview } from "@/lib/staff-pwa/home";
import { getStaffOvertimeSummary } from "@/lib/staff-pwa/overtime-approvals";
import { getStaffTeamApprovalSummary } from "@/lib/staff-pwa/team-approvals";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function StaffHomePage() {
  const auth = await getEmployeeSelfServiceAuthContext();
  if (!auth) redirect("/staff/login");
  const context = await loadBusinessModuleContext(auth.businessId);
  const modules = [...context.enabledModules];
  const [overview, teamApprovals, overtimeApprovals] = await Promise.all([
    getStaffHomeOverview(auth, modules),
    getStaffTeamApprovalSummary(auth),
    getStaffOvertimeSummary(auth),
  ]);
  const approvalSummary = teamApprovals || overtimeApprovals?.canReviewOvertime
    ? {
        attendance: teamApprovals?.attendance ?? 0,
        leave: teamApprovals?.leave ?? 0,
        claims: teamApprovals?.claims ?? 0,
        overtime: overtimeApprovals?.canReviewOvertime ? overtimeApprovals.pending : 0,
        total: (teamApprovals?.total ?? 0) + (overtimeApprovals?.canReviewOvertime ? overtimeApprovals.pending : 0),
        complete: teamApprovals?.complete ?? true,
        canReviewAttendance: teamApprovals?.canReviewAttendance ?? false,
        canReviewLeave: teamApprovals?.canReviewLeave ?? false,
        canReviewClaims: teamApprovals?.canReviewClaims ?? false,
        canReviewOvertime: overtimeApprovals?.canReviewOvertime ?? false,
      }
    : null;

  return (
    <div className="staff-home-stack">
      <StaffHomeOverview overview={overview}>
        {context.enabledModules.has("HR") ? (
          <StaffToday
            afterAttendance={approvalSummary && approvalSummary.total > 0 ? (
              <StaffManagerApprovalEntry summary={approvalSummary} />
            ) : null}
          />
        ) : null}
      </StaffHomeOverview>
    </div>
  );
}
