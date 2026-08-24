import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { getStaffTeamApprovalInbox, type MobileApprovalDomain } from "@/lib/staff-pwa/team-approvals";

export const metadata: Metadata = { title: "Team Approvals" };
export const dynamic = "force-dynamic";

export default async function StaffApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const auth = await requireEmployeeSelfServiceAuthContext();
  const domain = query.domain === "LEAVE" || query.domain === "CLAIMS" ? query.domain as MobileApprovalDomain : undefined;
  const page = Math.max(1, Number(query.page) || 1);
  const inbox = await getStaffTeamApprovalInbox({ auth, domain, page });
  if (!inbox) redirect("/staff");
  const message = typeof query.message === "string" ? query.message : null;
  const messageType = query.type === "error" ? "error" : "success";
  const allowedLabel = inbox.canReviewLeave && inbox.canReviewClaims
    ? "Leave and Claims"
    : inbox.canReviewLeave ? "Leave" : "Claims";

  return (
    <section className="staff-approval-page">
      <header className="staff-approval-header">
        <div><p className="staff-kicker">TEAM WORKSPACE</p><h1>Team Approvals</h1><p>Review {allowedLabel} for your current workplace.</p></div>
        <span>{inbox.counts.LEAVE + inbox.counts.CLAIMS} waiting</span>
      </header>
      {message ? <div className={`staff-alert ${messageType}`} role="status">{message}</div> : null}
      <nav className="staff-approval-tabs" aria-label="Approval filters">
        <Filter href="/staff/approvals" active={!domain} label="All" count={inbox.counts.LEAVE + inbox.counts.CLAIMS} />
        {inbox.canReviewLeave ? <Filter href="/staff/approvals?domain=LEAVE" active={domain === "LEAVE"} label="Leave" count={inbox.counts.LEAVE} /> : null}
        {inbox.canReviewClaims ? <Filter href="/staff/approvals?domain=CLAIMS" active={domain === "CLAIMS"} label="Claims" count={inbox.counts.CLAIMS} /> : null}
      </nav>
      {inbox.unavailableDomains.length ? <div className="staff-alert warning">Some approval data is temporarily unavailable. No missing item was treated as approved.</div> : null}
      <div className="staff-approval-list">
        {inbox.items.length ? inbox.items.map((item) => (
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
        )) : (
          <div className="staff-page-card staff-approval-empty"><strong>Nothing waiting for review</strong><span>New {allowedLabel} requests in your authorized scope will appear here.</span></div>
        )}
      </div>
      {inbox.pagination.totalPages > 1 ? (
        <nav className="staff-approval-pagination" aria-label="Approval pages">
          {page > 1 ? <Link href={`/staff/approvals${domain ? `?domain=${domain}&` : "?"}page=${page - 1}`}>Previous</Link> : <span />}
          <small>Page {inbox.pagination.page} of {inbox.pagination.totalPages}</small>
          {page < inbox.pagination.totalPages ? <Link href={`/staff/approvals${domain ? `?domain=${domain}&` : "?"}page=${page + 1}`}>Next</Link> : <span />}
        </nav>
      ) : null}
    </section>
  );
}

function Filter({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return <Link className={active ? "active" : ""} href={href}>{label}<b>{count}</b></Link>;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).format(value);
}
