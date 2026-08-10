"use client";

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
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await staffApiFetch<{ ok: true; data: Overview }>("/api/employee-claims");
      setData(response.data);
      setSelectedCategoryId((current) => current || response.data.categories[0]?.id || "");
      setError(null);
    } catch (value) {
      if (value instanceof StaffApiError && isEmployeeSessionError(value.code)) {
        window.location.assign("/staff/login?reason=session-expired");
        return;
      }
      setError(value instanceof Error ? value.message : "Unable to load Claims.");
    } finally {
      setLoading(false);
    }
  }, []);

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
    try {
      await staffApiFetch("/api/employee-claims", { method: "POST", body });
      formElement.reset();
      setMessage("Claim submitted for manager review.");
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to submit Claim.");
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
        <p>EXPENSES</p><h1>My Claims</h1>
        <span>Submit MYR business expenses. Approval does not mean payment; reimbursement is tracked separately.</span>
      </section>
      {message ? <div className={styles.success} role="status">{message}</div> : null}
      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      <section className={styles.card}>
        <h2>New Claim</h2>
        {!data?.categories.length ? <p>Your company has not configured Claim categories yet. Contact HR.</p> : (
          <form onSubmit={submit} className={styles.form}>
            <label>Purpose<input name="purpose" required minLength={3} maxLength={500} placeholder="Why this expense was needed" /></label>
            <label>Category<select required value={selectedCategoryId} onChange={(event) => setSelectedCategoryId(event.target.value)}>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <div><label>Expense date<input name="expenseDate" type="date" required /></label><label>Merchant<input name="merchant" maxLength={160} /></label></div>
            <label>Description<textarea name="description" required minLength={3} maxLength={500} placeholder="What was purchased or travelled" /></label>
            {selected?.nature === "MILEAGE" ? (
              <label>Distance (km)<input name="mileageKm" type="number" min="0.01" step="0.01" required /><small>Company rate: RM {selected.mileageRatePerKm} / km. The amount is derived on the server.</small></label>
            ) : (
              <label>Amount (MYR)<input name="amount" type="number" min="0.01" step="0.01" required /><small>{selected?.maxLineAmount ? `Maximum RM ${selected.maxLineAmount}` : "MYR only"}</small></label>
            )}
            {selected?.nature === "MILEAGE" ? <input type="hidden" name="amount" value="0.01" /> : null}
            <label>Receipt {selected?.receiptRequired ? "(required)" : "(optional)"}<input name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required={selected?.receiptRequired} /><small>JPG, PNG, WebP or PDF; maximum 10 MB. Stored privately.</small></label>
            <button type="submit">Submit Claim</button>
          </form>
        )}
      </section>

      <section className={styles.card}>
        <h2>Claim history</h2>
        <div className={styles.list}>{data?.claims.length ? data.claims.map((claim) => (
          <article key={claim.id}>
            <header><div><strong>Claim {claim.claimNumber}</strong><span>{claim.purpose}</span></div><b data-status={claim.status}>{claim.status.replaceAll("_", " ")}</b></header>
            <p>Submitted RM {claim.submittedTotal} · Approved RM {claim.approvedTotal}</p>
            {claim.duplicateWarning ? <p className={styles.warning}>Possible duplicate warning recorded for review; it was not auto-rejected.</p> : null}
            {claim.lines.map((line) => <div className={styles.line} key={line.id}><span>{line.expenseDate} · {line.categoryNameSnapshot}</span><strong>RM {line.submittedAmount}</strong><small>{line.description} · {line.reviewStatus.replaceAll("_", " ")}{line.reviewReason ? ` · ${line.reviewReason}` : ""}</small>{line.attachments.map((attachment) => <a key={attachment.id} href={`/api/claims/attachments/${attachment.id}`} target="_blank" rel="noreferrer">View {attachment.sanitizedFileName}</a>)}</div>)}
            {claim.reimbursement ? <p>Reimbursement: {claim.reimbursement.status.replaceAll("_", " ")}{claim.reimbursement.channel ? ` · ${claim.reimbursement.channel.replaceAll("_", " ")}` : ""}</p> : null}
            {claim.reviewReason ? <p>Manager reason: {claim.reviewReason}</p> : null}
            {claim.withdrawalReason ? <p>Withdrawal reason: {claim.withdrawalReason}</p> : null}
            {claim.status === "SUBMITTED" ? <button type="button" onClick={() => void withdraw(claim.id, claim.revision)}>Withdraw</button> : null}
          </article>
        )) : <p>No Claims yet.</p>}</div>
      </section>
    </div>
  );
}
