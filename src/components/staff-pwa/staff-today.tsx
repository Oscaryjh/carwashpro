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
} from "@/lib/staff-pwa/client";
import type {
  AttendanceAction,
  AttendancePunchResult,
  AttendanceToday,
  EmployeeProfile,
} from "@/lib/staff-pwa/types";
import { StaffLoading } from "./staff-auth";

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
};

export function StaffToday() {
  const router = useRouter();
  const mounted = useRef(true);
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [today, setToday] = useState<AttendanceToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmAction, setConfirmAction] = useState<AttendanceAction | null>(null);
  const [gpsStatus, setGpsStatus] = useState("");
  const [pendingPunch, setPendingPunch] = useState<PendingPunch | null>(null);
  const [exceptionPrompt, setExceptionPrompt] = useState<PendingPunch | null>(null);
  const [exceptionReason, setExceptionReason] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const [profileResult, todayResult] = await Promise.all([
        staffApiFetch<{ ok: true; authenticated: true; profile: EmployeeProfile }>(
          "/api/employee-auth/me",
        ),
        staffApiFetch<{ ok: true; data: AttendanceToday }>(
          "/api/employee-attendance/today",
        ),
      ]);
      if (!mounted.current) return;
      setProfile(profileResult.profile);
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
  if (!today || !profile) {
    return (
      <section className="staff-page-card">
        <div className="staff-alert error" role="alert">{error || "Unable to load Attendance."}</div>
        <button className="staff-primary-button" onClick={() => load()} type="button">
          Try again
        </button>
      </section>
    );
  }

  async function confirmAndPunch() {
    const action = confirmAction;
    if (!action || !today || busy) return;
    setConfirmAction(null);
    setBusy(true);
    setError("");
    setNotice("");
    setExceptionPrompt(null);

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
        setGpsStatus("Locating…");
        gps = await requestGps();
        setGpsStatus(
          gps.accuracyMeters !== null &&
            gps.accuracyMeters >
              today.geofenceRequirements.maximumAcceptedGpsErrorMeters
            ? "GPS Inaccurate"
            : "Location acquired",
        );
      } else {
        setGpsStatus("Geofence Disabled");
      }

      const pending = {
        action,
        idempotencyKey: createAttendanceIdempotencyKey(action),
        gps,
        deviceTimestamp: new Date().toISOString(),
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
        setGpsStatus(browserGpsStatus ?? gpsCodeLabel(code));
        setError("This punch needs an exception reason and manager approval.");
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
          }),
        },
      );
      setPendingPunch(null);
      setExceptionPrompt(null);
      setExceptionReason("");
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
        setGpsStatus(gpsCodeLabel(caught.code));
        setError("This punch needs an exception reason and manager approval.");
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
      setError("Enter at least 3 characters explaining the exception.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await submitPunch(exceptionPrompt, reason);
    } catch (caught) {
      handleSessionOrError(caught, router, setError);
    } finally {
      setBusy(false);
    }
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
  return (
    <div className="staff-today-stack">
      <section className="staff-welcome-card">
        <div>
          <p className="staff-kicker">{formatBranchDate(today.branchLocalTime)}</p>
          <h1>Hello, {today.employee.fullName.split(/\s+/)[0]}</h1>
          <p>{formatWorkplace(today.business.name, today.branch.name)}</p>
          {today.availableBranches.length > 1 ? (
            <label className="staff-branch-switch">
              <span>Attendance branch</span>
              <select
                disabled={
                  busy ||
                  today.status === "OPEN" ||
                  today.status === "ON_BREAK"
                }
                onChange={(event) => void switchBranch(event.target.value)}
                value={today.branch.id}
              >
                {today.availableBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
              {today.status === "OPEN" || today.status === "ON_BREAK" ? (
                <small>Complete the active shift before switching.</small>
              ) : null}
            </label>
          ) : null}
        </div>
        <span className={`staff-state-orb ${today.status?.toLowerCase() ?? "ready"}`}>
          {attendanceStatusLabel(today.status)}
        </span>
      </section>

      <section className="staff-page-card">
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
        <div className="staff-metrics">
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

        {error ? <div className="staff-alert error" role="alert">{error}</div> : null}
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

        {exceptionPrompt ? (
          <div className="staff-exception-panel">
            <h3>Request an attendance exception</h3>
            <p>This will be submitted as Pending Approval, not a normal punch.</p>
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
                  setExceptionPrompt(null);
                  setExceptionReason("");
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
                  onClick={() => setConfirmAction(action)}
                  type="button"
                >
                  {busy
                    ? "Working…"
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
        {today.status === "ON_BREAK" ? (
          <p className="staff-form-hint">End the current break before clocking out.</p>
        ) : null}
      </section>

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
                : attendanceActionLabel(confirmAction)}
            </h2>
            <p>
              {confirmAction === "CLOCK_IN" && today.completedSessionCount > 0
                ? "Your previous shift stays completed. A new attendance shift will start now."
                : attendanceConfirmation(confirmAction)}
            </p>
            <div className="staff-inline-actions">
              <button className="staff-primary-button" onClick={confirmAndPunch} type="button">
                Confirm
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

function formatWorkplace(businessName: string, branchName: string) {
  return businessName.trim().toLocaleLowerCase() ===
    branchName.trim().toLocaleLowerCase()
    ? branchName
    : `${businessName} · ${branchName}`;
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
  if (!("geolocation" in navigator)) {
    return Promise.reject(new Error("GPS_UNAVAILABLE"));
  }
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
        reject(new Error("GPS_UNAVAILABLE"));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15_000,
      },
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
  return "UNKNOWN";
}

function gpsBrowserStatus(error: Error) {
  if (error.message === "GPS_PERMISSION_DENIED") {
    return "GPS Permission Denied";
  }
  if (error.message === "GPS_UNAVAILABLE") {
    return "GPS Unavailable";
  }
  return null;
}

function gpsCodeLabel(code: string) {
  if (code === "GPS_INACCURATE") return "GPS Inaccurate";
  if (code === "OUTSIDE_GEOFENCE") return "Outside Work Location";
  return "GPS Permission Denied or Unavailable";
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
