"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  getOrCreateDeviceIdentifier,
  isEmployeeSessionError,
  StaffApiError,
  staffApiFetch,
} from "@/lib/staff-pwa/client";
import type {
  AttendanceHistory,
  AttendanceHistoryItem,
} from "@/lib/staff-pwa/types";
import { StaffLoading } from "./staff-auth";

export function StaffHistory() {
  const router = useRouter();
  const defaults = useMemo(() => defaultRange(), []);
  const [history, setHistory] = useState<AttendanceHistory | null>(null);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [status, setStatus] = useState("");
  const [draftFrom, setDraftFrom] = useState(defaults.from);
  const [draftTo, setDraftTo] = useState(defaults.to);
  const [draftStatus, setDraftStatus] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionType, setCorrectionType] = useState<
    "FORGOT_CLOCK_IN" | "FORGOT_CLOCK_OUT"
  >("FORGOT_CLOCK_OUT");
  const [correctionSessionId, setCorrectionSessionId] = useState("");
  const [requestedClockInAt, setRequestedClockInAt] = useState("");
  const [requestedClockOutAt, setRequestedClockOutAt] = useState("");
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [correctionMessage, setCorrectionMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      from,
      to,
      page: String(page),
      pageSize: "12",
    });
    if (status) params.set("status", status);

    try {
      const result = await staffApiFetch<{ ok: true; data: AttendanceHistory }>(
        `/api/employee-attendance/history?${params.toString()}`,
      );
      setHistory(result.data);
    } catch (caught) {
      if (caught instanceof StaffApiError && isEmployeeSessionError(caught.code)) {
        router.replace("/staff/login?reason=session-expired");
        return;
      }
      setError(
        caught instanceof StaffApiError
          ? caught.message
          : "Unable to load attendance history.",
      );
    } finally {
      setLoading(false);
    }
  }, [from, page, router, status, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!correctionOpen && !filtersOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (filtersOpen) setFiltersOpen(false);
      if (correctionOpen && !correctionSubmitting) setCorrectionOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [correctionOpen, correctionSubmitting, filtersOpen]);

  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFrom(draftFrom);
    setTo(draftTo);
    setStatus(draftStatus);
    setFiltersOpen(false);
    setPage(1);
  }

  function openFilters() {
    setDraftFrom(from);
    setDraftTo(to);
    setDraftStatus(status);
    setCorrectionOpen(false);
    setFiltersOpen(true);
  }

  async function submitCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCorrectionSubmitting(true);
    setCorrectionMessage("");
    setError("");
    try {
      const requestedClockIn = requestedClockInAt
        ? new Date(requestedClockInAt)
        : null;
      const requestedClockOut = requestedClockOutAt
        ? new Date(requestedClockOutAt)
        : null;
      const result = await staffApiFetch<{
        ok: true;
        data: { duplicate: boolean };
      }>("/api/employee-attendance/exception", {
        method: "POST",
        body: JSON.stringify({
          attendanceSessionId:
            correctionType === "FORGOT_CLOCK_OUT"
              ? correctionSessionId
              : null,
          attendancePunchId: null,
          type: correctionType,
          requestedClockInAt:
            correctionType === "FORGOT_CLOCK_IN" &&
            requestedClockIn &&
            Number.isFinite(requestedClockIn.getTime())
              ? requestedClockIn.toISOString()
              : null,
          requestedClockOutAt:
            requestedClockOut &&
            Number.isFinite(requestedClockOut.getTime())
              ? requestedClockOut.toISOString()
              : null,
          reason:
            correctionType === "FORGOT_CLOCK_IN"
              ? "Employee requested a missing clock-in correction."
              : "Employee requested a missing clock-out correction.",
          deviceIdentifier: getOrCreateDeviceIdentifier(),
        }),
      });
      setCorrectionMessage(
        result.data.duplicate
          ? "This request is already pending."
          : "Request submitted for manager review.",
      );
      await load();
    } catch (caught) {
      if (
        caught instanceof StaffApiError &&
        isEmployeeSessionError(caught.code)
      ) {
        router.replace("/staff/login?reason=session-expired");
        return;
      }
      setError(
        caught instanceof StaffApiError
          ? caught.message
          : "Unable to submit the correction request.",
      );
    } finally {
      setCorrectionSubmitting(false);
    }
  }

  return (
    <div className="staff-history-stack">
      <section className="staff-page-title staff-section-hero">
        <p className="staff-kicker">ATTENDANCE</p>
        <h1>History</h1>
        <p>Review your clock-ins, hours and attendance status.</p>
        <button
          aria-controls="staff-correction-sheet"
          aria-expanded={correctionOpen}
          aria-haspopup="dialog"
          className="staff-secondary-button"
          onClick={() => {
            setFiltersOpen(false);
            setCorrectionOpen(true);
          }}
          type="button"
        >
          Report issue
        </button>
      </section>

      {correctionOpen ? (
        <div
          className="staff-correction-backdrop"
          onClick={() => {
            if (!correctionSubmitting) setCorrectionOpen(false);
          }}
          role="presentation"
        >
          <section
            aria-labelledby="staff-correction-heading"
            aria-modal="true"
            className="staff-page-card staff-correction-sheet"
            id="staff-correction-sheet"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="staff-card-heading staff-correction-heading">
              <div>
                <p className="staff-kicker">CORRECTION</p>
                <h2 id="staff-correction-heading">Report a missing punch</h2>
                <p className="staff-sheet-description">Add the missing time and send it for review.</p>
              </div>
              <button
                aria-label="Close correction request"
                className="staff-correction-close"
                disabled={correctionSubmitting}
                onClick={() => setCorrectionOpen(false)}
                type="button"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <form className="staff-history-filters" onSubmit={submitCorrection}>
              <div className="staff-correction-field-grid staff-correction-action-grid">
                <label>
                  Missing action
                  <select
                    onChange={(event) =>
                      setCorrectionType(
                        event.target.value as
                          | "FORGOT_CLOCK_IN"
                          | "FORGOT_CLOCK_OUT",
                      )
                    }
                    value={correctionType}
                  >
                    <option value="FORGOT_CLOCK_OUT">Forgot clock out</option>
                    <option value="FORGOT_CLOCK_IN">Forgot clock in</option>
                  </select>
                </label>
              </div>
              <div className="staff-correction-field-grid staff-correction-time-grid">
                {correctionType === "FORGOT_CLOCK_OUT" ? (
                  <label>
                    Attendance shift
                    <select
                      onChange={(event) => setCorrectionSessionId(event.target.value)}
                      required
                      value={correctionSessionId}
                    >
                      <option value="">Select shift</option>
                      {(history?.items ?? [])
                        .flatMap((item) => item.sessions
                          .filter((session) =>
                            !item.locked &&
                            !session.clockOutAt &&
                            session.punchStatus !== "COMPLETED" &&
                            session.punchStatus !== "CANCELLED",
                          )
                          .map((session) => (
                            <option key={session.id} value={session.id}>
                              {item.workDate} / In progress
                            </option>
                          ))) }
                    </select>
                  </label>
                ) : (
                  <label>
                    Requested clock in
                    <input
                      onChange={(event) => setRequestedClockInAt(event.target.value)}
                      required
                      type="datetime-local"
                      value={requestedClockInAt}
                    />
                  </label>
                )}
                <label>
                  Requested clock out
                  <input
                    onChange={(event) => setRequestedClockOutAt(event.target.value)}
                    required={correctionType === "FORGOT_CLOCK_OUT"}
                    type="datetime-local"
                    value={requestedClockOutAt}
                  />
                </label>
              </div>
              {correctionType === "FORGOT_CLOCK_OUT" && (history?.items ?? []).some((item) => item.locked) ? (
                <p className="staff-correction-note">
                  <span aria-hidden="true">i</span>
                  Finalized timesheet records stay locked.
                </p>
              ) : null}
              <button
                className="staff-primary-button"
                disabled={correctionSubmitting}
                type="submit"
              >
                {correctionSubmitting ? "Submitting…" : "Submit for review"}
              </button>
              {correctionMessage ? <small className="staff-correction-message" role="status">{correctionMessage}</small> : null}
            </form>
          </section>
        </div>
      ) : null}

      <section className="staff-history-filter-card">
        <div className="staff-history-filter-summary">
          <div>
            <small>Showing</small>
            <strong>{formatWorkDate(from)} – {formatWorkDate(to)}</strong>
            <span>
              {status || from !== defaults.from || to !== defaults.to
                ? "Custom filters applied"
                : "All statuses"}
            </span>
          </div>
          <button
            aria-controls="staff-history-filters"
            aria-expanded={filtersOpen}
            aria-haspopup="dialog"
            className="staff-filter-toggle"
            onClick={openFilters}
            type="button"
          >
            <span aria-hidden="true">≡</span>
            Filters
          </button>
        </div>
      </section>

      {filtersOpen ? (
        <div
          className="staff-correction-backdrop staff-filter-backdrop"
          onClick={() => setFiltersOpen(false)}
          role="presentation"
        >
          <section
            aria-labelledby="staff-filter-heading"
            aria-modal="true"
            className="staff-page-card staff-correction-sheet staff-filter-sheet"
            id="staff-history-filters"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="staff-card-heading staff-correction-heading">
              <div>
                <p className="staff-kicker">ATTENDANCE</p>
                <h2 id="staff-filter-heading">Filter history</h2>
                <p className="staff-sheet-description">Choose a period and status.</p>
              </div>
              <button
                aria-label="Close attendance filters"
                className="staff-correction-close"
                onClick={() => setFiltersOpen(false)}
                type="button"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <form className="staff-history-filters" onSubmit={filter}>
              <div className="staff-filter-field-grid staff-filter-date-grid">
                <label>
                  From
                  <input onChange={(event) => setDraftFrom(event.target.value)} type="date" value={draftFrom} />
                </label>
                <label>
                  To
                  <input onChange={(event) => setDraftTo(event.target.value)} type="date" value={draftTo} />
                </label>
              </div>
              <div className="staff-filter-field-grid staff-filter-status-grid">
                <label>
                  Status
                  <select onChange={(event) => setDraftStatus(event.target.value)} value={draftStatus}>
                    <option value="">All statuses</option>
                    <option value="OPEN">In progress</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="NEEDS_REVIEW">Needs review</option>
                    <option value="MISSING_PUNCH">Missing punch</option>
                    <option value="ADJUSTED">Adjusted</option>
                    <option value="RESOLVED">Resolved</option>
                    <option value="CANCELLED">Cancelled</option>
                  </select>
                </label>
              </div>
              <p className="staff-filter-limit">Choose up to 31 days.</p>
              <button className="staff-primary-button" type="submit">Apply filters</button>
            </form>
          </section>
        </div>
      ) : null}

      {error ? <div className="staff-alert error" role="alert">{error}</div> : null}
      {loading && !history ? <StaffLoading label="Loading attendance history…" /> : null}

      {history ? (
        <>
          {history.items.some((item) => item.attention) ? (
            <section className="staff-attendance-attention" aria-labelledby="staff-attention-heading">
              <div className="staff-attendance-section-heading">
                <div>
                  <p className="staff-kicker">NEEDS YOUR ATTENTION</p>
                  <h2 id="staff-attention-heading">Attendance issues</h2>
                </div>
                <span>{history.items.filter((item) => item.attention).length}</span>
              </div>
              <div className="staff-attention-list">
                {history.items.filter((item) => item.attention).map((item) => (
                  <a className="staff-attention-row" href={`#attendance-${item.id}`} key={`attention-${item.id}`}>
                    <span className="staff-attention-date">{formatCompactWorkDate(item.workDate)}</span>
                    <span>
                      <strong>{item.attention?.label}</strong>
                      <small>{item.attention?.description}</small>
                    </span>
                    <b>{attentionStateLabel(item.attention?.status ?? "")}</b>
                    <i aria-hidden="true">›</i>
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          <section className="staff-history-list" aria-busy={loading} aria-labelledby="staff-history-heading">
            <div className="staff-attendance-section-heading staff-history-heading">
              <div>
                <p className="staff-kicker">HISTORY</p>
                <h2 id="staff-history-heading">Clock-in records</h2>
              </div>
              <span>{history.pagination.total}</span>
            </div>
            <div className="staff-history-rows">
              {history.items.map((item) => <HistoryRow item={item} key={item.id} />)}
            </div>
            {!history.items.length ? (
              <div className="staff-empty-state">
                <span aria-hidden="true">◷</span>
                <h2>No attendance records</h2>
                <p>No records match this date range and filters.</p>
              </div>
            ) : null}
          </section>
          {history.pagination.totalPages > 1 ? (
            <div className="staff-pagination">
              <button
                disabled={loading || history.pagination.page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                type="button"
              >
                Previous
              </button>
              <span>
                Page {history.pagination.page} of {history.pagination.totalPages}
                <small>{history.pagination.total} records</small>
              </span>
              <button
                disabled={
                  loading ||
                  history.pagination.page >= history.pagination.totalPages
                }
                onClick={() => setPage((current) => current + 1)}
                type="button"
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function HistoryRow({ item }: { item: AttendanceHistoryItem }) {
  const timezone = item.branch.timezone;
  return (
    <details className={`staff-attendance-day ${item.primaryStatus.tone}`} id={`attendance-${item.id}`}>
      <summary>
        <span className="staff-attendance-day-date">
          <strong>{formatCompactWorkDate(item.workDate)}</strong>
          <small>{item.branch.name}</small>
        </span>
        <span className="staff-attendance-day-facts">
          <strong>{formatActualRange(item, timezone)}</strong>
          <small>
            Worked {formatCompactDuration(item.actual.totalWorkedMinutes)} · Break {formatCompactDuration(item.actual.totalBreakMinutes)}
          </small>
          {item.flags.length ? <em>{item.flags.join(" · ")}</em> : null}
        </span>
        <span className={`staff-attendance-status ${item.primaryStatus.tone}`}>
          {item.primaryStatus.label}
        </span>
        <i aria-hidden="true">⌄</i>
      </summary>

      <div className="staff-attendance-day-detail">
        <div className="staff-attendance-detail-heading">
          <div>
            <p className="staff-kicker">ATTENDANCE DETAIL</p>
            <h3>{formatFullWorkDate(item.workDate)}</h3>
          </div>
          <span className={`staff-attendance-status ${item.primaryStatus.tone}`}>
            {item.primaryStatus.label}
          </span>
        </div>

        {item.attention ? (
          <div className="staff-attendance-detail-alert">
            <strong>{item.attention.label}</strong>
            <span>{item.attention.description}</span>
            <small>{attentionStateLabel(item.attention.status)}</small>
          </div>
        ) : null}

        <section className="staff-scheduled-actual" aria-label="Scheduled and actual attendance">
          <div>
            <small>SCHEDULED</small>
            <strong>{scheduledLabel(item, timezone)}</strong>
            <span>{scheduledKindLabel(item.scheduled?.kind ?? null)}</span>
          </div>
          <div>
            <small>ACTUAL</small>
            <strong>{formatActualRange(item, timezone)}</strong>
            <span>Worked {formatCompactDuration(item.actual.totalWorkedMinutes)} · Break {formatCompactDuration(item.actual.totalBreakMinutes)}</span>
          </div>
        </section>

        {item.sessions.length > 1 ? (
          <section className="staff-attendance-evidence-block">
            <p className="staff-kicker">SESSIONS</p>
            <div className="staff-session-list">
              {item.sessions.map((session, index) => (
                <div key={session.id}>
                  <span>Session {index + 1}</span>
                  <strong>{formatTime(session.clockInAt, timezone)} – {session.clockOutAt ? formatTime(session.clockOutAt, timezone) : "—"}</strong>
                  <small>Worked {formatCompactDuration(session.totalWorkedMinutes)} · Break {formatCompactDuration(session.totalBreakMinutes)}</small>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <SessionEvidence item={item} />

        {item.locked ? (
          <div className="staff-attendance-lock-note">
            <strong>Finalized timesheet</strong>
            <span>This attendance record belongs to a finalized timesheet. Contact your manager if a correction is required.</span>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function SessionEvidence({ item }: { item: AttendanceHistoryItem }) {
  const timezone = item.branch.timezone;
  const locationEvidence = item.sessions.flatMap((session) => session.geofenceEvidence)
    .filter((evidence) => evidence.type === "CLOCK_IN" || evidence.type === "CLOCK_OUT");
  const breakPeriods = item.sessions.flatMap((session) => session.breakPeriods);
  const approvalLabels = [...new Set(item.sessions.flatMap((session) => session.approvalLabel ? [session.approvalLabel] : []))];
  const adjusted = item.sessions.some((session) => session.adjusted);

  return (
    <>
      {breakPeriods.length ? (
        <section className="staff-attendance-evidence-block">
          <p className="staff-kicker">BREAKS</p>
          {breakPeriods.map((period, index) => (
            <div className="staff-evidence-line" key={`${period.startAt}-${index}`}>
              <span>Break {breakPeriods.length > 1 ? index + 1 : ""}</span>
              <strong>{formatTime(period.startAt, timezone)} – {period.endAt ? formatTime(period.endAt, timezone) : "In progress"}</strong>
            </div>
          ))}
          <div className="staff-evidence-line"><span>Canonical total</span><strong>{formatCompactDuration(item.actual.totalBreakMinutes)}</strong></div>
        </section>
      ) : null}

      {locationEvidence.length ? (
        <section className="staff-attendance-evidence-block">
          <p className="staff-kicker">LOCATION EVIDENCE</p>
          {locationEvidence.map((evidence) => (
            <div className="staff-evidence-line" key={evidence.punchId}>
              <span>{evidence.type === "CLOCK_IN" ? "Clock-in" : "Clock-out"}</span>
              <strong>{locationEvidenceLabel(evidence.geofenceStatus)}</strong>
              <small>Punch recorded{evidence.accuracyMeters === null ? "" : ` · Accuracy ${Math.round(evidence.accuracyMeters)} m`}</small>
            </div>
          ))}
        </section>
      ) : null}

      {adjusted || approvalLabels.length ? (
        <section className="staff-attendance-evidence-block">
          <p className="staff-kicker">ADJUSTMENT</p>
          <div className="staff-evidence-line">
            <span>Status</span>
            <strong>{approvalLabels[0] ?? "Attendance adjusted"}</strong>
          </div>
          <div className="staff-evidence-line">
            <span>Final attendance</span>
            <strong>{formatActualRange(item, timezone)}</strong>
          </div>
        </section>
      ) : null}

      {item.sessions.length ? (
        <div className="staff-punch-status-note">
          Punch status: {item.sessions.map((session) => humanize(session.punchStatus)).join(", ")}
        </div>
      ) : null}
    </>
  );
}

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function formatWorkDate(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatCompactWorkDate(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatFullWorkDate(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).format(new Date(value));
}

function formatActualRange(item: AttendanceHistoryItem, timezone: string) {
  const { clockInAt, clockOutAt } = item.actual;
  if (!clockInAt && !clockOutAt) return "No punches recorded";
  return `${clockInAt ? formatTime(clockInAt, timezone) : "—"} – ${clockOutAt ? formatTime(clockOutAt, timezone) : "—"}`;
}

function formatCompactDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder}m`;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function scheduledLabel(item: AttendanceHistoryItem, timezone: string) {
  if (!item.scheduled?.startAt || !item.scheduled.endAt) return "No scheduled time";
  return `${formatTime(item.scheduled.startAt, timezone)} – ${formatTime(item.scheduled.endAt, timezone)}`;
}

function scheduledKindLabel(kind: string | null) {
  switch (kind) {
    case "WORKDAY": return "Published workday";
    case "REST_DAY": return "Rest day";
    case "PUBLIC_HOLIDAY": return "Public holiday";
    case "NOT_SCHEDULED": return "Not scheduled";
    default: return "No expected work evidence";
  }
}

function attentionStateLabel(status: string) {
  if (status === "PENDING_EMPLOYEE" || status === "RETURNED_FOR_CORRECTION") return "Action required";
  if (status === "RESOLVED" || status === "CLOSED") return "Resolved";
  return "Pending review";
}

function locationEvidenceLabel(status: string) {
  switch (status) {
    case "INSIDE": return "Inside work location";
    case "OUTSIDE": return "Outside work location";
    case "GPS_INACCURATE": return "Low GPS accuracy";
    case "GPS_UNAVAILABLE": return "GPS unavailable";
    case "GEOFENCE_DISABLED": return "Location check not required";
    default: return "Location evidence recorded";
  }
}

function humanize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}
