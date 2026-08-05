import Link from "next/link";
import { sanitizePayrollNotice } from "@/lib/payroll/error-message";
import { resolvePaymentReadAccess } from "@/lib/payroll/payment/payment-access";
import { loadPaymentBatches, parsePaymentPage, parsePaymentStatus, paymentBatchStatuses } from "@/lib/payroll/payment/payment-read";
import { PaymentAccessDenied, PaymentPageHeader, PaymentStatusBadge, formatPaymentDate, formatPaymentMoney, formatPaymentMonth } from "./_components";
import styles from "./payments.module.css";

export const dynamic = "force-dynamic";

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ message?: string; page?: string; runId?: string; status?: string; type?: string }> }) {
  const access = await resolvePaymentReadAccess();
  if (!access.granted) return <PaymentAccessDenied scopeRestricted={access.scopeRestricted} />;
  const query = await searchParams;
  const status = parsePaymentStatus(query.status);
  const runId = isUuid(query.runId) ? query.runId : undefined;
  const data = await loadPaymentBatches(access.businessId, parsePaymentPage(query.page), status, runId);
  const notice = sanitizePayrollNotice(query.message, query.type);

  return <main className={`content hr-module-page ${styles.page}`}>
    <PaymentPageHeader title="Payroll Payments" description="Review payment readiness and manage draft approval separately from locked payroll calculations.">
      <Link href="/team/payroll/workspace">Payroll Workspace</Link><Link href="/team/payroll/runs">Payroll Runs</Link>
    </PaymentPageHeader>
    {notice ? <div className={`${styles.notice} ${query.type === "error" ? styles.noticeError : ""}`} role={query.type === "error" ? "alert" : "status"}>{notice}</div> : null}
    <section className={styles.hero}><div><p className={styles.eyebrow}>Payment control</p><h2>Finalized is not paid</h2><p>A batch records reviewed salary-payment instructions. P2 does not create a bank file, submit to a bank, or mark employees paid.</p></div><div className={styles.metrics}><div className={styles.metric}><span>Matching batches</span><strong>{data.total}</strong></div><div className={styles.metric}><span>Current capability</span><strong>Review &amp; approval</strong></div><div className={styles.metric}><span>Bank execution</span><strong>Not available</strong></div></div></section>
    <section className={styles.panel}>
      <div className={styles.sectionHeading}><div><h2>Payment batches</h2><p>Original and correction revisions remain independently traceable.</p></div></div>
      <form className={styles.filterForm} action="/team/payroll/payments"><label>Status<select name="status" defaultValue={status ?? ""}><option value="">All statuses</option>{paymentBatchStatuses.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></label>{runId ? <input type="hidden" name="runId" value={runId} /> : null}<button className={styles.secondaryButton} type="submit">Apply filter</button>{status || runId ? <Link href="/team/payroll/payments">Clear</Link> : null}</form>
      {data.batches.length ? <div className={styles.batchGrid}>{data.batches.map((batch) => <article className={styles.batchCard} key={batch.id}><div><p className={styles.eyebrow}>{formatPaymentMonth(batch.payrollRun.periodStart)}</p><h3>{batch.batchNumber}</h3><PaymentStatusBadge status={batch.status} /><p className={styles.batchMeta}>{batch.batchType === "CORRECTION" ? "Correction" : "Original"} · Revision {batch.revision} · Created {formatPaymentDate(batch.createdAt)}</p><div className={styles.actions}><Link href={`/team/payroll/payments/${batch.id}`}>View batch</Link><Link href={`/team/payroll/runs/${batch.payrollRunId}`}>View payroll run</Link></div></div><div className={styles.batchStats}><div><span>Ready</span><strong>{batch.readyCount}</strong></div><div><span>Blocked</span><strong>{batch.blockedCount}</strong></div><div><span>Excluded</span><strong>{batch.excludedCount}</strong></div><div><span>Ready amount</span><strong>{formatPaymentMoney(batch.totalReadyAmount)}</strong></div></div></article>)}</div> : <div className={styles.empty}><h3>No payment batches</h3><p>Open a finalized Payroll Run to evaluate readiness and create a draft.</p><Link href="/team/payroll/runs">Open Payroll Runs</Link></div>}
      <Pagination page={data.page} totalPages={data.totalPages} status={status} runId={runId} />
    </section>
  </main>;
}

function Pagination({ page, totalPages, status, runId }: { page: number; totalPages: number; status: string | null; runId?: string }) {
  if (totalPages <= 1) return null;
  const href = (target: number) => `/team/payroll/payments?${new URLSearchParams({ page: String(target), ...(status ? { status } : {}), ...(runId ? { runId } : {}) })}`;
  return <nav className={styles.pagination} aria-label="Payment batch pages">{page > 1 ? <Link href={href(page - 1)}>Previous</Link> : <span>Previous</span>}<strong>Page {page} of {totalPages}</strong>{page < totalPages ? <Link href={href(page + 1)}>Next</Link> : <span>Next</span>}</nav>;
}

function isUuid(value: string | undefined): value is string { return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)); }
