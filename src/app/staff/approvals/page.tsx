import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "@/components/staff-pwa/staff-approval-center-v2.module.css";
import {
  StaffV2EmptyState,
  StaffV2ListRow,
  StaffV2PageHeader,
  StaffV2RowGroup,
  StaffV2StatusBadge,
  staffV2Styles,
} from "@/components/staff-pwa/staff-v2-primitives";
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
  const requested = DOMAINS.includes(String(query.domain) as (typeof DOMAINS)[number])
    ? String(query.domain) as StaffApprovalHistoryDomain
    : undefined;
  const page = Math.max(1, Number(query.page) || 1);
  const [summary, overtime] = await Promise.all([getStaffTeamApprovalSummary(auth), getStaffOvertimeSummary(auth)]);
  if (!summary && !overtime?.canReviewOvertime) redirect("/staff");
  const counts: Record<StaffApprovalHistoryDomain, number> = {
    LEAVE: summary?.leave ?? 0,
    CLAIMS: summary?.claims ?? 0,
    ATTENDANCE: summary?.attendance ?? 0,
    OT: overtime?.pending ?? 0,
  };
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const supported = [
    ...(summary?.canReviewLeave ? ["LEAVE" as const] : []),
    ...(summary?.canReviewClaims ? ["CLAIMS" as const] : []),
    ...(summary?.canReviewAttendance ? ["ATTENDANCE" as const] : []),
    ...(overtime?.canReviewOvertime ? ["OT" as const] : []),
  ];
  const domain = requested && supported.includes(requested) ? requested : undefined;
  const message = typeof query.message === "string" ? query.message : null;

  return (
    <section className={`${staffV2Styles.scope} ${styles.page}`}>
      <StaffV2PageHeader title="Approvals" meta="Review requests that need your decision." />
      <nav className={styles.viewTabs} aria-label="Approval views">
        <Link aria-current={view === "pending" ? "page" : undefined} href="/staff/approvals">
          Pending <b>{total}</b>
        </Link>
        <Link aria-current={view === "history" ? "page" : undefined} href="/staff/approvals?view=history">
          My History
        </Link>
      </nav>
      {message ? (
        <div className={`${styles.alert} ${query.type === "error" ? styles.alertDanger : styles.alertSuccess}`} role="status">
          {message}
        </div>
      ) : null}
      {view === "history"
        ? <HistoryView auth={auth} query={query} domain={domain} supported={supported} page={page} />
        : <PendingView auth={auth} domain={domain} page={page} summary={summary} overtime={overtime} counts={counts} total={total} supported={supported} />}
    </section>
  );
}

