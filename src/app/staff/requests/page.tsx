import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth/session";
import { loadEmployeeAttendanceResolutionCases } from "@/lib/attendance/resolution-read-service";
import { getEmployeeClaimOverview } from "@/lib/claim/service";
import { getEmployeeLeaveOverview } from "@/lib/leave/service";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import { getStaffOvertimeSummary } from "@/lib/staff-pwa/overtime-approvals";
import { getStaffTeamApprovalSummary } from "@/lib/staff-pwa/team-approvals";

export const metadata: Metadata = { title: "Requests" };
export const dynamic = "force-dynamic";

type RequestActivity = {
  id: string;
  domain: "Leave" | "Claim" | "Attendance";
  title: string;
  detail: string;
  status: string;
  tone: "pending" | "approved" | "rejected" | "cancelled" | "action";
  href: string;
  timestamp: string;
};

export default async function StaffRequestsPage() {
  const auth = await getEmployeeSelfServiceAuthContext();
  if (!auth) redirect("/staff/login");
  const { enabledModules } = await loadBusinessModuleContext(auth.businessId);
  const [leave, claims, attendance, approvals, overtime] = await Promise.all([
    enabledModules.has("HR") ? getEmployeeLeaveOverview(auth) : null,
    enabledModules.has("CLAIMS") ? getEmployeeClaimOverview(auth) : null,
    enabledModules.has("HR") ? loadEmployeeAttendanceResolutionCases({ auth }) : [],
    getStaffTeamApprovalSummary(auth),
    getStaffOvertimeSummary(auth),
  ]);

  const activities: RequestActivity[] = [
    ...(leave?.requests.slice(0, 8).map((request) => ({
      id: request.id,
      domain: "Leave" as const,
      title: request.policyNameSnapshot,
      detail: `${formatDateValue(request.startsOn)} – ${formatDateValue(request.endsOn)} · ${request.requestedDays} day${request.requestedDays === 1 ? "" : "s"}`,
      status: request.status === "PENDING" ? "Pending approval" : titleCase(request.status),
      tone: statusTone(request.status),
      href: "/staff/leave",
      timestamp: request.createdAt,
    })) ?? []),
    ...(claims?.claims.slice(0, 8).map((claim) => ({
      id: claim.id,
      domain: "Claim" as const,
      title: claim.purpose,
      detail: `${claim.currency} ${claim.submittedTotal} · ${claim.claimNumber}`,
      status: claimStatusLabel(claim.status, claim.reimbursement?.status),
      tone: claimTone(claim.status, claim.reimbursement?.status),
      href: "/staff/claims",
      timestamp: claim.createdAt,
    })) ?? []),
    ...attendance.slice(0, 8).map((item) => ({
      id: item.id,
      domain: "Attendance" as const,
      title: "Attendance correction",
      detail: `${formatDateValue(item.workDate)} · ${item.branch.name}`,
      status: item.status === "RETURNED_FOR_CORRECTION" ? "Needs action" : "Under review",
      tone: "action" as const,
      href: "/staff/history/records",
      timestamp: item.updatedAt,
    })),
  ].sort((left, right) => right.timestamp.localeCompare(left.timestamp)).slice(0, 12);

  if (!enabledModules.has("HR") && !enabledModules.has("CLAIMS")) {
    redirect("/staff/module-not-enabled?module=HR");
  }

  const managerWorkspaceCount = (approvals?.leave ?? 0) +
    (approvals?.claims ?? 0) +
    (approvals?.attendance ?? 0) +
    (overtime?.pending ?? 0);

  return (
    <section className="staff-hub-page" aria-labelledby="staff-requests-heading">
      <header className="staff-section-hero">
        <p className="staff-kicker">MY REQUESTS</p>
        <h1 id="staff-requests-heading">Requests</h1>
        <span>Submit, track and follow up without searching through separate menus.</span>
      </header>

      {approvals || overtime?.canReviewOvertime ? (
        <Link className="staff-manager-approval-link" href="/staff/approvals">
          <span><small>MANAGER WORKSPACE</small><strong>Team approvals</strong></span>
          <b>{managerWorkspaceCount ? `${managerWorkspaceCount} waiting` : "All clear"}</b>
        </Link>
      ) : null}

      <div className="staff-hub-grid">
        {enabledModules.has("HR") ? <RequestCard href="/staff/leave" eyebrow="TIME AWAY" title="Leave" detail="Request leave and review balances or decisions." /> : null}
        {enabledModules.has("CLAIMS") ? <RequestCard href="/staff/claims" eyebrow="EXPENSES" title="Claims" detail="Submit expenses, receipts and track reimbursement." /> : null}
        {enabledModules.has("HR") ? <RequestCard href="/staff/history/records" eyebrow="TIME RECORDS" title="Attendance corrections" detail="Review your missing punches and submitted corrections." /> : null}
      </div>

      {enabledModules.has("HR") ? (
        <div className="staff-hub-note"><strong>Overtime</strong><span>Overtime is calculated from approved attendance. Check Timesheet &amp; overtime to see its status.</span></div>
      ) : null}

      <section className="staff-request-activity" aria-labelledby="request-activity-heading">
        <header><div><small>RECENT ACTIVITY</small><h2 id="request-activity-heading">Request status</h2></div><span>{activities.length} shown</span></header>
        {activities.length ? activities.map((item) => (
          <Link href={item.href} key={`${item.domain}-${item.id}`}>
            <span className="staff-request-domain">{item.domain.slice(0, 2).toUpperCase()}</span>
            <span className="staff-request-copy"><small>{item.domain}</small><strong>{item.title}</strong><span>{item.detail}</span></span>
            <b className={`staff-request-status ${item.tone}`}>{item.status}</b>
          </Link>
        )) : <div className="staff-hub-empty"><strong>No requests yet</strong><span>Your submitted Leave, Claims and attendance corrections will appear here.</span></div>}
      </section>
    </section>
  );
}
function RequestCard({ href, eyebrow, title, detail }: { href: string; eyebrow: string; title: string; detail: string }) {
  return <Link className="staff-hub-card" href={href}><small>{eyebrow}</small><strong>{title}</strong><span>{detail}</span><b>Open <span aria-hidden="true">→</span></b></Link>;
}

function statusTone(status: string): RequestActivity["tone"] {
  if (status === "APPROVED") return "approved";
  if (status === "REJECTED") return "rejected";
  if (status === "CANCELLED") return "cancelled";
  return "pending";
}

function claimTone(status: string, reimbursement?: string | null): RequestActivity["tone"] {
  if (reimbursement === "OUTSIDE_PAYROLL_PAID" || reimbursement === "PAYROLL_SETTLED") return "approved";
  if (status === "REJECTED") return "rejected";
  if (status === "CANCELLED" || status === "WITHDRAWN") return "cancelled";
  return status === "APPROVED" || status === "PARTIALLY_APPROVED" ? "approved" : "pending";
}

function claimStatusLabel(status: string, reimbursement?: string | null) {
  if (reimbursement === "OUTSIDE_PAYROLL_PAID" || reimbursement === "PAYROLL_SETTLED") return "Reimbursed";
  if (reimbursement === "PAYROLL_LINKED") return "Added to payroll";
  if (status === "SUBMITTED") return "Pending approval";
  if (status === "PARTIALLY_APPROVED") return "Partially approved";
  if (status === "WITHDRAWN") return "Withdrawn";
  return titleCase(status);
}

function titleCase(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function formatDateValue(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}
