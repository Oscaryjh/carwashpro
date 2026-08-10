"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  }>;
};

export function StaffLeave() {
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
        window.location.assign("/staff/login?reason=session-expired");
        return;
      }
      setError(value instanceof Error ? value.message : "Unable to load Leave.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const selectedPolicy = useMemo(() => data?.policies.find((policy) => policy.id === selectedPolicyId), [data, selectedPolicyId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setMessage(null);
    setError(null);
    try {
      await staffApiFetch("/api/employee-leave", {
        method: "POST",
        body: JSON.stringify({
          clientRequestId: crypto.randomUUID(),
          policyId: selectedPolicyId,
          startsOn: form.get("startsOn"),
          endsOn: form.get("endsOn"),
          leaveUnit: form.get("leaveUnit"),
          reason: form.get("reason"),
          documentReference: form.get("documentReference") || null,
        }),
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

  if (loading && !data) return <section className={styles.state}>Loading Leave...</section>;
  return (
    <div className={styles.page}>
      <section className={styles.hero}><p>TIME OFF</p><h1>My Leave</h1><span>You choose the Leave type; your manager approves or rejects it without changing its treatment.</span></section>
      {message ? <div className={styles.success} role="status">{message}</div> : null}
      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      {data?.policies.length ? (
        <section className={styles.card}>
          <h2>{data.year} balances</h2>
          <div className={styles.balances}>{data.policies.filter((policy) => policy.balanceTracked).map((policy) => <article key={policy.id}><span>{policy.name}</span><strong>{policy.remainingDays?.toFixed(1)}</strong><small>days available · {policy.usedDays.toFixed(1)} used · {policy.pendingDays.toFixed(1)} pending</small></article>)}</div>
        </section>
      ) : null}

      <section className={styles.card}>
        <h2>Apply for Leave</h2>
        {!data?.policies.length ? <p>Your company has not enabled Leave policies yet. Contact HR.</p> : (
          <form onSubmit={submit} className={styles.form}>
            <label>Leave type<select required value={selectedPolicyId} onChange={(event) => setSelectedPolicyId(event.target.value)}><option value="" disabled>Select a ready Leave type</option>{data.policies.map((policy) => <option value={policy.id} key={policy.id} disabled={!policy.applicationReady}>{policy.name} · {policy.payTreatment === "PAID" ? "Paid" : "Unpaid"}{policy.readinessCode ? ` · ${policy.readinessCode}` : ""}</option>)}</select></label>
            <div><label>From<input name="startsOn" type="date" required /></label><label>To<input name="endsOn" type="date" required /></label></div>
            <label>Duration<select name="leaveUnit"><option value="FULL_DAY">Full day / days</option><option value="HALF_DAY_AM">Half day · AM</option><option value="HALF_DAY_PM">Half day · PM</option></select></label>
            <label>Reason<textarea name="reason" minLength={3} maxLength={500} required placeholder="Tell your manager why you need Leave" /></label>
            {selectedPolicy?.requiresDocument ? <label>Supporting document link / reference<input name="documentReference" required maxLength={500} placeholder="Secure document reference" /></label> : null}
            <p>{selectedPolicy?.countMode === "CALENDAR_DAYS" ? "This company policy counts calendar days." : "Only explicit expected workdays are counted; rest days and public holidays are excluded."}</p>
            <button type="submit" disabled={!selectedPolicy?.applicationReady}>Submit for approval</button>
          </form>
        )}
      </section>

      <section className={styles.card}><h2>My applications</h2><div className={styles.requests}>{data?.requests.length ? data.requests.map((request) => <article key={request.id}><div><strong>{request.policyNameSnapshot}</strong><span>{request.startsOn} — {request.endsOn} · {request.requestedDays} day(s) · {request.leaveUnit.replaceAll("_", " ")}</span><small>{request.cancellationReason ? `Cancellation: ${request.cancellationReason}` : request.reviewNote ? `Manager note: ${request.reviewNote}` : request.reason}</small></div><div><b className={styles[request.status.toLowerCase()]}>{request.status}</b>{request.status === "PENDING" ? <button type="button" onClick={() => void withdraw(request.id, request.revision)}>Withdraw</button> : null}</div></article>) : <p>No Leave applications yet.</p>}</div></section>
    </div>
  );
}
