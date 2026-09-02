import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "@/components/staff-pwa/staff-approval-center-v2.module.css";
import { MobileOvertimeApprovalForm } from "@/components/staff-pwa/mobile-overtime-approval-form";
import {
  StaffV2DetailSection,
  StaffV2PageHeader,
  StaffV2StatusBadge,
  staffV2Styles,
} from "@/components/staff-pwa/staff-v2-primitives";
import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { getStaffOvertimeDetail } from "@/lib/staff-pwa/overtime-approvals";
import { decideMobileOvertimeAction } from "../actions";

export const metadata: Metadata = { title: "Review overtime" };
export const dynamic = "force-dynamic";

export default async function StaffOvertimeDetailPage({ params, searchParams }: {
  params: Promise<{ finalResultId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ finalResultId }, query] = await Promise.all([params, searchParams]);
  const auth = await requireEmployeeSelfServiceAuthContext();
  const detail = await getStaffOvertimeDetail(auth, finalResultId);
  if (!detail) notFound();
  const item = detail.item;
  const message = typeof query.message === "string" ? query.message : null;
  const readOnly = detail.locked || item.blockedReason !== null;

  return (
    <section className={`${staffV2Styles.scope} ${styles.detailPage} ${readOnly ? "" : styles.detailPageWithActions}`}>
      <Link className={styles.backLink} href={`/staff/requests/overtime?month=${detail.month}`}>← Overtime</Link>
      <StaffV2PageHeader title="Overtime review" meta={`${item.employeeName} · ${item.branchName} · ${displayDate(item.workDate)}`} />
      <StaffV2StatusBadge tone={item.stale ? "warning" : item.effectiveStatus === "REJECTED" ? "danger" : "info"}>
        {item.stale ? "Needs review" : humanize(item.effectiveStatus)}
      </StaffV2StatusBadge>
      {message ? <div className={`${styles.alert} ${query.type === "error" ? styles.alertDanger : styles.alertSuccess}`} role="status">{message}</div> : null}
      {detail.locked ? <div className={styles.alert}>This monthly Timesheet is locked. Reopen it on Desktop before changing overtime.</div> : null}
      {item.blockedReason ? <div className={styles.alert}>Resolve the full-day Leave and Attendance conflict before reviewing overtime.</div> : null}
      <section className={styles.detailSurface}>
        <StaffV2DetailSection title="Who and when">
          <dl className={styles.detailFacts}>
            <Fact label="Employee" value={`${item.employeeName} · ${item.employeeCode}`} />
            <Fact label="Work date" value={displayDate(item.workDate)} />
            <Fact label="Expected day" value={humanize(item.expectedDayKindSnapshot ?? "Not scheduled")} />
          </dl>
        </StaffV2DetailSection>
        <StaffV2DetailSection title="Attendance">
          <dl className={styles.detailFacts}>
            <Fact label="Result" value={humanize(item.outcome)} />
            <Fact label="Scheduled" value={rangeLabel(item.expectedStartAt, item.expectedEndAt)} />
            <Fact label="Recorded" value={rangeLabel(item.actualClockInAt, item.actualClockOutAt)} />
            <Fact label="Worked" value={durationLabel(item.totalWorkedMinutes)} />
            <Fact label="Break" value={durationLabel(item.totalBreakMinutes)} />
          </dl>
        </StaffV2DetailSection>
        <StaffV2DetailSection title="Overtime">
          <dl className={styles.detailFacts}>
            <Fact label="Context" value={humanize(item.context)} />
            <Fact label="Potential" value={durationLabel(item.potentialOtMinutes)} />
            {item.review ? <Fact label="Approved" value={durationLabel(item.review.approvedOtMinutes)} /> : null}
            {item.review?.reason ? <Fact label="Decision reason" value={item.review.reason} stacked /> : null}
          </dl>
        </StaffV2DetailSection>
      </section>
      <p className={styles.boundary}>This decision does not change clock records or create overtime. It reviews the latest final Attendance result.</p>
      {readOnly ? null : (
        <MobileOvertimeApprovalForm
          action={decideMobileOvertimeAction}
          expectedRevision={item.review?.revision ?? 0}
          finalResultId={item.finalResultId}
          month={detail.month}
          potentialMinutes={item.potentialOtMinutes}
        />
      )}
    </section>
  );
}

function Fact({ label, value, stacked }: { label: string; value: string; stacked?: boolean }) {
  return <div className={stacked ? styles.stacked : ""}><dt>{label}</dt><dd>{value}</dd></div>;
}
function displayDate(value: Date) { return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(value); }
function displayTime(value: Date | null) { return value ? new Intl.DateTimeFormat("en-MY", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).format(value) : "—"; }
function rangeLabel(start: Date | null, end: Date | null) { return start || end ? `${displayTime(start)}–${displayTime(end)}` : "Not recorded"; }
function durationLabel(minutes: number) { const hours = Math.floor(minutes / 60); const rest = minutes % 60; if (!hours) return `${rest} min`; return `${hours} hr${hours === 1 ? "" : "s"}${rest ? ` ${rest} min` : ""}`; }
function humanize(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
