"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatEmployeeClaimAmount,
  getEmployeeClaimApprovalStatus,
  getEmployeeClaimPaymentStatus,
  getEmployeeClaimStatus,
} from "@/lib/claim/presentation";
import { createBrowserUuid, isEmployeeSessionError, staffApiFetch, StaffApiError } from "@/lib/staff-pwa/client";
import { useStaffShell } from "./staff-pwa-chrome";
import {
  StaffV2AttachmentRow,
  StaffV2DetailSection,
  StaffV2EmptyState,
  StaffV2FormSection,
  StaffV2PageHeader,
  StaffV2SectionLabel,
  StaffV2StatusBadge,
  StaffV2StickyActionBar,
  staffV2Styles,
} from "./staff-v2-primitives";
import styles from "./staff-claims.module.css";

const RECENT_CLAIM_LIMIT = 3;

type ClaimCategory = {
  id: string;
  code: string;
  name: string;
  nature: "GENERAL" | "MILEAGE";
  receiptRequired: boolean;
  descriptionRequired: boolean;
  maxLineAmount: string | null;
  mileageRatePerKm: string | null;
};

type ClaimLine = {
  id: string;
  categoryNameSnapshot: string;
  expenseDate: string;
  description: string;
  merchant: string | null;
  submittedAmount: string;
  approvedAmount: string;
  reviewStatus: string;
  reviewReason: string | null;
  attachments: Array<{ id: string; sanitizedFileName: string }>;
};

type Claim = {
  id: string;
  claimNumber: string;
  purpose: string;
  currency: string;
  status: string;
  submittedTotal: string;
  approvedTotal: string;
  duplicateWarning: boolean;
  revision: number;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  withdrawalReason: string | null;
  createdAt: string;
  lines: ClaimLine[];
  reimbursement: {
    status: string;
    channel: string | null;
    amount: string;
    paymentReference: string | null;
    paidAt: string | null;
  } | null;
};

type Overview = {
  employee: { fullName: string; employeeCode: string };
  categories: ClaimCategory[];
  claims: Claim[];
};

type Draft = { categoryId: string; expenseDate: string; amount: string; mileageKm: string; note: string; merchant: string };
const emptyDraft: Draft = { categoryId: "", expenseDate: "", amount: "", mileageKm: "", note: "", merchant: "" };

