import Link from "next/link";
import type { ReactNode } from "react";
import type { AwaitedReturn } from "@/lib/staff-pwa/home-types";

export function StaffHomeOverview({ overview, children }: { overview: AwaitedReturn; children?: ReactNode }) {
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
