"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  formatMinutesAsHours,
  getOrCreateDeviceIdentifier,
  gpsStatusLabel,
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
  const [branchId, setBranchId] = useState("");
  const [status, setStatus] = useState("");
  const [draftFrom, setDraftFrom] = useState(defaults.from);
  const [draftTo, setDraftTo] = useState(defaults.to);
  const [draftBranchId, setDraftBranchId] = useState("");
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
  const [correctionBranchId, setCorrectionBranchId] = useState("");
  const [requestedClockInAt, setRequestedClockInAt] = useState("");
  const [requestedClockOutAt, setRequestedClockOutAt] = useState("");
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [correctionMessage, setCorrectionMessage] = useState("");
  const [knownBranches, setKnownBranches] = useState<Array<{ id: string; name: string }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      from,
      to,
      page: String(page),
      pageSize: "12",
    });
    if (branchId) params.set("branchId", branchId);
    if (status) params.set("status", status);

    try {
      const result = await staffApiFetch<{ ok: true; data: AttendanceHistory }>(
        `/api/employee-attendance/history?${params.toString()}`,
      );
      setHistory(result.data);
      setKnownBranches((current) => {
        const map = new Map(
          [...current, ...result.data.availableBranches].map((branch) => [
            branch.id,
            branch,
          ]),
        );
        for (const item of result.data.items) {
          map.set(item.branch.id, item.branch);
        }
        return [...map.values()].sort((left, right) => left.name.localeCompare(right.name));
      });
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
  }, [branchId, from, page, router, status, to]);

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
    setBranchId(draftBranchId);
    setStatus(draftStatus);
    setFiltersOpen(false);
    setPage(1);
  }

  function openFilters() {
    setDraftFrom(from);
    setDraftTo(to);
    setDraftBranchId(branchId);
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
          branchId: correctionBranchId,
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
            <label>
              Branch
              <select
                onChange={(event) => setCorrectionBranchId(event.target.value)}
                required
                value={correctionBranchId}
              >
                <option value="">Select branch</option>
                {(history?.availableBranches ?? knownBranches).map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </label>
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
                    .filter(
                      (item) =>
                        !item.clockOutAt &&
                        item.status !== "COMPLETED" &&
                        item.status !== "CANCELLED",
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.workDate} / {item.branch.name} / {humanize(item.status)}
                      </option>
                    ))}
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
            <button
              className="staff-primary-button"
              disabled={correctionSubmitting}
              type="submit"
            >
              {correctionSubmitting ? "Submitting…" : "Submit for review"}
            </button>
            {correctionMessage ? <small>{correctionMessage}</small> : null}
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
              {branchId || status || from !== defaults.from || to !== defaults.to
                ? "Custom filters applied"
                : "All branches · All statuses"}
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
              <label>
                From
                <input onChange={(event) => setDraftFrom(event.target.value)} type="date" value={draftFrom} />
              </label>
              <label>
                To
                <input onChange={(event) => setDraftTo(event.target.value)} type="date" value={draftTo} />
              </label>
              <label>
                Branch
                <select onChange={(event) => setDraftBranchId(event.target.value)} value={draftBranchId}>
                  <option value="">All branches</option>
                  {knownBranches.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select onChange={(event) => setDraftStatus(event.target.value)} value={draftStatus}>
                  <option value="">All statuses</option>
                  <option value="OPEN">Open</option>
                  <option value="ON_BREAK">On break</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="INCOMPLETE">Incomplete</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </label>
              <button className="staff-primary-button" type="submit">Apply filters</button>
              <small>Date ranges are limited to 31 days.</small>
            </form>
          </section>
        </div>
      ) : null}

      {error ? <div className="staff-alert error" role="alert">{error}</div> : null}
      {loading && !history ? <StaffLoading label="Loading attendance history…" /> : null}

      {history ? (
        <>
          <section className="staff-history-list" aria-busy={loading}>
            {history.items.map((item) => <HistoryCard item={item} key={item.id} />)}
            {!history.items.length ? (
              <div className="staff-empty-state">
                <span aria-hidden="true">◷</span>
                <h2>No attendance records</h2>
                <p>No records match this date range and filters.</p>
              </div>
            ) : null}
          </section>
          <div className="staff-pagination">
            <button
              disabled={loading || history.pagination.page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              type="button"
            >
              Previous
            </button>
            <span>
              Page {history.pagination.page} of {Math.max(1, history.pagination.totalPages)}
              <small>{history.pagination.total} records</small>
            </span>
            <button
              disabled={
                loading ||
                history.pagination.page >= Math.max(1, history.pagination.totalPages)
              }
              onClick={() => setPage((current) => current + 1)}
              type="button"
            >
              Next
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function HistoryCard({ item }: { item: AttendanceHistoryItem }) {
  return (
    <article className="staff-history-card">
      <div className="staff-history-card-header">
        <div>
          <strong>{formatWorkDate(item.workDate)}</strong>
          <small>{item.branch.name}</small>
        </div>
        <span className={`staff-status-chip ${item.status.toLowerCase()}`}>
          {humanize(item.status)}
        </span>
      </div>
      <div className="staff-history-times">
        <span><small>Clock in</small><strong>{formatTime(item.clockInAt)}</strong></span>
        <span><small>Clock out</small><strong>{item.clockOutAt ? formatTime(item.clockOutAt) : "—"}</strong></span>
        <span><small>Break</small><strong>{item.totalBreakMinutes} min</strong></span>
        <span><small>Worked</small><strong>{formatMinutesAsHours(item.totalWorkedMinutes)}</strong></span>
      </div>
      <div className="staff-history-flags">
        <span>{gpsStatusLabel(item.geofenceStatus)}</span>
        <span>{item.requiresApproval ? `Approval: ${humanize(item.approvalStatus)}` : "No approval required"}</span>
        {item.adjusted ? <span className="adjusted">Adjusted</span> : null}
      </div>
    </article>
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

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function humanize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}
