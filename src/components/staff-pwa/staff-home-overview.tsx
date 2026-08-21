import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { StaffAppIcon } from "@/components/staff-pwa/staff-app-icon";
import type { AwaitedReturn } from "@/lib/staff-pwa/home-types";

export function StaffHomeOverview({ overview, children }: { overview: AwaitedReturn; children?: ReactNode }) {
  const displayName = formatDisplayName(overview.profile.employee.fullName);
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
            <span className="staff-welcome-avatar">
              {overview.profile.employee.avatarUrl ? (
                <Image
                  alt={`${overview.profile.employee.fullName} profile photo`}
                  height={80}
                  sizes="40px"
                  src={overview.profile.employee.avatarUrl}
                  unoptimized
                  width={80}
                />
              ) : (
                <span aria-hidden="true">{initials || "T"}</span>
              )}
            </span>
            <div>
              <p className="staff-kicker">TODAY</p>
              <h1>{displayName}</h1>
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
              <span className="staff-home-card-icon" aria-hidden="true">
                <StaffAppIcon name={overview.appearance.quickAccessIcons[card.domain]} />
              </span>
              <small>{card.label.replace(/^My\s+/i, "")}</small>
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

function formatDisplayName(fullName: string) {
  return fullName
    .trim()
    .split(/\s+/)
    .map((part) =>
      part
        ? `${part[0]?.toLocaleUpperCase("en-MY")}${part.slice(1).toLocaleLowerCase("en-MY")}`
        : part,
    )
    .join(" ");
}

function normalizeLabel(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-MY");
}
