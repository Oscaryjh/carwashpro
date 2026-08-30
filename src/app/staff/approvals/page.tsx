import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { getStaffOvertimeSummary } from "@/lib/staff-pwa/overtime-approvals";
import {
  getStaffTeamApprovalInbox,
  getStaffTeamApprovalSummary,
  type MobileApprovalDomain,
} from "@/lib/staff-pwa/team-approvals";

export const metadata: Metadata = { title: "Team Approvals" };
export const dynamic = "force-dynamic";

export default async function StaffApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const auth = await requireEmployeeSelfServiceAuthContext();
  const domain = ["LEAVE", "CLAIMS", "ATTENDANCE", "OT"].includes(String(query.domain))
    ? String(query.domain) as MobileApprovalDomain | "ATTENDANCE" | "OT"
    : undefined;
  const page = Math.max(1, Number(query.page) || 1);
  const [summary, overtime] = await Promise.all([
    getStaffTeamApprovalSummary(auth),
    getStaffOvertimeSummary(auth),
  ]);
  const inboxDomain = domain === "LEAVE" || domain === "CLAIMS" ? domain : undefined;
  const inbox = summary?.canReviewLeave || summary?.canReviewClaims
    ? await getStaffTeamApprovalInbox({ auth, domain: inboxDomain, page })
    : null;
  if (!summary && !overtime?.canReviewOvertime) redirect("/staff");
  const message = typeof query.message === "string" ? query.message : null;
  const messageType = query.type === "error" ? "error" : "success";
  const attendanceCount = summary?.attendance ?? 0;
  const leaveCount = summary?.leave ?? 0;
  const claimsCount = summary?.claims ?? 0;
  const overtimeCount = overtime?.pending ?? 0;
  const totalCount = attendanceCount + leaveCount + claimsCount + overtimeCount;
  const items = domain === "ATTENDANCE" || domain === "OT" ? [] : inbox?.items ?? [];

  return (
    <section className="staff-approval-page">
      <header className="staff-approval-header">
        <div><p className="staff-kicker">MANAGER WORKSPACE</p><h1>Approval Center</h1><p>Review requests from your team.</p></div>
        <span>{totalCount} pending</span>
      </header>
      {message ? <div className={`staff-alert ${messageType}`} role="status">{message}</div> : null}
      <nav className="staff-approval-tabs" aria-label="Approval filters">
        <Filter href="/staff/approvals" active={!domain} label="All" count={totalCount} />
        {summary?.canReviewLeave ? <Filter href="/staff/approvals?domain=LEAVE" active={domain === "LEAVE"} label="Leave" count={leaveCount} /> : null}
        {summary?.canReviewClaims ? <Filter href="/staff/approvals?domain=CLAIMS" active={domain === "CLAIMS"} label="Claims" count={claimsCount} /> : null}
        {summary?.canReviewAttendance ? <Filter href="/staff/approvals?domain=ATTENDANCE" active={domain === "ATTENDANCE"} label="Attendance" count={attendanceCount} /> : null}
        {overtime?.canReviewOvertime ? <Filter href="/staff/approvals?domain=OT" active={domain === "OT"} label="OT" count={overtimeCount} /> : null}
      </nav>
      {inbox?.unavailableDomains.length ? <div className="staff-alert warning">Some approval data is temporarily unavailable. No missing item was treated as approved.</div> : null}
      <div className="staff-approval-list">
        {(!domain || domain === "ATTENDANCE") && summary?.canReviewAttendance && attendanceCount > 0 ? (
          <ApprovalDomainLink href="/staff/requests/attendance-corrections" code="AT" title="Attendance" count={attendanceCount} detail="Missing punches and submitted time corrections" />
        ) : null}
        {(!domain || domain === "OT") && overtime?.canReviewOvertime && overtimeCount > 0 ? (
          <ApprovalDomainLink href="/staff/requests/overtime" code="OT" title="Overtime" count={overtimeCount} detail="Calculated overtime awaiting a manager decision" />
        ) : null}
        {items.length ? items.map((item) => (
          <Link className="staff-approval-row" href={`/staff/approvals/${item.domain.toLowerCase()}/${item.subjectId}`} key={item.id}>
            <span className={`staff-approval-domain ${item.domain.toLowerCase()}`}>{item.domain === "LEAVE" ? "LV" : "CL"}</span>
            <span className="staff-approval-copy">
              <small>{item.domain === "LEAVE" ? "Leave" : "Claim"} · {item.branchName}</small>
              <strong>{item.employeeName}</strong>
              <span>{item.summary}</span>
              <time dateTime={item.requestedAt.toISOString()}>Submitted {formatDate(item.requestedAt)}</time>
            </span>
            <span className="staff-approval-chevron" aria-hidden="true">›</span>
          </Link>
        )) : null}
        {!items.length && ((!domain && totalCount === 0) || (domain === "LEAVE" && !leaveCount) || (domain === "CLAIMS" && !claimsCount) || (domain === "ATTENDANCE" && !attendanceCount) || (domain === "OT" && !overtimeCount)) ? (
          <div className="staff-page-card staff-approval-empty"><strong>{domain === "ATTENDANCE" ? "No attendance items need your review" : "Nothing waiting for review"}</strong><span>New requests from your team will appear here.</span></div>
        ) : null}
      </div>
      {inbox && inbox.pagination.totalPages > 1 && domain !== "ATTENDANCE" && domain !== "OT" ? (
        <nav className="staff-approval-pagination" aria-label="Approval pages">
          {page > 1 ? <Link href={`/staff/approvals${domain ? `?domain=${domain}&` : "?"}page=${page - 1}`}>Previous</Link> : <span />}
          <small>Page {inbox.pagination.page} of {inbox.pagination.totalPages}</small>
          {page < inbox.pagination.totalPages ? <Link href={`/staff/approvals${domain ? `?domain=${domain}&` : "?"}page=${page + 1}`}>Next</Link> : <span />}
        </nav>
      ) : null}
    </section>
  );
}

function ApprovalDomainLink({ href, code, title, count, detail }: { href: string; code: string; title: string; count: number; detail: string }) {
  return (
    <Link className="staff-approval-row" href={href}>
      <span className="staff-approval-domain">{code}</span>
      <span className="staff-approval-copy"><small>{code === "AT" ? "TIME RECORDS" : "OVERTIME"}</small><strong>{title}</strong><span>{detail}</span><time>{count} pending</time></span>
      <span className="staff-approval-chevron" aria-hidden="true">›</span>
    </Link>
  );
}

function Filter({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return <Link className={active ? "active" : ""} href={href}>{label}<b>{count}</b></Link>;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).format(value);
}
