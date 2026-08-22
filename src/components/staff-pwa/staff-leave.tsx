"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { isEmployeeSessionError, staffApiFetch, StaffApiError } from "@/lib/staff-pwa/client";
import styles from "./staff-leave.module.css";

type Overview = {
  year: number;
  employee: { fullName: string; employeeCode: string };
  policies: Array<{
    id: string;
    name: string;
    payTreatment: "PAID" | "UNPAID";
    countMode: string;
    requiresDocument: boolean;
    balanceTracked: boolean;
    legalStatus: string;
    entitlementDays: number;
    usedDays: number;
    pendingDays: number;
    remainingDays: number | null;
    currentEntitlementDays: number;
    carryForwardDays: number;
    manualAdjustmentDays: number;
    carryForwardBuckets: Array<{
      remainingDays: number;
      expiresAt: string | null;
    }>;
    applicationReady: boolean;
    readinessCode: string | null;
  }>;
  requests: Array<{
    id: string;
    policyNameSnapshot: string;
    startsOn: string;
    endsOn: string;
    requestedDays: number;
    leaveUnit: string;
    status: string;
    revision: number;
    reason: string;
    reviewNote: string | null;
    cancellationReason: string | null;
    supportingEvidenceRequired: boolean;
    supportingEvidenceStatus: string;
    supportingDocuments: Array<{
      id: string;
      source: string;
      documentType: string;
      fileName: string;
      mimeType: string | null;
      byteLength: number | null;
      securityStatus: string;
      reviewStatus: string;
      reviewNote: string | null;
    }>;
  }>;
};

