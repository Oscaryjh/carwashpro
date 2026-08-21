import Link from "next/link";
import type { ReactNode } from "react";
import type { AwaitedReturn } from "@/lib/staff-pwa/home-types";

export function StaffHomeOverview({ overview, children }: { overview: AwaitedReturn; children?: ReactNode }) {
  const firstName = overview.profile.employee.fullName.split(/\s+/)[0];
  const businessName = overview.profile.workplace.businessName;
  const branchName = overview.profile.workplace.primaryBranchName;
  const showBranchName = normalizeLabel(branchName) !== normalizeLabel(businessName);
  const initials = overview.profile.employee.fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((name) => name[0]?.toUpperCase())
    .join("");
  const today = new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    weekday: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date());

  return (
    <section className="staff-home-overview" aria-labelledby="staff-home-overview-heading">
      {overview.showWelcome ? (
        <section className="staff-welcome-card">
          <div className="staff-welcome-identity">
            <span aria-hidden="true" className="staff-welcome-avatar">{initials || "T"}</span>
            <div>
              <p className="staff-kicker">TODAY</p>
              <h1>Hello, {firstName}</h1>
              <p>{businessName}</p>
              {showBranchName ? <span className="staff-welcome-branch">{branchName}</span> : null}
            </div>
          </div>
          <div className="staff-welcome-meta">
            <time dateTime={new Date().toISOString().slice(0, 10)}>{today}</time>
            <span className="staff-state-orb ready"><i aria-hidden="true" /> Ready</span>
          </div>
        </section>
      ) : null}
      {children}
      <div className="staff-home-section-heading">
        <div><p className="staff-kicker">MY WORKSPACE</p><h2 id="staff-home-overview-heading">Quick access</h2></div>
        <Link href="/staff/profile">View profile <span aria-hidden="true">→</span></Link>
      </div>
      {overview.cards.length ? (
        <div className="staff-home-grid">
          {overview.cards.map((card) => (
            <Link
              aria-label={`${card.label}: ${card.value}`}
              className={`staff-home-card ${card.status.toLowerCase()}`}
              href={card.href}
              key={card.domain}
            >
              <span className="staff-home-card-icon" aria-hidden="true"><HomeDomainIcon domain={card.domain} /></span>
              <div>
                <small>{card.label.replace(/^My\s+/i, "")}</small>
                <strong>{card.value}</strong>
              </div>
              <span aria-hidden="true" className="staff-home-card-arrow">›</span>
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

function normalizeLabel(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-MY");
}

function HomeDomainIcon({ domain }: { domain: AwaitedReturn["cards"][number]["domain"] }) {
  const paths: Record<AwaitedReturn["cards"][number]["domain"], ReactNode> = {
    ROSTER: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h3M13 14h3" /></>,
    TIMESHEET: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    LEAVE: <><path d="M5 20c8 0 14-5 14-15C9 5 5 11 5 20Z" /><path d="M6 18c3-4 6-7 11-10" /></>,
    CLAIMS: <><path d="M7 3h10l3 3v15H4V3z" /><path d="M8 9h8M8 13h8M8 17h5" /></>,
    COMMISSION: <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5c-.8-.7-1.9-1-3.2-1-1.8 0-3 .8-3 2.1 0 3.2 6.1 1.6 6.1 4.9 0 1.3-1.2 2.1-3.2 2.1-1.5 0-2.8-.5-3.7-1.4M12 5.5v13" /></>,
    PAYSLIP: <><path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21V3Z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
  };
  return <svg fill="none" viewBox="0 0 24 24"><g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">{paths[domain]}</g></svg>;
}
