"use client";

import { useActionState, useState } from "react";
import type { BranchAttendanceSettingActionState } from "@/app/(business)/team/attendance-settings/actions";
import styles from "@/app/(business)/team/attendance-settings/attendance-settings.module.css";

const initialBranchAttendanceSettingActionState: BranchAttendanceSettingActionState = {
  status: "idle",
  message: "",
};

type AttendanceSettingValues = {
  latitude: string;
  longitude: string;
  geofenceRadiusMeters: number;
  minimumAccuracyMeters: number;
  requireGeofence: boolean;
  allowOutsideGeofenceRequest: boolean;
  timezone: string;
  breakPolicy: "MANUAL_PUNCH" | "FLEXIBLE_CONFIRMATION" | "PAID_BREAK";
  targetBreakMinutes: number;
  normalWorkMinutesPerDay: number;
  shiftSpanMinutes: number;
  isEnabled: boolean;
};

type AttendanceSettingsFormProps = {
  action: (
    previousState: BranchAttendanceSettingActionState,
    formData: FormData,
  ) => Promise<BranchAttendanceSettingActionState>;
  branch: {
    id: string;
    name: string;
  };
  isConfigured: boolean;
  initialValues: AttendanceSettingValues;
};

type PendingDeviceLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
};

export function AttendanceSettingsForm({
  action,
  branch,
  isConfigured,
  initialValues,
}: AttendanceSettingsFormProps) {
  const [state, formAction, pending] = useActionState(
    action,
    initialBranchAttendanceSettingActionState,
  );
  const [latitude, setLatitude] = useState(initialValues.latitude);
  const [longitude, setLongitude] = useState(initialValues.longitude);
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [pendingDeviceLocation, setPendingDeviceLocation] =
    useState<PendingDeviceLocation | null>(null);
  const [attendancePaused, setAttendancePaused] = useState(
    isConfigured ? !initialValues.isEnabled : false,
  );
  const isMalaysiaTimezone =
    initialValues.timezone === "Asia/Kuching" ||
    initialValues.timezone === "Asia/Kuala_Lumpur";

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationMessage("This browser does not provide device location.");
      return;
    }

    setLocating(true);
    setLocationMessage("Requesting the current device location...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPendingDeviceLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
        });
        setLocationMessage("");
        setLocating(false);
      },
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? "Location access is off. Allow location for this site in your browser settings, then try again."
            : error.code === error.TIMEOUT
              ? "Location took too long. Move near a window or outdoors, then try again."
              : "This device could not determine its location. Check GPS and precise-location settings, then try again.";
        setLocationMessage(message);
        setLocating(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15_000,
      },
    );
  }

  function confirmCurrentLocation() {
    if (!pendingDeviceLocation) {
      return;
    }

    setLatitude(pendingDeviceLocation.latitude.toFixed(6));
    setLongitude(pendingDeviceLocation.longitude.toFixed(6));
    setPendingDeviceLocation(null);
    setLocationMessage(
      "Branch location updated from this device. Save Attendance Settings to apply it.",
    );
  }

  return (
    <form
      action={formAction}
      className={styles.form}
      onSubmit={(event) => {
        if (
          initialValues.isEnabled &&
          attendancePaused &&
          !window.confirm(
            "Pause Attendance for this branch? Staff will not be able to Clock In or Clock Out. Existing attendance history will be preserved.",
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input name="branchId" type="hidden" value={branch.id} />
      <input
        name="isEnabled"
        type="hidden"
        value={attendancePaused ? "" : "on"}
      />

      {state.message ? (
        <div
          className={state.status === "error" ? styles.error : styles.success}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </div>
      ) : null}

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p>BRANCH ATTENDANCE</p>
            <h2>{branch.name}</h2>
          </div>
          <span
            className={`${styles.attendanceStatus} ${
              attendancePaused
                ? styles.attendanceStatusPaused
                : styles.attendanceStatusActive
            }`}
          >
            {attendancePaused ? "Paused" : "Active"}
          </span>
        </div>

        <div className={styles.attendanceAvailability}>
          <div>
            <strong>
              {attendancePaused
                ? "Staff clock-in is paused"
                : "Staff can use Attendance"}
            </strong>
            <span>
              {attendancePaused
                ? "Staff cannot Clock In or Clock Out for this branch until Attendance is resumed. Existing history remains available."
                : isConfigured
                  ? "Clock In and Clock Out use the saved location and work-policy rules below."
                  : "Saving valid settings will activate Clock In and Clock Out for this branch automatically."}
            </span>
          </div>
          <label className={styles.pauseControl}>
            <input
              checked={attendancePaused}
              onChange={(event) => setAttendancePaused(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Pause Attendance for this branch</strong>
              <small>Use only when staff punching must be temporarily stopped.</small>
            </span>
          </label>
        </div>
      </section>

      {pendingDeviceLocation ? (
        <div
          className={styles.locationModalBackdrop}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setPendingDeviceLocation(null);
            }
          }}
        >
          <section
            aria-describedby="location-confirmation-description"
            aria-labelledby="location-confirmation-title"
            aria-modal="true"
            className={styles.locationModal}
            role="dialog"
          >
            <div className={styles.locationModalHeading}>
              <div>
                <p>CONFIRM BRANCH LOCATION</p>
                <h2 id="location-confirmation-title">Is this the right place?</h2>
              </div>
              <button
                aria-label="Close location preview"
                autoFocus
                className={styles.locationModalClose}
                onClick={() => setPendingDeviceLocation(null)}
                type="button"
              >
                X
              </button>
            </div>

            <p
              className={styles.locationModalDescription}
              id="location-confirmation-description"
            >
              Check that the marker is at {branch.name}. Nothing changes until you
              confirm this location and save the settings.
            </p>

            <div className={styles.locationMapFrame}>
              <iframe
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                src={`https://www.google.com/maps?q=${pendingDeviceLocation.latitude},${pendingDeviceLocation.longitude}&z=18&output=embed`}
                title={`Google Maps preview for ${branch.name}`}
              />
            </div>

            <div className={styles.locationConfirmationDetails}>
              <div>
                <span>Detected position</span>
                <strong>{branch.name}</strong>
                <small>
                  GPS accuracy: approximately{" "}
                  {Math.round(pendingDeviceLocation.accuracyMeters)} m
                </small>
              </div>
              <a
                href={`https://www.google.com/maps?q=${pendingDeviceLocation.latitude},${pendingDeviceLocation.longitude}`}
                rel="noreferrer"
                target="_blank"
              >
                Open in Google Maps
              </a>
            </div>

            <details className={styles.locationCoordinatesDetails}>
              <summary>View coordinates</summary>
              <span>
                {pendingDeviceLocation.latitude.toFixed(6)}, {" "}
                {pendingDeviceLocation.longitude.toFixed(6)}
              </span>
            </details>

            <div className={styles.locationModalActions}>
              <button
                className={styles.locationSecondaryButton}
                disabled={locating}
                onClick={useCurrentLocation}
                type="button"
              >
                {locating ? "Locating..." : "Try location again"}
              </button>
              <button onClick={confirmCurrentLocation} type="button">
                Use this location
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p>GEOFENCE CENTRE</p>
            <h2>Branch coordinates</h2>
          </div>
          <button
            className={styles.locationButton}
            disabled={locating || pending}
            onClick={useCurrentLocation}
            type="button"
          >
            {locating ? "Locating..." : "Use current device location"}
          </button>
        </div>

        <div className={styles.fieldGrid}>
          <label>
            <span>Latitude</span>
            <input
              inputMode="decimal"
              max="90"
              min="-90"
              name="latitude"
              onChange={(event) => setLatitude(event.target.value)}
              required
              step="0.000001"
              value={latitude}
            />
            <small>-90 to 90</small>
          </label>
          <label>
            <span>Longitude</span>
            <input
              inputMode="decimal"
              max="180"
              min="-180"
              name="longitude"
              onChange={(event) => setLongitude(event.target.value)}
              required
              step="0.000001"
              value={longitude}
            />
            <small>-180 to 180</small>
          </label>
        </div>

        {locationMessage ? (
          <p className={styles.locationMessage} role="status">
            {locationMessage}
          </p>
        ) : null}
        <div className={styles.coordinatePreview} aria-live="polite">
          <span>
            Latitude: <strong>{latitude || "Not set"}</strong>
          </span>
          <span>
            Longitude: <strong>{longitude || "Not set"}</strong>
          </span>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p>LOCATION RULES</p>
            <h2>Geofence validation</h2>
          </div>
        </div>

        <div className={styles.fieldGrid}>
          <label>
            <span>Geofence Radius (metres)</span>
            <input
              defaultValue={initialValues.geofenceRadiusMeters}
              max="1000"
              min="20"
              name="geofenceRadiusMeters"
              required
              step="1"
              type="number"
            />
            <small>The permitted clock-in area around the branch (20-1000 m).</small>
          </label>
          <label>
            <span>Maximum Accepted GPS Error (metres)</span>
            <input
              defaultValue={initialValues.minimumAccuracyMeters}
              max="500"
              min="10"
              name="minimumAccuracyMeters"
              required
              step="1"
              type="number"
            />
            <small>The largest device location error accepted (10-500 m).</small>
          </label>
          <label>
            <span>Time zone</span>
            <select
              aria-describedby="attendance-timezone-help"
              defaultValue={
                isMalaysiaTimezone
                  ? "Asia/Kuala_Lumpur"
                  : initialValues.timezone
              }
              name="timezone"
              required
            >
              {!isMalaysiaTimezone ? (
                <option value={initialValues.timezone}>
                  {initialValues.timezone} (Current)
                </option>
              ) : null}
              <option value="Asia/Kuala_Lumpur">Malaysia (UTC+8)</option>
            </select>
            <small id="attendance-timezone-help">
              Malaysia time is used for clock-in dates, shifts and overnight work.
            </small>
          </label>
        </div>

        <div className={styles.checkGrid}>
          <ToggleField
            defaultChecked={initialValues.requireGeofence}
            description="Employee clock-ins must pass the configured location rules."
            label="Require Geofence"
            name="requireGeofence"
          />
          <ToggleField
            defaultChecked={initialValues.allowOutsideGeofenceRequest}
            description="Employees may request review instead of silently bypassing the rule."
            label="Allow Outside Geofence Request"
            name="allowOutsideGeofenceRequest"
          />
        </div>

        <div className={styles.example}>
          <strong>How the location check works</strong>
          <span>Branch radius: 100 m</span>
          <span>Employee GPS error: 35 m</span>
          <span>Result: the system may continue with the range check.</span>
          <small>
            Attendance checks the employee location only when a punch action is submitted.
          </small>
        </div>
      </section>

      <WorkPolicyFields initialValues={initialValues} />

      <div className={styles.actions}>
        <button disabled={pending} type="submit">
          {pending ? "Saving..." : "Save Attendance Settings"}
        </button>
      </div>
    </form>
  );
}

function WorkPolicyFields({
  initialValues,
}: {
  initialValues: AttendanceSettingValues;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}>
        <div>
          <p>BRANCH DEFAULTS</p>
          <h2>Default work &amp; break rules</h2>
          <span className={styles.sectionIntro}>
            Used only when the employee has no published Roster for that day and
            no employee-specific work-time setting.
          </span>
        </div>
      </div>

      <div
        aria-label="How Tetamu chooses work and break rules"
        className={styles.policyPriority}
      >
        <article>
          <span className={styles.policyStep}>1</span>
          <div>
            <strong>Published Roster</strong>
            <small>First choice: that day&apos;s scheduled hours and break.</small>
          </div>
        </article>
        <article>
          <span className={styles.policyStep}>2</span>
          <div>
            <strong>Employee-specific setting</strong>
            <small>Second choice: used when no published Roster applies.</small>
          </div>
        </article>
        <article>
          <span className={styles.policyStep}>3</span>
          <div>
            <strong>These branch defaults</strong>
            <small>Used only when the first two choices are unavailable.</small>
          </div>
        </article>
      </div>

      <div className={styles.fieldGrid}>
        <label>
          <span>How staff record breaks</span>
          <select defaultValue={initialValues.breakPolicy} name="breakPolicy">
            <option value="MANUAL_PUNCH">Manual Break Start / End</option>
            <option value="FLEXIBLE_CONFIRMATION">
              Flexible break — confirm at Clock Out
            </option>
            <option value="PAID_BREAK">Paid break — do not deduct</option>
          </select>
          <small>
            The default break method when no published Roster rule applies.
          </small>
        </label>
        <label>
          <span>Default break length (minutes)</span>
          <input
            defaultValue={initialValues.targetBreakMinutes}
            max="480"
            min="0"
            name="targetBreakMinutes"
            required
            step="1"
            type="number"
          />
          <small>60 minutes equals a 1-hour break.</small>
        </label>
        <label>
          <span>Default paid working time (minutes)</span>
          <input
            defaultValue={initialValues.normalWorkMinutesPerDay}
            max="1440"
            min="60"
            name="normalWorkMinutesPerDay"
            required
            step="1"
            type="number"
          />
          <small>480 minutes equals 8 paid working hours.</small>
        </label>
        <label>
          <span>Default total shift length (minutes)</span>
          <input
            defaultValue={initialValues.shiftSpanMinutes}
            max="1440"
            min="60"
            name="shiftSpanMinutes"
            required
            step="1"
            type="number"
          />
          <small>540 minutes equals 9 hours including the break.</small>
        </label>
      </div>

      <div className={styles.example}>
        <strong>Example: a standard 9-hour shift</strong>
        <span>Total shift: 9 hours</span>
        <span>Break: 1 hour</span>
        <span>Paid working time: 8 hours</span>
        <small>
          Published Roster hours and employee-specific settings still take priority.
          Appointment gaps are never counted as breaks automatically.
        </small>
      </div>
    </section>
  );
}

function ToggleField({
  defaultChecked,
  description,
  label,
  name,
}: {
  defaultChecked: boolean;
  description: string;
  label: string;
  name: string;
}) {
  return (
    <label className={styles.toggleField}>
      <input defaultChecked={defaultChecked} name={name} type="checkbox" />
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}