async function PendingView({ auth, domain, page, summary, overtime, counts, total, supported }: {
  auth: Awaited<ReturnType<typeof requireEmployeeSelfServiceAuthContext>>;
  domain?: StaffApprovalHistoryDomain;
  page: number;
  summary: Awaited<ReturnType<typeof getStaffTeamApprovalSummary>>;
  overtime: Awaited<ReturnType<typeof getStaffOvertimeSummary>>;
  counts: Record<StaffApprovalHistoryDomain, number>;
  total: number;
  supported: StaffApprovalHistoryDomain[];
}) {
  const inboxDomain = domain === "LEAVE" || domain === "CLAIMS" ? domain as MobileApprovalDomain : undefined;
  const inbox = summary?.canReviewLeave || summary?.canReviewClaims
    ? await getStaffTeamApprovalInbox({ auth, domain: inboxDomain, page })
    : null;
  const items = domain === "ATTENDANCE" || domain === "OT" ? [] : inbox?.items ?? [];
  const visibleTotal = domain ? counts[domain] : total;

  return (
    <>
      <DomainFilters view="pending" active={domain} supported={supported} counts={counts} total={total} />
      {inbox?.unavailableDomains.length ? (
        <div className={styles.alert}>Some approval data is temporarily unavailable. No missing item was treated as approved.</div>
      ) : null}
      {visibleTotal > 0 ? (
        <StaffV2RowGroup ariaLabel="Pending approvals">
          {(!domain || domain === "ATTENDANCE") && summary?.canReviewAttendance && counts.ATTENDANCE > 0 ? (
            <ApprovalDomainLink href="/staff/requests/attendance-corrections" domain="ATTENDANCE" count={counts.ATTENDANCE} detail="Missing punches and time corrections" />
          ) : null}
          {(!domain || domain === "OT") && overtime?.canReviewOvertime && counts.OT > 0 ? (
            <ApprovalDomainLink href="/staff/requests/overtime" domain="OT" count={counts.OT} detail="Potential overtime awaiting review" />
          ) : null}
          {items.map((item) => (
            <StaffV2ListRow
              ariaLabel={`Review ${domainLabel(item.domain)} request from ${item.employeeName}`}
              href={`/staff/approvals/${item.domain.toLowerCase()}/${item.subjectId}`}
              key={item.id}
              kicker={`${domainLabel(item.domain)} · ${item.branchName}`}
              leading={<DomainMark domain={item.domain} />}
              meta={<span className={styles.rowMeta}><span>{item.summary}</span><time dateTime={item.requestedAt.toISOString()}>{formatDateTime(item.requestedAt)}</time></span>}
              title={item.employeeName}
            />
          ))}
        </StaffV2RowGroup>
      ) : (
        <StaffV2EmptyState title="No approvals waiting" description="New requests that need your decision will appear here." />
      )}
      {inbox && inbox.pagination.totalPages > 1 && domain !== "ATTENDANCE" && domain !== "OT" ? (
        <Pagination page={inbox.pagination.page} totalPages={inbox.pagination.totalPages} href={(next) => pendingHref(domain, next)} />
      ) : null}
    </>
  );
}

async function HistoryView({ auth, query, domain, supported, page }: {
  auth: Awaited<ReturnType<typeof requireEmployeeSelfServiceAuthContext>>;
  query: Query;
  domain?: StaffApprovalHistoryDomain;
  supported: StaffApprovalHistoryDomain[];
  page: number;
}) {
  const history = await getStaffApprovalHistoryPage({
    auth,
    domain,
    month: typeof query.month === "string" ? query.month : undefined,
    employee: typeof query.employee === "string" ? query.employee : undefined,
    page,
  });
  if (!history) redirect("/staff");
  return (
    <>
      <DomainFilters view="history" active={domain} supported={supported} />
      <form className={styles.historyFilters} method="get">
        <input name="view" type="hidden" value="history" />
        {domain ? <input name="domain" type="hidden" value={domain} /> : null}
        <label>
          <span>Period</span>
          <select defaultValue={history.selectedMonth} name="month">
            {history.availableMonths.map((month) => <option value={month} key={month}>{formatMonth(month)}</option>)}
          </select>
        </label>
        <label>
          <span>Employee</span>
          <input defaultValue={history.employee} maxLength={80} name="employee" placeholder="Search name" type="search" />
        </label>
        <button type="submit">Apply</button>
      </form>
      <p className={styles.scopeCopy}>Only decisions made by you are shown · {history.pagination.total} result{history.pagination.total === 1 ? "" : "s"}</p>
      {history.items.length ? (
        <StaffV2RowGroup ariaLabel="My approval history">
          {history.items.map((item) => <HistoryRow item={item} key={item.id} />)}
        </StaffV2RowGroup>
      ) : (
        <StaffV2EmptyState title="No approval history for this period" description="Try another period, category or employee name." />
      )}
      {history.pagination.totalPages > 1 ? (
        <Pagination page={history.pagination.page} totalPages={history.pagination.totalPages} href={(next) => historyHref({ domain, month: history.selectedMonth, employee: history.employee, page: next })} />
      ) : null}
    </>
  );
}

function HistoryRow({ item }: { item: StaffApprovalHistoryItem }) {
  return (
    <StaffV2ListRow
      ariaLabel={`View your ${decisionLabel(item.decision).toLowerCase()} ${domainLabel(item.domain)} decision for ${item.employeeName}`}
      href={`/staff/approvals/history/${item.domain.toLowerCase()}/${encodeURIComponent(item.sourceId)}`}
      kicker={`${domainLabel(item.domain)} · ${formatDate(item.reviewedAt)}`}
      leading={<DomainMark domain={item.domain} />}
      meta={`${item.title} · ${item.summary}`}
      title={item.employeeName}
      trailing={<span className={styles.rowStatus}><StaffV2StatusBadge tone={decisionTone(item.decision)}>{decisionLabel(item.decision)}</StaffV2StatusBadge></span>}
    />
  );
}

