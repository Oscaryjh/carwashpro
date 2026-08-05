import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sanitizePayrollNotice } from "@/lib/payroll/error-message";
import { resolvePaymentReadAccess } from "@/lib/payroll/payment/payment-access";
import { loadPaymentBatches, loadPaymentRun } from "@/lib/payroll/payment/payment-read";
import { evaluatePayrollPaymentReadiness } from "@/lib/payroll/payment/payment-readiness";
import { createPaymentBatchAction } from "../actions";
import { PaymentAccessDenied, PaymentPageHeader, blockerLabel, formatPaymentMoney, formatPaymentMonth, instructionStatusLabel } from "../_components";
import styles from "../payments.module.css";

export const dynamic = "force-dynamic";

export default async function NewPaymentBatchPage({ searchParams }: { searchParams: Promise<{ message?: string; runId?: string; type?: string }> }) {
  const access = await resolvePaymentReadAccess();
  if (!access.granted) return <PaymentAccessDenied scopeRestricted={access.scopeRestricted} />;
  const query = await searchParams;
  if (!query.runId || !isUuid(query.runId)) notFound();
  const run = await loadPaymentRun(access.businessId, query.runId);
  if (!run) notFound();
  const notice = sanitizePayrollNotice(query.message, query.type);
  if (!access.actions.canCreate) return <PaymentAccessDenied />;
  if (run.status !== "FINALIZED") return <main className={`content hr-module-page ${styles.page}`}><PaymentPageHeader title="Payment readiness" description="Only a finalized payroll calculation can become a payment draft."><Link href={`/team/payroll/runs/${run.id}`}>Back to Payroll Run</Link></PaymentPageHeader><section className={styles.statePanel}><h2>Payroll calculations are not locked</h2><p>Finalize the Payroll Run before evaluating salary-payment readiness.</p></section></main>;
  const [readiness, existing] = await Promise.all([
    evaluatePayrollPaymentReadiness(access.paymentContext, run.id),
    loadPaymentBatches(access.businessId, 1, null, run.id),
  ]);
  const canCreate = readiness.blockedCount === 0 && readiness.readyCount > 0;

  return <main className={`content hr-module-page ${styles.page}`}>
    <PaymentPageHeader title={`${formatPaymentMonth(run.periodStart)} Payment Readiness`} description="Validate employee net pay and effective verified bank versions before creating a draft."><Link href={`/team/payroll/runs/${run.id}`}>Payroll Run</Link><Link href="/team/payroll/payments">All batches</Link></PaymentPageHeader>
    {notice ? <div className={`${styles.notice} ${query.type === "error" ? styles.noticeError : ""}`} role={query.type === "error" ? "alert" : "status"}>{notice}</div> : null}
    <section className={styles.hero}><div><p className={styles.eyebrow}>Finalized payroll source</p><h2>{canCreate ? "Ready to create a payment draft" : "Resolve blockers before creating a draft"}</h2><p>The draft snapshots current verified bank versions. Later bank changes do not rewrite an existing batch.</p></div><div className={styles.metrics}><div className={styles.metric}><span>Ready</span><strong>{readiness.readyCount}</strong></div><div className={styles.metric}><span>Blocked</span><strong>{readiness.blockedCount}</strong></div><div className={styles.metric}><span>Ready amount</span><strong>{formatPaymentMoney(readiness.totalReadyAmount)}</strong></div></div></section>
    {existing.total ? <div className={styles.notice}>This Payroll Run already has {existing.total} historical or active payment batch revision(s). Active allocations appear as blockers to prevent duplicate payment instructions.</div> : null}
    <section className={styles.panel}><div className={styles.sectionHeading}><div><h2>Employee readiness</h2><p>Only masked bank details are returned to this page.</p></div></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Employee</th><th>Net pay</th><th>Bank</th><th>Status</th><th>Finding</th></tr></thead><tbody>{readiness.items.map((item) => <tr key={item.payrollEntryId}><td data-label="Employee"><strong>{item.employeeName}</strong><small>{item.employeeCode}</small></td><td data-label="Net pay">{formatPaymentMoney(item.netPay)}</td><td data-label="Bank">{item.bankName ? <><span>{item.bankName}</span><small className={styles.account}>•••• {item.accountLast4}</small></> : "Not configured"}</td><td data-label="Status"><span className={styles.badge}>{instructionStatusLabel(item.status)}</span></td><td data-label="Finding">{blockerLabel(item.blockerCode)}{access.canViewEmployeeProfile && item.blockerCode?.startsWith("BANK_") || access.canViewEmployeeProfile && item.blockerCode === "MISSING_BANK_ACCOUNT" ? <small><Link href={`/team/people/${item.employeeMembershipId}?section=payroll`}>Open employee bank profile</Link></small> : null}</td></tr>)}</tbody></table></div></section>
    <section className={styles.panel}><div className={styles.sectionHeading}><div><h2>Create draft batch</h2><p>Creating a draft does not create a bank file and does not mark any employee paid.</p></div></div>{canCreate ? <form className={styles.reasonForm} action={createPaymentBatchAction}><input type="hidden" name="commandId" value={randomUUID()} /><input type="hidden" name="expectedRevision" value="0" /><input type="hidden" name="payrollRunId" value={run.id} /><input type="hidden" name="reasonType" value="PAYMENT_BATCH_CREATE" /><label>Audit reason<textarea name="reason" minLength={5} maxLength={500} required placeholder="Explain why this payment draft is being prepared" /></label><button className={styles.primaryButton} type="submit">Create payment draft</button></form> : <div className={styles.empty}><strong>Draft creation blocked</strong><p>Resolve every blocker, then reload this readiness check.</p></div>}</section>
  </main>;
}

function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
