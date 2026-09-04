"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getAttendanceCorrectionBreakLimit,
  getLocalCorrectionElapsedMinutes,
} from "@/lib/staff-pwa/attendance-correction-breaks";
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
      <section className="staff-page-card staff-resolution-card" aria-busy="true" id="attendance-issues">
        <p className="staff-kicker">ATTENDANCE ISSUES</p>
        <p>Checking whether a response is needed…</p>
      </section>
    );
  }
  if (error) {
    return (
      <section className="staff-page-card staff-resolution-card" id="attendance-issues">
        <div className="staff-alert error" role="alert">{error}</div>
        <button className="staff-secondary-button" onClick={() => void load()} type="button">
          Try again
        </button>
      </section>
    );
  }
  if (!cases.length) return null;

  return (
    <section className="staff-page-card staff-resolution-card" id="attendance-issues">
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
  const [breakMinutes, setBreakMinutes] = useState("");
  const [includeBreakCorrection, setIncludeBreakCorrection] = useState(false);
  const incompleteBreakPeriods = item.breakRecord.periods.filter(
    (period) => !period.startAt || !period.endAt,
  );
  const incompleteBreakPeriod = incompleteBreakPeriods.length === 1
    ? incompleteBreakPeriods[0]
    : null;
  const [breakStart, setBreakStart] = useState(
    incompleteBreakPeriod?.startAt
      ? toLocalInput(incompleteBreakPeriod.startAt, item.branch.timezone)
      : "",
  );
  const [breakEnd, setBreakEnd] = useState(
    incompleteBreakPeriod?.endAt
      ? toLocalInput(incompleteBreakPeriod.endAt, item.branch.timezone)
      : "",
  );
  const [includeCorrection, setIncludeCorrection] = useState(!item.clockOutAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const elapsedMinutes = getLocalCorrectionElapsedMinutes(clockIn, clockOut);
  const breakLimit = getAttendanceCorrectionBreakLimit({
    elapsedMinutes,
    recommendedBreakMinutes: item.branch.recommendedBreakMinutes,
  });
  const proposedIncompleteBreakMinutes = getLocalCorrectionElapsedMinutes(
    breakStart,
    breakEnd,
  );
  const breakValue = item.breakRecord.status === "COMPLETE"
    ? item.breakRecord.recordedMinutes
    : item.breakRecord.status === "INCOMPLETE"
      ? item.breakRecord.recordedMinutes + (proposedIncompleteBreakMinutes ?? 0)
      : Number(breakMinutes);
  const recordedBreakOutsideShift = item.breakRecord.status === "COMPLETE" &&
    item.breakRecord.periods.some((period) => {
      if (!period.startAt || !period.endAt || !clockIn || !clockOut) return false;
      const start = toLocalInput(period.startAt, item.branch.timezone);
      const end = toLocalInput(period.endAt, item.branch.timezone);
      return start < clockIn || end > clockOut;
    });
  const invalidBreak = item.breakRecord.status === "COMPLETE"
    ? recordedBreakOutsideShift
    : item.breakRecord.status === "INCOMPLETE"
      ? incompleteBreakPeriods.length !== 1 ||
        proposedIncompleteBreakMinutes === null ||
        breakStart < clockIn ||
        breakEnd > clockOut ||
        breakValue > breakLimit
      : includeBreakCorrection && (breakMinutes.trim() === "" ||
        !Number.isInteger(breakValue) ||
        breakValue < 0 ||
        breakValue > breakLimit);
  const invalidCorrection = includeCorrection && (
    !clockIn || !clockOut || invalidBreak || elapsedMinutes === null
  );
  const exceedsRecommendation = item.breakRecord.status !== "COMPLETE" &&
    Number.isFinite(breakValue) &&
    breakValue > item.branch.recommendedBreakMinutes;
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
          proposedBreakMinutes: includeCorrection
            ? item.breakRecord.status === "COMPLETE"
              ? item.breakRecord.recordedMinutes
              : item.breakRecord.status === "NONE" && includeBreakCorrection
                ? Number(breakMinutes)
                : null
            : null,
          proposedBreakStartLocal: includeCorrection && item.breakRecord.status === "INCOMPLETE"
            ? breakStart
            : null,
          proposedBreakEndLocal: includeCorrection && item.breakRecord.status === "INCOMPLETE"
            ? breakEnd
            : null,
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
              {item.breakRecord.status === "COMPLETE" ? (
                <div className="staff-recorded-break">
                  <span>Recorded break</span>
                  <strong>{item.breakRecord.recordedMinutes} min</strong>
                  <small>
                    {item.breakRecord.periods.map((period) =>
                      formatBreakPeriod(period, item.branch.timezone),
                    ).join(" · ")}
                  </small>
                  <small className="staff-field-guidance">
                    Based on completed break punches. This value is locked and does not need to be entered again.
                  </small>
                  {recordedBreakOutsideShift ? (
                    <small className="staff-field-warning">
                      Clock-in and clock-out must include the recorded break period.
                    </small>
                  ) : null}
                </div>
              ) : item.breakRecord.status === "INCOMPLETE" ? (
                <div className="staff-break-correction">
                  <span>Complete break record</span>
                  {incompleteBreakPeriod ? (
                    <div className="staff-break-time-fields">
                      <label>
                        <span>Break start</span>
                        <input
                          disabled={Boolean(incompleteBreakPeriod.startAt)}
                          onChange={(event) => setBreakStart(event.target.value)}
                          required
                          type="datetime-local"
                          value={breakStart}
                        />
                      </label>
                      <label>
                        <span>Break end</span>
                        <input
                          disabled={Boolean(incompleteBreakPeriod.endAt)}
                          onChange={(event) => setBreakEnd(event.target.value)}
                          required
                          type="datetime-local"
                          value={breakEnd}
                        />
                      </label>
                    </div>
                  ) : (
                    <small className="staff-field-warning">
                      Multiple incomplete break records require manager review.
                    </small>
                  )}
                  <small className="staff-field-guidance">
                    Recorded times are locked. Enter only the missing break time.
                  </small>
                  {exceedsRecommendation && !invalidBreak ? (
                    <small className="staff-field-warning">
                      Explain why this exceeds the workplace break target.
                    </small>
                  ) : null}
                </div>
              ) : (
                <div className="staff-break-correction">
                  <label className="staff-resolution-check">
                    <input
                      aria-controls={`break-declaration-${item.id}`}
                      aria-expanded={includeBreakCorrection}
                      checked={includeBreakCorrection}
                      onChange={(event) => setIncludeBreakCorrection(event.target.checked)}
                      type="checkbox"
                    />
                    <span>I also forgot to record my break</span>
                  </label>
                  {includeBreakCorrection ? (
                    <div className="staff-break-declaration" id={`break-declaration-${item.id}`}>
                      <label>
                        <span>Actual break taken (minutes)</span>
                        <input
                          aria-describedby={`break-guidance-${item.id}`}
                          max={breakLimit}
                          min="0"
                          onChange={(event) => setBreakMinutes(event.target.value)}
                          placeholder="Enter actual minutes"
                          required
                          step="1"
                          type="number"
                          value={breakMinutes}
                        />
                      </label>
                      <small className="staff-field-guidance" id={`break-guidance-${item.id}`}>
                        Workplace target: {item.branch.recommendedBreakMinutes} min. Enter the time you actually took, not the target.
                        This is your declaration, subject to manager approval.
                      </small>
                      <small className="staff-field-guidance">
                        Maximum {breakLimit} min for this correction. Contact your manager if more time is needed.
                      </small>
                      {exceedsRecommendation ? (
                        <small className="staff-field-warning">
                          Explain why this exceeds the workplace break target.
                        </small>
                      ) : null}
                    </div>
                  ) : (
                    <small className="staff-field-guidance">
                      No break punches were recorded. Your manager must verify the break time.
                      Leaving this unchecked does not mean you took no break.
                    </small>
                  )}
                </div>
              )}
            </div>
          ) : null}
          {error ? <div className="staff-alert error" role="alert">{error}</div> : null}
          <button
            className="staff-primary-button"
            disabled={busy || reason.trim().length < 3 || invalidCorrection}
            onClick={() => void submit()}
            type="button"
          >
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

function formatBreakPeriod(
  period: { startAt: string | null; endAt: string | null },
  timeZone: string,
) {
  return `${period.startAt ? formatTime(period.startAt, timeZone) : "Missing start"} – ${
    period.endAt ? formatTime(period.endAt, timeZone) : "Missing end"
  }`;
}

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-MY", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
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