function DomainFilters({ view, active, supported, counts, total }: {
  view: "pending" | "history";
  active?: StaffApprovalHistoryDomain;
  supported: StaffApprovalHistoryDomain[];
  counts?: Record<StaffApprovalHistoryDomain, number>;
  total?: number;
}) {
  return (
    <nav className={styles.filterStrip} aria-label="Approval categories">
      <Filter href={filterHref(view)} active={!active} label="All" count={view === "pending" ? total : undefined} />
      {supported.map((item) => (
        <Filter href={filterHref(view, item)} active={active === item} label={domainLabel(item)} count={view === "pending" ? counts?.[item] : undefined} key={item} />
      ))}
    </nav>
  );
}

function ApprovalDomainLink({ href, domain, count, detail }: { href: string; domain: StaffApprovalHistoryDomain; count: number; detail: string }) {
  return (
    <StaffV2ListRow
      ariaLabel={`Review ${count} pending ${domainLabel(domain)} item${count === 1 ? "" : "s"}`}
      href={href}
      kicker={domainLabel(domain)}
      leading={<DomainMark domain={domain} />}
      meta={detail}
      title={`${count} waiting for you`}
    />
  );
}

function DomainMark({ domain }: { domain: string }) {
  return <span className={styles.domainMark}>{domain === "LEAVE" ? "LV" : domain === "CLAIMS" ? "CL" : domain === "ATTENDANCE" ? "AT" : "OT"}</span>;
}
function Filter({ href, active, label, count }: { href: string; active: boolean; label: string; count?: number }) {
  return <Link aria-current={active ? "page" : undefined} href={href}>{label}{count === undefined ? null : <b>{count}</b>}</Link>;
}
function Pagination({ page, totalPages, href }: { page: number; totalPages: number; href: (page: number) => string }) {
  return <nav className={styles.pagination} aria-label="Approval pages">{page > 1 ? <Link href={href(page - 1)}>Previous</Link> : <span />}<small>Page {page} of {totalPages}</small>{page < totalPages ? <Link href={href(page + 1)}>Next</Link> : <span />}</nav>;
}
function filterHref(view: "pending" | "history", domain?: StaffApprovalHistoryDomain) { const params = new URLSearchParams(); if (view === "history") params.set("view", "history"); if (domain) params.set("domain", domain); const value = params.toString(); return `/staff/approvals${value ? `?${value}` : ""}`; }
function pendingHref(domain: StaffApprovalHistoryDomain | undefined, page: number) { const params = new URLSearchParams(); if (domain) params.set("domain", domain); params.set("page", String(page)); return `/staff/approvals?${params}`; }
function historyHref(input: { domain?: StaffApprovalHistoryDomain; month: string; employee: string; page: number }) { const params = new URLSearchParams({ view: "history", month: input.month, page: String(input.page) }); if (input.domain) params.set("domain", input.domain); if (input.employee) params.set("employee", input.employee); return `/staff/approvals?${params}`; }
function domainLabel(domain: string) { return domain === "CLAIMS" ? "Claims" : domain === "ATTENDANCE" ? "Attendance" : domain === "OT" ? "OT" : "Leave"; }
function decisionLabel(decision: string) { return decision === "ADJUSTED" ? "Adjusted" : decision === "RETURNED" ? "Returned" : decision === "REJECTED" ? "Rejected" : "Approved"; }
function decisionTone(decision: string): "success" | "danger" | "warning" { return decision === "REJECTED" ? "danger" : decision === "ADJUSTED" || decision === "RETURNED" ? "warning" : "success"; }
function formatDate(value: Date) { return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur" }).format(value); }
function formatDateTime(value: Date) { return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).format(value); }
function formatMonth(value: string) { const [year, month] = value.split("-").map(Number); return new Intl.DateTimeFormat("en-MY", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1))); }