export function StaffClaims() {
  const router = useRouter();
  const { setTaskNavigationHidden } = useStaffShell();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"landing" | "new">("landing");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [showMore, setShowMore] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [receipt, setReceipt] = useState<File | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await staffApiFetch<{ ok: true; data: Overview }>("/api/employee-claims");
      setData(response.data);
      setDraft((current) => ({ ...current, categoryId: current.categoryId || response.data.categories[0]?.id || "" }));
      setError(null);
    } catch (value) {
      if (value instanceof StaffApiError && isEmployeeSessionError(value.code)) {
        router.push("/staff/login?reason=session-expired");
        return;
      }
      setError("Claims couldn't load.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setTaskNavigationHidden(mode === "new");
    return () => setTaskNavigationHidden(false);
  }, [mode, setTaskNavigationHidden]);

  const selected = useMemo(() => data?.categories.find((category) => category.id === draft.categoryId), [data, draft.categoryId]);
  const displayedClaims = showMore ? data?.claims ?? [] : (data?.claims ?? []).slice(0, RECENT_CLAIM_LIMIT);

  function update<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  function startNewClaim() {
    setMessage(null);
    setError(null);
    setStep(1);
    setMode("new");
  }

  function leaveTask() {
    setError(null);
    setStep(1);
    setMode("landing");
  }

  function continueFromStepOne() {
    if (!draft.categoryId || !draft.expenseDate) return setError("Choose a category and expense date to continue.");
    if (selected?.nature === "MILEAGE" ? Number(draft.mileageKm) <= 0 : Number(draft.amount) <= 0) {
      return setError(selected?.nature === "MILEAGE" ? "Enter the distance travelled." : "Enter the amount claimed.");
    }
    setError(null);
    setStep(2);
  }

  function continueFromStepTwo() {
    if (selected?.descriptionRequired && draft.note.trim().length < 3) return setError("Add a short reason explaining this expense.");
    if (selected?.receiptRequired && !receipt) return setError("Attach a receipt for this category.");
    setError(null);
    setStep(3);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const note = draft.note.trim() || `${selected.name} expense`;
    const payload = {
      clientRequestId: createBrowserUuid(),
      purpose: note,
      currency: "MYR",
      lines: [{
        lineNumber: 1,
        categoryId: selected.id,
        expenseDate: draft.expenseDate,
        merchant: draft.merchant.trim() || null,
        description: note,
        amount: selected.nature === "MILEAGE" ? "0.01" : draft.amount,
        mileageKm: selected.nature === "MILEAGE" ? draft.mileageKm : null,
      }],
    };
    const body = new FormData();
    body.set("payload", JSON.stringify(payload));
    if (receipt) body.set("receipt:1", receipt);
    setMessage(null);
    setError(null);
    setSubmitting(true);
    try {
      await staffApiFetch("/api/employee-claims", { method: "POST", body });
      setDraft({ ...emptyDraft, categoryId: data?.categories[0]?.id ?? "" });
      setReceipt(null);
      setStep(1);
      setMode("landing");
      setMessage("Claim submitted. Next: Waiting for review.");
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Claim couldn't be submitted. Check the details and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function withdraw(claimId: string, expectedRevision: number) {
    const reason = window.prompt("Why are you withdrawing this pending claim?");
    if (!reason?.trim()) return;
    try {
      await staffApiFetch("/api/employee-claims", { method: "DELETE", body: JSON.stringify({ claimId, expectedRevision, reason }) });
      setMessage("Claim withdrawn.");
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Claim couldn't be withdrawn. Try again.");
    }
  }

  if (mode === "new") {
    return (
      <NewClaimTask
        data={data}
        draft={draft}
        error={error}
        onBack={leaveTask}
        onContinueOne={continueFromStepOne}
        onContinueTwo={continueFromStepTwo}
        onReceipt={setReceipt}
        onStep={setStep}
        onSubmit={submit}
        onUpdate={update}
        receipt={receipt}
        selected={selected}
        step={step}
        submitting={submitting}
      />
    );
  }

  return (
    <section aria-label="Claims" className={`${staffV2Styles.scope} ${styles.page}`}>
      <StaffV2PageHeader title="Claims" meta="Submit expenses and track approval and payment." />

      {message ? <div className={styles.success} role="status">{message}</div> : null}
      {error ? <div className={styles.error} role="alert"><span>{error}</span><button onClick={() => void load()} type="button">Try again</button></div> : null}

      <button className={styles.newClaimAction} disabled={!data?.categories.length} onClick={startNewClaim} type="button">
        <span aria-hidden="true">＋</span>
        <strong>New claim</strong>
        <i aria-hidden="true">›</i>
      </button>

      <section aria-labelledby="recent-claims-title">
        <StaffV2SectionLabel id="recent-claims-title">Recent claims</StaffV2SectionLabel>
        {loading && !data ? <ClaimsLoadingRows /> : displayedClaims.length ? (
          <div className={styles.claimList} role="list">
            {displayedClaims.map((claim) => <ClaimHistoryItem claim={claim} key={claim.id} onWithdraw={withdraw} />)}
          </div>
        ) : (
          <div className={styles.emptyWrap}>
            <StaffV2EmptyState title="No claims yet." description="Your submitted claims will appear here." />
            <button onClick={startNewClaim} type="button">New claim</button>
          </div>
        )}
        {(data?.claims.length ?? 0) > RECENT_CLAIM_LIMIT ? (
          <button className={styles.showMore} onClick={() => setShowMore((current) => !current)} type="button">
            {showMore ? "Show fewer recent claims" : "Show more recent claims"}<span aria-hidden="true">›</span>
          </button>
        ) : null}
      </section>
    </section>
  );
}

