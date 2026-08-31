import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { getStaffApprovalHistoryPage, type StaffApprovalHistoryDomain, type StaffApprovalHistoryItem } from "@/lib/staff-pwa/approval-history";
import { getStaffOvertimeSummary } from "@/lib/staff-pwa/overtime-approvals";
import { getStaffTeamApprovalInbox, getStaffTeamApprovalSummary, type MobileApprovalDomain } from "@/lib/staff-pwa/team-approvals";

export const metadata: Metadata = { title: "Approval Center" };
export const dynamic = "force-dynamic";
type Query = Record<string, string | string[] | undefined>;
const DOMAINS = ["LEAVE", "CLAIMS", "ATTENDANCE", "OT"] as const;

export default async function StaffApprovalsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const auth = await requireEmployeeSelfServiceAuthContext();
  const view = query.view === "history" ? "history" : "pending";
  const requested = DOMAINS.includes(String(query.domain) as (typeof DOMAINS)[number]) ? String(query.domain) as StaffApprovalHistoryDomain : undefined;
  const page = Math.max(1, Number(query.page) || 1);
  const [summary, overtime] = await Promise.all([getStaffTeamApprovalSummary(auth), getStaffOvertimeSummary(auth)]);
  if (!summary && !overtime?.canReviewOvertime) redirect("/staff");
  const counts: Record<StaffApprovalHistoryDomain, number> = { LEAVE: summary?.leave ?? 0, CLAIMS: summary?.claims ?? 0, ATTENDANCE: summary?.attendance ?? 0, OT: overtime?.pending ?? 0 };
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const supported = [...(summary?.canReviewLeave ? ["LEAVE" as const] : []), ...(summary?.canReviewClaims ? ["CLAIMS" as const] : []), ...(summary?.canReviewAttendance ? ["ATTENDANCE" as const] : []), ...(overtime?.canReviewOvertime ? ["OT" as const] : [])];
  const domain = requested && supported.includes(requested) ? requested : undefined;
  const message = typeof query.message === "string" ? query.message : null;
  return <section className="staff-approval-page">
    <header className="staff-approval-header"><div><p className="staff-kicker">MANAGER</p><h1>Approvals</h1><p>Review pending work and your past decisions.</p></div>{view === "pending" ? <span>{total} pending</span> : null}</header>
    <nav className="staff-approval-view-tabs" aria-label="Approval views"><Link className={view === "pending" ? "active" : ""} href="/staff/approvals">Pending <b>{total}</b></Link><Link className={view === "history" ? "active" : ""} href="/staff/approvals?view=history">My History</Link></nav>
    {message ? <div className={`staff-alert ${query.type === "error" ? "error" : "success"}`} role="status">{message}</div> : null}
    {view === "history" ? <HistoryView auth={auth} query={query} domain={domain} supported={supported} page={page} /> : <PendingView auth={auth} domain={domain} page={page} summary={summary} overtime={overtime} counts={counts} total={total} supported={supported} />}
  </section>;
}

