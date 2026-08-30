"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getEmployeeClaimStatus } from "@/lib/claim/presentation";
import { createBrowserUuid, isEmployeeSessionError, staffApiFetch, StaffApiError } from "@/lib/staff-pwa/client";
import styles from "./staff-claims.module.css";

type Overview = {
  employee: { fullName: string; employeeCode: string };
  categories: Array<{ id: string; code: string; name: string; nature: "GENERAL" | "MILEAGE"; receiptRequired: boolean; descriptionRequired: boolean; maxLineAmount: string | null; mileageRatePerKm: string | null }>;
  claims: Array<{
    id: string; claimNumber: string; purpose: string; status: string; submittedTotal: string; approvedTotal: string; duplicateWarning: boolean; revision: number; submittedAt: string | null; reviewReason: string | null; withdrawalReason: string | null;
    lines: Array<{ id: string; categoryNameSnapshot: string; expenseDate: string; description: string; merchant: string | null; submittedAmount: string; approvedAmount: string; reviewStatus: string; reviewReason: string | null; attachments: Array<{ id: string; sanitizedFileName: string }> }>;
    reimbursement: { status: string; channel: string | null; amount: string; paymentReference: string | null } | null;
  }>;
};

type Draft = { categoryId: string; expenseDate: string; amount: string; mileageKm: string; note: string; merchant: string };
const emptyDraft: Draft = { categoryId: "", expenseDate: "", amount: "", mileageKm: "", note: "", merchant: "" };

