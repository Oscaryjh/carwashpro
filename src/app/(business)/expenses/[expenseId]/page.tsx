import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExpensePaymentForm } from "@/components/expense-payment-form";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { resolveExpenseReadScope } from "@/lib/expense/access";
import { listOpenExpenseDrawerShifts } from "@/lib/expense/drawer-balance";
import { getBusinessExpenseDetail } from "@/lib/expense/service";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import { confirmExpenseAction, voidExpenseAction } from "../actions";
import styles from "../expense.module.css";

export default async function ExpenseDetailPage({ params, searchParams }: { params: Promise<{ expenseId: string }>; searchParams: Promise<{ message?: string; type?: string }> }) {
  const context = await requireBusinessUserForModule("EXPENSE", "VIEW_EXPENSE");
  const [{ expenseId }, query, scope, moduleContext] = await Promise.all([params, searchParams, resolveExpenseReadScope(context), loadBusinessModuleContext(context.businessId)]);
  const expense = await getBusinessExpenseDetail({ businessId: context.businessId, expenseId, ...scope }).catch(() => null);
  if (!expense) notFound();

  const canEdit = hasBusinessCapability(context.access, "EDIT_EXPENSE_DRAFT") && expense.sourceType === "MANUAL" && expense.status !== "VOID" && expense.paymentStatus === "UNPAID";
  const canConfirm = hasBusinessCapability(context.access, "CONFIRM_EXPENSE") && expense.sourceType === "MANUAL" && expense.status === "DRAFT";
  const canMarkPaid = hasBusinessCapability(context.access, "MARK_EXPENSE_PAID") && expense.sourceType === "MANUAL" && expense.status === "CONFIRMED" && expense.paymentStatus !== "PAID";
  const canVoid = hasBusinessCapability(context.access, "VOID_EXPENSE") && expense.sourceType === "MANUAL" && expense.status === "CONFIRMED" && expense.paymentStatus === "UNPAID";
  const canViewReceipt = hasBusinessCapability(context.access, "VIEW_EXPENSE_RECEIPT");
  const openDrawerShifts = canMarkPaid && expense.branchId ? await listOpenExpenseDrawerShifts({ branchIds: [expense.branchId], businessId: context.businessId }) : [];
  const sourceHref = expense.sourceSnapshot && expense.sourceType === "CLAIM" && hasBusinessCapability(context.access, "VIEW_CLAIM")
    ? `/team/claims?claimId=${expense.sourceSnapshot.sourceRecordId}`
    : expense.sourceSnapshot && expense.sourceType === "PAYROLL" && hasBusinessCapability(context.access, "VIEW_PAYROLL_RUN")
      ? `/team/payroll/runs/${expense.sourceSnapshot.sourceRecordId}`
      : expense.sourceSnapshot && expense.sourceType === "INVENTORY_PURCHASE" && moduleContext.enabledModules.has("INVENTORY") && hasBusinessCapability(context.access, "VIEW_SUPPLIER_BILL")
        ? `/inventory/supplier-bills/${expense.sourceSnapshot.sourceRecordId}`
        : null;

  const eventPaidAmount = expense.paymentEvents.reduce((sum, event) => sum + Number(event.amount), 0);
  const paidAmount = expense.sourceSettlement ? Number(expense.sourceSettlement.paidAmount) : eventPaidAmount;
  const outstanding = expense.sourceSettlement ? Number(expense.sourceSettlement.outstandingAmount) : Math.max(0, Number(expense.amount) - eventPaidAmount);
  const paymentStatus = expense.sourceSettlement?.settlementStatus ?? (outstanding === 0 ? "PAID" : paidAmount > 0 ? "PARTIALLY_PAID" : "UNPAID");

  return <section className={`content ${styles.expensePage} ${styles.detailPage}`}>
    <header className={styles.detailHeader}>
      <div className={styles.headerCopy}>
        <span className={styles.eyebrow}>Expense record</span>
        <div className={styles.detailTitleRow}>
          <h1>{expense.expenseNumber}</h1>
          <StatusBadge value={expense.status} />
          <StatusBadge value={paymentStatus} />
        </div>
        <p>{expense.payeeName ?? "No payee recorded"} · {expense.branchNameSnapshot ?? "Business-wide"}</p>
      </div>
      <nav className={styles.detailActions} aria-label="Expense actions">
        <Link className={styles.secondaryAction} href="/expenses/history">Back to history</Link>
        {canEdit ? <Link className={styles.primaryAction} href={`/expenses/${expense.id}/edit`}>Edit / Correct</Link> : null}
      </nav>
    </header>

    {query.message ? <p className={`form-message ${query.type === "error" ? "error" : "success"}`}>{query.message}</p> : null}

    <section className={styles.detailHero} aria-label="Expense summary">
      <div className={styles.amountSummary}>
        <span>Recorded amount</span>
        <strong>RM {expense.amount.toFixed(2)}</strong>
        <small>{outstanding > 0 ? `RM ${outstanding.toFixed(2)} outstanding` : "Fully paid"}</small>
      </div>
      <div className={styles.detailMetaGrid}>
        <MetaFact label="Expense date" value={formatDate(expense.expenseDate)} />
        <MetaFact label="Category" value={expense.categoryNameSnapshot} />
        <MetaFact label="Branch" value={expense.branchNameSnapshot ?? "Business-wide"} />
        <MetaFact label="Payee" value={expense.payeeName ?? "Not provided"} />
      </div>
    </section>

    <div className={styles.detailGrid}>
      <section className={styles.detailCard}>
        <div className={styles.cardHeading}>
          <div><span className={styles.eyebrow}>Details</span><h2>Expense information</h2></div>
        </div>
        <dl className={styles.detailList}>
          <div className={styles.wideDetail}><dt>Description</dt><dd>{expense.description}</dd></div>
          {expense.notes ? <div className={styles.wideDetail}><dt>Notes</dt><dd>{expense.notes}</dd></div> : null}
          <div><dt>Created by</dt><dd>{expense.createdBy.name}</dd></div>
          <div><dt>Confirmed by</dt><dd>{expense.confirmedBy?.name ?? "Not confirmed yet"}</dd></div>
          {expense.status === "VOID" ? <div className={styles.wideDetail}><dt>Void reason</dt><dd>{expense.voidReason}</dd></div> : null}
        </dl>
      </section>

      <section className={styles.detailCard}>
        <div className={styles.cardHeading}>
          <div><span className={styles.eyebrow}>Payment</span><h2>Payment information</h2></div>
          <StatusBadge value={paymentStatus} />
        </div>
        {paymentStatus === "UNPAID" ? <div className={styles.emptyPayment}><strong>No payment recorded</strong><span>This expense still has RM {outstanding.toFixed(2)} outstanding.</span></div> : <>
          <dl className={styles.detailList}><div><dt>Paid amount</dt><dd>RM {paidAmount.toFixed(2)}</dd></div><div><dt>Outstanding</dt><dd>RM {outstanding.toFixed(2)}</dd></div></dl>
          {expense.paymentEvents.length ? <div className={styles.stack}><strong>Payment history</strong>{expense.paymentEvents.map((payment) => <article className={styles.history} key={payment.id}><strong>RM {payment.amount.toFixed(2)} · {sentenceCase(payment.paymentMethod)}</strong><span>{formatDate(payment.paymentDate)} · {paymentSourceLabel(payment.paymentSource)}</span><span>{payment.actor.name}{payment.paymentReference ? ` · ${payment.paymentReference}` : ""}</span>{payment.drawerPayout ? <span>Deducted from {payment.drawerPayout.shift.cashier.name}&apos;s POS shift at {formatDateTime(payment.drawerPayout.occurredAt)}</span> : null}</article>)}</div> : <p className={styles.panelNote}>Settlement is managed by the canonical source record.</p>}
        </>}
      </section>
    </div>

    <section className={styles.detailCard}>
      <div className={styles.cardHeading}>
        <div><span className={styles.eyebrow}>Documents</span><h2>Receipt</h2></div>
        <span className={styles.documentCount}>{expense.attachments.length} file{expense.attachments.length === 1 ? "" : "s"}</span>
      </div>
      {expense.attachments.length ? <div className={styles.receiptList}>{expense.attachments.map((attachment) => {
        const releasable = attachment.malwareStatus === "CLEAN" && ["SAFE", "SANITIZED"].includes(attachment.privacyMetadataStatus);
        return <article className={styles.receiptCard} key={attachment.id}>
          <div className={styles.fileIcon} aria-hidden="true">DOC</div>
          <div className={styles.receiptInfo}>
            <strong>{attachment.sanitizedFileName}</strong>
            <span>{(attachment.byteLength / 1024).toFixed(1)} KB · {releasable ? "Ready to view" : "Stored privately"}</span>
          </div>
          {canViewReceipt && releasable ? <a className={styles.secondaryAction} href={`/api/expenses/attachments/${attachment.id}`} target="_blank" rel="noreferrer">View receipt</a> : null}
          {!releasable ? <p className={styles.receiptNotice}><strong>Preview not available yet</strong><span>The receipt remains stored privately while document safety and privacy checks are pending.</span></p> : null}
        </article>;
      })}</div> : <div className={styles.emptyDocument}><strong>No receipt attached</strong><span>This expense was saved without a supporting document.</span></div>}
    </section>

    {(canConfirm || canMarkPaid || canVoid) ? <section className={styles.detailCard}>
      <div className={styles.cardHeading}><div><span className={styles.eyebrow}>Next step</span><h2>Payment & corrections</h2></div></div>
      <div className={styles.grid}>
        {canConfirm ? <form action={confirmExpenseAction} className={styles.actions}><input type="hidden" name="expenseId" value={expense.id} /><input type="hidden" name="expectedRevision" value={expense.revision} /><input type="hidden" name="operationKey" value={`CONFIRM_EXPENSE:${expense.id}:${randomUUID()}`} /><button>Confirm expense</button></form> : null}
        {canMarkPaid ? <ExpensePaymentForm expenseId={expense.id} expectedRevision={expense.revision} openDrawerShifts={openDrawerShifts.map((shift) => ({ availableCash: shift.availableCash, cashierName: shift.cashierName, id: shift.id, isCurrentUser: shift.cashierId === context.access.userId, startedAt: shift.startedAt.toISOString() }))} operationKey={`MARK_EXPENSE_PAID:${expense.id}:${randomUUID()}`} outstanding={outstanding.toFixed(2)} /> : null}
        {canVoid ? <details className={styles.dangerDisclosure}><summary><span><strong>Void expense</strong><small>Entered by mistake? Void it so it no longer counts as spending. The audit history will be kept.</small></span><span className={styles.dangerDisclosureAction}>Open</span></summary><form action={voidExpenseAction} className={styles.form}><p className={`${styles.full} ${styles.voidExplanation}`}>This does not delete the record. Its status will change to Void and the reason will be saved in the revision history.</p><input type="hidden" name="expenseId" value={expense.id} /><input type="hidden" name="expectedRevision" value={expense.revision} /><input type="hidden" name="operationKey" value={`VOID_EXPENSE:${expense.id}:${randomUUID()}`} /><label className={styles.full}>Why are you voiding this expense?<input name="reason" required minLength={5} maxLength={500} placeholder="Example: Duplicate expense entered by mistake" /></label><button className={`danger-button ${styles.full}`}>Confirm void expense</button></form></details> : null}
      </div>
    </section> : null}

    <details className={styles.auditDisclosure}>
      <summary><span><strong>Source & audit trail</strong><small>Record source, revisions and system details</small></span><span aria-hidden="true">+</span></summary>
      <div className={styles.auditBody}>
        <section>
          <h2>Source</h2>
          <p>{expense.sourceType !== "MANUAL" ? <strong>System Generated · Read-only representation · </strong> : null}{sourceLabel(expense.sourceType)}</p>
          {expense.sourceId ? <p className={styles.source}>Source ID: {expense.sourceId}<br />Source revision: {expense.sourceRevision ?? "Not available"}</p> : <p>Created directly in Expenses.</p>}
          {expense.sourceSnapshot ? <dl className={styles.auditList}><dt>Canonical record</dt><dd>{expense.sourceSnapshot.sourceNumberSnapshot}</dd><dt>Recognition status</dt><dd>{sentenceCase(expense.sourceSnapshot.sourceStatusSnapshot)}</dd><dt>Source digest</dt><dd className={styles.source}>{expense.sourceSnapshot.sourceDigest}</dd>{expense.sourceType === "CLAIM" ? <><dt>Submitted / approved</dt><dd>RM {expense.sourceSnapshot.submittedAmount?.toFixed(2) ?? "0.00"} / RM {expense.sourceSnapshot.approvedAmount?.toFixed(2) ?? "0.00"}</dd><dt>Source receipt</dt><dd>{expense.sourceSnapshot.receiptAvailable ? "Available in Claims (not copied)" : "No source receipt"}</dd></> : null}{expense.sourceType === "PAYROLL" ? <><dt>Gross remuneration</dt><dd>RM {expense.sourceSnapshot.grossRemuneration?.toFixed(2) ?? "0.00"}</dd><dt>Employer contributions</dt><dd>RM {expense.sourceSnapshot.employerContributionTotal?.toFixed(2) ?? "0.00"}</dd><dt>Excluded pass-through</dt><dd>RM {expense.sourceSnapshot.excludedPassThrough?.toFixed(2) ?? "0.00"}</dd></> : null}</dl> : null}
          {sourceHref ? <Link className={styles.inlineLink} href={sourceHref}>Open canonical source →</Link> : null}
        </section>
        <section>
          <h2>Revision history</h2>
          <div className={styles.stack}>{expense.revisions.map((revision) => <article className={styles.history} key={revision.id}><strong>Revision {revision.revision} · {sentenceCase(revision.revisionType)}</strong><span>{formatDateTime(revision.createdAt)} · {revision.createdBy.name}</span><span>RM {revision.amount.toFixed(2)} · {sentenceCase(revision.status)} / {sentenceCase(revision.paymentStatus)}</span>{revision.reason ? <span>{revision.reason}</span> : null}</article>)}</div>
        </section>
      </div>
    </details>
  </section>;
}

