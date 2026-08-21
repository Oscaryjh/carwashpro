"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  attendanceActionLabel,
  attendanceConfirmation,
  createAttendanceIdempotencyKey,
  formatMinutesAsHours,
  getOrCreateDeviceIdentifier,
  gpsStatusLabel,
  isEmployeeSessionError,
  StaffApiError,
  staffApiFetch,
  wasBreakEndedRecently,
} from "@/lib/staff-pwa/client";
import type {
  AttendanceAction,
  AttendancePunchResult,
  AttendanceToday,
} from "@/lib/staff-pwa/types";
import { StaffLoading } from "./staff-auth";
import { StaffResolutionCases } from "./staff-resolution-cases";

type GpsEvidence = {
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  status: string;
};

type PendingPunch = {
  action: AttendanceAction;
  idempotencyKey: string;
  gps: GpsEvidence;
  deviceTimestamp: string;
  confirmedBreakMinutes?: number | null;
  breakExceptionReason?: string | null;
};

export function StaffToday() {
  const router = useRouter();
  const mounted = useRef(true);
  const [today, setToday] = useState<AttendanceToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmAction, setConfirmAction] = useState<AttendanceAction | null>(null);
  const [gpsStatus, setGpsStatus] = useState("");
  const [pendingPunch, setPendingPunch] = useState<PendingPunch | null>(null);
  const [confirmedBreakMinutes, setConfirmedBreakMinutes] = useState("60");
  const [breakExceptionReason, setBreakExceptionReason] = useState("");
  const [exceptionPrompt, setExceptionPrompt] = useState<PendingPunch | null>(null);
  const [exceptionFormOpen, setExceptionFormOpen] = useState(false);
  const [exceptionReason, setExceptionReason] = useState("");
  const [exceptionError, setExceptionError] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const todayResult = await staffApiFetch<{ ok: true; data: AttendanceToday }>(
        "/api/employee-attendance/today",
      );
      if (!mounted.current) return;
      setToday(todayResult.data);
      if (!silent) setGpsStatus("");
    } catch (caught) {
      handleSessionOrError(caught, router, setError);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  if (loading && !today) {
    return <StaffLoading label="Loading today’s attendance…" />;
  }
  if (!today) {
    return (
      <section className="staff-page-card">
        <div className="staff-alert error" role="alert">{error || "Unable to load Attendance."}</div>
        <button className="staff-primary-button" onClick={() => load()} type="button">
          Try again
        </button>

      </section>
    );
  }

  function openConfirmation(action: AttendanceAction) {
    if (action === "CLOCK_OUT") {
      setConfirmedBreakMinutes(
        String(today?.workPolicy.expectedBreakMinutes ?? 60),
      );
      setBreakExceptionReason("");
    }
    setError("");
    setConfirmAction(action);
  }

  async function confirmAndPunch() {
    const action = confirmAction;
    if (!action || !today || busy) return;
    let breakMinutes: number | null = null;
    let shortBreakReason: string | null = null;
    if (
      action === "CLOCK_OUT" &&
      today.workPolicy.breakPolicy === "FLEXIBLE_CONFIRMATION"
    ) {
      breakMinutes = Number(confirmedBreakMinutes);
      if (
        !Number.isInteger(breakMinutes) ||
        breakMinutes < 0 ||
        breakMinutes > 1440
      ) {
        setError("Enter valid total break minutes between 0 and 1440.");
        return;
      }
      if (breakMinutes < today.workPolicy.expectedBreakMinutes) {
        shortBreakReason = breakExceptionReason.trim();
        if (shortBreakReason.length < 3) {
          setError("Explain why the break was shorter than the company policy.");
          return;
        }
      }
    }

    setConfirmAction(null);
    setBusy(true);
    setError("");
    setNotice("");
    setExceptionPrompt(null);
    setExceptionFormOpen(false);
    setExceptionError("");

    try {
      if (!navigator.onLine) {
        throw new StaffApiError(
          "NETWORK_ERROR",
          "Attendance requires a network connection. Connect to the internet and try again.",
          0,
        );
      }

      let gps: GpsEvidence = {
        latitude: null,
        longitude: null,
        accuracyMeters: null,
        status: "GEOFENCE_DISABLED",
      };
      if (today.geofenceRequirements.requireGeofence) {
        setGpsStatus("Getting your location…");
        gps = await requestGps();
        setGpsStatus(
          gps.accuracyMeters !== null &&
            gps.accuracyMeters >
              today.geofenceRequirements.maximumAcceptedGpsErrorMeters
            ? "GPS Inaccurate"
            : "Location detected",
        );
      } else {
        setGpsStatus("Geofence Disabled");
      }

      const pending = {
        action,
        idempotencyKey: createAttendanceIdempotencyKey(action),
        gps,
        deviceTimestamp: new Date().toISOString(),
        confirmedBreakMinutes: breakMinutes,
        breakExceptionReason: shortBreakReason,
      };
      setPendingPunch(pending);
      await submitPunch(pending);
    } catch (caught) {
      const code =
        caught instanceof StaffApiError ? caught.code : gpsBrowserErrorCode(caught);
      const browserGpsStatus =
        caught instanceof Error
          ? gpsBrowserStatus(caught)
          : null;
      if (
        ["GPS_REQUIRED", "GPS_INACCURATE", "OUTSIDE_GEOFENCE"].includes(code) &&
        today.geofenceRequirements.allowOutsideGeofenceRequest
      ) {
        const fallback = pendingPunch ?? {
          action,
          idempotencyKey: createAttendanceIdempotencyKey(action),
          gps: {
            latitude: null,
            longitude: null,
            accuracyMeters: null,
            status: code,
          },
          deviceTimestamp: new Date().toISOString(),
        };
        setPendingPunch(fallback);
        setExceptionPrompt(fallback);
        setExceptionFormOpen(false);
        setGpsStatus(browserGpsStatus ?? gpsCodeLabel(code));
        setError(locationRecoveryMessage(code, browserGpsStatus));
      } else if (code === "GPS_REQUIRED" && browserGpsStatus) {
        setGpsStatus(browserGpsStatus);
        setError(
          `${browserGpsStatus}. Enable Location permission and try again, or contact your manager.`,
        );
      } else {
        handleSessionOrError(caught, router, setError);
      }
    } finally {
      setBusy(false);
    }
  }

  async function switchBranch(branchId: string) {
    if (!today || branchId === today.branch.id || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await staffApiFetch<{
        ok: true;
        data: { branch: { id: string; name: string } };
      }>("/api/employee-attendance/switch-branch", {
        method: "POST",
        body: JSON.stringify({ branchId }),
      });
      setNotice("Attendance branch switched.");
      await load(true);
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
          : "Unable to switch Attendance branch.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitPunch(pending: PendingPunch, reason?: string) {
    const attendance = today;
    if (!attendance) {
      throw new StaffApiError("REQUEST_FAILED", "Attendance is not ready.", 400);
    }
    try {
      const endpoint = attendanceEndpoint(pending.action);
      const result = await staffApiFetch<{ ok: true; data: AttendancePunchResult }>(
        endpoint,
        {
          method: "POST",
          body: JSON.stringify({
            branchId: attendance.branch.id,
            latitude: pending.gps.latitude,
            longitude: pending.gps.longitude,
            accuracyMeters: pending.gps.accuracyMeters,
            deviceTimestamp: pending.deviceTimestamp,
            deviceIdentifier: getOrCreateDeviceIdentifier(),
            idempotencyKey: pending.idempotencyKey,
            exceptionReason: reason || null,
            confirmedBreakMinutes: pending.confirmedBreakMinutes ?? null,
            breakExceptionReason: pending.breakExceptionReason ?? null,
          }),
        },
      );
      setPendingPunch(null);
      setExceptionPrompt(null);
      setExceptionFormOpen(false);
      setExceptionReason("");
      setExceptionError("");
      setGpsStatus(gpsStatusLabel(result.data.geofenceStatus));
      setNotice(
        result.data.requiresApproval
          ? "Punch submitted. Pending manager approval."
          : `${attendanceActionLabel(pending.action)} recorded at ${formatTime(
              result.data.serverTimestamp,
              attendance.geofenceRequirements.timezone,
            )}.`,
      );
      await load(true);
    } catch (caught) {
      if (
        caught instanceof StaffApiError &&
        ["GPS_REQUIRED", "GPS_INACCURATE", "OUTSIDE_GEOFENCE"].includes(caught.code) &&
        attendance.geofenceRequirements.allowOutsideGeofenceRequest &&
        !reason
      ) {
        setExceptionPrompt(pending);
        setExceptionFormOpen(false);
        setGpsStatus(gpsCodeLabel(caught.code));
        setError(locationRecoveryMessage(caught.code));
        return;
      }
      if (caught instanceof StaffApiError && caught.code === "NETWORK_ERROR") {
        setPendingPunch(pending);
      }
      throw caught;
    }
  }

  async function submitException() {
    if (!exceptionPrompt || busy) return;
    const reason = exceptionReason.trim();
    if (reason.length < 3) {
      setExceptionError("Enter at least 3 characters explaining the exception.");
      return;
    }
    setBusy(true);
    setExceptionError("");
    try {
      await submitPunch(exceptionPrompt, reason);
    } catch (caught) {
      handleSessionOrError(caught, router, setExceptionError);
    } finally {
      setBusy(false);
    }
  }

  async function retryLocation() {
    const previous = exceptionPrompt;
    if (!previous || !today || busy) return;

    setBusy(true);
    setError("");
    setNotice("");
    setExceptionFormOpen(false);
    setExceptionError("");
    try {
      setGpsStatus("Getting your locationâ€¦");
      const gps = await requestGps();
      const nextPending: PendingPunch = {
        ...previous,
        idempotencyKey: createAttendanceIdempotencyKey(previous.action),
        gps,
        deviceTimestamp: new Date().toISOString(),
      };
      setPendingPunch(nextPending);
      setGpsStatus(
        gps.accuracyMeters !== null &&
          gps.accuracyMeters >
            today.geofenceRequirements.maximumAcceptedGpsErrorMeters
          ? "GPS Inaccurate"
          : "Location detected",
      );
      await submitPunch(nextPending);
    } catch (caught) {
      const code =
        caught instanceof StaffApiError ? caught.code : gpsBrowserErrorCode(caught);
      const browserGpsStatus =
        caught instanceof Error ? gpsBrowserStatus(caught) : null;
      if (
        ["GPS_REQUIRED", "GPS_INACCURATE", "OUTSIDE_GEOFENCE"].includes(code) &&
        today.geofenceRequirements.allowOutsideGeofenceRequest
      ) {
        const fallback: PendingPunch = {
          ...previous,
          idempotencyKey: createAttendanceIdempotencyKey(previous.action),
          gps: {
            latitude: null,
            longitude: null,
            accuracyMeters: null,
            status: code,
          },
          deviceTimestamp: new Date().toISOString(),
        };
        setPendingPunch(fallback);
        setExceptionPrompt(fallback);
        setGpsStatus(browserGpsStatus ?? gpsCodeLabel(code));
        setError(locationRecoveryMessage(code, browserGpsStatus));
      } else {
        handleSessionOrError(caught, router, setError);
      }
    } finally {
      setBusy(false);
    }
  }

  function cancelLocationRecovery() {
    setExceptionPrompt(null);
    setExceptionFormOpen(false);
    setExceptionReason("");
    setExceptionError("");
    setPendingPunch(null);
    setGpsStatus("");
    setError("");
  }

  async function retryPending() {
    if (!pendingPunch || busy) return;
    setBusy(true);
    setError("");
    try {
      await submitPunch(pendingPunch);
    } catch (caught) {
      handleSessionOrError(caught, router, setError);
    } finally {
      setBusy(false);
    }
  }

  const timeZone = today.geofenceRequirements.timezone;
  const showLocationStatus =
    today.geofenceRequirements.requireGeofence &&
    (busy || Boolean(exceptionPrompt) || Boolean(error && gpsStatus));

  const reviewStatus = today.pendingExceptions.length
    ? "PENDING"
    : today.currentSession?.requiresApproval
      ? today.currentSession.approvalStatus
      : null;
  const recentBreakRestart =
    confirmAction === "BREAK_START" &&
    wasBreakEndedRecently({
      lastBreakEndedAt: today.lastBreakEndedAt,
      serverTime: today.serverTime,
    });
  return (
    <div className="staff-today-stack">
      <section className="staff-page-card staff-attendance-card">
        <div className="staff-card-heading">
          <div>
            <p className="staff-kicker">ATTENDANCE</p>
            <h2>{attendanceHeadline(today)}</h2>
          </div>
          <span className={`staff-status-chip ${today.status?.toLowerCase() ?? "ready"}`}>
            {today.sessionCount > 1
              ? `Shift ${today.sessionCount} · ${attendanceStatusLabel(today.status)}`
              : attendanceStatusLabel(today.status)}
          </span>
        </div>
        <div className="staff-attendance-context">
          <div>
            <small>{formatBranchDate(today.branchLocalTime)}</small>
            <strong>Working at: {today.branch.name}</strong>
            {normalizeLabel(today.business.name) !== normalizeLabel(today.branch.name) ? (
              <span>{today.business.name}</span>
            ) : null}
          </div>
          {today.availableBranches.length > 1 ? (
            <label className="staff-branch-switch">
              <span>Attendance branch</span>
              <select
                disabled={busy || today.status === "OPEN" || today.status === "ON_BREAK"}
                onChange={(event) => void switchBranch(event.target.value)}
                value={today.branch.id}
              >
                {today.availableBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
              {today.status === "OPEN" || today.status === "ON_BREAK" ? (
                <small>Complete the active shift before switching branch.</small>
              ) : null}
            </label>
          ) : null}
        </div>
        {showLocationStatus ? (
          <div className="staff-gps-panel">
            <span aria-hidden="true">⌖</span>
            <div>
              <strong>{gpsStatus || "Checking work location..."}</strong>
              <small>
                Location is checked only for this attendance action. Tetamu does
                not continuously track your location.
              </small>
            </div>
          </div>
        ) : null}

        {error && !exceptionPrompt ? (
          <div className="staff-alert error" role="alert">{error}</div>
        ) : null}
        {notice ? (
          <div
            className={`staff-alert ${notice.includes("Pending") ? "warning" : "success"}`}
            role="status"
          >
            {notice}
          </div>
        ) : null}

        {pendingPunch && !exceptionPrompt && error.includes("network") ? (
          <button
            className="staff-secondary-button"
            disabled={busy}
            onClick={retryPending}
            type="button"
          >
            Retry the same request
          </button>
        ) : null}

        {exceptionPrompt && !exceptionFormOpen ? (
          <div className="staff-location-recovery" role="status">
            <div>
              <p className="staff-kicker">LOCATION CHECK</p>
              <h3>{locationRecoveryTitle(gpsStatus)}</h3>
              <p>{error}</p>
            </div>
            <button
              className="staff-primary-button"
              disabled={busy}
              onClick={retryLocation}
              type="button"
            >
              {busy ? "Checking location…" : "Try location again"}
            </button>
            <button
              className="staff-secondary-button"
              disabled={busy}
              onClick={() => {
                setExceptionError("");
                setExceptionFormOpen(true);
              }}
              type="button"
            >
              Request manager approval
            </button>
            <button
              className="staff-link-button"
              disabled={busy}
              onClick={cancelLocationRecovery}
              type="button"
            >
              Not now
            </button>
            <small>
              Nothing is submitted until you retry successfully or send an
              exception request.
            </small>
          </div>
        ) : null}

        {exceptionPrompt && exceptionFormOpen ? (
          <div className="staff-exception-panel">
            <h3>Request an attendance exception</h3>
            <p>This will be submitted as Pending Approval, not a normal punch.</p>
            {exceptionError ? (
              <div className="staff-alert error" role="alert">
                {exceptionError}
              </div>
            ) : null}
            <label>
              Reason
              <textarea
                maxLength={500}
                onChange={(event) => setExceptionReason(event.target.value)}
                placeholder="Explain why you cannot provide an accepted work-location reading"
                rows={4}
                value={exceptionReason}
              />
            </label>
            <small>{exceptionReason.length}/500</small>
            <div className="staff-inline-actions">
              <button
                className="staff-primary-button"
                disabled={busy}
                onClick={submitException}
                type="button"
              >
                {busy ? "Submitting…" : "Submit for approval"}
              </button>
              <button
                className="staff-link-button"
                disabled={busy}
                onClick={() => {
                  setExceptionFormOpen(false);
                  setExceptionReason("");
                  setExceptionError("");
                }}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {!exceptionPrompt ? (
          <div className="staff-action-grid">
            {today.status === "COMPLETED" ? (
              <div className="staff-completed-message">
                <span aria-hidden="true">✓</span>
                <strong>Shift completed</strong>
                <small>
                  {today.completedSessionCount}{" "}
                  {today.completedSessionCount === 1 ? "shift" : "shifts"} completed today
                </small>
                <Link href="/staff/history">View shifts in History</Link>
              </div>
            ) : null}
            {today.allowedActions.map((action) => {
              const isAdditionalShift =
                action === "CLOCK_IN" &&
                today.completedSessionCount > 0;
              return (
                <button
                  className={
                    action === "CLOCK_IN" || action === "CLOCK_OUT"
                      ? "staff-primary-button"
                      : "staff-secondary-button"
                  }
                  disabled={busy}
                  key={action}
                  onClick={() => openConfirmation(action)}
                  type="button"
                >
                  {busy
                    ? "Recording..."
                    : isAdditionalShift
                      ? "Start another shift"
                      : attendanceActionLabel(action)}
                </button>
              );
            })}
            {today.allowedActions.length === 0 && today.status !== "COMPLETED" ? (
              <div className="staff-completed-message">
                <strong>No attendance actions available</strong>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="staff-metrics" aria-label="Today's attendance summary">
          <Metric
            label="Clock in"
            value={today.clockInAt ? formatTime(today.clockInAt, timeZone) : "—"}
          />
          <Metric
            label="Clock out"
            value={
              today.currentSession?.clockOutAt
                ? formatTime(today.currentSession.clockOutAt, timeZone)
                : "—"
            }
          />
          <Metric
            label="Break today"
            value={`${today.totalCompletedBreakMinutes} min`}
          />
          <Metric
            label="Worked today"
            value={formatMinutesAsHours(today.currentWorkedMinutes)}
          />
        </div>
        {today.status === "ON_BREAK" ? (
          <p className="staff-form-hint">End the current break before clocking out.</p>
        ) : null}
      </section>

      <section className="staff-page-card staff-schedule-card" aria-labelledby="staff-schedule-heading">
        <div className="staff-card-heading">
          <div>
            <p className="staff-kicker">EXPECTED ATTENDANCE</p>
            <h2 id="staff-schedule-heading">Today&apos;s published evidence</h2>
          </div>
          {today.expectedAttendance ? (
            <span className="staff-status-chip">Revision {today.expectedAttendance.revision}</span>
          ) : null}
        </div>
        {today.expectedAttendance ? (
          <div className="staff-schedule-evidence">
            <strong>{expectedAttendanceLabel(today.expectedAttendance.kind)}</strong>
            <span>{expectedAttendanceDetail(today.expectedAttendance)}</span>
            <small>Source: {today.expectedAttendance.source.replaceAll("_", " ").toLowerCase()}</small>
          </div>
        ) : (
          <div className="staff-schedule-empty" role="status">
            <strong>No published schedule available</strong>
            <span>No expected-attendance evidence exists for today. Tetamu will not infer that this is an off day.</span>
          </div>
        )}
      </section>

      <StaffResolutionCases />

      {reviewStatus ? (
        <section
          className={`staff-page-card staff-approval-card ${reviewStatus.toLowerCase()}`}
        >
          <div className="staff-card-heading">
            <div>
              <p className="staff-kicker">ATTENDANCE REVIEW</p>
              <h2>{approvalHeadline(reviewStatus)}</h2>
            </div>
            <span className={`staff-status-chip ${approvalTone(reviewStatus)}`}>
              {approvalLabel(reviewStatus)}
            </span>
          </div>
          <p>{approvalDescription(reviewStatus)}</p>
          <Link className="staff-approval-history-link" href="/staff/history">
            View attendance history
          </Link>
        </section>
      ) : null}

      {confirmAction ? (
        <div className="staff-confirm-backdrop" role="presentation">
          <div
            aria-labelledby="staff-confirm-title"
            aria-modal="true"
            className="staff-confirm-dialog"
            role="dialog"
          >
            <p className="staff-kicker">CONFIRM ACTION</p>
            <h2 id="staff-confirm-title">
              {confirmAction === "CLOCK_IN" && today.completedSessionCount > 0
                ? "Start another shift"
                : recentBreakRestart
                  ? "Start another break?"
                : attendanceActionLabel(confirmAction)}
            </h2>
            <p>
              {confirmAction === "CLOCK_IN" && today.completedSessionCount > 0
                ? "Your previous shift stays completed. A new attendance shift will start now."
                : recentBreakRestart && today.lastBreakEndedAt
                  ? `Your previous break ended at ${formatTime(
                      today.lastBreakEndedAt,
                      timeZone,
                    )}. Continue only if you intend to record another break.`
                : attendanceConfirmation(confirmAction)}
            </p>
            {recentBreakRestart ? (
              <div className="staff-alert warning" role="status">
                This extra check helps prevent an accidental second break.
              </div>
            ) : null}
            {confirmAction === "CLOCK_OUT" &&
            today.workPolicy.breakPolicy === "FLEXIBLE_CONFIRMATION" ? (
              <div className="staff-break-confirmation">
                <label>
                  <span>Total break taken today (minutes)</span>
                  <input
                    inputMode="numeric"
                    max="1440"
                    min="0"
                    onChange={(event) => setConfirmedBreakMinutes(event.target.value)}
                    step="1"
                    type="number"
                    value={confirmedBreakMinutes}
                  />
                </label>
                <small>
                  Today&apos;s break target: {today.workPolicy.expectedBreakMinutes} minutes
                  {today.workPolicy.expectedBreakSource === "PUBLISHED_ROSTER"
                    ? " from the published roster."
                    : today.workPolicy.expectedBreakSource === "SESSION_SNAPSHOT"
                      ? " locked when you clocked in."
                    : "."}
                  Appointment gaps are not counted automatically.
                </small>
                {Number(confirmedBreakMinutes) <
                today.workPolicy.expectedBreakMinutes ? (
                  <label>
                    <span>Why was the break shorter?</span>
                    <textarea
                      maxLength={500}
                      onChange={(event) => setBreakExceptionReason(event.target.value)}
                      placeholder="Give the manager a short reason"
                      rows={3}
                      value={breakExceptionReason}
                    />
                    <small>This Clock Out will be sent for manager approval.</small>
                  </label>
                ) : null}
              </div>
            ) : null}
            <div className="staff-inline-actions">
              <button className="staff-primary-button" onClick={confirmAndPunch} type="button">
                {recentBreakRestart ? "Start another break" : "Confirm"}
              </button>
              <button
                className="staff-link-button"
                onClick={() => setConfirmAction(null)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function attendanceHeadline(today: AttendanceToday) {
  if (today.status === "OPEN") return "You are currently working";
  if (today.status === "ON_BREAK") return "Your break is in progress";
  if (today.status === "COMPLETED") return "You have clocked out for today";
  return "Ready to start your day";
}

function attendanceStatusLabel(status: AttendanceToday["status"]) {
  if (status === "OPEN") return "Working";
  if (status === "ON_BREAK") return "On break";
  if (status === "COMPLETED") return "Shift done";
  return "Ready";
}

function formatBranchDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  if (!match) return "TODAY";
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (!Number.isFinite(date.getTime())) return "TODAY";
  return new Intl.DateTimeFormat("en-MY", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date).toUpperCase();
}

function approvalHeadline(
  status: NonNullable<AttendanceToday["currentSession"]>["approvalStatus"],
) {
  if (status === "APPROVED") return "Attendance exception approved";
  if (status === "REJECTED") return "Attendance exception rejected";
  return "Manager approval pending";
}

function approvalLabel(
  status: NonNullable<AttendanceToday["currentSession"]>["approvalStatus"],
) {
  if (status === "APPROVED") return "Approved";
  if (status === "REJECTED") return "Rejected";
  return "Pending";
}

function approvalTone(
  status: NonNullable<AttendanceToday["currentSession"]>["approvalStatus"],
) {
  if (status === "APPROVED") return "approved";
  if (status === "REJECTED") return "rejected";
  return "warning";
}

function approvalDescription(
  status: NonNullable<AttendanceToday["currentSession"]>["approvalStatus"],
) {
  if (status === "APPROVED") {
    return "Your manager approved the attendance location exception.";
  }
  if (status === "REJECTED") {
    return "Your manager rejected the attendance exception. Review History or contact your manager.";
  }
  return "Your shift is recorded, but a manager still needs to review the location exception.";
}

function attendanceEndpoint(action: AttendanceAction) {
  switch (action) {
    case "CLOCK_IN":
      return "/api/employee-attendance/clock-in";
    case "BREAK_START":
      return "/api/employee-attendance/break-start";
    case "BREAK_END":
      return "/api/employee-attendance/break-end";
    case "CLOCK_OUT":
      return "/api/employee-attendance/clock-out";
  }
}

function requestGps(): Promise<GpsEvidence> {
  if (!window.isSecureContext) {
    return Promise.reject(new Error("GPS_INSECURE_CONTEXT"));
  }
  if (!("geolocation" in navigator)) {
    return Promise.reject(new Error("GPS_UNAVAILABLE"));
  }
  return requestBrowserPosition({
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 30_000,
  }).catch((error: unknown) => {
    if (
      error instanceof Error &&
      ["GPS_TIMEOUT", "GPS_POSITION_UNAVAILABLE"].includes(error.message)
    ) {
      return requestBrowserPosition({
        enableHighAccuracy: false,
        maximumAge: 0,
        timeout: 20_000,
      });
    }
    throw error;
  });
}

function requestBrowserPosition(options: PositionOptions): Promise<GpsEvidence> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          status: "ACQUIRED",
        }),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new Error("GPS_PERMISSION_DENIED"));
          return;
        }
        if (error.code === error.TIMEOUT) {
          reject(new Error("GPS_TIMEOUT"));
          return;
        }
        reject(new Error("GPS_POSITION_UNAVAILABLE"));
      },
      options,
    );
  });
}

function gpsBrowserErrorCode(error: unknown) {
  if (error instanceof Error && error.message === "GPS_PERMISSION_DENIED") {
    return "GPS_REQUIRED";
  }
  if (error instanceof Error && error.message === "GPS_UNAVAILABLE") {
    return "GPS_REQUIRED";
  }
  if (
    error instanceof Error &&
    ["GPS_TIMEOUT", "GPS_POSITION_UNAVAILABLE"].includes(error.message)
  ) {
    return "GPS_REQUIRED";
  }
  if (error instanceof Error && error.message === "GPS_INSECURE_CONTEXT") {
    return "GPS_REQUIRED";
  }
  return "UNKNOWN";
}

function gpsBrowserStatus(error: Error) {
  if (error.message === "GPS_PERMISSION_DENIED") {
    return "GPS Permission Denied";
  }
  if (error.message === "GPS_UNAVAILABLE") {
    return "GPS Unavailable";
  }
  if (error.message === "GPS_POSITION_UNAVAILABLE") {
    return "GPS Unavailable";
  }
  if (error.message === "GPS_TIMEOUT") {
    return "Location Timed Out";
  }
  if (error.message === "GPS_INSECURE_CONTEXT") {
    return "Secure Connection Required";
  }
  return null;
}

function gpsCodeLabel(code: string) {
  if (code === "GPS_INACCURATE") return "GPS Inaccurate";
  if (code === "OUTSIDE_GEOFENCE") return "Outside Work Location";
  return "GPS Permission Denied or Unavailable";
}

function locationRecoveryTitle(status: string) {
  if (status === "GPS Permission Denied") return "Allow location to continue";
  if (status === "GPS Inaccurate") return "Improve your location accuracy";
  if (status === "Outside Work Location") return "Move closer to your workplace";
  if (status === "Secure Connection Required") return "Open a secure Staff App link";
  if (status === "Location Timed Out") return "Location is taking too long";
  return "Location could not be confirmed";
}

function locationRecoveryMessage(code: string, browserStatus?: string | null) {
  if (browserStatus === "GPS Permission Denied") {
    return "Allow precise location for Tetamu in your phone and browser settings, then try again.";
  }
  if (browserStatus === "Secure Connection Required") {
    return "Mobile location requires an HTTPS Staff App address. Use the secure Testing link, then try again.";
  }
  if (browserStatus === "GPS Unavailable") {
    return "Android could not provide a location. Turn on Location, Google Location Accuracy and precise location, then try again.";
  }
  if (browserStatus === "Location Timed Out") {
    return "Keep Tetamu open while the phone finds your location. Turn on Google Location Accuracy, then try again.";
  }
  if (code === "GPS_INACCURATE") {
    return "The location reading is not accurate enough. Turn on precise location or move to an open area, then try again.";
  }
  if (code === "OUTSIDE_GEOFENCE") {
    return "You appear to be outside the approved work location. Move closer to the branch, then try again.";
  }
  return "Tetamu could not confirm your work location. Check your location settings, then try again.";
}

function handleSessionOrError(
  error: unknown,
  router: ReturnType<typeof useRouter>,
  setError: (message: string) => void,
) {
  if (error instanceof StaffApiError && isEmployeeSessionError(error.code)) {
    const revoked =
      error.code === "DEVICE_REVOKED" || error.code === "SESSION_REVOKED";
    router.replace(
      `/staff/login${revoked ? "?reason=device-revoked" : "?reason=session-expired"}`,
    );
    return;
  }
  setError(
    error instanceof StaffApiError
      ? error.message
      : "Unable to complete the Attendance action.",
  );
}

function formatTime(value: string, timeZone?: string) {
  return new Intl.DateTimeFormat("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function expectedAttendanceLabel(kind: NonNullable<AttendanceToday["expectedAttendance"]>["kind"]) {
  if (kind === "WORKDAY") return "Published workday";
  if (kind === "REST_DAY") return "Published rest day";
  if (kind === "PUBLIC_HOLIDAY") return "Published public holiday";
  return "Published as not scheduled";
}

function expectedAttendanceDetail(expected: NonNullable<AttendanceToday["expectedAttendance"]>) {
  if (expected.kind !== "WORKDAY") {
    return "This status comes from explicit expected-attendance evidence.";
  }
  if (!expected.expectedStartAt || !expected.expectedEndAt) {
    return "Published workday evidence is incomplete. Contact your manager.";
  }
  const start = formatTime(expected.expectedStartAt, expected.timezone);
  const end = formatTime(expected.expectedEndAt, expected.timezone);
  return `${start} – ${end}${expected.graceMinutes ? ` · ${expected.graceMinutes} minute grace` : ""}`;
}

function normalizeLabel(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-MY");
}