export function StaffClaims() {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
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
      setError(value instanceof Error ? value.message : "Claims could not be loaded. Try again.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);
  const selected = useMemo(() => data?.categories.find((category) => category.id === draft.categoryId), [data, draft.categoryId]);
  const calculatedMileage = selected?.nature === "MILEAGE" && selected.mileageRatePerKm && draft.mileageKm ? (Number(selected.mileageRatePerKm) * Number(draft.mileageKm)).toFixed(2) : null;

  function update<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  function continueFromStepOne() {
    if (!draft.categoryId || !draft.expenseDate) return setError("Choose a category and expense date to continue.");
    setStep(2);
  }

  function continueFromStepTwo() {
    if (selected?.nature === "MILEAGE" ? Number(draft.mileageKm) <= 0 : Number(draft.amount) <= 0) return setError(selected?.nature === "MILEAGE" ? "Enter the distance travelled." : "Enter the amount claimed.");
    if (selected?.descriptionRequired && draft.note.trim().length < 3) return setError("Add a short note explaining this expense.");
    if (selected?.receiptRequired && !receipt) return setError("Attach a receipt for this category.");
    setError(null);
    setStep(3);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const note = draft.note.trim() || `${selected.name} expense`;
    const payload = {
      clientRequestId: createBrowserUuid(), purpose: note, currency: "MYR",
      lines: [{ lineNumber: 1, categoryId: selected.id, expenseDate: draft.expenseDate, merchant: draft.merchant.trim() || null, description: note, amount: selected.nature === "MILEAGE" ? "0.01" : draft.amount, mileageKm: selected.nature === "MILEAGE" ? draft.mileageKm : null }],
    };
    const body = new FormData();
    body.set("payload", JSON.stringify(payload));
    if (receipt) body.set("receipt:1", receipt);
    setMessage(null); setError(null); setSubmitting(true);
    try {
      await staffApiFetch("/api/employee-claims", { method: "POST", body });
      const submittedAmount = selected.nature === "MILEAGE" ? calculatedMileage : Number(draft.amount).toFixed(2);
      const submittedDate = formatDate(draft.expenseDate);
      setDraft({ ...emptyDraft, categoryId: data?.categories[0]?.id ?? "" }); setReceipt(null); setStep(1);
      setMessage(`Submitted · RM ${submittedAmount ?? "0.00"} · ${selected.name} · ${submittedDate}. Next: Waiting for review.`);
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Claim could not be submitted. Check the details and try again.");
    } finally { setSubmitting(false); }
  }

  async function withdraw(claimId: string, expectedRevision: number) {
    const reason = window.prompt("Tell us why you want to withdraw this claim.");
    if (!reason?.trim()) return;
    try {
      await staffApiFetch("/api/employee-claims", { method: "DELETE", body: JSON.stringify({ claimId, expectedRevision, reason }) });
      setMessage("Claim withdrawn."); await load();
    } catch (value) { setError(value instanceof Error ? value.message : "Claim could not be withdrawn. Try again."); }
  }

  if (loading && !data) return <section className={styles.state}>Loading claims…</section>;
  return <div className={styles.page}>
    <section className={styles.hero}><p>EXPENSES</p><h1>My claims</h1><span>Submit a work expense and track it through approval and payment.</span></section>
    {message ? <div className={styles.success} role="status">{message}</div> : null}
    {error ? <div className={styles.error} role="alert">{error}</div> : null}

    <section className={styles.card}>
      <div className={styles.cardHeading}><div><h2>New claim</h2><span>Step {step} of 3</span></div><ol className={styles.steps}><li data-active={step >= 1}>Expense</li><li data-active={step >= 2}>Details</li><li data-active={step >= 3}>Review</li></ol></div>
      {!data?.categories.length ? <p>Your workplace has not added claim categories yet. Contact HR.</p> : <form onSubmit={submit} className={styles.form}>
        {step === 1 ? <div className={styles.stepPanel}>
          <label>Category<select required value={draft.categoryId} onChange={(event) => update("categoryId", event.target.value)}>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          {selected ? <div className={styles.policyHint} role="status"><strong>{selected.receiptRequired ? "Receipt required" : "Receipt optional"}</strong><span>{selected.nature === "MILEAGE" ? `Company rate: RM ${selected.mileageRatePerKm ?? "—"} / km` : selected.maxLineAmount ? `Maximum claim: RM ${selected.maxLineAmount}` : "No category amount limit"}</span></div> : null}
          <label>Expense date<input type="date" required value={draft.expenseDate} onChange={(event) => update("expenseDate", event.target.value)} /></label>
          <div className={styles.stepActions}><button type="button" onClick={continueFromStepOne}>Continue</button></div>
        </div> : null}
        {step === 2 ? <div className={styles.stepPanel}>
          {selected?.nature === "MILEAGE" ? <label>Distance travelled (km)<input type="number" min="0.01" step="0.01" value={draft.mileageKm} onChange={(event) => update("mileageKm", event.target.value)} /><small>Company rate: RM {selected.mileageRatePerKm} / km{calculatedMileage ? ` · Estimated reimbursement: RM ${calculatedMileage}` : ""}. Final amount is calculated by the system.</small></label> : <label>Amount (RM)<input type="number" min="0.01" step="0.01" value={draft.amount} onChange={(event) => update("amount", event.target.value)} /><small>{selected?.maxLineAmount ? `Maximum RM ${selected.maxLineAmount}` : "No category limit"}</small></label>}
          <label>Receipt {selected?.receiptRequired ? "(required)" : "(optional)"}<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setReceipt(event.target.files?.[0] ?? null)} /><small>JPG, PNG, WebP or PDF, up to 10 MB. Stored privately.</small></label>
          <label>Note {selected?.descriptionRequired ? "(required)" : "(optional)"}<textarea maxLength={500} value={draft.note} onChange={(event) => update("note", event.target.value)} placeholder="What was this expense for?" /></label>
          <label>Merchant (optional)<input maxLength={160} value={draft.merchant} onChange={(event) => update("merchant", event.target.value)} placeholder="Business or supplier name" /></label>
          <div className={styles.stepActions}><button className={styles.secondary} type="button" onClick={() => setStep(1)}>Back</button><button type="button" onClick={continueFromStepTwo}>Review claim</button></div>
        </div> : null}
        {step === 3 ? <div className={styles.stepPanel}>
          <div className={styles.reviewCard}><div><span>Category</span><strong>{selected?.name}</strong></div><div><span>Expense date</span><strong>{formatDate(draft.expenseDate)}</strong></div><div><span>Amount</span><strong>RM {selected?.nature === "MILEAGE" ? calculatedMileage : Number(draft.amount).toFixed(2)}</strong></div><div><span>Receipt</span><strong>{receipt?.name ?? "Not attached"}</strong></div>{draft.note ? <div className={styles.reviewWide}><span>Note</span><strong>{draft.note}</strong></div> : null}</div>
          <p className={styles.confirmation}>After submission, HR will review the claim. Approval and payment are tracked separately.</p>
          <div className={styles.stepActions}><button className={styles.secondary} type="button" onClick={() => setStep(2)}>Back</button><button type="submit" disabled={submitting}>{submitting ? "Submitting…" : "Submit claim"}</button></div>
        </div> : null}
      </form>}
    </section>

    <section className={styles.card}><h2>Claim history</h2><div className={styles.list}>{data?.claims.length ? data.claims.map((claim) => {
      const status = getEmployeeClaimStatus({ claimStatus: claim.status, reimbursementStatus: claim.reimbursement?.status });
      return <article key={claim.id}><header><div><strong>{claim.lines[0]?.categoryNameSnapshot ?? `Claim ${claim.claimNumber}`}</strong><span>{formatDate(claim.lines[0]?.expenseDate)} · RM {claim.submittedTotal}</span></div><b>{status}</b></header>
        <details><summary>View details</summary><div className={styles.historyDetail}>{claim.lines.map((line) => <div className={styles.line} key={line.id}><span>{line.categoryNameSnapshot}</span><strong>RM {line.submittedAmount}</strong><small>{line.description}{line.reviewReason ? ` · ${line.reviewReason}` : ""}</small>{line.attachments.map((attachment) => <a key={attachment.id} href={`/api/claims/attachments/${attachment.id}`} target="_blank" rel="noreferrer">View receipt</a>)}</div>)}{claim.reviewReason ? <p>HR note: {claim.reviewReason}</p> : null}{claim.withdrawalReason ? <p>Withdrawal note: {claim.withdrawalReason}</p> : null}</div></details>
        {claim.duplicateWarning ? <p className={styles.warning}>HR is checking whether this may be a duplicate.</p> : null}
        {claim.status === "SUBMITTED" ? <button type="button" onClick={() => void withdraw(claim.id, claim.revision)}>Withdraw claim</button> : null}
      </article>;
    }) : <p>No claims yet. Your submitted claims will appear here.</p>}</div></section>
  </div>;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}