function ClaimHistoryItem({ claim, onWithdraw }: { claim: Claim; onWithdraw: (claimId: string, expectedRevision: number) => Promise<void> }) {
  const input = { claimStatus: claim.status, reimbursementStatus: claim.reimbursement?.status };
  const combinedStatus = getEmployeeClaimStatus(input);
  const approvalStatus = getEmployeeClaimApprovalStatus(input);
  const paymentStatus = getEmployeeClaimPaymentStatus(input);
  const firstLine = claim.lines[0];
  const claimDate = firstLine?.expenseDate ?? claim.submittedAt ?? claim.createdAt;

  return (
    <details className={styles.claimItem} role="listitem">
      <summary aria-label={`View ${firstLine?.categoryNameSnapshot ?? claim.claimNumber}, ${formatEmployeeClaimAmount(claim.submittedTotal, claim.currency)}, ${combinedStatus}`}>
        <time dateTime={claimDate.slice(0, 10)}>{formatShortDate(claimDate)}</time>
        <span className={styles.claimRowCopy}>
          <strong>{firstLine?.categoryNameSnapshot ?? `Claim ${claim.claimNumber}`}</strong>
          <small>{combinedStatus}</small>
        </span>
        <b>{formatEmployeeClaimAmount(claim.submittedTotal, claim.currency)}</b>
        <i aria-hidden="true">›</i>
      </summary>

      <div className={styles.claimDetail}>
        <header className={styles.detailLead}>
          <span>{firstLine?.categoryNameSnapshot ?? `Claim ${claim.claimNumber}`}</span>
          <strong>{formatEmployeeClaimAmount(claim.submittedTotal, claim.currency)}</strong>
        </header>

        <StaffV2DetailSection title="Approval">
          <div className={styles.statusFact}>
            <span>Status</span>
            <StaffV2StatusBadge tone={approvalTone(claim.status)}>{approvalStatus}</StaffV2StatusBadge>
          </div>
        </StaffV2DetailSection>

        {paymentStatus ? (
          <StaffV2DetailSection title="Payment">
            <div className={styles.statusFact}>
              <span>Status</span>
              <StaffV2StatusBadge tone={paymentTone(paymentStatus)}>{paymentStatus}</StaffV2StatusBadge>
            </div>
          </StaffV2DetailSection>
        ) : null}

        <StaffV2DetailSection title="Claim details">
          <dl className={styles.detailFacts}>
            <div><dt>Date</dt><dd>{formatDate(claimDate)}</dd></div>
            <div><dt>Category</dt><dd>{firstLine?.categoryNameSnapshot ?? "—"}</dd></div>
            <div><dt>Reason</dt><dd>{firstLine?.description || claim.purpose || "—"}</dd></div>
            {firstLine?.merchant ? <div><dt>Merchant</dt><dd>{firstLine.merchant}</dd></div> : null}
          </dl>
        </StaffV2DetailSection>

        {claim.lines.some((line) => line.attachments.length) ? (
          <StaffV2DetailSection title="Receipt">
            <div className={styles.attachmentList}>
              {claim.lines.flatMap((line) => line.attachments).map((attachment) => (
                <StaffV2AttachmentRow
                  action={<a aria-label={`View receipt ${attachment.sanitizedFileName}`} href={`/api/claims/attachments/${attachment.id}`} target="_blank" rel="noreferrer">View</a>}
                  fileName={attachment.sanitizedFileName}
                  key={attachment.id}
                  status="Receipt attached"
                />
              ))}
            </div>
          </StaffV2DetailSection>
        ) : null}

        {claim.reviewReason || firstLine?.reviewReason ? (
          <StaffV2DetailSection title="Decision">
            <dl className={styles.detailFacts}><div><dt>Review note</dt><dd>{claim.reviewReason ?? firstLine?.reviewReason}</dd></div></dl>
          </StaffV2DetailSection>
        ) : null}

        {claim.duplicateWarning ? <p className={styles.warning}>Your workplace is checking whether this may be a duplicate claim.</p> : null}
        {claim.status === "SUBMITTED" ? <div className={styles.withdrawRow}><button onClick={() => void onWithdraw(claim.id, claim.revision)} type="button">Withdraw claim</button></div> : null}
      </div>
    </details>
  );
}

