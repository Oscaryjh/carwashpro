import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { StaffAppIcon } from "@/components/staff-pwa/staff-app-icon";
import type { StaffAppDomain, StaffAppIconName } from "@/lib/staff-pwa/appearance-config";
import type { AwaitedReturn } from "@/lib/staff-pwa/home-types";
import {
  StaffV2ActionRow,
  StaffV2EmptyState,
  StaffV2ListRow,
  StaffV2PageHeader,
  staffV2Styles as styles,
} from "./staff-v2-primitives";

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

const homeQuickActionIcons: Partial<Record<StaffAppDomain, StaffAppIconName>> = {
  APPOINTMENTS: "clock",
  ROSTER: "calendar",
  LEAVE: "leaf",
};

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
    weekday: "long",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date());
  const nextAppointment = overview.appointmentDay?.nextAppointment ?? null;
  const usefulUpNext = overview.upNext && overview.upNext.status !== "EMPTY"
    ? overview.upNext
    : null;

  return (
    <section aria-label="Staff home" className={styles.scope}>
      <StaffV2PageHeader
        leading={overview.profile.employee.avatarUrl ? (
          <Image
            alt=""
            height={32}
            sizes="32px"
            src={overview.profile.employee.avatarUrl}
            unoptimized
            width={32}
          />
        ) : <span aria-hidden="true">{initials || "T"}</span>}
        meta={today}
        title={displayName}
      />

      {children}

      {nextAppointment ? (
        <section aria-labelledby="staff-home-next-heading">
          <p className={styles.sectionLabel} id="staff-home-next-heading">Next appointment</p>
          <StaffV2ListRow
            ariaLabel={`Open appointment with ${nextAppointment.customerName}`}
            href={`/staff/appointments?date=${overview.appointmentDay?.date}`}
            kicker={nextAppointment.timeLabel}
            meta={`${nextAppointment.serviceSummary} · ${nextAppointment.durationLabel} · ${nextAppointment.branchName}`}
            title={nextAppointment.customerName}
          />
        </section>
      ) : usefulUpNext ? (
        <section aria-labelledby="staff-home-next-heading">
          <p className={styles.sectionLabel} id="staff-home-next-heading">Up next</p>
          <StaffV2ListRow
            href={usefulUpNext.href}
            kicker={usefulUpNext.dateLabel}
            leading={<StaffAppIcon name={overview.appearance.quickAccessIcons.ROSTER} />}
            meta={[usefulUpNext.timeLabel, usefulUpNext.branchName].filter(Boolean).join(" · ")}
            title={usefulUpNext.title}
          />
        </section>
      ) : null}

      <section className={styles.quickActions} aria-labelledby="staff-home-quick-access-heading">
        <p className={styles.sectionLabel} id="staff-home-quick-access-heading">Quick actions</p>
        {overview.quickAccess.length ? (
          <div className={`${styles.quickGrid} ${overview.quickAccess.length === 2 ? styles.two : ""}`}>
            {overview.quickAccess.map((item) => (
              <Link
                aria-label={`Open ${item.label}`}
                className={styles.quickAction}
                href={item.href}
                key={item.domain}
              >
                <span aria-hidden="true">
                  <StaffAppIcon name={homeQuickActionIcons[item.domain] ?? "calendar"} />
                </span>
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        ) : (
          <StaffV2EmptyState
            description="This workplace has not enabled staff self-service modules."
            title="No quick actions available"
          />
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
    <StaffV2ActionRow
      ariaLabel={`Open Approval Center. Review ${summary.total} pending approval${summary.total === 1 ? "" : "s"}`}
      count={summary.total}
      href="/staff/approvals"
      kicker="Needs my approval"
      leading={<span aria-hidden="true">✓</span>}
      meta="Review pending staff requests"
      title={`${summary.total} pending`}
    />
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
