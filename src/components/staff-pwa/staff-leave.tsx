"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserUuid, isEmployeeSessionError, staffApiFetch, StaffApiError } from "@/lib/staff-pwa/client";
import {
  formatLeaveDate,
  formatLeaveDateRange,
  formatLeaveUnits,
  leaveDecisionPresentation,
  leaveEvidencePresentation,
  leaveRowStatus,
  sortLeaveBalances,
} from "@/lib/staff-pwa/leave-v2";
import { StaffDatePicker } from "./staff-date-picker";
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
import styles from "./staff-leave.module.css";

const MAX_LEAVE_DOCUMENTS = 5;
const MAX_LEAVE_DOCUMENT_BYTES = 10 * 1024 * 1024;
const RECENT_REQUEST_LIMIT = 3;

type LeaveDocument = {
  id: string;
  source: string;
  documentType: string;
  fileName: string;
  mimeType: string | null;
  byteLength: number | null;
  securityStatus: string;
  reviewStatus: string;
  reviewNote: string | null;
};

type LeaveRequest = {
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
  supportingDocuments: LeaveDocument[];
};

type LeavePolicy = {
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
  carryForwardBuckets: Array<{ remainingDays: number; expiresAt: string | null }>;
  applicationReady: boolean;
  readinessCode: string | null;
};

type Overview = {
  year: number;
  employee: { fullName: string; employeeCode: string };
  policies: LeavePolicy[];
  requests: LeaveRequest[];
};

