import Link from "next/link";
import { notFound } from "next/navigation";
import { HrPayrollIssue } from "@/components/hr-payroll-issue";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { requireUser } from "@/lib/auth/session";
import {
  actionCenterDomains,
  availableApprovalDomains,
  getUnifiedApprovalInbox,
  isUnifiedApprovalCenterAvailable,
  resolveUnifiedApprovalContext,
} from "@/lib/approvals/service";
import type {
  ActionCenterKind,
  ApprovalDomain,
  ApprovalInboxItem,
} from "@/lib/approvals/types";
import { prisma } from "@/lib/prisma";
import styles from "./approvals.module.css";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    kind?: string;
    domain?: string;
    branch?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
};

const actionCenterDomainSet = new Set<ApprovalDomain>(actionCenterDomains);
const kindLabels: Record<ActionCenterKind, string> = {
  APPROVAL: "Approvals",
  TASK: "Tasks",
};
const domainLabels: Record<ApprovalDomain, string> = {
  ATTENDANCE: "Attendance",
  LEAVE: "Leave",
  CLAIMS: "Claims",
  COMMISSION: "Commission",
  PAYROLL: "Payroll",
};

export default async function ActionCenterPage({ searchParams }: PageProps) {
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
  const kind = params.kind === "APPROVAL" || params.kind === "TASK"
    ? params.kind
    : undefined;
  const domain = actionCenterDomainSet.has(params.domain as ApprovalDomain)
    ? params.domain as ApprovalDomain
    : undefined;
  const from = parseDate(params.from);
  const to = parseDate(params.to, true);
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const [inbox, branches] = await Promise.all([
    getUnifiedApprovalInbox(context, {
      kind,
      domain,
      domains: actionCenterDomains,
      branchId: params.branch,
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
  const availableModules = availableApprovalDomains(context).filter((item) =>
    actionCenterDomainSet.has(item),
  );
  const activeFilterCount = [domain, params.branch, params.from, params.to].filter(Boolean).length;
  const attentionCount = inbox.kindCounts.total;

  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <p className={styles.eyebrow}>HR &amp; Payroll overview</p>
          <div className={styles.titleRow}>
            <h1>Overview</h1>
            <span className={styles.pendingPill} aria-label={`${attentionCount} need attention`}>
              <strong>{attentionCount}</strong>
              <span>{attentionCount === 1 ? "needs" : "need"} attention</span>
            </span>
          </div>
          <p>See approvals, payroll blockers and follow-up work in one place.</p>
        </div>
      </header>

      {inbox.unavailableDomains.length ? (
        <HrPayrollIssue
          affected={inbox.unavailableDomains.map((item) => domainLabels[item]).join(", ")}
          impact="Items from these areas may be missing from the Action Center until they load successfully."
          nextAction={{ href: "/team/approvals", label: "Try again" }}
          title="Some work is temporarily unavailable"
          tone="error"
          whatHappened="Tetamu could not load one or more HR & Payroll work queues. No records were changed."
        />
      ) : null}

      <nav className={styles.summary} aria-label="Overview item types">
        <Link
          className={!kind ? styles.activeSummary : styles.summaryCard}
          href={filterHref(params, { kind: undefined, page: undefined })}
        >
          <span>All</span>
          <strong>{inbox.kindCounts.total}</strong>
        </Link>
        {(["APPROVAL", "TASK"] as const).map((itemKind) => (
          <Link
            className={kind === itemKind ? styles.activeSummary : styles.summaryCard}
            href={filterHref(params, { kind: itemKind, page: undefined })}
            key={itemKind}
          >
            <span>{kindLabels[itemKind]}</span>
            <strong>{inbox.kindCounts[itemKind]}</strong>
          </Link>
        ))}
      </nav>

      <section className={styles.panel} aria-label="Action Center">
        <div className={styles.panelHeading}>
          <div>
            <h2>Action Center</h2>
            <p>{inbox.pagination.total === 1 ? "One item is ready for you." : `${inbox.pagination.total} items are ready for you.`}</p>
          </div>
        </div>

        <details className={styles.filterDisclosure} open={activeFilterCount > 0}>
          <summary>
            <span>
              Filters
              {activeFilterCount ? <strong>{activeFilterCount}</strong> : null}
            </span>
            <span className={styles.filterToggle} aria-hidden="true" />
          </summary>
          <form className={styles.filters}>
            {kind ? <input name="kind" type="hidden" value={kind} /> : null}
            <label>
              Module
              <select name="domain" defaultValue={domain ?? ""}>
                <option value="">All modules</option>
                {availableModules.map((item) => (
                  <option key={item} value={item}>{domainLabels[item]}</option>
                ))}
              </select>
            </label>
            <label>
              Branch
              <select name="branch" defaultValue={params.branch ?? ""}>
                <option value="">All authorised branches</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>
            <label>Submitted from<input name="from" type="date" defaultValue={params.from ?? ""} /></label>
            <label>Submitted to<input name="to" type="date" defaultValue={params.to ?? ""} /></label>
            <div className={styles.filterActions}>
              {activeFilterCount ? (
                <Link href={filterHref(params, { domain: undefined, branch: undefined, from: undefined, to: undefined, page: undefined })}>
                  Clear
                </Link>
              ) : null}
              <button type="submit">Apply</button>
            </div>
          </form>
        </details>

        {inbox.items.length ? (
          <div className={styles.list}>
            {inbox.items.map((item) => <ActionCenterCard item={item} key={item.id} />)}
          </div>
        ) : (
          <div className={styles.empty} role="status">
            <span className={styles.emptyIcon} aria-hidden="true">✓</span>
            <strong>You&apos;re all caught up</strong>
            <span>No approvals or tasks need your attention.</span>
          </div>
        )}

        {inbox.pagination.totalPages > 1 ? (
          <nav className={styles.pagination} aria-label="Action Center pagination">
            {inbox.pagination.page > 1 ? <Link href={filterHref(params, { page: String(inbox.pagination.page - 1) })}>Previous</Link> : <span />}
            <span>Page {inbox.pagination.page} of {inbox.pagination.totalPages}</span>
            {inbox.pagination.page < inbox.pagination.totalPages ? <Link href={filterHref(params, { page: String(inbox.pagination.page + 1) })}>Next</Link> : <span />}
          </nav>
        ) : null}
      </section>
    </main>
  );
}

function ActionCenterCard({ item }: { item: ApprovalInboxItem }) {
  const money = item.amount === null ? null : new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
  }).format(item.amount);
  return (
    <article className={styles.item}>
      <span className={styles.itemIcon} aria-hidden="true">{domainInitials[item.domain]}</span>
      <div className={styles.itemMain}>
        <div className={styles.classification}>
          <strong>{item.kind}</strong>
          <span aria-hidden="true">·</span>
          <span>{domainLabels[item.domain]}</span>
        </div>
        <div className={styles.itemTitle}>
          <h3>{item.title}</h3>
          <span className={styles.status}>{formatStatus(item)}</span>
        </div>
        <div className={styles.itemMeta}>
          {item.employeeName ? <strong>{item.employeeName}</strong> : null}
          {item.employeeName ? <span aria-hidden="true">•</span> : null}
          <span>{item.branchName ?? "Business-wide"}</span>
          {money ? <><span aria-hidden="true">•</span><strong>{money}</strong></> : null}
        </div>
        <p>{formatActionSummary(item.summary)}</p>
      </div>
      <div className={styles.itemAction}>
        <div className={styles.requestTiming}>
          <time dateTime={item.requestedAt.toISOString()}>{formatActivityTime(item)}</time>
          <small>{formatAge(item.requestedAt)}</small>
        </div>
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

function formatActionSummary(summary: string) {
  return summary.replace(/^(\d{4})-(\d{2})\b/, (_, year: string, month: string) => {
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
    return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  });
}

function actionLabel(item: ApprovalInboxItem) {
  if (item.kind === "TASK") return "Finalize timesheet";
  if (item.domain === "ATTENDANCE") return "Review attendance";
  if (item.domain === "LEAVE") return "Review leave";
  if (item.domain === "CLAIMS") return "Review claim";
  return "Review";
}

function formatStatus(item: ApprovalInboxItem) {
  if (item.status === "BLOCKED") return "Blocked";
  if (item.kind === "TASK") return "Ready to finalize";
  return "Waiting for decision";
}

function parseDate(value?: string, endExclusive = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return endExclusive ? new Date(parsed.getTime() + 86_400_000) : parsed;
}

function formatAge(date: Date) {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1_000));
  if (seconds < 3_600) return `Waiting ${Math.max(1, Math.floor(seconds / 60))}m`;
  if (seconds < 86_400) return `Waiting ${Math.floor(seconds / 3_600)}h`;
  return `Waiting ${Math.floor(seconds / 86_400)}d`;
}

function formatActivityTime(item: ApprovalInboxItem) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date());
  const activityDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(item.requestedAt);
  const time = new Intl.DateTimeFormat("en-MY", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kuala_Lumpur",
  }).format(item.requestedAt);
  const prefix = item.kind === "TASK" ? "Ready" : "Submitted";
  if (today === activityDate) return `${prefix} today · ${time}`;
  const date = new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(item.requestedAt);
  return `${prefix} ${date} · ${time}`;
}

type FilterKey = "kind" | "domain" | "branch" | "from" | "to" | "page";

function filterHref(
  params: Awaited<PageProps["searchParams"]>,
  changes: Partial<Record<FilterKey, string | undefined>>,
) {
  const query = new URLSearchParams();
  const values = { ...params, ...changes };
  for (const key of ["kind", "domain", "branch", "from", "to", "page"] as const) {
    if (values[key]) query.set(key, values[key]);
  }
  const value = query.toString();
  return `/team/approvals${value ? `?${value}` : ""}`;
}
