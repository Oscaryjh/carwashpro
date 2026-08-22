"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isEmployeeSessionError, staffApiFetch, StaffApiError } from "@/lib/staff-pwa/client";
import styles from "./staff-claims.module.css";

type Overview = {
  employee: { fullName: string; employeeCode: string };
  categories: Array<{
    id: string;
    code: string;
    name: string;
    nature: "GENERAL" | "MILEAGE";
    receiptRequired: boolean;
    maxLineAmount: string | null;
    mileageRatePerKm: string | null;
  }>;
  claims: Array<{
    id: string;
    claimNumber: string;
    purpose: string;
    status: string;
    submittedTotal: string;
    approvedTotal: string;
    duplicateWarning: boolean;
    revision: number;
    submittedAt: string | null;
    reviewReason: string | null;
    withdrawalReason: string | null;
    lines: Array<{
      id: string;
      categoryNameSnapshot: string;
      expenseDate: string;
      description: string;
      submittedAmount: string;
      approvedAmount: string;
      reviewStatus: string;
      reviewReason: string | null;
      attachments: Array<{ id: string; sanitizedFileName: string }>;
    }>;
    reimbursement: { status: string; channel: string | null; amount: string; paymentReference: string | null } | null;
  }>;
};

export function StaffClaims() {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await staffApiFetch<{ ok: true; data: Overview }>("/api/employee-claims");
      setData(response.data);
      setSelectedCategoryId((current) => current || response.data.categories[0]?.id || "");
      setError(null);
    } catch (value) {
      if (value instanceof StaffApiError && isEmployeeSessionError(value.code)) {
        router.replace("/staff/login?reason=session-expired");
        return;
      }
      setError(value instanceof Error ? value.message : "Unable to load Claims.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);
  const selected = useMemo(() => data?.categories.find((category) => category.id === selectedCategoryId), [data, selectedCategoryId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = {
      clientRequestId: crypto.randomUUID(),
      purpose: form.get("purpose"),
      currency: "MYR",
      lines: [{
        lineNumber: 1,
        categoryId: selectedCategoryId,
        expenseDate: form.get("expenseDate"),
        merchant: form.get("merchant") || null,
        description: form.get("description"),
        amount: form.get("amount"),
        mileageKm: form.get("mileageKm") || null,
      }],
    };
    const body = new FormData();
    body.set("payload", JSON.stringify(payload));
    const receipt = form.get("receipt");
    if (receipt instanceof File && receipt.size > 0) body.set("receipt:1", receipt);
    setMessage(null);
    setError(null);
    setSubmitting(true);
    try {
      await staffApiFetch("/api/employee-claims", { method: "POST", body });
      formElement.reset();
      setMessage("Claim submitted for manager review.");
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to submit Claim.");
    } finally {
      setSubmitting(false);
    }
  }

  async function withdraw(claimId: string, expectedRevision: number) {
    const reason = window.prompt("Why are you withdrawing this submitted Claim?");
    if (!reason) return;
    try {
      await staffApiFetch("/api/employee-claims", {
        method: "DELETE",
        body: JSON.stringify({ claimId, expectedRevision, reason }),
      });
      setMessage("Claim withdrawn. Its immutable history remains available.");
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to withdraw Claim.");
    }
  }

  if (loading && !data) return <section className={styles.state}>Loading Claims...</section>;
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p>CLAIMS</p>
        <h1>Expenses</h1>
        <span>Submit a work expense and track its review.</span>
      </section>
      {message ? <div className={styles.success} role="status">{message}</div> : null}
      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      <section className={styles.card}>
        <header className={styles.sectionHeading}>
          <div><p>NEW CLAIM</p><h2>Expense details</h2></div>
        </header>
        {!data?.categories.length ? <p>Your company has not configured Claim categories yet. Contact HR.</p> : (
          <form onSubmit={submit} className={styles.form}>
            <label><span>Claim title</span><input autoComplete="off" name="purpose" required minLength={3} maxLength={500} placeholder="e.g. Client transport" /></label>
            <label><span>Category</span><select required value={selectedCategoryId} onChange={(event) => setSelectedCategoryId(event.target.value)}>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <div className={styles.formRow}><label><span>Expense date</span><input name="expenseDate" type="date" required /></label><label><span>Merchant <small>Optional</small></span><input autoComplete="organization" name="merchant" maxLength={160} placeholder="Business name" /></label></div>
            <label><span>Expense details</span><textarea name="description" required minLength={3} maxLength={500} placeholder="What did you purchase or pay for?" /></label>
            {selected?.nature === "MILEAGE" ? (
              <label><span>Distance</span><div className={styles.unitField}><input inputMode="decimal" name="mileageKm" type="number" min="0.01" step="0.01" required /><b>km</b></div><small>Company rate: RM {selected.mileageRatePerKm} per km. Your claim amount is calculated automatically.</small></label>
            ) : (
              <label><span>Amount</span><div className={styles.moneyField}><b>RM</b><input inputMode="decimal" name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required /></div>{selected?.maxLineAmount ? <small>Maximum RM {selected.maxLineAmount}</small> : null}</label>
            )}
            {selected?.nature === "MILEAGE" ? <input type="hidden" name="amount" value="0.01" /> : null}
            <label className={styles.receiptField}><span>Receipt <small>{selected?.receiptRequired ? "Required" : "Optional"}</small></span><input name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required={selected?.receiptRequired} /><small>JPG, PNG, WebP or PDF · Max 10 MB · Private</small></label>
            <button disabled={submitting} type="submit">{submitting ? "Submitting…" : "Submit expense"}</button>
          </form>
        )}
      </section>

      <section className={styles.card}>
        <header className={styles.sectionHeading}>
          <div><p>HISTORY</p><h2>Previous claims</h2></div>
          {data?.claims.length ? <span>{data.claims.length}</span> : null}
        </header>
        <div className={styles.list}>{data?.claims.length ? data.claims.map((claim) => (
          <article key={claim.id}>
            <header><div><small>CLAIM {claim.claimNumber}</small><strong>{claim.purpose}</strong></div><b data-status={claim.status}>{claim.status.replaceAll("_", " ")}</b></header>
            <p><strong>RM {claim.submittedTotal}</strong><span>Approved RM {claim.approvedTotal}</span></p>
            {claim.duplicateWarning ? <p className={styles.warning}>Possible duplicate warning recorded for review; it was not auto-rejected.</p> : null}
            {claim.lines.map((line) => <div className={styles.line} key={line.id}><span>{line.expenseDate} · {line.categoryNameSnapshot}</span><strong>RM {line.submittedAmount}</strong><small>{line.description} · {line.reviewStatus.replaceAll("_", " ")}{line.reviewReason ? ` · ${line.reviewReason}` : ""}</small>{line.attachments.map((attachment) => <a key={attachment.id} href={`/api/claims/attachments/${attachment.id}`} target="_blank" rel="noreferrer">View {attachment.sanitizedFileName}</a>)}</div>)}
            {claim.reimbursement ? <p>Reimbursement: {claim.reimbursement.status.replaceAll("_", " ")}{claim.reimbursement.channel ? ` · ${claim.reimbursement.channel.replaceAll("_", " ")}` : ""}</p> : null}
            {claim.reviewReason ? <p>Manager reason: {claim.reviewReason}</p> : null}
            {claim.withdrawalReason ? <p>Withdrawal reason: {claim.withdrawalReason}</p> : null}
            {claim.status === "SUBMITTED" ? <button type="button" onClick={() => void withdraw(claim.id, claim.revision)}>Withdraw</button> : null}
          </article>
        )) : <div className={styles.empty}><span aria-hidden="true">✓</span><strong>No claims yet</strong><small>Your submitted expenses will appear here.</small></div>}</div>
      </section>
    </div>
  );
}