export function StaffLeave({ view = "overview" }: { view?: "overview" | "new-request" }) {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [documentBusy, setDocumentBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPolicyId, setSelectedPolicyId] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [durationMode, setDurationMode] = useState<"FULL_DAY" | "HALF_DAY">("FULL_DAY");
  const [halfDayPeriod, setHalfDayPeriod] = useState<"AM" | "PM">("AM");
  const [cameraDocumentNames, setCameraDocumentNames] = useState<string[]>([]);
  const [uploadedDocumentNames, setUploadedDocumentNames] = useState<string[]>([]);

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
      setError("Leave couldn't load.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  const selectedPolicy = useMemo(
    () => data?.policies.find((policy) => policy.id === selectedPolicyId),
    [data, selectedPolicyId],
  );
  const trackedPolicies = useMemo(
    () => sortLeaveBalances((data?.policies ?? []).filter((policy) => policy.balanceTracked)),
    [data?.policies],
  );
  const selectedDocumentNames = [...cameraDocumentNames, ...uploadedDocumentNames];
  const leaveUnit = durationMode === "FULL_DAY" ? "FULL_DAY" : `HALF_DAY_${halfDayPeriod}`;
  const durationPreview = selectedDurationPreview({ startsOn, endsOn, leaveUnit, countMode: selectedPolicy?.countMode });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setMessage(null);
    setError(null);
    setSubmitting(true);
    try {
      const files = selectedFiles(form);
      validateSelectedFiles(files);
      if (selectedPolicy?.requiresDocument && files.length === 0) throw new Error("Add a supporting document before submitting this leave request.");
      if (!startsOn || !endsOn) throw new Error("Choose the start and end dates for this leave request.");
      const outgoing = new FormData();
      outgoing.set("payload", JSON.stringify({
        clientRequestId: createBrowserUuid(),
        policyId: selectedPolicyId,
        startsOn,
        endsOn,
        leaveUnit,
        reason: form.get("reason"),
        documentReference: null,
      }));
      outgoing.set("documentType", String(form.get("documentType") || "SUPPORTING_DOCUMENT"));
      for (const file of files) outgoing.append("supportingDocument", file, file.name);
      await staffApiFetch("/api/employee-leave", { method: "POST", body: outgoing });
      formElement.reset();
      setStartsOn("");
      setEndsOn("");
      setDurationMode("FULL_DAY");
      setHalfDayPeriod("AM");
      setCameraDocumentNames([]);
      setUploadedDocumentNames([]);
      setMessage("Leave request submitted for manager review.");
      await load();
    } catch (value) {
      setError(actionError(value, "Leave request couldn't be submitted."));
    } finally {
      setSubmitting(false);
    }
  }

  async function withdraw(requestId: string, expectedRevision: number) {
    const reason = window.prompt("Why are you withdrawing this pending leave request?");
    if (!reason) return;
    setDocumentBusy(`withdraw-${requestId}`);
    try {
      await staffApiFetch("/api/employee-leave", {
        method: "DELETE",
        body: JSON.stringify({ requestId, expectedRevision, reason }),
      });
      setMessage("Pending leave request withdrawn.");
      await load();
    } catch (value) {
      setError(actionError(value, "Leave request couldn't be withdrawn."));
    } finally {
      setDocumentBusy(null);
    }
  }

  async function removeDocument(documentId: string) {
    if (!window.confirm("Remove this supporting document from the pending leave request?")) return;
    setDocumentBusy(`remove-${documentId}`);
    try {
      await staffApiFetch(`/api/employee-leave/documents/${documentId}`, { method: "DELETE" });
      setMessage("Supporting document removed.");
      await load();
    } catch (value) {
      setError(actionError(value, "Supporting document couldn't be removed."));
    } finally {
      setDocumentBusy(null);
    }
  }

  async function addDocuments(requestId: string, event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const files = selectedFiles(form);
      validateSelectedFiles(files);
      if (files.length === 0) throw new Error("Choose at least one supporting document.");
      setDocumentBusy(`add-${requestId}`);
      setError(null);
      await staffApiFetch(`/api/employee-leave/requests/${requestId}/documents`, { method: "POST", body: form });
      formElement.reset();
      setMessage("Supporting document added for review.");
      await load();
    } catch (value) {
      setError(actionError(value, "Supporting document couldn't be added."));
    } finally {
      setDocumentBusy(null);
    }
  }

  async function replaceDocument(documentId: string, event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const files = selectedFiles(form);
      validateSelectedFiles(files);
      if (files.length !== 1) throw new Error("Choose one replacement document.");
      setDocumentBusy(`replace-${documentId}`);
      setError(null);
      await staffApiFetch(`/api/employee-leave/documents/${documentId}`, { method: "PUT", body: form });
      formElement.reset();
      setMessage("Supporting document replaced for review.");
      await load();
    } catch (value) {
      setError(actionError(value, "Supporting document couldn't be replaced."));
    } finally {
      setDocumentBusy(null);
    }
  }

  if (loading && !data) return <LeaveLoading view={view} />;

  if (view === "new-request") {
    return (
      <section aria-label="New leave request" className={`${staffV2Styles.scope} ${styles.page} ${styles.requestPage}`}>
        <StaffV2PageHeader
          leading={<Link className={styles.backAction} href="/staff/leave" aria-label="Back to Leave">‹</Link>}
          title="New leave request"
          meta="Complete the details for your manager to review."
        />
        <Feedback message={message} error={error} retry={error === "Leave couldn't load." ? load : undefined} />
        {renderRequestForm()}
      </section>
    );
  }

  return (
    <section aria-label="Leave" className={`${staffV2Styles.scope} ${styles.page}`}>
      <StaffV2PageHeader title="Leave" meta="Balances, requests and time off." />
      <Link className={styles.primaryAction} href="/staff/leave/new">New leave request <span aria-hidden="true">›</span></Link>
      <Feedback message={message} error={error} retry={error === "Leave couldn't load." ? load : undefined} />

      {trackedPolicies.length ? (
        <section aria-labelledby="leave-balances-heading">
          <StaffV2SectionLabel id="leave-balances-heading">Balances</StaffV2SectionLabel>
          <div className={styles.balanceGroup} role="list" aria-label={`${data?.year ?? "Current"} leave balances`}>
            {trackedPolicies.slice(0, 2).map((policy) => <BalanceRow key={policy.id} policy={policy} />)}
          </div>
          <details className={styles.balanceDetails}>
            <summary>View all balances <span aria-hidden="true">›</span></summary>
            <div className={styles.balanceDetailBody}>
              {trackedPolicies.map((policy) => <BalanceDetail key={policy.id} policy={policy} year={data?.year ?? new Date().getFullYear()} />)}
            </div>
          </details>
        </section>
      ) : null}

      <section aria-labelledby="leave-recent-heading">
        <StaffV2SectionLabel id="leave-recent-heading">Recent requests</StaffV2SectionLabel>
        {data?.requests.length ? (
          <>
            <div className={styles.requestGroup} role="list" aria-label="Recent leave requests">
              {data.requests.slice(0, RECENT_REQUEST_LIMIT).map((request) => (
                <LeaveRequestDetails
                  addDocuments={addDocuments}
                  documentBusy={documentBusy}
                  key={request.id}
                  removeDocument={removeDocument}
                  replaceDocument={replaceDocument}
                  request={request}
                  withdraw={withdraw}
                />
              ))}
            </div>
            {data.requests.length > RECENT_REQUEST_LIMIT ? (
              <details className={styles.moreRequests}>
                <summary>Show more recent requests <span aria-hidden="true">›</span></summary>
                <div className={styles.requestGroup} role="list" aria-label="More recent leave requests">
                  {data.requests.slice(RECENT_REQUEST_LIMIT).map((request) => (
                    <LeaveRequestDetails
                      addDocuments={addDocuments}
                      documentBusy={documentBusy}
                      key={request.id}
                      removeDocument={removeDocument}
                      replaceDocument={replaceDocument}
                      request={request}
                      withdraw={withdraw}
                    />
                  ))}
                </div>
              </details>
            ) : null}
          </>
        ) : (
          <div className={styles.emptyWrap}>
            <StaffV2EmptyState title="No leave requests yet." description="Your submitted requests will appear here." />
            <Link href="/staff/leave/new">New leave request</Link>
          </div>
        )}
      </section>
    </section>
  );

  function renderRequestForm() {
    if (!data?.policies.length) {
      return <StaffV2EmptyState title="Leave isn't available yet." description="Your company has not enabled a leave policy. Contact HR." />;
    }
    return (
      <form className={styles.form} onSubmit={submit}>
        <StaffV2FormSection flat title="Leave type">
          <label className={styles.field}>Leave type
            <select required value={selectedPolicyId} onChange={(event) => setSelectedPolicyId(event.target.value)}>
              <option value="" disabled>Select a leave type</option>
              {data.policies.map((policy) => (
                <option disabled={!policy.applicationReady} key={policy.id} value={policy.id}>{friendlyPolicyName(policy.name)}</option>
              ))}
            </select>
          </label>
          {selectedPolicy ? (
            <p className={styles.policyHint} role="status">
              <strong>{selectedPolicy.payTreatment === "PAID" ? "Paid leave" : "Unpaid leave"}</strong>
              <span>{selectedPolicy.requiresDocument ? "Supporting document required" : "Supporting document optional"}</span>
            </p>
          ) : null}
        </StaffV2FormSection>

        <StaffV2FormSection flat title="Dates">
          <div className={styles.dateRange}>
            <StaffDatePicker label="From" name="startsOn" value={startsOn} onChange={(value) => {
              setStartsOn(value);
              if (durationMode === "HALF_DAY" || (endsOn && endsOn < value)) setEndsOn(value);
            }} />
            <StaffDatePicker label="To" min={startsOn || undefined} name="endsOn" value={endsOn} onChange={setEndsOn} />
          </div>
        </StaffV2FormSection>

        <StaffV2FormSection flat title="Duration">
          <div className={styles.segmented} role="radiogroup" aria-label="Leave duration">
            <label><input checked={durationMode === "FULL_DAY"} name="durationMode" onChange={() => setDurationMode("FULL_DAY")} type="radio" value="FULL_DAY" /><span>Full day</span></label>
            <label><input checked={durationMode === "HALF_DAY"} name="durationMode" onChange={() => { setDurationMode("HALF_DAY"); if (startsOn) setEndsOn(startsOn); }} type="radio" value="HALF_DAY" /><span>Half day</span></label>
          </div>
          {durationMode === "HALF_DAY" ? (
            <div className={styles.segmented} role="radiogroup" aria-label="Half-day period">
              <label><input checked={halfDayPeriod === "AM"} name="halfDayPeriod" onChange={() => setHalfDayPeriod("AM")} type="radio" value="AM" /><span>AM</span></label>
              <label><input checked={halfDayPeriod === "PM"} name="halfDayPeriod" onChange={() => setHalfDayPeriod("PM")} type="radio" value="PM" /><span>PM</span></label>
            </div>
          ) : null}
          <input name="leaveUnit" type="hidden" value={leaveUnit} />
          <div className={styles.durationSummary} role="status">
            <span>Calculated duration</span>
            <strong>{durationPreview.value}</strong>
            {durationPreview.note ? <small>{durationPreview.note}</small> : null}
          </div>
        </StaffV2FormSection>

        <StaffV2FormSection flat title="Reason">
          <label className={styles.field}>Reason
            <textarea name="reason" minLength={3} maxLength={500} required placeholder="Tell your manager why you need leave" />
          </label>
        </StaffV2FormSection>

        <StaffV2FormSection
          flat
          title="Supporting documents"
          description={`PDF, JPG, PNG or WEBP · up to 10 MB each · maximum ${MAX_LEAVE_DOCUMENTS} files.`}
        >
          <label className={styles.field}>Document type
            <select name="documentType" defaultValue={selectedPolicy?.name.toLowerCase().includes("medical") ? "MEDICAL_CERTIFICATE" : "SUPPORTING_DOCUMENT"}>
              <option value="SUPPORTING_DOCUMENT">Supporting document</option>
              <option value="MEDICAL_CERTIFICATE">Medical certificate</option>
              <option value="HOSPITALISATION_SUPPORT">Hospitalisation support</option>
              <option value="MATERNITY_SUPPORT">Maternity support</option>
              <option value="PATERNITY_SUPPORT">Paternity support</option>
              <option value="OTHER">Other evidence</option>
            </select>
          </label>
          <div className={styles.documentButtons}>
            <label className={styles.fileButton}>{cameraDocumentNames.length ? "Retake photo" : "Take photo"}
              <input name="supportingDocument" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => setCameraDocumentNames(Array.from(event.currentTarget.files ?? [], (file) => file.name))} />
            </label>
            <label className={styles.fileButtonSecondary}>{uploadedDocumentNames.length ? "Change files" : "Upload files"}
              <input name="supportingDocument" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple onChange={(event) => setUploadedDocumentNames(Array.from(event.currentTarget.files ?? [], (file) => file.name))} />
            </label>
          </div>
          {selectedDocumentNames.map((fileName) => <StaffV2AttachmentRow fileName={fileName} key={fileName} status="Selected" />)}
          <small className={styles.privateNote}>Files are stored privately and are available only to authorized reviewers.</small>
        </StaffV2FormSection>

        <StaffV2StickyActionBar>
          <button className={styles.submitButton} disabled={!selectedPolicy?.applicationReady || submitting} type="submit">
            {submitting ? "Submitting…" : "Submit request"}
          </button>
        </StaffV2StickyActionBar>
      </form>
    );
  }
}

