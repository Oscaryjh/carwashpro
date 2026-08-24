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
      {teamApprovals ? (
        <Link className="staff-team-approvals-entry" href="/staff/approvals">
          <span className="staff-team-approvals-icon" aria-hidden="true">✓</span>
          <span>
            <small>TEAM WORKSPACE</small>
            <strong>Team Approvals</strong>
            <b>{teamApprovals.total ? `${teamApprovals.total} waiting` : "All caught up"}</b>
            <span className="staff-team-approvals-domains">
              {teamApprovals.canReviewLeave ? <em>Leave {teamApprovals.leave}</em> : null}
              {teamApprovals.canReviewClaims ? <em>Claims {teamApprovals.claims}</em> : null}
            </span>
          </span>
          <span className="staff-team-approvals-count" aria-label={`${teamApprovals.total} pending approvals`}>{teamApprovals.total}</span>
        </Link>
      ) : null}
      <div className="staff-home-section-heading">
        <div><p className="staff-kicker">MY SELF-SERVICE</p><h2 id="staff-home-overview-heading">Your work in one place</h2></div>
        <Link href="/staff/profile">Profile</Link>
      </div>
      {overview.cards.length ? (
        <div className="staff-home-grid">
          {overview.cards.map((card) => (
            <Link className={`staff-home-card ${card.status.toLowerCase()}`} href={card.href} key={card.domain}>
              <small>{card.label}</small>
              <strong>{card.value}</strong>
              <span>{card.detail}</span>
              <b>Open</b>
            </Link>
          ))}
        </div>
      ) : (
        <div className="staff-page-card staff-core-only-state" role="status">
          <strong>Profile and account access are available</strong>
          <span>This business has not enabled HR self-service modules. Tetamu will not show an empty Attendance workspace.</span>
          <Link href="/staff/profile">Open my profile</Link>
        </div>
      )}
    </section>
  );
}
