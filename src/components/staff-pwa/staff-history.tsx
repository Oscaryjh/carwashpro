"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  formatMinutesAsHours,
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
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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
        const map = new Map(current.map((branch) => [branch.id, branch]));
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

  return (
    <div className="staff-history-stack">
      <section className="staff-page-title">
        <p className="staff-kicker">MY ATTENDANCE</p>
        <h1>History</h1>
        <p>Only your own Attendance records are shown.</p>
      </section>

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
          <label>
            Branch
            <select onChange={(event) => setBranchId(event.target.value)} value={branchId}>
              <option value="">All branches</option>
              {knownBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
          </label>
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