async function PendingView({ auth, domain, page, summary, overtime, counts, total, supported }: { auth: Awaited<ReturnType<typeof requireEmployeeSelfServiceAuthContext>>; domain?: StaffApprovalHistoryDomain; page: number; summary: Awaited<ReturnType<typeof getStaffTeamApprovalSummary>>; overtime: Awaited<ReturnType<typeof getStaffOvertimeSummary>>; counts: Record<StaffApprovalHistoryDomain, number>; total: number; supported: StaffApprovalHistoryDomain[] }) {
  const inboxDomain = domain === "LEAVE" || domain === "CLAIMS" ? domain as MobileApprovalDomain : undefined;
  const inbox = summary?.canReviewLeave || summary?.canReviewClaims ? await getStaffTeamApprovalInbox({ auth, domain: inboxDomain, page }) : null;
  const items = domain === "ATTENDANCE" || domain === "OT" ? [] : inbox?.items ?? [];
  return <><DomainFilters view="pending" active={domain} supported={supported} counts={counts} total={total} />
    {inbox?.unavailableDomains.length ? <div className="staff-alert warning">Some approval data is temporarily unavailable. No missing item was treated as approved.</div> : null}
    <div className="staff-approval-list">
      {(!domain || domain === "ATTENDANCE") && summary?.canReviewAttendance && counts.ATTENDANCE > 0 ? <ApprovalDomainLink href="/staff/requests/attendance-corrections" code="AT" title="Attendance" count={counts.ATTENDANCE} detail="Missing punches and submitted time corrections" /> : null}
      {(!domain || domain === "OT") && overtime?.canReviewOvertime && counts.OT > 0 ? <ApprovalDomainLink href="/staff/requests/overtime" code="OT" title="Overtime" count={counts.OT} detail="Calculated overtime awaiting your decision" /> : null}
      {items.map((item) => <Link className="staff-approval-row" href={`/staff/approvals/${item.domain.toLowerCase()}/${item.subjectId}`} key={item.id}><Badge domain={item.domain} /><span className="staff-approval-copy"><small>{domainLabel(item.domain)} · {item.branchName}</small><strong>{item.employeeName}</strong><span>{item.summary}</span><time dateTime={item.requestedAt.toISOString()}>Submitted {formatDateTime(item.requestedAt)}</time></span><span className="staff-approval-chevron" aria-hidden="true">›</span></Link>)}
      {(domain ? counts[domain] : total) === 0 ? <div className="staff-page-card staff-approval-empty"><span className="staff-approval-empty-icon">✓</span><strong>You’re all caught up</strong><span>No pending approvals need your attention.</span><Link href="/staff/approvals?view=history">View My History</Link></div> : null}
    </div>
    {inbox && inbox.pagination.totalPages > 1 && domain !== "ATTENDANCE" && domain !== "OT" ? <Pagination page={inbox.pagination.page} totalPages={inbox.pagination.totalPages} href={(next) => pendingHref(domain, next)} /> : null}
  </>;
}

async function HistoryView({ auth, query, domain, supported, page }: { auth: Awaited<ReturnType<typeof requireEmployeeSelfServiceAuthContext>>; query: Query; domain?: StaffApprovalHistoryDomain; supported: StaffApprovalHistoryDomain[]; page: number }) {
  const history = await getStaffApprovalHistoryPage({ auth, domain, month: typeof query.month === "string" ? query.month : undefined, employee: typeof query.employee === "string" ? query.employee : undefined, page });
  if (!history) redirect("/staff");
  return <><DomainFilters view="history" active={domain} supported={supported} />
    <form className="staff-approval-history-filters" method="get"><input name="view" type="hidden" value="history" />{domain ? <input name="domain" type="hidden" value={domain} /> : null}<label><span>Month</span><select defaultValue={history.selectedMonth} name="month">{history.availableMonths.map((month) => <option value={month} key={month}>{formatMonth(month)}</option>)}</select></label><label><span>Employee</span><input defaultValue={history.employee} maxLength={80} name="employee" placeholder="Search name" type="search" /></label><button type="submit">Apply filters</button></form>
    <p className="staff-approval-history-scope">Only decisions made by you are shown · {history.pagination.total} result{history.pagination.total === 1 ? "" : "s"}</p>
    <div className="staff-approval-list">{history.items.map((item) => <HistoryRow item={item} key={item.id} />)}{!history.items.length ? <div className="staff-page-card staff-approval-empty"><span className="staff-approval-empty-icon">○</span><strong>No decisions this month</strong><span>Try another month, category or employee name.</span></div> : null}</div>
    {history.pagination.totalPages > 1 ? <Pagination page={history.pagination.page} totalPages={history.pagination.totalPages} href={(next) => historyHref({ domain, month: history.selectedMonth, employee: history.employee, page: next })} /> : null}
  </>;
}

