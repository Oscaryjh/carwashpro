"use client";

import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  formatMinutesAsHours,
  getOrCreateDeviceIdentifier,
  isEmployeeSessionError,
  StaffApiError,
  staffApiFetch,
} from "@/lib/staff-pwa/client";
import {
  attendanceHistoryPeriodLabel,
  attendanceHistoryStatusFilterLabel,
  getAttendanceHistoryV2Status,
} from "@/lib/staff-pwa/attendance-history-v2";
import { getMissingClockOutCorrectionState } from "@/lib/staff-pwa/attendance-correction-eligibility";
import type {
  AttendanceHistory,
  AttendanceHistoryItem,
} from "@/lib/staff-pwa/types";
import {
  StaffV2EmptyState,
  StaffV2FilterChip,
  StaffV2FormSection,
  StaffV2PageHeader,
  StaffV2RowGroup,
  StaffV2StatusBadge,
  staffV2Styles,
} from "./staff-v2-primitives";
import { useStaffShell } from "./staff-pwa-chrome";
import styles from "./staff-attendance-history-v2.module.css";

type HistoryFilters = {
  from: string;
  to: string;
  branchId: string;
  status: string;
};

export function StaffHistory() {
  const router = useRouter();
  const { setTaskNavigationHidden } = useStaffShell();
  const defaults = useMemo(() => defaultRange(), []);
  const initialFilters = useMemo<HistoryFilters>(() => ({
    ...defaults,
    branchId: "",
    status: "",
  }), [defaults]);
  const [history, setHistory] = useState<AttendanceHistory | null>(null);
  const [filters, setFilters] = useState<HistoryFilters>(initialFilters);
  const [draftFilters, setDraftFilters] = useState<HistoryFilters>(initialFilters);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterError, setFilterError] = useState("");
  const filterDialogRef = useRef<HTMLDialogElement>(null);
  const correctionDialogRef = useRef<HTMLDialogElement>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionContextual, setCorrectionContextual] = useState(false);
  const [correctionType, setCorrectionType] = useState<
    "FORGOT_CLOCK_IN" | "FORGOT_CLOCK_OUT"
  >("FORGOT_CLOCK_OUT");
  const [correctionSessionId, setCorrectionSessionId] = useState("");
  const [correctionBranchId, setCorrectionBranchId] = useState("");
  const [requestedClockInAt, setRequestedClockInAt] = useState("");
  const [requestedClockOutAt, setRequestedClockOutAt] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [correctionError, setCorrectionError] = useState("");
  const availableBranches = history?.availableBranches ?? [];
  const hasSingleBranch = availableBranches.length === 1;
  const hasMultipleBranches = availableBranches.length > 1;
  const actionableSessions = (history?.items ?? []).filter(
    (item) => getMissingClockOutCorrectionState(item) === "ACTIONABLE",
  );
  const selectedCorrectionSession = (history?.items ?? []).find(
    (item) => item.id === correctionSessionId,
  );

  useEffect(() => {
    if (window.location.hash === "#attendance-correction") {
      setCorrectionContextual(false);
      setCorrectionOpen(true);
    }
  }, []);

  useEffect(() => {
    syncDialog(filterDialogRef.current, filterOpen);
  }, [filterOpen]);

  useEffect(() => {
    syncDialog(correctionDialogRef.current, correctionOpen);
  }, [correctionOpen]);

  useEffect(() => {
    const modalOpen = filterOpen || correctionOpen;
    setTaskNavigationHidden(modalOpen);
    return () => setTaskNavigationHidden(false);
  }, [correctionOpen, filterOpen, setTaskNavigationHidden]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      from: filters.from,
      to: filters.to,
      page: String(page),
      pageSize: "12",
    });
    if (filters.branchId) params.set("branchId", filters.branchId);
    if (filters.status) params.set("status", filters.status);

    try {
      const result = await staffApiFetch<{ ok: true; data: AttendanceHistory }>(
        `/api/employee-attendance/history?${params.toString()}`,
      );
      setHistory(result.data);
      if (result.data.availableBranches.length === 1) {
        setCorrectionBranchId(result.data.availableBranches[0]?.id ?? "");
      }
    } catch (caught) {
      if (caught instanceof StaffApiError && isEmployeeSessionError(caught.code)) {
        router.replace("/staff/login?reason=session-expired");
        return;
      }
      setError("Attendance couldn't load. Try again.");
    } finally {
      setLoading(false);
    }
  }, [filters, page, router]);

  useEffect(() => {
    void load();
  }, [load]);

  function openFilters() {
    setDraftFilters(filters);
    setFilterError("");
    setFilterOpen(true);
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateHistoryRange(draftFilters.from, draftFilters.to);
    if (validation) {
      setFilterError(validation);
      return;
    }
    setFilterError("");
    setPage(1);
    setFilters(draftFilters);
    setFilterOpen(false);
  }

  function resetFilters() {
    setFilterError("");
    setDraftFilters(initialFilters);
    setPage(1);
    setFilters(initialFilters);
    setFilterOpen(false);
  }

  function openMissingClockOutCorrection(item: AttendanceHistoryItem) {
    setCorrectionContextual(true);
    setCorrectionType("FORGOT_CLOCK_OUT");
    setCorrectionSessionId(item.id);
    setCorrectionBranchId(item.branch.id);
    setRequestedClockInAt("");
    setRequestedClockOutAt("");
    setCorrectionReason("");
    setCorrectionError("");
    setSuccessMessage("");
    setCorrectionOpen(true);
  }

  function openGenericCorrection() {
    setCorrectionContextual(false);
    setCorrectionType("FORGOT_CLOCK_OUT");
    setCorrectionSessionId("");
    setCorrectionBranchId(availableBranches[0]?.id ?? "");
    setRequestedClockInAt("");
    setRequestedClockOutAt("");
    setCorrectionReason("");
    setCorrectionError("");
    setSuccessMessage("");
    setCorrectionOpen(true);
  }

  async function submitCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCorrectionSubmitting(true);
    setCorrectionError("");
    setSuccessMessage("");
    try {
      const requestedClockIn = requestedClockInAt ? new Date(requestedClockInAt) : null;
      const requestedClockOut = requestedClockOutAt ? new Date(requestedClockOutAt) : null;
      const result = await staffApiFetch<{
        ok: true;
        data: { duplicate: boolean };
      }>("/api/employee-attendance/exception", {
        method: "POST",
        body: JSON.stringify({
          branchId: correctionBranchId,
          attendanceSessionId: correctionType === "FORGOT_CLOCK_OUT" ? correctionSessionId : null,
          attendancePunchId: null,
          type: correctionType,
          requestedClockInAt:
            correctionType === "FORGOT_CLOCK_IN" && requestedClockIn && Number.isFinite(requestedClockIn.getTime())
              ? requestedClockIn.toISOString()
              : null,
          requestedClockOutAt:
            requestedClockOut && Number.isFinite(requestedClockOut.getTime())
              ? requestedClockOut.toISOString()
              : null,
          reason: correctionReason,
          deviceIdentifier: getOrCreateDeviceIdentifier(),
        }),
      });
      setSuccessMessage(
        result.data.duplicate
          ? "This correction is already waiting for your manager."
          : "Correction sent to your manager.",
      );
      setCorrectionOpen(false);
      setCorrectionReason("");
      await load();
    } catch (caught) {
      if (caught instanceof StaffApiError && isEmployeeSessionError(caught.code)) {
        router.replace("/staff/login?reason=session-expired");
        return;
      }
      setCorrectionError(
        caught instanceof StaffApiError
          ? caught.message
          : "Unable to submit the correction. Try again.",
      );
    } finally {
      setCorrectionSubmitting(false);
    }
  }

  const periodLabel = attendanceHistoryPeriodLabel(filters.from, filters.to);

  return (
    <section className={`${staffV2Styles.scope} ${styles.page}`} aria-label="Attendance history">
      <StaffV2PageHeader title="Attendance history" meta="Your actual clock-ins and worked time." />

      <div className={styles.periodBar}>
        <div>
          <strong>{periodLabel}</strong>
          {filters.branchId ? (
            <small>{availableBranches.find((branch) => branch.id === filters.branchId)?.name}</small>
          ) : null}
        </div>
        <StaffV2FilterChip onClick={openFilters}>
          {attendanceHistoryStatusFilterLabel(filters.status)}
        </StaffV2FilterChip>
      </div>

      {successMessage ? <div className={styles.success} role="status">{successMessage}</div> : null}
      {error ? (
        <div className={staffV2Styles.inlineError} role="alert">
          <span><strong>Attendance couldn&apos;t load.</strong><small>Please check your connection and try again.</small></span>
          <button className={styles.textButton} onClick={() => void load()} type="button">Try again</button>
        </div>
      ) : null}

      {loading && !history ? <HistorySkeleton /> : null}

      {history ? (
        <>
          <section aria-busy={loading} aria-label="Attendance records" className={styles.records}>
            {history.items.length ? (
              <StaffV2RowGroup ariaLabel="Attendance records" className={styles.recordGroup}>
                {history.items.map((item) => (
                  <HistoryRow
                    hasMultipleBranches={hasMultipleBranches}
                    item={item}
                    key={item.id}
                    onSubmitCorrection={openMissingClockOutCorrection}
                  />
                ))}
              </StaffV2RowGroup>
            ) : (
              <StaffV2EmptyState
                title="No attendance records in this period."
                description="Try another date range."
              />
            )}
          </section>

          {history.pagination.totalPages > 1 ? (
            <nav aria-label="Attendance history pages" className={styles.pagination}>
              <button
                disabled={loading || history.pagination.page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                type="button"
              >Previous</button>
              <span aria-live="polite">{history.pagination.page} / {history.pagination.totalPages}</span>
              <button
                disabled={loading || history.pagination.page >= history.pagination.totalPages}
                onClick={() => setPage((current) => current + 1)}
                type="button"
              >Next</button>
            </nav>
          ) : null}

          <button className={styles.fallbackAction} onClick={openGenericCorrection} type="button">
            Report another missing punch
          </button>
        </>
      ) : null}

      <dialog
        aria-labelledby="attendance-history-filter-title"
        className={styles.dialog}
        onCancel={() => setFilterOpen(false)}
        onClose={() => setFilterOpen(false)}
        onClick={(event) => {
          if (event.currentTarget === event.target) setFilterOpen(false);
        }}
        ref={filterDialogRef}
      >
        <section className={styles.sheet}>
          <SheetHeading
            id="attendance-history-filter-title"
            kicker="ATTENDANCE"
            onClose={() => setFilterOpen(false)}
            title="Filter history"
          />
          <form className={styles.form} onSubmit={applyFilters}>
            <StaffV2FormSection>
              <div className={styles.dateFields}>
                <label>
                  From
                  <input
                    aria-describedby="history-range-hint history-filter-error"
                    onChange={(event) => setDraftFilters((current) => ({ ...current, from: event.target.value }))}
                    required
                    type="date"
                    value={draftFilters.from}
                  />
                </label>
                <label>
                  To
                  <input
                    aria-describedby="history-range-hint history-filter-error"
                    onChange={(event) => setDraftFilters((current) => ({ ...current, to: event.target.value }))}
                    required
                    type="date"
                    value={draftFilters.to}
                  />
                </label>
              </div>
              <label>
                Status
                <select
                  onChange={(event) => setDraftFilters((current) => ({ ...current, status: event.target.value }))}
                  value={draftFilters.status}
                >
                  <option value="">All statuses</option>
                  <option value="OPEN">In progress</option>
                  <option value="ON_BREAK">On break</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="INCOMPLETE">Incomplete records</option>
                  <option value="CANCELLED">Cancelled records</option>
                </select>
              </label>
              {hasMultipleBranches ? (
                <label>
                  Branch
                  <select
                    onChange={(event) => setDraftFilters((current) => ({ ...current, branchId: event.target.value }))}
                    value={draftFilters.branchId}
                  >
                    <option value="">All branches</option>
                    {availableBranches.map((branch) => (
                      <option key={branch.id} value={branch.id}>{branch.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <small id="history-range-hint">Choose up to 31 days.</small>
              {filterError ? <p className={styles.fieldError} id="history-filter-error" role="alert">{filterError}</p> : null}
            </StaffV2FormSection>
            <div className={styles.sheetActions}>
              <button className={styles.primaryButton} type="submit">Apply filters</button>
              <button className={styles.secondaryButton} onClick={resetFilters} type="button">Reset</button>
            </div>
          </form>
        </section>
      </dialog>

      <dialog
        aria-labelledby="attendance-correction-title"
        className={styles.dialog}
        id="attendance-correction"
        onCancel={() => !correctionSubmitting && setCorrectionOpen(false)}
        onClose={() => setCorrectionOpen(false)}
        onClick={(event) => {
          if (event.currentTarget === event.target && !correctionSubmitting) setCorrectionOpen(false);
        }}
        ref={correctionDialogRef}
      >
        <section className={styles.sheet}>
          <SheetHeading
            id="attendance-correction-title"
            kicker="ATTENDANCE CORRECTION"
            onClose={() => setCorrectionOpen(false)}
            title={correctionContextual ? "Correct attendance" : "Report a missing punch"}
          />
          <form className={styles.form} onSubmit={submitCorrection}>
            <StaffV2FormSection>
              {correctionContextual && selectedCorrectionSession ? (
                <div className={styles.correctionContext}>
                  <strong>{formatWorkDate(selectedCorrectionSession.workDate)}</strong>
                  <span>Clocked in {formatTime(selectedCorrectionSession.clockInAt)}</span>
                  <span>Clock out missing</span>
                </div>
              ) : (
                <label>
                  Missing action
                  <select
                    onChange={(event) => {
                      setCorrectionType(event.target.value as "FORGOT_CLOCK_IN" | "FORGOT_CLOCK_OUT");
                      setCorrectionSessionId("");
                      setRequestedClockInAt("");
                      setRequestedClockOutAt("");
                    }}
                    value={correctionType}
                  >
                    <option value="FORGOT_CLOCK_OUT">Forgot clock out</option>
                    <option value="FORGOT_CLOCK_IN">Forgot clock in</option>
                  </select>
                </label>
              )}

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

              {correctionType === "FORGOT_CLOCK_OUT" && !correctionContextual ? (
                <label>
                  Attendance record
                  <select
                    onChange={(event) => {
                      const item = actionableSessions.find((session) => session.id === event.target.value);
                      setCorrectionSessionId(event.target.value);
                      if (item) setCorrectionBranchId(item.branch.id);
                    }}
                    required
                    value={correctionSessionId}
                  >
                    <option value="">Select attendance record</option>
                    {actionableSessions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {formatWorkDate(item.workDate)} · {formatTime(item.clockInAt)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {correctionType === "FORGOT_CLOCK_IN" ? (
                <label>
                  Requested clock-in time
                  <input
                    onChange={(event) => setRequestedClockInAt(event.target.value)}
                    required
                    type="datetime-local"
                    value={requestedClockInAt}
                  />
                </label>
              ) : null}

              <label>
                Requested clock-out time
                <input
                  onChange={(event) => setRequestedClockOutAt(event.target.value)}
                  required={correctionType === "FORGOT_CLOCK_OUT"}
                  type="datetime-local"
                  value={requestedClockOutAt}
                />
              </label>
              <label>
                Reason
                <textarea
                  aria-describedby="attendance-correction-reason-hint"
                  maxLength={500}
                  minLength={3}
                  onChange={(event) => setCorrectionReason(event.target.value)}
                  required
                  rows={3}
                  value={correctionReason}
                />
              </label>
              <small id="attendance-correction-reason-hint">Briefly explain the missing time.</small>
              {correctionError ? <p className={styles.fieldError} role="alert">{correctionError}</p> : null}
            </StaffV2FormSection>
            <button className={styles.primaryButton} disabled={correctionSubmitting} type="submit">
              {correctionSubmitting ? "Submitting…" : "Submit correction"}
            </button>
          </form>
        </section>
      </dialog>
    </section>
  );
}

function HistoryRow({
  item,
  hasMultipleBranches,
  onSubmitCorrection,
}: {
  item: AttendanceHistoryItem;
  hasMultipleBranches: boolean;
  onSubmitCorrection: (item: AttendanceHistoryItem) => void;
}) {
  const status = getAttendanceHistoryV2Status(item);
  const missingClockOut = !item.clockOutAt && item.status === "INCOMPLETE";
  const meta = missingClockOut
    ? status.correctionState === "PENDING"
      ? "Missing clock out correction"
      : `Missing clock out · Clocked in ${formatTime(item.clockInAt)}`
    : `${formatClockRange(item)} · Worked ${formatMinutesAsHours(item.totalWorkedMinutes)}`;

  return (
    <article className={styles.record} id={`attendance-record-${item.id}`} role="listitem">
      <details>
        <summary aria-label={`${formatWorkDate(item.workDate)}. ${status.label}. ${meta}. Open attendance details.`}>
          <time dateTime={item.workDate}>{formatShortDate(item.workDate)}</time>
          <span className={styles.recordCopy}>
            <StaffV2StatusBadge tone={status.tone}>{status.label}</StaffV2StatusBadge>
            <span>{meta}</span>
            {hasMultipleBranches ? <small>{item.branch.name}</small> : null}
          </span>
          <span aria-hidden="true" className={styles.chevron}>›</span>
        </summary>
        <div className={styles.recordDetail}>
          <div className={styles.detailHeading}>
            <strong>{formatWorkDate(item.workDate)}</strong>
            <StaffV2StatusBadge tone={status.tone}>{status.label}</StaffV2StatusBadge>
          </div>
          <section>
            <h3>Attendance</h3>
            <dl>
              <div><dt>Clock in</dt><dd>{formatTime(item.clockInAt)}</dd></div>
              <div><dt>Clock out</dt><dd>{item.clockOutAt ? formatTime(item.clockOutAt) : "Missing"}</dd></div>
              <div><dt>Break</dt><dd>{item.totalBreakMinutes} min</dd></div>
              <div><dt>Worked</dt><dd>{formatMinutesAsHours(item.totalWorkedMinutes)}</dd></div>
              <div><dt>Branch</dt><dd>{item.branch.name}</dd></div>
            </dl>
          </section>
          {missingClockOut || item.adjusted || item.geofenceStatus ? (
            <section>
              <h3>Attendance details</h3>
              <dl>
                {missingClockOut ? (
                  <div><dt>Clock out</dt><dd>{status.correctionState === "PENDING" ? "Waiting for manager" : "Missing"}</dd></div>
                ) : null}
                {item.adjusted ? <div><dt>Adjustment</dt><dd>Recorded</dd></div> : null}
                {item.geofenceStatus ? <div><dt>Clock-in location</dt><dd>{geofenceDetail(item.geofenceStatus)}</dd></div> : null}
              </dl>
            </section>
          ) : null}
        </div>
      </details>
      {status.correctionState === "ACTIONABLE" ? (
        <div className={styles.recordAction}>
          <span><strong>Missing clock out</strong><small>Add the correct time for manager review.</small></span>
          <button onClick={() => onSubmitCorrection(item)} type="button">Submit correction</button>
        </div>
      ) : null}
      {status.correctionState === "PENDING" ? (
        <p className={styles.pendingNote}>No action needed — your manager is reviewing this correction.</p>
      ) : null}
    </article>
  );
}

function SheetHeading({
  id,
  kicker,
  onClose,
  title,
}: {
  id: string;
  kicker: string;
  onClose: () => void;
  title: string;
}) {
  return (
    <header className={styles.sheetHeading}>
      <div><small>{kicker}</small><h2 id={id}>{title}</h2></div>
      <button aria-label={`Close ${title}`} onClick={onClose} type="button">×</button>
    </header>
  );
}

export function HistorySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading attendance history" className={styles.loading} role="status">
      <span className={styles.periodSkeleton} />
      <span className={styles.rowSkeleton} />
      <span className={styles.rowSkeleton} />
      <span className={styles.rowSkeleton} />
      <span className={staffV2Styles.srOnly}>Loading attendance history…</span>
    </div>
  );
}

function syncDialog(dialog: HTMLDialogElement | null, open: boolean) {
  if (!dialog) return;
  if (open && !dialog.open) dialog.showModal();
  if (!open && dialog.open) dialog.close();
}

function validateHistoryRange(from: string, to: string) {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime())) {
    return "Choose a valid From and To date.";
  }
  if (fromDate > toDate) return "From date must be before To date.";
  const days = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  return days > 31 ? "Choose a date range of 31 days or less." : "";
}

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
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
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatClockRange(item: AttendanceHistoryItem) {
  return item.clockOutAt
    ? `${formatTime(item.clockInAt)} – ${formatTime(item.clockOutAt)}`
    : `Clocked in ${formatTime(item.clockInAt)}`;
}

function geofenceDetail(status: string) {
  if (status === "INSIDE") return "Within workplace area";
  if (status === "OUTSIDE") return "Outside workplace area";
  if (status === "GPS_INACCURATE") return "Location accuracy was insufficient";
  if (status === "GPS_UNAVAILABLE") return "Location was unavailable";
  if (status === "GEOFENCE_DISABLED") return "Location check was not required";
  return "Location evidence recorded";
}
