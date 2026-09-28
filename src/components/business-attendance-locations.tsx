"use client";

import { useState } from "react";

export type BusinessAttendanceBranch = {
  id: string;
  name: string;
  attendanceSetting: {
    isEnabled: boolean;
    requireGeofence: boolean;
    geofenceRadiusMeters: number;
  } | null;
};

export function BusinessAttendanceLocations({ branches, available, hrEnabled }: {
  branches: BusinessAttendanceBranch[];
  available: boolean;
  hrEnabled: boolean;
}) {
  const [selectedId, setSelectedId] = useState(branches[0]?.id ?? "");
  const branch = branches.find((item) => item.id === selectedId) ?? branches[0];
  const setting = branch?.attendanceSetting;

  return (
    <section className="company-attendance-location" aria-labelledby="company-attendance-location-title">
      <div>
        <h3 id="company-attendance-location-title">Branch clock-in location</h3>
        <p>Managed separately in HR settings</p>
      </div>
      {!hrEnabled ? (
        <div><strong>HR is not enabled for this business.</strong><p>Enable HR in Modules &amp; access. Contact your platform administrator if you do not have access.</p></div>
      ) : !available ? (
        <p>HR access and attendance settings permission are required to manage clock-in locations.</p>
      ) : !branch ? (
        <p>No active branches are available. Set up an active branch before configuring its clock-in location.</p>
      ) : (
        <>
          {branches.length > 1 ? (
            <label>
              <span>Branch</span>
              <select value={branch.id} onChange={(event) => setSelectedId(event.target.value)}>
                {branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          ) : <div className="company-attendance-branch"><span>Branch</span><strong>{branch.name}</strong></div>}
          <div className="company-attendance-location-summary" aria-live="polite">
            <div>
              <strong className={!setting ? "company-attendance-warning" : "company-attendance-configured"}>
                <span aria-hidden="true">{setting ? "✓" : "⚠"} </span>
                {setting ? "Clock-in location configured" : "Clock-in location not set"}
              </strong>
              <p>{!setting
                ? "Staff will not be able to use location-based clock-in until a branch location is configured."
                : setting.requireGeofence
                  ? `Radius: ${setting.geofenceRadiusMeters} m`
                  : "Location restriction is off. Staff are not limited to a clock-in radius."}</p>
              {setting && <p>{setting.isEnabled ? "Attendance active" : "Attendance paused"}</p>}
            </div>
            <a className="company-attendance-location-action" href={`/team/attendance-settings/${encodeURIComponent(branch.id)}`} target="_blank" rel="noopener noreferrer">
              {setting ? "Manage clock-in location" : "Set clock-in location"}<span aria-hidden="true"> ↗</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        </>
      )}
      <div className="company-attendance-location-help">
        <p>Clock-in location is managed in HR &gt; Attendance settings.</p>
        <p>Changing the company address will not change the clock-in location.</p>
      </div>
    </section>
  );
}
