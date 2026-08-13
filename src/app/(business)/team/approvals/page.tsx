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

  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>People &amp; HR</p>
          <h1>Approvals</h1>
          <p>One actionable inbox backed by each domain’s canonical workflow.</p>
        </div>
        <div className={styles.total} aria-label={`${inbox.counts.total} pending approvals`}>
          <span>Pending approvals</span>
          <strong>{inbox.counts.total}</strong>
        </div>
      </header>

      {inbox.unavailableDomains.length ? (
        <div className={styles.warning} role="alert">
          Partial data unavailable: {inbox.unavailableDomains.map((item) => domainLabels[item]).join(", ")}. No failed adapter was treated as zero pending.
        </div>
      ) : null}

      <section className={styles.summary} aria-label="Approval category counts">
        {availableDomains.map((item) => (
          <Link
            className={domain === item ? styles.activeSummary : styles.summaryCard}
            href={filterHref(params, { domain: domain === item ? undefined : item, page: undefined })}
            key={item}
          >
            <span>{domainLabels[item]}</span>
            <strong>{inbox.counts[item]}</strong>
          </Link>
        ))}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div><p className={styles.eyebrow}>Needs my attention</p><h2>{domain ? domainLabels[domain] : "All pending work"}</h2></div>
          {domain ? <Link href={filterHref(params, { domain: undefined, page: undefined })}>Clear category</Link> : null}
        </div>

        <form className={styles.filters}>
          <label>Domain<select name="domain" defaultValue={domain ?? ""}><option value="">All</option>{availableDomains.map((item) => <option key={item} value={item}>{domainLabels[item]}</option>)}</select></label>
          <label>Branch<select name="branch" defaultValue={params.branch ?? ""}><option value="">All authorised branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <label>Employee<input name="employee" defaultValue={params.employee ?? ""} maxLength={100} placeholder="Name or employee code" /></label>
          <label>From<input name="from" type="date" defaultValue={params.from ?? ""} /></label>
          <label>To<input name="to" type="date" defaultValue={params.to ?? ""} /></label>
          <button type="submit">Apply filters</button>
        </form>

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

      <p className={styles.boundary}>Approval Center is a read model, not a second approval engine. Payroll Finalize and Reopen remain protected by True MFA in the Payroll workspace.</p>
    </main>
  );
}

function ApprovalCard({ item }: { item: ApprovalInboxItem }) {
  const money = item.amount === null ? null : new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(item.amount);
  return (
    <article className={styles.item}>
      <div className={styles.itemType}>
        <span>{domainLabels[item.domain]}</span>
        <small>{item.branchName ?? "Whole business"}</small>
      </div>
      <div className={styles.itemMain}>
        <div><h3>{item.title}</h3><span className={styles.status}>{item.status}</span></div>
        <strong>{item.employeeName ?? item.branchName ?? "Business workflow"}</strong>
        <p>{item.summary}</p>
        <small>{formatAge(item.requestedAt)} · revision {item.revision ?? "canonical"}</small>
      </div>
      <div className={styles.itemAction}>
        {money ? <strong>{money}</strong> : null}
        <Link href={item.targetUrl}>{actionLabel(item.domain)}</Link>
      </div>
    </article>
  );
}

function actionLabel(domain: ApprovalDomain) {
  if (domain === "ATTENDANCE") return "Review / resolve";
  if (domain === "LEAVE") return "Open decision";
  if (domain === "CLAIMS") return "Open review";
  if (domain === "COMMISSION") return "Review / approve";
  return "Open Payroll review";
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
