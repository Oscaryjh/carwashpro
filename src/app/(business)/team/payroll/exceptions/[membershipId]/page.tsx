import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { getPayrollExceptionOverview } from "@/lib/payroll/exception-center-read";
import { PAYROLL_EXCEPTION_AREA_LABELS, PAYROLL_EXCEPTION_IMPACT_LABELS } from "@/lib/payroll/exception-center-types";
import { parsePayrollMonth } from "@/lib/payroll/period";
import { hasWholeBusinessPeopleScope } from "@/lib/team/people-scope";
import styles from "../payroll-exceptions.module.css";

export const dynamic = "force-dynamic";

export default async function PayrollExceptionDetailPage({ params, searchParams }: {
  params: Promise<{ membershipId: string }>;
  searchParams: Promise<{ month?: string; returnTo?: string }>;
}) {
  const context = await requireBusinessUser();
  const [{ membershipId }, query, scope] = await Promise.all([params, searchParams, resolveAttendanceScope(context.access)]);
  const parsedId = z.string().uuid().safeParse(membershipId);
  if (!parsedId.success) notFound();
  const month = normalizeMonth(query.month);
  const returnTo = safeReturn(query.returnTo, month);
  const result = await getPayrollExceptionOverview({
    access: context.access,
    allowedBranchIds: scope.allowedBranchIds,
    businessId: context.businessId,
    membershipId: parsedId.data,
    month,
    wholeBusinessScope: hasWholeBusinessPeopleScope(context.access),
  });
  if (result.status !== "READY" || result.data.rows.length !== 1) notFound();
  const row = result.data.rows[0]!;

  return (
    <main className={`${styles.page} ${styles.detailPage}`}>
      <Link className={styles.back} href={returnTo}>← Back to Payroll issues</Link>
      <header className={styles.detailHeader}>
        <div><p className={styles.eyebrow}>PAYROLL ISSUE DETAILS</p><h1>{row.name}</h1><p>{row.employeeCode} · {row.branches.map((branch) => branch.name).join(", ") || "No current branch"}</p></div>
        <div><span>Payroll month</span><strong>{formatMonth(month)}</strong></div>
      </header>
      <section className={styles.detailSummary}>
        <span className={styles.badge} data-impact={impactQueryValue(row.status)}>{PAYROLL_EXCEPTION_IMPACT_LABELS[row.status]}</span>
        <p>{row.issues.length ? `${row.issues.length} ${row.issues.length === 1 ? "issue needs" : "issues need"} attention.` : "No visible action is needed for this employee."}</p>
      </section>
      {row.issues.length ? <div className={styles.issueGroups}>{row.issues.map((issue, index) => (
        <article key={`${issue.area}:${issue.title}:${index}`}>
          <div className={styles.issueHeading}><span>{PAYROLL_EXCEPTION_AREA_LABELS[issue.area]}</span><strong>{PAYROLL_EXCEPTION_IMPACT_LABELS[issue.impact]}</strong></div>
          <h2>{issue.title}</h2><p>{issue.detail}</p><small>Usually handled by: {issue.owner}</small>
          {issue.action && issue.action.label !== "View issue" ? <Link className={styles.primaryAction} href={withReturn(issue.action.href, returnTo)}>{issue.action.label}<span aria-hidden="true"> →</span></Link> : null}
        </article>
      ))}</div> : <section className={styles.empty}><h2>No payroll issues found</h2><p>This employee has no visible issues for {formatMonth(month)}.</p></section>}
      <footer className={styles.footer}>This view contains business-readable status only. It does not change attendance, payroll, tax, or statutory records.</footer>
    </main>
  );
}

function normalizeMonth(value?: string) {
  try { return parsePayrollMonth(value).value; } catch { return new Date().toISOString().slice(0, 7); }
}

function safeReturn(value: string | undefined, month: string) {
  const fallback = `/team/payroll/exceptions?month=${month}`;
  if (!value || /[\\\r\n]/.test(value)) return fallback;
  const url = new URL(value, "https://internal.invalid");
  if (url.pathname !== "/team/payroll/exceptions") return fallback;
  const allowed = new URLSearchParams();
  for (const key of ["month", "search", "branch", "impact", "area", "showReady", "page"]) {
    const item = url.searchParams.get(key);
    if (item) allowed.set(key, item);
  }
  allowed.set("month", normalizeMonth(allowed.get("month") ?? month));
  return `/team/payroll/exceptions?${allowed}`;
}

function withReturn(href: string, returnTo: string) {
  const url = new URL(href, "https://internal.invalid");
  if (url.pathname.startsWith("/team/people/")) url.searchParams.set("peopleReturn", returnTo);
  else if (url.pathname === "/team/leave") url.searchParams.set("payrollReturn", returnTo);
  return `${url.pathname}${url.search}`;
}

function impactQueryValue(impact: keyof typeof PAYROLL_EXCEPTION_IMPACT_LABELS) { return ({ BLOCKING_PAYROLL: "blocking", NEEDS_REVIEW: "review", SETUP_REQUIRED: "setup", READY: "ready" } as const)[impact]; }
function formatMonth(month: string) { return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00.000Z`)); }