function LeaveLoading({ view }: { view: "overview" | "new-request" }) {
  return (
    <section aria-busy="true" aria-label={`Loading ${view === "overview" ? "Leave" : "new leave request"}`} className={`${staffV2Styles.scope} ${styles.page}`}>
      <StaffV2PageHeader title={view === "overview" ? "Leave" : "New leave request"} meta="Loading…" />
      <div className={styles.loadingAction} />
      <StaffV2SectionLabel>{view === "overview" ? "Balances" : "Leave type"}</StaffV2SectionLabel>
      <div className={styles.loadingRows}>{[0, 1, 2].map((row) => <div className={staffV2Styles.skeleton} key={row} />)}</div>
      {view === "overview" ? <><StaffV2SectionLabel>Recent requests</StaffV2SectionLabel><div className={styles.loadingRows}>{[0, 1, 2].map((row) => <div className={staffV2Styles.skeleton} key={`request-${row}`} />)}</div></> : null}
    </section>
  );
}

function Feedback({ message, error, retry }: { message: string | null; error: string | null; retry?: () => Promise<void> }) {
  return (
    <>
      {message ? <div className={styles.success} role="status">{message}</div> : null}
      {error ? <div className={styles.error} role="alert"><span>{error}</span>{retry ? <button onClick={() => void retry()} type="button">Try again</button> : null}</div> : null}
    </>
  );
}

