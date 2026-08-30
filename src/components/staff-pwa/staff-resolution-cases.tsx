"use client";

import { useCallback, useEffect, useState } from "react";
import { StaffApiError, staffApiFetch } from "@/lib/staff-pwa/client";
import type { AttendanceResolutionCase } from "@/lib/staff-pwa/types";

export function StaffResolutionCases() {
  const [cases, setCases] = useState<AttendanceResolutionCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await staffApiFetch<{
        ok: true;
        data: AttendanceResolutionCase[];
      }>("/api/employee-attendance/resolutions");
      setCases(result.data);
    } catch (caught) {
      setError(
        caught instanceof StaffApiError
          ? caught.message
          : "Unable to load attendance issues.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <section className="staff-page-card staff-resolution-card" aria-busy="true">
        <p className="staff-kicker">ATTENDANCE ISSUES</p>
        <p>Checking whether a response is needed…</p>
      </section>
    );
  }
  if (error) {
    return (
      <section className="staff-page-card staff-resolution-card">
        <div className="staff-alert error" role="alert">{error}</div>
        <button className="staff-secondary-button" onClick={() => void load()} type="button">
          Try again
        </button>
      </section>
    );
  }
  if (!cases.length) return null;

  return (
    <section className="staff-page-card staff-resolution-card">
      <div className="staff-card-heading">
        <div>
          <p className="staff-kicker">ATTENDANCE ISSUES</p>
          <h2>Resolution required</h2>
        </div>
        <span className="staff-status-chip warning">{cases.length}</span>
      </div>
      <p className="staff-resolution-intro">
        Respond to returned or incomplete attendance records. Your manager will
        make the final decision.
      </p>
      <div className="staff-resolution-list">
        {cases.map((item) => (
          <ResolutionCaseCard item={item} key={item.id} onSubmitted={load} />
        ))}
      </div>
    </section>
  );
}

function ResolutionCaseCard({
  item,
  onSubmitted,
}: {
  item: AttendanceResolutionCase;
  onSubmitted: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [clockIn, setClockIn] = useState(toLocalInput(item.clockInAt, item.branch.timezone));
  const [clockOut, setClockOut] = useState(
    item.clockOutAt ? toLocalInput(item.clockOutAt, item.branch.timezone) : "",
  );
  const [breakMinutes, setBreakMinutes] = useState(String(item.totalBreakMinutes));
  const [includeCorrection, setIncludeCorrection] = useState(!item.clockOutAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const needsResponse =
    item.status === "OPEN" || item.status === "RETURNED_FOR_CORRECTION";

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await staffApiFetch<{ ok: true }>("/api/employee-attendance/resolutions", {
        method: "POST",
        body: JSON.stringify({
          resolutionCaseId: item.id,
          reason,
          proposedClockInLocal: includeCorrection ? clockIn : null,
          proposedClockOutLocal: includeCorrection ? clockOut : null,
          proposedBreakMinutes: includeCorrection ? Number(breakMinutes) : null,
        }),
      });
      await onSubmitted();
    } catch (caught) {
      setError(
        caught instanceof StaffApiError
          ? caught.message
          : "Unable to submit the attendance response.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancelPending() {
    if (busy || !item.canCancel) return;
    if (!window.confirm("Cancel this pending attendance request? You can submit a new response afterwards.")) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await staffApiFetch<{ ok: true }>("/api/employee-attendance/resolutions", {
        method: "DELETE",
        body: JSON.stringify({
          resolutionCaseId: item.id,
          expectedUpdatedAt: item.updatedAt,
        }),
      });
      await onSubmitted();
    } catch (caught) {
      setError(
        caught instanceof StaffApiError
          ? caught.message
          : "Unable to cancel the attendance request.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="staff-resolution-item">
      <div className="staff-resolution-summary">
        <div>
          <strong>{formatReason(item.openedReason)}</strong>
          <small>{item.workDate} · {item.branch.name}</small>
        </div>
        <span className={`staff-status-chip ${item.status === "UNDER_REVIEW" ? "approved" : "warning"}`}>
          {item.status === "UNDER_REVIEW" ? "Under review" : "Response needed"}
        </span>
      </div>
      {item.status === "RETURNED_FOR_CORRECTION" && item.latestEvent ? (
        <div className="staff-alert warning">
          <strong>Manager returned this case</strong>
          <span>{item.latestEvent.reason}</span>
        </div>
      ) : null}
      {item.latestEvent?.type === "EMPLOYEE_CANCELLED" ? (
        <div className="staff-alert success">
          <strong>Previous request cancelled</strong>
          <span>Submit a new response when you are ready.</span>
        </div>
      ) : null}
      {needsResponse ? (
        <div className="staff-resolution-form">
          <label>
            <span>Explanation</span>
            <textarea
              maxLength={500}
              minLength={3}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Explain what happened and what should be corrected"
              required
              rows={3}
              value={reason}
            />
          </label>
          <label className="staff-resolution-check">
            <input
              checked={includeCorrection}
              onChange={(event) => setIncludeCorrection(event.target.checked)}
              type="checkbox"
            />
            <span>Propose corrected times</span>
          </label>
          {includeCorrection ? (
            <div className="staff-resolution-fields">
              <label>
                <span>Clock in</span>
                <input onChange={(event) => setClockIn(event.target.value)} required type="datetime-local" value={clockIn} />
              </label>
              <label>
                <span>Clock out</span>
                <input onChange={(event) => setClockOut(event.target.value)} required type="datetime-local" value={clockOut} />
              </label>
              <label>
                <span>Break minutes</span>
                <input min="0" onChange={(event) => setBreakMinutes(event.target.value)} required type="number" value={breakMinutes} />
              </label>
            </div>
          ) : null}
          {error ? <div className="staff-alert error" role="alert">{error}</div> : null}
          <button className="staff-primary-button" disabled={busy || reason.trim().length < 3} onClick={() => void submit()} type="button">
            {busy ? "Submitting…" : "Submit to manager"}
          </button>
        </div>
      ) : (
        <div className="staff-resolution-pending">
          <p className="staff-form-hint">Your response is waiting for manager review.</p>
          {item.canCancel ? (
            <button
              className="staff-cancel-button"
              disabled={busy}
              onClick={() => void cancelPending()}
              type="button"
            >
              {busy ? "Cancelling..." : "Cancel pending request"}
            </button>
          ) : null}
          {error ? <div className="staff-alert error" role="alert">{error}</div> : null}
        </div>
      )}
    </article>
  );
}

function formatReason(value: string) {
  return value
    .toLocaleLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toLocaleUpperCase());
}

function toLocalInput(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date(value))
    .filter((part) => part.type !== "literal")
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
