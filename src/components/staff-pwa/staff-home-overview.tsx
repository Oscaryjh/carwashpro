import Link from "next/link";
import type { ReactNode } from "react";
import type { AwaitedReturn } from "@/lib/staff-pwa/home-types";

type TeamApprovalSummary = {
  total: number;
  leave: number;
  claims: number;
  complete: boolean;
  canReviewLeave: boolean;
  canReviewClaims: boolean;
} | null;

export function StaffHomeOverview({ overview, teamApprovals, children }: { overview: AwaitedReturn; teamApprovals?: TeamApprovalSummary; children?: ReactNode }) {
  const nextShift = overview.cards.find((card) => card.domain === "ROSTER");
  const latestPayslip = overview.cards.find((card) => card.domain === "PAYSLIP");
  const requestCards = overview.cards.filter((card) => card.domain === "LEAVE" || card.domain === "CLAIMS");
  const pendingRequests = requestCards.filter((card) => /pending/i.test(card.value)).length;
  return (
    <section className="staff-home-overview" aria-labelledby="staff-home-overview-heading">
      {overview.showWelcome ? (
        <section className="staff-welcome-card">
          <div>
            <p className="staff-kicker">TETAMU STAFF APP</p>
            <h1>Hello, {overview.profile.employee.fullName.split(/\s+/)[0]}</h1>
            <p>{overview.profile.workplace.businessName} · {overview.profile.workplace.primaryBranchName}</p>
          </div>
          <span className="staff-state-orb ready">Ready</span>
        </section>
      ) : null}
      {children}
      <div className="staff-home-section-heading">
        <div><p className="staff-kicker">NEXT</p><h2 id="staff-home-overview-heading">What&apos;s coming up</h2></div>
      </div>
      {nextShift || latestPayslip || requestCards.length ? (
        <div className="staff-home-grid staff-home-grid-compact">
          {nextShift ? [nextShift].map((card) => (
            <Link className={`staff-home-card ${card.status.toLowerCase()}`} href={card.href} key={card.domain}>
              <small>{card.label}</small>
              <strong>{card.value}</strong>
              <span>{card.detail}</span>
              <b>Open</b>
            </Link>
          )) : null}
          {requestCards.length ? <Link className="staff-home-card ready" href="/staff/requests"><small>My requests</small><strong>{pendingRequests ? `${pendingRequests} pending` : "No pending requests"}</strong><span>Leave, claims and attendance corrections.</span><b>Open</b></Link> : null}
          {latestPayslip ? <Link className={`staff-home-card ${latestPayslip.status.toLowerCase()}`} href="/staff/pay"><small>Latest payslip</small><strong>{latestPayslip.value}</strong><span>{latestPayslip.detail}</span><b>Open</b></Link> : null}
        </div>
      ) : (
        <div className="staff-page-card staff-core-only-state" role="status">
          <strong>Profile and account access are available</strong>
          <span>This business has not enabled HR self-service modules. Tetamu will not show an empty Attendance workspace.</span>
          <Link href="/staff/profile">Open my profile</Link>
        </div>
      )}
      {teamApprovals ? (
        <Link aria-label="Team Approvals" className="staff-team-approvals-entry staff-team-approvals-compact" href="/staff/requests">
          <span className="staff-team-approvals-icon" aria-hidden="true">✓</span>
          <span><small>MANAGER</small><strong>Needs your approval</strong><b>{teamApprovals.total ? `${teamApprovals.total} waiting` : "All caught up"}</b></span>
          <span className="staff-team-approvals-count" aria-label={`${teamApprovals.total} pending approvals`}>{teamApprovals.total}</span>
        </Link>
      ) : null}
    </section>
  );
}