function BalanceRow({ policy }: { policy: LeavePolicy }) {
  return (
    <div className={styles.balanceRow} role="listitem">
      <span><strong>{friendlyPolicyName(policy.name)}</strong><small>{policy.payTreatment === "PAID" ? "Paid" : "Unpaid"}</small></span>
      <b>{formatLeaveUnits(policy.remainingDays ?? 0)} available</b>
    </div>
  );
}

function BalanceDetail({ policy, year }: { policy: LeavePolicy; year: number }) {
  return (
    <StaffV2DetailSection title={friendlyPolicyName(policy.name)}>
      <dl className={styles.detailFacts}>
        <Fact label="Available" value={formatLeaveUnits(policy.remainingDays ?? 0)} />
        <Fact label={`${year} entitlement`} value={formatLeaveUnits(policy.currentEntitlementDays)} />
        {policy.carryForwardDays > 0 ? <Fact label="Carry forward" value={formatLeaveUnits(policy.carryForwardDays)} /> : null}
        <Fact label="Used" value={formatLeaveUnits(policy.usedDays)} />
        <Fact label="Pending" value={formatLeaveUnits(policy.pendingDays)} />
        {policy.manualAdjustmentDays !== 0 ? <Fact label="Adjustment" value={`${policy.manualAdjustmentDays > 0 ? "+" : ""}${formatLeaveUnits(policy.manualAdjustmentDays)}`} /> : null}
      </dl>
      {policy.carryForwardBuckets.map((bucket, index) => bucket.expiresAt ? (
        <p className={styles.expiry} key={`${bucket.expiresAt}-${index}`}>
          {formatLeaveNumber(bucket.remainingDays)} carry-forward days expire on {formatLeaveDate(bucket.expiresAt, true)}.
        </p>
      ) : null)}
    </StaffV2DetailSection>
  );
}