function HistoryRow({ item }: { item: StaffApprovalHistoryItem }) { return <Link className="staff-approval-row staff-approval-history-row" href={`/staff/approvals/history/${item.domain.toLowerCase()}/${encodeURIComponent(item.sourceId)}`}><Badge domain={item.domain} /><span className="staff-approval-copy"><small>{domainLabel(item.domain)} · {item.branchName}</small><strong>{item.employeeName}</strong><span>{item.title} · {item.summary}</span><time dateTime={item.reviewedAt.toISOString()}>{decisionLabel(item.decision)} · {formatDateTime(item.reviewedAt)}</time></span><span className={`staff-approval-history-status ${item.decision.toLowerCase()}`}>{decisionLabel(item.decision)}</span></Link>; }
function DomainFilters({ view, active, supported, counts, total }: { view: "pending" | "history"; active?: StaffApprovalHistoryDomain; supported: StaffApprovalHistoryDomain[]; counts?: Record<StaffApprovalHistoryDomain, number>; total?: number }) { return <nav className="staff-approval-tabs" aria-label="Approval categories"><Filter href={filterHref(view)} active={!active} label="All" count={view === "pending" ? total : undefined} />{supported.map((item) => <Filter href={filterHref(view, item)} active={active === item} label={domainLabel(item)} count={view === "pending" ? counts?.[item] : undefined} key={item} />)}</nav>; }
function ApprovalDomainLink({ href, code, title, count, detail }: { href: string; code: string; title: string; count: number; detail: string }) { return <Link className="staff-approval-row" href={href}><span className="staff-approval-domain">{code}</span><span className="staff-approval-copy"><small>{code === "AT" ? "TIME RECORDS" : "OVERTIME"}</small><strong>{title}</strong><span>{detail}</span><time>{count} pending</time></span><span className="staff-approval-chevron" aria-hidden="true">›</span></Link>; }
function Badge({ domain }: { domain: string }) { return <span className={`staff-approval-domain ${domain.toLowerCase()}`}>{domain === "LEAVE" ? "LV" : domain === "CLAIMS" ? "CL" : domain === "ATTENDANCE" ? "AT" : "OT"}</span>; }
function Filter({ href, active, label, count }: { href: string; active: boolean; label: string; count?: number }) { return <Link className={active ? "active" : ""} href={href}>{label}{count === undefined ? null : <b>{count}</b>}</Link>; }
function Pagination({ page, totalPages, href }: { page: number; totalPages: number; href: (page: number) => string }) { return <nav className="staff-approval-pagination" aria-label="Approval pages">{page > 1 ? <Link href={href(page - 1)}>Previous</Link> : <span />}<small>Page {page} of {totalPages}</small>{page < totalPages ? <Link href={href(page + 1)}>Next</Link> : <span />}</nav>; }
function filterHref(view: "pending" | "history", domain?: StaffApprovalHistoryDomain) { const params = new URLSearchParams(); if (view === "history") params.set("view", "history"); if (domain) params.set("domain", domain); const value = params.toString(); return `/staff/approvals${value ? `?${value}` : ""}`; }
function pendingHref(domain: StaffApprovalHistoryDomain | undefined, page: number) { const params = new URLSearchParams(); if (domain) params.set("domain", domain); params.set("page", String(page)); return `/staff/approvals?${params}`; }
function historyHref(input: { domain?: StaffApprovalHistoryDomain; month: string; employee: string; page: number }) { const params = new URLSearchParams({ view: "history", month: input.month, page: String(input.page) }); if (input.domain) params.set("domain", input.domain); if (input.employee) params.set("employee", input.employee); return `/staff/approvals?${params}`; }
function domainLabel(domain: string) { return domain === "CLAIMS" ? "Claims" : domain === "ATTENDANCE" ? "Attendance" : domain === "OT" ? "OT" : "Leave"; }
function decisionLabel(decision: string) { return decision === "ADJUSTED" ? "Adjusted" : decision === "RETURNED" ? "Returned" : decision === "REJECTED" ? "Rejected" : "Approved"; }
function formatDateTime(value: Date) { return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).format(value); }
function formatMonth(value: string) { const [year, month] = value.split("-").map(Number); return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1))); }