type NewClaimTaskProps = {
  data: Overview | null;
  draft: Draft;
  error: string | null;
  onBack: () => void;
  onContinueOne: () => void;
  onContinueTwo: () => void;
  onReceipt: (file: File | null) => void;
  onStep: (step: 1 | 2 | 3) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onUpdate: <K extends keyof Draft>(field: K, value: Draft[K]) => void;
  receipt: File | null;
  selected: ClaimCategory | undefined;
  step: 1 | 2 | 3;
  submitting: boolean;
};

function NewClaimTask({ data, draft, error, onBack, onContinueOne, onContinueTwo, onReceipt, onStep, onSubmit, onUpdate, receipt, selected, step, submitting }: NewClaimTaskProps) {
  const stepTitle = step === 1 ? "Claim details" : step === 2 ? "Receipt & reason" : "Review & submit";
  return (
    <section aria-label="New claim" className={`${staffV2Styles.scope} ${styles.page} ${styles.taskPage}`}>
      <div className={styles.taskHeader}>
        <StaffV2PageHeader
          leading={<button aria-label="Back to Claims" className={styles.backAction} onClick={onBack} type="button">‹</button>}
          title="New claim"
          meta={`Step ${step} of 3 · ${stepTitle}`}
        />
        <ol aria-label="Claim submission progress" className={styles.steps}>
          <li aria-current={step === 1 ? "step" : undefined} data-active={step >= 1}>Details</li>
          <li aria-current={step === 2 ? "step" : undefined} data-active={step >= 2}>Receipt</li>
          <li aria-current={step === 3 ? "step" : undefined} data-active={step >= 3}>Review</li>
        </ol>
      </div>

      {!data?.categories.length ? (
        <StaffV2EmptyState title="Claims aren't ready yet." description="Your workplace has not added a claim category. Contact HR." />
      ) : (
        <form aria-describedby={error ? "claim-form-error" : undefined} className={styles.form} onSubmit={onSubmit}>
          <div className={styles.formBody}>
            {step === 1 ? (
              <StaffV2FormSection title="Claim details">
                <label className={styles.field}>Category
                  <select required value={draft.categoryId} onChange={(event) => onUpdate("categoryId", event.target.value)}>
                    {data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                </label>
                {selected ? (
                  <p className={styles.policyHint}>
                    <strong>{selected.receiptRequired ? "Receipt required" : "Receipt optional"}</strong>
                    <span>{selected.nature === "MILEAGE" ? `Company rate ${formatEmployeeClaimAmount(selected.mileageRatePerKm ?? 0)} / km` : selected.maxLineAmount ? `Limit ${formatEmployeeClaimAmount(selected.maxLineAmount)}` : "No category amount limit"}</span>
                  </p>
                ) : null}
                <label className={styles.field}>Expense date
                  <input required type="date" value={draft.expenseDate} onChange={(event) => onUpdate("expenseDate", event.target.value)} />
                </label>
                {selected?.nature === "MILEAGE" ? (
                  <label className={styles.field}>Distance travelled (km)
                    <input inputMode="decimal" min="0.01" required step="0.01" type="number" value={draft.mileageKm} onChange={(event) => onUpdate("mileageKm", event.target.value)} />
                    <small>The final amount is calculated by the system using your company&apos;s rate.</small>
                  </label>
                ) : (
                  <label className={styles.field}>Amount (RM)
                    <input inputMode="decimal" min="0.01" required step="0.01" type="number" value={draft.amount} onChange={(event) => onUpdate("amount", event.target.value)} />
                  </label>
                )}
                <label className={styles.field}>Merchant <span>(optional)</span>
                  <input maxLength={160} value={draft.merchant} onChange={(event) => onUpdate("merchant", event.target.value)} placeholder="Business or supplier name" />
                </label>
              </StaffV2FormSection>
            ) : null}

            {step === 2 ? (
              <StaffV2FormSection title="Receipt & reason">
                <div className={styles.receiptControl}>
                  <span className={styles.fieldLabel}>Receipt {selected?.receiptRequired ? "(required)" : "(optional)"}</span>
                  <label className={styles.fileButton}>
                    <span>{receipt ? "Replace receipt" : "Upload receipt"}</span>
                    <input aria-label={receipt ? `Replace receipt ${receipt.name}` : "Upload receipt"} accept="image/jpeg,image/png,image/webp,application/pdf" type="file" onChange={(event) => onReceipt(event.target.files?.[0] ?? null)} />
                  </label>
                  {receipt ? <StaffV2AttachmentRow fileName={receipt.name} status="Ready to submit" /> : null}
                  <small>JPG, PNG, WebP or PDF, up to 10 MB. Stored privately.</small>
                </div>
                <label className={styles.field}>Reason {selected?.descriptionRequired ? "(required)" : "(optional)"}
                  <textarea maxLength={500} placeholder="What was this expense for?" value={draft.note} onChange={(event) => onUpdate("note", event.target.value)} />
                </label>
              </StaffV2FormSection>
            ) : null}

            {step === 3 ? (
              <StaffV2FormSection title="Review & submit">
                <dl className={styles.reviewFacts}>
                  <div><dt>Category</dt><dd>{selected?.name}</dd></div>
                  <div><dt>Date</dt><dd>{formatDate(draft.expenseDate)}</dd></div>
                  <div><dt>Amount</dt><dd>{selected?.nature === "MILEAGE" ? `${draft.mileageKm} km · Calculated by company rate` : formatEmployeeClaimAmount(draft.amount)}</dd></div>
                  {draft.merchant ? <div><dt>Merchant</dt><dd>{draft.merchant}</dd></div> : null}
                  <div><dt>Reason</dt><dd>{draft.note || `${selected?.name} expense`}</dd></div>
                </dl>
                {receipt ? <StaffV2AttachmentRow fileName={receipt.name} status="Receipt ready" /> : <p className={styles.noReceipt}>No receipt attached.</p>}
                <p className={styles.confirmation}>After submission, approval and payment will be tracked separately.</p>
              </StaffV2FormSection>
            ) : null}
          </div>

          {error ? <div className={styles.formError} id="claim-form-error" role="alert">{error}</div> : null}
          <StaffV2StickyActionBar>
            <div className={styles.taskActions}>
              {step > 1 ? <button className={styles.secondaryAction} onClick={() => onStep(step === 3 ? 2 : 1)} type="button">Back</button> : null}
              {step === 1 ? <button className={styles.primaryAction} onClick={onContinueOne} type="button">Continue</button> : null}
              {step === 2 ? <button className={styles.primaryAction} onClick={onContinueTwo} type="button">Review claim</button> : null}
              {step === 3 ? <button className={styles.primaryAction} disabled={submitting} type="submit">{submitting ? "Submitting…" : "Submit claim"}</button> : null}
            </div>
          </StaffV2StickyActionBar>
        </form>
      )}
    </section>
  );
}

function ClaimsLoadingRows() {
  return <div aria-label="Loading recent claims" className={styles.loadingRows} role="status">{[0, 1, 2].map((row) => <span key={row} />)}</div>;
}

function approvalTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "REJECTED" || status === "WITHDRAWN") return "danger";
  if (status === "SUBMITTED") return "warning";
  if (["APPROVED", "PARTIALLY_APPROVED"].includes(status)) return "success";
  return "neutral";
}

function paymentTone(status?: string | null): "neutral" | "success" | "warning" | "danger" | "info" {
  if (["Paid", "Included in finalized payroll"].includes(status ?? "")) return "success";
  if (status === "Cancelled") return "danger";
  if (["Payment processing", "Added to payroll"].includes(status ?? "")) return "info";
  return "warning";
}

function formatShortDate(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short" }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}
