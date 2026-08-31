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
import { getMissingClockOutCorrectionState } from "@/lib/staff-pwa/attendance-correction-eligibility";
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
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionType, setCorrectionType] = useState<
    "FORGOT_CLOCK_IN" | "FORGOT_CLOCK_OUT"
  >("FORGOT_CLOCK_OUT");
  const [correctionSessionId, setCorrectionSessionId] = useState("");
  const [correctionBranchId, setCorrectionBranchId] = useState("");
  const [requestedClockInAt, setRequestedClockInAt] = useState("");
  const [requestedClockOutAt, setRequestedClockOutAt] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [correctionMessage, setCorrectionMessage] = useState("");
  const [knownBranches, setKnownBranches] = useState<Array<{ id: string; name: string }>>([]);
  const availableBranches = history?.availableBranches.length ? history.availableBranches : knownBranches;
  const hasSingleBranch = availableBranches.length === 1;
  const hasMultipleBranches = availableBranches.length > 1;

  useEffect(() => {
    if (window.location.hash === "#attendance-correction") setCorrectionOpen(true);
  }, []);
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
      if (result.data.availableBranches.length === 1) {
        setCorrectionBranchId(result.data.availableBranches[0]?.id ?? "");
      }
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

  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (page === 1) {
      void load();
    } else {
      setPage(1);
    }
  }

  function openMissingClockOutCorrection(item: AttendanceHistoryItem) {
    setCorrectionType("FORGOT_CLOCK_OUT");
    setCorrectionSessionId(item.id);
    setCorrectionBranchId(item.branch.id);
    setRequestedClockOutAt("");
    setCorrectionMessage("");
    setCorrectionOpen(true);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document
          .getElementById("attendance-correction")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
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
          reason: correctionReason,
          deviceIdentifier: getOrCreateDeviceIdentifier(),
        }),
      });
      setCorrectionMessage(
        result.data.duplicate
          ? "This request is already pending."
          : "Request submitted for manager review.",
      );
      setCorrectionReason("");
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
      <section className="staff-page-title">
        <p className="staff-kicker">ATTENDANCE</p>
        <h1>Attendance history</h1>
        <p>Review your actual clock-ins, hours and attendance status.</p>
        <button
          className="staff-secondary-button"
          onClick={() => setCorrectionOpen((current) => !current)}
          type="button"
        >
          {correctionOpen ? "Close request" : "Report a missing punch"}
        </button>
      </section>

      {correctionOpen ? (
        <section className="staff-page-card" id="attendance-correction">
          <div className="staff-card-heading">
            <div>
              <p className="staff-kicker">ATTENDANCE CORRECTION</p>
              <h2>Request an attendance correction</h2>
            </div>
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
            {!hasSingleBranch ? (
              <label>
                Branch
                <select
                  onChange={(event) => setCorrectionBranchId(event.target.value)}
                  required
                  value={correctionBranchId}
                >
                  <option value="">Select branch</option>
                  {availableBranches.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
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
                        getMissingClockOutCorrectionState(item) === "ACTIONABLE",
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {formatWorkDate(item.workDate)} · {item.branch.name} · {humanize(item.status)}
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
            <label>
              Reason
              <input
                maxLength={500}
                minLength={3}
                onChange={(event) => setCorrectionReason(event.target.value)}
                required
                value={correctionReason}
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
      ) : null}

      <section className="staff-page-card">
        <form className="staff-history-filters" onSubmit={filter}>
          <label>
            From
            <input onChange={(event) => setFrom(event.target.value)} type="date" value={from} />
          </label>
          <label>
            To
            <input onChange={(event) => setTo(event.target.value)} type="date" value={to} />
          </label>
          {hasMultipleBranches ? (
            <label>
              Branch
              <select onChange={(event) => setBranchId(event.target.value)} value={branchId}>
                <option value="">All branches</option>
                {availableBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Status
            <select onChange={(event) => setStatus(event.target.value)} value={status}>
              <option value="">All statuses</option>
              <option value="OPEN">Open</option>
              <option value="ON_BREAK">On break</option>
              <option value="COMPLETED">Completed</option>
              <option value="INCOMPLETE">Incomplete</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </label>
          <button className="staff-secondary-button" type="submit">Apply filters</button>
          <small>Date ranges are limited to 31 days.</small>
        </form>
      </section>

      {error ? <div className="staff-alert error" role="alert">{error}</div> : null}
      {loading && !history ? <StaffLoading label="Loading attendance history…" /> : null}

      {history ? (
        <>
          <section className="staff-history-list" aria-busy={loading} aria-label="Attendance history">
            {history.items.map((item) => (
              <HistoryCard
                item={item}
                key={item.id}
                onSubmitCorrection={openMissingClockOutCorrection}
              />
            ))}
            {!history.items.length ? (
              <div className="staff-empty-state">
                <span aria-hidden="true">◷</span>
                <h2>No attendance records</h2>
                <p>No records match this date range and filters.</p>
              </div>
            ) : null}
          </section>
          {history.pagination.totalPages > 1 ? <div className="staff-pagination">
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
          </div> : null}
        </>
      ) : null}
    </div>
  );
}
function HistoryCard({
  item,
  onSubmitCorrection,
}: {
  item: AttendanceHistoryItem;
  onSubmitCorrection: (item: AttendanceHistoryItem) => void;
}) {
  const correctionState = getMissingClockOutCorrectionState(item);

  return (
    <article className="staff-history-card" id={`attendance-record-${item.id}`}>
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
      {correctionState === "ACTIONABLE" ? (
        <div className="staff-history-actions">
          <div>
            <strong>Missing clock out</strong>
            <small>Add the correct clock-out time for manager review.</small>
          </div>
          <button
            className="staff-secondary-button"
            onClick={() => onSubmitCorrection(item)}
            type="button"
          >
            Submit correction
          </button>
        </div>
      ) : null}
      {correctionState === "PENDING" ? (
        <div className="staff-history-actions pending" role="status">
          <div>
            <strong>Correction pending</strong>
            <small>Your manager has this request for review.</small>
          </div>
        </div>
      ) : null}
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