export function StaffLeave() {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPolicyId, setSelectedPolicyId] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await staffApiFetch<{ ok: true; data: Overview }>("/api/employee-leave");
      setData(response.data);
      setSelectedPolicyId((current) => current || response.data.policies.find((policy) => policy.applicationReady)?.id || "");
      setError(null);
    } catch (value) {
      if (value instanceof StaffApiError && isEmployeeSessionError(value.code)) {
        router.push("/staff/login?reason=session-expired");
        return;
      }
      setError(value instanceof Error ? value.message : "Unable to load Leave.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);
  const selectedPolicy = useMemo(() => data?.policies.find((policy) => policy.id === selectedPolicyId), [data, selectedPolicyId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setMessage(null);
    setError(null);
    try {
      const files = form.getAll("supportingDocument").filter((value): value is File => value instanceof File && value.size > 0);
      if (files.length > 5) throw new Error("Upload up to 5 supporting documents.");
      if (selectedPolicy?.requiresDocument && files.length === 0) throw new Error("Add a supporting document before submitting this Leave request.");
      const outgoing = new FormData();
      outgoing.set("payload", JSON.stringify({
        clientRequestId: crypto.randomUUID(),
        policyId: selectedPolicyId,
        startsOn: form.get("startsOn"),
        endsOn: form.get("endsOn"),
        leaveUnit: form.get("leaveUnit"),
        reason: form.get("reason"),
        documentReference: null,
      }));
      outgoing.set("documentType", String(form.get("documentType") || "SUPPORTING_DOCUMENT"));
      for (const file of files) outgoing.append("supportingDocument", file, file.name);
      await staffApiFetch("/api/employee-leave", {
        method: "POST",
        body: outgoing,
      });
      formElement.reset();
      setMessage("Leave application submitted for manager approval.");
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to submit Leave.");
    }
  }

  async function withdraw(requestId: string, expectedRevision: number) {
    const reason = window.prompt("Why are you withdrawing this pending Leave application?");
    if (!reason) return;
    try {
      await staffApiFetch("/api/employee-leave", { method: "DELETE", body: JSON.stringify({ requestId, expectedRevision, reason }) });
      setMessage("Pending Leave application withdrawn.");
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to withdraw Leave.");
    }
  }

  async function removeDocument(documentId: string) {
    if (!window.confirm("Remove this supporting document from the pending Leave request?")) return;
    try {
      await staffApiFetch(`/api/employee-leave/documents/${documentId}`, { method: "DELETE" });
      setMessage("Supporting document removed.");
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to remove supporting document.");
    }
  }

  async function addDocuments(requestId: string, event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const files = form.getAll("supportingDocument").filter((value): value is File => value instanceof File && value.size > 0);
    if (files.length === 0) {
      setError("Choose at least one supporting document.");
      return;
    }
    try {
      setError(null);
      await staffApiFetch(`/api/employee-leave/requests/${requestId}/documents`, { method: "POST", body: form });
      formElement.reset();
      setMessage("Supporting document added for manager review.");
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to add supporting document.");
    }
  }

  async function replaceDocument(documentId: string, event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = form.get("supportingDocument");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose one replacement document.");
      return;
    }
    try {
      setError(null);
      await staffApiFetch(`/api/employee-leave/documents/${documentId}`, { method: "PUT", body: form });
      formElement.reset();
      setMessage("Supporting document replaced for manager review.");
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to replace supporting document.");
    }
  }

  if (loading && !data) return <section className={styles.state}>Loading Leave...</section>;
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div><p>LEAVE</p><h1>Time off</h1><span>Check balances and submit a request.</span></div>
        <a className={styles.heroAction} href="#staff-leave-apply">
          <span aria-hidden="true">+</span>
          New request
        </a>
      </section>
      {message ? <div className={styles.success} role="status">{message}</div> : null}
      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      {data?.policies.length ? (
        <section className={styles.card}>
          <h2>Balances · {data.year}</h2>
          <div className={styles.balances}>
            {data.policies.filter((policy) => policy.balanceTracked).map((policy) => (
              <article className={styles.balanceCard} key={policy.id}>
                <div className={styles.balanceHeading}>
                  <div><span>LEAVE BALANCE</span><h3>{policy.name}</h3></div>
                  <div className={styles.remaining}><strong>{formatDays(policy.remainingDays ?? 0)}</strong><small>days remaining</small></div>
                </div>
                <dl className={styles.balanceFacts}>
                  <div><dt>{data.year} entitlement</dt><dd>{formatDays(policy.currentEntitlementDays)}</dd></div>
                  {policy.carryForwardDays > 0 ? <div><dt>Carry forward</dt><dd>{formatDays(policy.carryForwardDays)}</dd></div> : null}
                  <div><dt>Used</dt><dd>{formatDays(policy.usedDays)}</dd></div>
                  <div><dt>Pending</dt><dd>{formatDays(policy.pendingDays)}</dd></div>
                  {policy.manualAdjustmentDays !== 0 ? <div><dt>Balance adjustment</dt><dd>{formatSignedDays(policy.manualAdjustmentDays)}</dd></div> : null}
                </dl>
                {policy.carryForwardBuckets.map((bucket, index) => bucket.expiresAt ? (
                  <p className={styles.carryNotice} key={`${bucket.expiresAt}-${index}`}>
                    {formatDays(bucket.remainingDays)} carry-forward days expire on {formatDateValue(bucket.expiresAt)}.
                  </p>
                ) : null)}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.card} id="staff-leave-apply">
        <h2>New request</h2>
        {!data?.policies.length ? <p>Your company has not enabled Leave policies yet. Contact HR.</p> : (
          <form onSubmit={submit} className={styles.form}>
            <label>Leave type<select required value={selectedPolicyId} onChange={(event) => setSelectedPolicyId(event.target.value)}><option value="" disabled>Select a ready Leave type</option>{data.policies.map((policy) => <option value={policy.id} key={policy.id} disabled={!policy.applicationReady}>{policy.name} · {policy.payTreatment === "PAID" ? "Paid" : "Unpaid"}{policy.readinessCode ? ` · ${policy.readinessCode}` : ""}</option>)}</select></label>
            <div><label>From<input name="startsOn" type="date" required /></label><label>To<input name="endsOn" type="date" required /></label></div>
            <label>Duration<select name="leaveUnit"><option value="FULL_DAY">Full day / days</option><option value="HALF_DAY_AM">Half day · AM</option><option value="HALF_DAY_PM">Half day · PM</option></select></label>
            <label>Reason<textarea name="reason" minLength={3} maxLength={500} required placeholder="Tell your manager why you need Leave" /></label>
            <fieldset className={styles.documents}>
              <legend>Supporting documents {selectedPolicy?.requiresDocument ? <span>Required</span> : <small>Optional</small>}</legend>
              <p>Private HR evidence. PDF, JPG, PNG or WEBP · up to 10 MB each · maximum 5 files.</p>
              <label>Document type<select name="documentType" defaultValue={selectedPolicy?.name.toLowerCase().includes("medical") ? "MEDICAL_CERTIFICATE" : "SUPPORTING_DOCUMENT"}><option value="SUPPORTING_DOCUMENT">Supporting document</option><option value="MEDICAL_CERTIFICATE">Medical certificate</option><option value="HOSPITALISATION_SUPPORT">Hospitalisation support</option><option value="MATERNITY_SUPPORT">Maternity support</option><option value="PATERNITY_SUPPORT">Paternity support</option><option value="OTHER">Other evidence</option></select></label>
              <div className={styles.documentButtons}>
                <label className={styles.fileButton}>Take photo<input name="supportingDocument" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" /></label>
                <label className={styles.fileButtonSecondary}>Upload files<input name="supportingDocument" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple /></label>
              </div>
              <small>Files are stored privately. There is no public attachment link.</small>
            </fieldset>
            <p>{selectedPolicy?.countMode === "CALENDAR_DAYS" ? "This company policy counts calendar days." : "Only explicit expected workdays are counted; rest days and public holidays are excluded."}</p>
            <button type="submit" disabled={!selectedPolicy?.applicationReady}>Submit for approval</button>
          </form>
        )}
      </section>

      <section className={styles.card}>
        <h2>Request history</h2>
        <div className={styles.requests}>
          {data?.requests.length ? data.requests.map((request) => (
            <article key={request.id} className={styles.requestCard}>
              <div className={styles.requestSummary}>
                <strong>{request.policyNameSnapshot}</strong>
                <span>{formatDateValue(request.startsOn)} — {formatDateValue(request.endsOn)} · {request.requestedDays} day(s) · {request.leaveUnit.replaceAll("_", " ")}</span>
                <small>{request.cancellationReason ? `Cancellation: ${request.cancellationReason}` : request.reviewNote ? `Manager note: ${request.reviewNote}` : request.reason}</small>
              </div>
              <div className={styles.requestStatus}>
                <b className={styles[request.status.toLowerCase()]}>{request.status}</b>
                {request.status === "PENDING" ? <button type="button" onClick={() => void withdraw(request.id, request.revision)}>Withdraw</button> : null}
              </div>

              <div className={styles.requestDocuments}>
                <div className={styles.requestDocumentsHeading}>
                  <strong>Supporting evidence</strong>
                  <span>{evidenceStatusLabel(request.supportingEvidenceStatus)}</span>
                </div>
                {request.supportingEvidenceRequired && request.supportingDocuments.length === 0 ? (
                  <p className={styles.documentWarning}>A supporting document is required before this request can be approved.</p>
                ) : null}
                {request.supportingDocuments.map((document) => (
                  <div className={styles.requestDocument} key={document.id}>
                    <div>
                      <a href={`/api/employee-leave/documents/${document.id}`} target="_blank" rel="noreferrer">{document.fileName}</a>
                      <small>{documentTypeLabel(document.documentType)} · {formatDocumentSize(document.byteLength)} · {evidenceStatusLabel(document.reviewStatus)}</small>
                      {document.reviewNote ? <small>Review note: {document.reviewNote}</small> : null}
                    </div>
                    {request.status === "PENDING" ? (
                      <div className={styles.documentActions}>
                        <form onSubmit={(event) => void replaceDocument(document.id, event)}>
                          <input type="hidden" name="documentType" value={document.documentType} />
                          <label className={styles.replaceFile}>Replace<input name="supportingDocument" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required /></label>
                          <button type="submit">Save</button>
                        </form>
                        <button type="button" onClick={() => void removeDocument(document.id)}>Remove</button>
                      </div>
                    ) : null}
                  </div>
                ))}
                {request.status === "PENDING" && request.supportingDocuments.length < 5 ? (
                  <form className={styles.addDocumentForm} onSubmit={(event) => void addDocuments(request.id, event)}>
                    <select name="documentType" aria-label="Document type" defaultValue="SUPPORTING_DOCUMENT">
                      <option value="SUPPORTING_DOCUMENT">Supporting document</option>
                      <option value="MEDICAL_CERTIFICATE">Medical certificate</option>
                      <option value="HOSPITALISATION_SUPPORT">Hospitalisation support</option>
                      <option value="MATERNITY_SUPPORT">Maternity support</option>
                      <option value="PATERNITY_SUPPORT">Paternity support</option>
                      <option value="OTHER">Other evidence</option>
                    </select>
                    <label className={styles.fileButtonSecondary}>Choose files<input name="supportingDocument" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple required /></label>
                    <button type="submit">Add document</button>
                  </form>
                ) : null}
              </div>
            </article>
          )) : <p>No requests yet.</p>}
        </div>
      </section>
    </div>
  );
}

function formatDays(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatSignedDays(value: number) {
  return `${value > 0 ? "+" : ""}${formatDays(value)}`;
}

function formatDateValue(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function evidenceStatusLabel(value: string) {
  return ({
    NOT_REVIEWED: "Awaiting review",
    VERIFIED: "Verified",
    REVIEW_REQUIRED: "Follow-up required",
    REJECTED: "Rejected",
  } as Record<string, string>)[value] ?? value.replaceAll("_", " ").toLowerCase();
}

function documentTypeLabel(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}

function formatDocumentSize(value: number | null) {
  if (!value) return "Reference only";
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
