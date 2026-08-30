import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { StaffAppIcon } from "@/components/staff-pwa/staff-app-icon";
import type { AwaitedReturn } from "@/lib/staff-pwa/home-types";

export type TeamApprovalSummary = {
  total: number;
  attendance: number;
  leave: number;
  claims: number;
  overtime: number;
  complete: boolean;
  canReviewAttendance: boolean;
  canReviewLeave: boolean;
  canReviewClaims: boolean;
  canReviewOvertime: boolean;
} | null;

export function StaffHomeOverview({ overview, children }: {
  overview: AwaitedReturn;
  children?: ReactNode;
}) {
  const displayName = formatDisplayName(overview.profile.employee.fullName);
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
    <section aria-label="Staff home" className="staff-home-overview">
      {overview.showWelcome ? (
        <section className="staff-welcome-card">
          <div className="staff-welcome-identity">
            <span className="staff-welcome-avatar">
              {overview.profile.employee.avatarUrl ? (
                <Image
                  alt={`${overview.profile.employee.fullName} profile photo`}
                  height={80}
                  sizes="80px"
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
            </div>
          </div>
          <div className="staff-welcome-meta">
            <time dateTime={new Date().toISOString().slice(0, 10)}>{today}</time>
            <span className="staff-state-orb ready"><i aria-hidden="true" /> Ready</span>
          </div>
        </section>
      ) : null}
      {children}
      {overview.appointmentDay?.nextAppointment ? (
        <section className="staff-home-next-appointment" aria-labelledby="staff-home-next-appointment-heading">
          <header className="staff-home-section-heading">
            <p className="staff-kicker" id="staff-home-next-appointment-heading">NEXT APPOINTMENT</p>
            <Link href="/staff/appointments">View all</Link>
          </header>
          <Link className="staff-home-next-appointment-card" href={`/staff/appointments?date=${overview.appointmentDay.date}`}>
            <time dateTime={overview.appointmentDay.nextAppointment.scheduledAt}>{overview.appointmentDay.nextAppointment.timeLabel}</time>
            <div>
              <strong>{overview.appointmentDay.nextAppointment.customerName}</strong>
              <small>{overview.appointmentDay.nextAppointment.serviceSummary}</small>
              <span>{overview.appointmentDay.nextAppointment.durationLabel} · {overview.appointmentDay.nextAppointment.branchName}</span>
            </div>
            <i aria-hidden="true">›</i>
          </Link>
          <small className="staff-home-appointment-count">{overview.appointmentDay.remainingCount} appointment{overview.appointmentDay.remainingCount === 1 ? "" : "s"} remaining today</small>
        </section>
      ) : null}
      {overview.upNext && overview.upNext.status !== "EMPTY" ? (
        <section className="staff-home-up-next" aria-labelledby="staff-home-up-next-heading">
          <header className="staff-home-section-heading">
            <p className="staff-kicker" id="staff-home-up-next-heading">UPCOMING SCHEDULE</p>
          </header>
          <Link className={`staff-home-up-next-card ${overview.upNext.status.toLowerCase()}`} href={overview.upNext.href}>
            <span className="staff-home-up-next-icon" aria-hidden="true">
              <StaffAppIcon name={overview.appearance.quickAccessIcons.ROSTER} />
            </span>
            <span>
              <small>{overview.upNext.dateLabel}</small>
              <strong>{overview.upNext.title}</strong>
              {overview.upNext.timeLabel ? <b>{overview.upNext.timeLabel}</b> : null}
              {overview.upNext.branchName ? <em>{overview.upNext.branchName}</em> : null}
            </span>
            <i aria-hidden="true">›</i>
          </Link>
        </section>
      ) : null}
      <section className="staff-home-quick-access" aria-labelledby="staff-home-quick-access-heading">
        <header className="staff-home-section-heading">
          <p className="staff-kicker" id="staff-home-quick-access-heading">QUICK ACCESS</p>
        </header>
      {overview.quickAccess.length ? (
        <div className={`staff-home-grid ${overview.quickAccess.length === 2 ? "two-items" : ""}`}>
          {overview.quickAccess.map((item) => (
            <Link
              aria-label={`Open ${item.label}`}
              className="staff-home-card"
              href={item.href}
              key={item.domain}
            >
              <span className="staff-home-card-icon" aria-hidden="true">
                <StaffAppIcon name={overview.appearance.quickAccessIcons[item.domain]} />
              </span>
              <small>{item.label}</small>
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
    </section>
  );
}

export function StaffManagerApprovalEntry({ summary }: {
  summary: TeamApprovalSummary;
}) {
  if (!summary || summary.total <= 0) return null;

  return (
    <Link
      aria-label={`Open Approval Center. Review ${summary.total} pending approval${summary.total === 1 ? "" : "s"}`}
      className="staff-team-approvals-entry staff-team-approvals-compact"
      href="/staff/approvals"
    >
      <span className="staff-team-approvals-icon" aria-hidden="true">✓</span>
      <span>
        <small>NEEDS MY APPROVAL</small>
        <strong>{summary.total} pending</strong>
        <b>Review</b>
      </span>
      <span className="staff-team-approvals-count" aria-hidden="true">{summary.total}</span>
    </Link>
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
