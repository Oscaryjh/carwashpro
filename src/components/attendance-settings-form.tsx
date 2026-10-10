"use client";

import { AttendanceLocationFields } from "./attendance-location-fields";
import { useActionState, useState } from "react";
import type { BranchAttendanceSettingActionState } from "@/app/(business)/team/attendance-settings/actions";
import styles from "@/app/(business)/team/attendance-settings/attendance-settings.module.css";

const initialBranchAttendanceSettingActionState: BranchAttendanceSettingActionState = {
  status: "idle",
  message: "",
};

export type AttendanceSettingValues = {
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
  locationManagedElsewhere?: boolean;
};

export function AttendanceSettingsForm({
  action,
  branch,
  isConfigured,
  initialValues,
  locationManagedElsewhere = false,
}: AttendanceSettingsFormProps) {
  const [state, formAction, pending] = useActionState(
    action,
    initialBranchAttendanceSettingActionState,
  );
  const [attendancePaused, setAttendancePaused] = useState(
    isConfigured ? !initialValues.isEnabled : false,
  );
  const needsLocation = locationManagedElsewhere && !isConfigured;

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
      {locationManagedElsewhere && <>
        <input name="attendanceOutletMode" type="hidden" value="single_outlet" />
        <input name="attendanceOutletBranchId" type="hidden" value={branch.id} />
      </>}
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
            <p>{locationManagedElsewhere ? "ATTENDANCE" : "BRANCH ATTENDANCE"}</p>
            <h2>{locationManagedElsewhere ? "Attendance rules" : branch.name}</h2>
          </div>
          <span
            className={`${styles.attendanceStatus} ${
              attendancePaused
                ? styles.attendanceStatusPaused
                : styles.attendanceStatusActive
            }`}
          >
            {needsLocation ? "Not configured" : attendancePaused ? "Paused" : "Active"}
          </span>
        </div>

        <div className={styles.attendanceAvailability}>
          <div>
            <strong>
              {needsLocation ? "Clock-in location is required" : attendancePaused
                ? "Staff clock-in is paused"
                : "Staff can use Attendance"}
            </strong>
            <span>
              {needsLocation ? "Configure the clock-in location in Business details first." : attendancePaused
                ? "Staff cannot Clock In or Clock Out for this branch until Attendance is resumed. Existing history remains available."
                : isConfigured
                  ? "Clock In and Clock Out use the saved location and work-policy rules below."
                  : "Saving valid settings will activate Clock In and Clock Out for this branch automatically."}
            </span>
          </div>
          <label className={styles.pauseControl}>
            <input
              checked={attendancePaused}
              disabled={needsLocation || pending}
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

      {locationManagedElsewhere ? (
        <section className={styles.section}>
          <h2>Clock-in location</h2>
          <p>{isConfigured ? "Location configured" : "Location not configured"}</p>
          {isConfigured && <p>Radius: {initialValues.geofenceRadiusMeters} m</p>}
          <p>Managed in Business details</p>
          <a href="/business/settings/clock-in-location">Manage location →</a>
        </section>
      ) : <AttendanceLocationFields branch={branch} initialValues={initialValues} pending={pending} />}
      <section className={styles.section}>
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
        <button disabled={pending || needsLocation} type="submit">
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