function LeaveRequestDetails({
  request,
  documentBusy,
  withdraw,
  removeDocument,
  addDocuments,
  replaceDocument,
}: {
  request: LeaveRequest;
  documentBusy: string | null;
  withdraw: (requestId: string, expectedRevision: number) => Promise<void>;
  removeDocument: (documentId: string) => Promise<void>;
  addDocuments: (requestId: string, event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  replaceDocument: (documentId: string, event: React.FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const rowStatus = leaveRowStatus(request);
  const decision = leaveDecisionPresentation(request.status);
  const evidence = leaveEvidencePresentation(request);
  const evidenceReviewNote = request.supportingDocuments.find((document) => document.reviewNote)?.reviewNote;
  const pending = request.status === "PENDING" || request.status === "SUBMITTED";
  return (
    <details className={styles.requestDetails} role="listitem">
      <summary aria-label={`${friendlyPolicyName(request.policyNameSnapshot)}, ${formatLeaveDateRange(request.startsOn, request.endsOn)}, ${rowStatus.label}`}>
        <span className={styles.requestCopy}>
          <small>{formatLeaveDateRange(request.startsOn, request.endsOn)}</small>
          <strong>{friendlyPolicyName(request.policyNameSnapshot)}</strong>
          <span>{formatLeaveUnits(request.requestedDays)} · {leaveUnitLabel(request.leaveUnit)}</span>
        </span>
        <StaffV2StatusBadge tone={rowStatus.tone}>{rowStatus.label}</StaffV2StatusBadge>
        <i aria-hidden="true">›</i>
      </summary>
      <div className={styles.requestDetailBody}>
        <StaffV2DetailSection title="Request">
          <dl className={styles.detailFacts}>
            <Fact label="Date" value={formatLeaveDateRange(request.startsOn, request.endsOn, true)} />
            <Fact label="Duration" value={`${formatLeaveUnits(request.requestedDays)} · ${leaveUnitLabel(request.leaveUnit)}`} />
            <Fact label="Reason" value={request.reason} />
          </dl>
        </StaffV2DetailSection>

        <StaffV2DetailSection title="Decision">
          <dl className={styles.detailFacts}>
            <Fact label="Status" value={<StaffV2StatusBadge tone={decision.tone}>{decision.label}</StaffV2StatusBadge>} />
            {request.reviewNote ? <Fact label="Review note" value={request.reviewNote} /> : null}
            {request.cancellationReason ? <Fact label="Cancellation" value={request.cancellationReason} /> : null}
          </dl>
        </StaffV2DetailSection>

        {request.supportingDocuments.length || request.supportingEvidenceRequired ? (
          <StaffV2DetailSection title="Supporting documents">
            {request.supportingDocuments.length ? request.supportingDocuments.map((document) => (
              <StaffV2AttachmentRow
                action={<DocumentActions document={document} disabled={Boolean(documentBusy)} pending={pending} removeDocument={removeDocument} replaceDocument={replaceDocument} />}
                fileName={document.fileName}
                key={document.id}
                status={`${documentTypeLabel(document.documentType)} · ${formatDocumentSize(document.byteLength)} · ${evidenceDocumentLabel(document.reviewStatus)}`}
              />
            )) : <p className={styles.evidenceNotice}>A supporting document is required.</p>}
            {pending && request.supportingDocuments.length < MAX_LEAVE_DOCUMENTS ? (
              <form className={styles.addDocumentForm} onSubmit={(event) => void addDocuments(request.id, event)}>
                <select name="documentType" aria-label="Document type" defaultValue="SUPPORTING_DOCUMENT">
                  <option value="SUPPORTING_DOCUMENT">Supporting document</option>
                  <option value="MEDICAL_CERTIFICATE">Medical certificate</option>
                  <option value="OTHER">Other evidence</option>
                </select>
                <label className={styles.inlineFile}>Choose files<input accept="image/jpeg,image/png,image/webp,application/pdf" multiple name="supportingDocument" required type="file" /></label>
                <button disabled={Boolean(documentBusy)} type="submit">Add document</button>
              </form>
            ) : null}
          </StaffV2DetailSection>
        ) : null}

        {evidence ? (
          <StaffV2DetailSection title="Evidence status">
            <div className={styles.evidenceStatus}><StaffV2StatusBadge tone={evidence.tone}>{evidence.label}</StaffV2StatusBadge></div>
            {evidence.actionNeeded ? (
              <p className={styles.evidenceNotice}>
                {evidenceReviewNote ?? "Supporting document needs follow-up. Contact your manager if you need clarification."}
              </p>
            ) : null}
          </StaffV2DetailSection>
        ) : null}

        {pending ? (
          <div className={styles.withdrawRow}>
            <button disabled={Boolean(documentBusy)} onClick={() => void withdraw(request.id, request.revision)} type="button">Withdraw request</button>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function DocumentActions({
  document,
  pending,
  disabled,
  removeDocument,
  replaceDocument,
}: {
  document: LeaveDocument;
  pending: boolean;
  disabled: boolean;
  removeDocument: (documentId: string) => Promise<void>;
  replaceDocument: (documentId: string, event: React.FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  if (!pending) {
    return <a aria-label={`View supporting document ${document.fileName}`} href={`/api/employee-leave/documents/${document.id}`} rel="noreferrer" target="_blank">View</a>;
  }
  return (
    <details className={styles.documentMenu}>
      <summary>Manage</summary>
      <div>
        <a aria-label={`View supporting document ${document.fileName}`} href={`/api/employee-leave/documents/${document.id}`} rel="noreferrer" target="_blank">View</a>
        <form onSubmit={(event) => void replaceDocument(document.id, event)}>
          <input name="documentType" type="hidden" value={document.documentType} />
          <label>Replace<input accept="image/jpeg,image/png,image/webp,application/pdf" name="supportingDocument" required type="file" /></label>
          <button disabled={disabled} type="submit">Upload</button>
        </form>
        <button disabled={disabled} onClick={() => void removeDocument(document.id)} type="button">Remove</button>
      </div>
    </details>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function selectedFiles(form: FormData) {
  return form.getAll("supportingDocument").filter((value): value is File => value instanceof File && value.size > 0);
}

function validateSelectedFiles(files: readonly File[]) {
  if (files.length > MAX_LEAVE_DOCUMENTS) throw new Error(`Upload up to ${MAX_LEAVE_DOCUMENTS} supporting documents.`);
  const oversized = files.find((file) => file.size > MAX_LEAVE_DOCUMENT_BYTES);
  if (oversized) throw new Error(`${oversized.name} is larger than 10 MB.`);
}

function actionError(value: unknown, fallback: string) {
  if (value instanceof StaffApiError && value.code === "VALIDATION_ERROR") return value.message;
  if (value instanceof Error && !/prisma|database|stack|sql/i.test(value.message)) return value.message;
  return fallback;
}

function selectedDurationPreview(input: { startsOn: string; endsOn: string; leaveUnit: string; countMode?: string }) {
  if (input.leaveUnit !== "FULL_DAY") return { value: "0.5 day", note: "Half-day requests use one selected date." };
  if (!input.startsOn || !input.endsOn) return { value: "Choose dates", note: null };
  if (input.startsOn === input.endsOn) return { value: "1 day", note: null };
  if (input.countMode === "CALENDAR_DAYS") {
    const start = new Date(`${input.startsOn}T00:00:00Z`).getTime();
    const end = new Date(`${input.endsOn}T00:00:00Z`).getTime();
    return { value: formatLeaveUnits(Math.floor((end - start) / 86_400_000) + 1), note: "Calendar-day policy." };
  }
  return { value: "Confirmed after submission", note: "Working days are calculated by your workplace schedule." };
}

function friendlyPolicyName(value: string) {
  return value.replace(/\s*\([^)]*\bpolicy\b[^)]*\)\s*/gi, " ").replace(/\s+/g, " ").trim();
}

function leaveUnitLabel(value: string) {
  return ({ FULL_DAY: "Full day", HALF_DAY_AM: "Morning half day", HALF_DAY_PM: "Afternoon half day" } as Record<string, string>)[value] ?? "Leave";
}

function evidenceDocumentLabel(value: string) {
  return ({ NOT_REVIEWED: "Awaiting review", VERIFIED: "Verified", REVIEW_REQUIRED: "Needs follow-up", REJECTED: "Needs follow-up" } as Record<string, string>)[value] ?? "Status unavailable";
}

function documentTypeLabel(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}

function formatDocumentSize(value: number | null) {
  if (!value) return "Reference only";
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatLeaveNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