function MetaFact({ label, value }: { label: string; value: string }) {
  return <div className={styles.metaFact}><span>{label}</span><strong>{value}</strong></div>;
}

function StatusBadge({ value }: { value: string }) {
  return <span className={`${styles.statusBadge} ${styles[`status_${value.toLowerCase()}`] ?? ""}`}>{sentenceCase(value)}</span>;
}

function sourceLabel(value: string) {
  if (value === "MANUAL") return "Manual entry";
  if (value === "INVENTORY_PURCHASE") return "Supplier bill";
  if (value === "SYSTEM") return "Recurring expense";
  return sentenceCase(value);
}

function sentenceCase(value: string) {
  const text = value.replaceAll("_", " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function paymentSourceLabel(value: string) {
  const labels: Record<string, string> = {
    BANK_ACCOUNT: "Business bank account / DuitNow",
    COMPANY_CARD: "Company card",
    OTHER: "Other / needs classification",
    OWNER_ADVANCE: "Owner paid personally",
    PETTY_CASH: "Petty cash",
    POS_DRAWER: "POS drawer cash",
    STAFF_ADVANCE: "Staff paid personally",
  };
  return labels[value] ?? sentenceCase(value);
}

function formatDate(value: Date) {
  return value.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" });
}

function formatDateTime(value: Date) {
  return value.toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" });
}
