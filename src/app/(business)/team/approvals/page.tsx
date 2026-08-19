import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { requireUser } from "@/lib/auth/session";
import {
  availableApprovalDomains,
  getUnifiedApprovalInbox,
  isUnifiedApprovalCenterAvailable,
  resolveUnifiedApprovalContext,
} from "@/lib/approvals/service";
import {
  approvalDomains,
  type ApprovalDomain,
  type ApprovalInboxItem,
} from "@/lib/approvals/types";
import { prisma } from "@/lib/prisma";
import styles from "./approvals.module.css";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    domain?: string;
    branch?: string;
    employee?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
};

const domainLabels: Record<ApprovalDomain, string> = {
  ATTENDANCE: "Attendance",
  LEAVE: "Leave",
  CLAIMS: "Claims",
  COMMISSION: "Commission",
  PAYROLL: "Payroll",
};

export default async function UnifiedApprovalsPage({ searchParams }: PageProps) {
  const identity = await requireUser();
  const business = await requireBusinessUser(
    identity.activeBusinessId !== identity.homeBusinessId ? "VIEW_DASHBOARD" : undefined,
  );
  const context = await resolveUnifiedApprovalContext({
    access: business.access,
    actorUserId: business.user.userId,
    moduleContext: business.moduleContext,
  });
  if (!context || !isUnifiedApprovalCenterAvailable(context)) notFound();

  const params = await searchParams;
  const domain = approvalDomains.includes(params.domain as ApprovalDomain)
    ? params.domain as ApprovalDomain
    : undefined;
  const from = parseDate(params.from);
  const to = parseDate(params.to, true);
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const [inbox, branches] = await Promise.all([
    getUnifiedApprovalInbox(context, {
      domain,
      branchId: params.branch,
      employee: params.employee,
      from,
      to,
      page,
      pageSize: 20,
    }),
    prisma.branch.findMany({
      where: {
        businessId: context.businessId,
        id: { in: [...context.allowedBranchIds] },
        status: "ACTIVE",
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const availableDomains = availableApprovalDomains(context);
  const visibleDomains = availableDomains.filter(
    (item) => inbox.counts[item] > 0 || item === domain,
  );
  const activeFilterCount = [
    params.branch,
    params.employee,
    params.from,
    params.to,
  ].filter(Boolean).length;

  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <p className={styles.eyebrow}>People &amp; HR</p>
          <div className={styles.titleRow}>
            <h1>Approvals</h1>
            <span className={styles.pendingPill} aria-label={`${inbox.counts.total} pending approvals`}>
              <strong>{inbox.counts.total}</strong>
              <span>pending</span>
            </span>
          </div>
          <p>Review and resolve work that needs your decision.</p>
        </div>
        {business.access.effectiveBusinessRole === "BUSINESS_OWNER" ? (
          <Link className={styles.workflowLink} href="/team/approvals/settings">
            <span aria-hidden="true">{"\u2699"}</span>
            Workflow settings
          </Link>
        ) : null}
      </header>

      {inbox.unavailableDomains.length ? (
        <div className={styles.warning} role="alert">
          Partial data unavailable: {inbox.unavailableDomains.map((item) => domainLabels[item]).join(", ")}. No failed adapter was treated as zero pending.
        </div>
      ) : null}

      <nav className={styles.summary} aria-label="Approval categories">
        <Link
          className={!domain ? styles.activeSummary : styles.summaryCard}
          href={filterHref(params, { domain: undefined, page: undefined })}
        >
          <span>All approvals</span>
          <strong>{inbox.counts.total}</strong>
        </Link>
        {visibleDomains.map((item) => (
          <Link
            className={domain === item ? styles.activeSummary : styles.summaryCard}
            href={filterHref(params, { domain: item, page: undefined })}
            key={item}
          >
            <span>{domainLabels[item]}</span>
            <strong>{inbox.counts[item]}</strong>
          </Link>
        ))}
      </nav>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div>
            <h2>{domain ? `${domainLabels[domain]} approvals` : "Waiting for your decision"}</h2>
            <p>{inbox.pagination.total === 1 ? "One item needs attention." : `${inbox.pagination.total} items need attention.`}</p>
          </div>
        </div>

        <details className={styles.filterDisclosure} open={activeFilterCount > 0}>
          <summary>
            <span>
              Filter approvals
              {activeFilterCount ? <strong>{activeFilterCount}</strong> : null}
            </span>
            <span className={styles.filterToggle} aria-hidden="true" />
          </summary>
          <form className={styles.filters}>
            {domain ? <input name="domain" type="hidden" value={domain} /> : null}
            <label>Branch<select name="branch" defaultValue={params.branch ?? ""}><option value="">All authorised branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
            <label>Employee<input name="employee" defaultValue={params.employee ?? ""} maxLength={100} placeholder="Name or employee code" /></label>
            <label>From<input name="from" type="date" defaultValue={params.from ?? ""} /></label>
            <label>To<input name="to" type="date" defaultValue={params.to ?? ""} /></label>
            <div className={styles.filterActions}>
              {activeFilterCount ? <Link href={filterHref(params, { branch: undefined, employee: undefined, from: undefined, to: undefined, page: undefined })}>Clear</Link> : null}
              <button type="submit">Apply filters</button>
            </div>
          </form>
        </details>

        {inbox.items.length ? (
          <div className={styles.list}>
            {inbox.items.map((item) => <ApprovalCard item={item} key={item.id} />)}
          </div>
        ) : (
          <div className={styles.empty} role="status">
            <strong>You&apos;re all caught up.</strong>
            <span>No approvals need your attention.</span>
          </div>
        )}

        {inbox.pagination.totalPages > 1 ? (
          <nav className={styles.pagination} aria-label="Approval inbox pagination">
            {inbox.pagination.page > 1 ? <Link href={filterHref(params, { page: String(inbox.pagination.page - 1) })}>Previous</Link> : <span />}
            <span>Page {inbox.pagination.page} of {inbox.pagination.totalPages}</span>
            {inbox.pagination.page < inbox.pagination.totalPages ? <Link href={filterHref(params, { page: String(inbox.pagination.page + 1) })}>Next</Link> : <span />}
          </nav>
        ) : null}
      </section>
    </main>
  );
}

function ApprovalCard({ item }: { item: ApprovalInboxItem }) {
  const money = item.amount === null ? null : new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(item.amount);
  return (
    <article className={styles.item}>
      <span className={styles.itemIcon} aria-hidden="true">{domainInitials[item.domain]}</span>
      <div className={styles.itemMain}>
        <div className={styles.itemTitle}><h3>{item.title}</h3><span className={styles.status}>{formatStatus(item.status)}</span></div>
        <div className={styles.itemMeta}>
          <strong>{domainLabels[item.domain]}</strong>
          <span aria-hidden="true">•</span>
          <span>{item.branchName ?? "Business-wide"}</span>
          {item.employeeName ? <><span aria-hidden="true">•</span><span>{item.employeeName}</span></> : null}
        </div>
        <p>{formatApprovalSummary(item.summary)}</p>
      </div>
      <div className={styles.itemAction}>
        {money ? <strong>{money}</strong> : null}
        <small>{formatAge(item.requestedAt)}</small>
        <Link href={item.targetUrl}>{actionLabel(item)} <span aria-hidden="true">→</span></Link>
      </div>
    </article>
  );
}

const domainInitials: Record<ApprovalDomain, string> = {
  ATTENDANCE: "AT",
  LEAVE: "LV",
  CLAIMS: "CL",
  COMMISSION: "CM",
  PAYROLL: "PR",
};

function formatApprovalSummary(summary: string) {
  return summary.replace(/^(\d{4})-(\d{2})\b/, (_, year: string, month: string) => {
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
    return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  });
}

function actionLabel(item: ApprovalInboxItem) {
  if (item.domain === "ATTENDANCE") {
    return item.targetUrl.includes("timesheets") ? "Review timesheet" : "Review attendance";
  }
  if (item.domain === "LEAVE") return "Review leave";
  if (item.domain === "CLAIMS") return "Review claim";
  if (item.domain === "COMMISSION") return "Review commission";
  return "Review payroll";
}

function formatStatus(status: ApprovalInboxItem["status"]) {
  return status === "BLOCKED" ? "Blocked" : "Pending";
}

function parseDate(value?: string, endExclusive = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return endExclusive ? new Date(parsed.getTime() + 86_400_000) : parsed;
}

function formatAge(date: Date) {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1_000));
  if (seconds < 3_600) return `Pending ${Math.max(1, Math.floor(seconds / 60))} min`;
  if (seconds < 86_400) return `Pending ${Math.floor(seconds / 3_600)} hour(s)`;
  return `Pending ${Math.floor(seconds / 86_400)} day(s)`;
}

function filterHref(
  params: Awaited<PageProps["searchParams"]>,
  changes: Partial<Record<"domain" | "branch" | "employee" | "from" | "to" | "page", string | undefined>>,
) {
  const query = new URLSearchParams();
  const values = { ...params, ...changes };
  for (const key of ["domain", "branch", "employee", "from", "to", "page"] as const) {
    if (values[key]) query.set(key, values[key]);
  }
  const value = query.toString();
  return `/team/approvals${value ? `?${value}` : ""}`;
}
