"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { isEmployeeSessionError, staffApiFetch, StaffApiError } from "@/lib/staff-pwa/client";
import styles from "./staff-leave.module.css";

type Overview = {
  year: number;
  employee: { fullName: string; employeeCode: string };
  policies: Array<{ id: string; name: string; payTreatment: "PAID" | "UNPAID"; countMode: string; requiresDocument: boolean; balanceTracked: boolean; entitlementDays: number; usedDays: number; remainingDays: number | null }>;
  requests: Array<{ id: string; policyNameSnapshot: string; startsOn: string; endsOn: string; requestedDays: number; status: string; reason: string; reviewNote: string | null }>;
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
      setSelectedPolicyId((current) => current || response.data.policies[0]?.id || "");
      setError(null);
    } catch (value) {
      if (value instanceof StaffApiError && isEmployeeSessionError(value.code)) {
        window.location.assign("/staff/login?reason=session-expired");
        return;
      }
      setError(value instanceof Error ? value.message : "Unable to load leave.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const selectedPolicy = useMemo(() => data?.policies.find((policy) => policy.id === selectedPolicyId), [data, selectedPolicyId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null); setError(null);
    try {
      await staffApiFetch("/api/employee-leave", { method: "POST", body: JSON.stringify({ policyId: selectedPolicyId, startsOn: form.get("startsOn"), endsOn: form.get("endsOn"), reason: form.get("reason"), documentReference: form.get("documentReference") || null }) });
      event.currentTarget.reset();
      setMessage("Leave request submitted for manager approval.");
      await load();
    } catch (value) { setError(value instanceof Error ? value.message : "Unable to submit leave."); }
  }

  async function cancel(requestId: string) {
    if (!window.confirm("Cancel this pending leave request?")) return;
    try {
      await staffApiFetch("/api/employee-leave", { method: "DELETE", body: JSON.stringify({ requestId }) });
      setMessage("Pending request cancelled.");
      await load();
    } catch (value) { setError(value instanceof Error ? value.message : "Unable to cancel leave."); }
  }

  if (loading && !data) return <section className={styles.state}>Loading leave...</section>;
  return (
    <div className={styles.page}>
      <section className={styles.hero}><p>TIME OFF</p><h1>Leave</h1><span>Request time off and follow approval status.</span></section>
      {message ? <div className={styles.success} role="status">{message}</div> : null}
      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      {data?.policies.length ? (
        <section className={styles.card}>
          <h2>{data.year} balances</h2>
          <div className={styles.balances}>{data.policies.filter((policy) => policy.balanceTracked).map((policy) => <article key={policy.id}><span>{policy.name}</span><strong>{policy.remainingDays?.toFixed(1)}</strong><small>days remaining · {policy.usedDays.toFixed(1)} used</small></article>)}</div>
        </section>
      ) : null}

      <section className={styles.card}>
        <h2>Request leave</h2>
        {!data?.policies.length ? <p>Your company has not enabled leave policies yet. Contact your manager.</p> : (
          <form onSubmit={submit} className={styles.form}>
            <label>Leave type<select value={selectedPolicyId} onChange={(event) => setSelectedPolicyId(event.target.value)}>{data.policies.map((policy) => <option value={policy.id} key={policy.id}>{policy.name} · {policy.payTreatment === "PAID" ? "Paid" : "Unpaid"}</option>)}</select></label>
            <div><label>From<input name="startsOn" type="date" required /></label><label>To<input name="endsOn" type="date" required /></label></div>
            <label>Reason<textarea name="reason" minLength={3} maxLength={500} required placeholder="Tell your manager why you need leave" /></label>
            {selectedPolicy?.requiresDocument ? <label>Supporting document link / reference<input name="documentReference" required maxLength={500} placeholder="Upload link or clinic document reference" /></label> : null}
            <p>{selectedPolicy?.countMode === "CALENDAR_DAYS" ? "Weekends are included for this leave type." : "Saturday and Sunday are not counted."}</p>
            <button type="submit">Submit for approval</button>
          </form>
        )}
      </section>

      <section className={styles.card}><h2>My requests</h2><div className={styles.requests}>{data?.requests.length ? data.requests.map((request) => <article key={request.id}><div><strong>{request.policyNameSnapshot}</strong><span>{request.startsOn} — {request.endsOn} · {request.requestedDays} day(s)</span><small>{request.reviewNote ? `Manager note: ${request.reviewNote}` : request.reason}</small></div><div><b className={styles[request.status.toLowerCase()]}>{request.status}</b>{request.status === "PENDING" ? <button type="button" onClick={() => void cancel(request.id)}>Cancel</button> : null}</div></article>) : <p>No leave requests yet.</p>}</div></section>
    </div>
  );
}
