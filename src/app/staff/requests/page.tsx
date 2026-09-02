import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth/session";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import { getStaffHomeOverview } from "@/lib/staff-pwa/home";
import { getStaffOvertimeSummary } from "@/lib/staff-pwa/overtime-approvals";
import { getStaffTeamApprovalSummary } from "@/lib/staff-pwa/team-approvals";

export const metadata: Metadata = { title: "Requests" };
export const dynamic = "force-dynamic";
const overtimeApprovalLink = { href: "/staff/requests/overtime" } as const;

export default async function StaffRequestsPage() {
  const auth = await getEmployeeSelfServiceAuthContext();
  if (!auth) redirect("/staff/login");
  const [{ enabledModules }, overtime, teamApprovals] = await Promise.all([
    loadBusinessModuleContext(auth.businessId),
    getStaffOvertimeSummary(auth),
    getStaffTeamApprovalSummary(auth),
  ]);
  const overview = await getStaffHomeOverview(auth, [...enabledModules]);
  const items = [
    enabledModules.has("HR")
      ? {
          href: "/staff/leave",
          eyebrow: "Time away",
          title: "Leave",
          detail: "Request leave and check your balances and request history.",
        }
      : null,
    enabledModules.has("CLAIMS")
      ? {
          href: "/staff/claims",
          eyebrow: "Expenses",
          title: "Claims",
          detail: "Submit an expense claim, attach a receipt and follow its status.",
        }
      : null,
    enabledModules.has("HR")
      ? {
          href: "/staff/history#attendance-correction",
          eyebrow: "Attendance",
          title: "Attendance correction",
          detail: "Report a missing clock in or clock out for manager review.",
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  const approvalTotal = (teamApprovals?.total ?? 0) + (overtime?.pending ?? 0);
  const activity = overview.cards.filter((card) =>
    card.domain === "LEAVE" || card.domain === "CLAIMS" || card.domain === "TIMESHEET"
  );

  if (!items.length) redirect("/staff/module-not-enabled?module=HR");

  return (
    <section className="staff-hub-page" aria-labelledby="staff-requests-heading">
      <header className="staff-hub-heading">
        <p className="staff-kicker">MY REQUESTS</p>
        <h1 id="staff-requests-heading">Requests</h1>
        <span>Submit your own request, track its status or review your team.</span>
      </header>
      {teamApprovals || overtime?.canReviewOvertime ? (
        <section className="staff-approval-summary" aria-labelledby="staff-approval-summary-heading">
          <div className="staff-approval-summary-heading">
            <div><small>MANAGER</small><h2 id="staff-approval-summary-heading">Needs your approval</h2></div>
            <strong>{approvalTotal}<span> waiting</span></strong>
          </div>
          <div className="staff-approval-summary-counts">
            {teamApprovals?.canReviewLeave ? <span><small>Leave</small><b>{teamApprovals.leave}</b></span> : null}
            {teamApprovals?.canReviewClaims ? <span><small>Claims</small><b>{teamApprovals.claims}</b></span> : null}
            {overtime?.canReviewOvertime ? <span><small>Overtime</small><b>{overtime.pending}</b></span> : null}
          </div>
          <div className="staff-approval-summary-actions">
            {teamApprovals ? <Link className="staff-primary-link" href="/staff/approvals">Review approvals <span aria-hidden="true">→</span></Link> : null}
            {overtime?.canReviewOvertime ? <Link className="staff-secondary-link" href={overtimeApprovalLink.href}>Review overtime</Link> : null}
          </div>
          <p>Overtime is calculated from attendance. Employees do not submit a separate overtime request.</p>
        </section>
      ) : null}
      <div className="staff-section-heading"><div><small>SELF-SERVICE</small><h2>My requests</h2></div></div>
      <div className="staff-hub-grid">
        {items.map((item) => (
          <Link className="staff-hub-card" href={item.href} key={item.href}>
            <small>{item.eyebrow}</small>
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
            <b>Open <span aria-hidden="true">→</span></b>
          </Link>
        ))}
      </div>
      <section className="staff-recent-activity" aria-labelledby="staff-recent-activity-heading">
        <div className="staff-section-heading"><div><small>YOUR UPDATES</small><h2 id="staff-recent-activity-heading">Recent activity</h2></div></div>
        {activity.length ? activity.map((card) => (
          <Link href={card.href} key={card.domain}>
            <span><strong>{card.label}</strong><small>{card.detail}</small></span>
            <b>{card.value}</b>
          </Link>
        )) : <div className="staff-empty-state"><h2>No requests yet</h2><p>Your leave, claims and attendance corrections will appear here.</p></div>}
      </section>
    </section>
  );
}
