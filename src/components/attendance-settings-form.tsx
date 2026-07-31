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
  initialValues: AttendanceSettingValues;
};

export function AttendanceSettingsForm({
  action,
  branch,
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

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationMessage("This browser does not provide device location.");
      return;
    }

    setLocating(true);
    setLocationMessage("Requesting the current device location...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toFixed(6));
        setLongitude(position.coords.longitude.toFixed(6));
        setLocationMessage(
          "Coordinates were filled from this device. Review and save them to confirm.",
        );
        setLocating(false);
      },
      (error) => {
        setLocationMessage(
          error.message || "The current device location could not be read.",
        );
        setLocating(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15_000,
      },
    );
  }

  return (
    <form
      action={formAction}
      className={styles.form}
      onSubmit={(event) => {
        const formData = new FormData(event.currentTarget);
        if (
          initialValues.isEnabled &&
          formData.get("isEnabled") !== "on" &&
          !window.confirm(
            "Disable Attendance for this branch? Existing attendance history will be preserved.",
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input name="branchId" type="hidden" value={branch.id} />

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
          <label className={styles.switchField}>
            <span>
              <strong>Attendance Enabled</strong>
              <small>Allow this branch to use Attendance after Phase 1C.</small>
            </span>
            <input
              defaultChecked={initialValues.isEnabled}
              name="isEnabled"
              type="checkbox"
            />
          </label>
        </div>
      </section>

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
            <span>Timezone</span>
            <input
              defaultValue={initialValues.timezone}
              name="timezone"
              placeholder="Asia/Kuching"
              required
            />
            <small>Use a valid IANA timezone.</small>
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

      <div className={styles.actions}>
        <button disabled={pending} type="submit">
          {pending ? "Saving..." : "Save Attendance Settings"}
        </button>
      </div>
    </form>
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
