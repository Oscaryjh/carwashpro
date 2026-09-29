"use client";

import { createContext, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import type { BranchAttendanceSettingActionState } from "@/app/(business)/team/attendance-settings/actions";
import { AttendanceLocationFields } from "./attendance-location-fields";
import type { AttendanceSettingValues } from "./attendance-settings-form";

const formId = "company-clock-in-location-form";
const SaveContext = createContext<{ state: BranchAttendanceSettingActionState; pending: boolean; markDirty: () => void }>({ state: { status: "idle", message: "" }, pending: false, markDirty: () => {} });
export function CompanyLocationSaveProvider({ action, children }: { action: (state: BranchAttendanceSettingActionState, form: FormData) => Promise<BranchAttendanceSettingActionState>; children: ReactNode }) {
  const [state, formAction, pending] = useActionState(action, { status: "idle", message: "" });
  const dirty = useRef(false);
  useEffect(() => { if (state.status === "success") dirty.current = false; }, [state]);
  useEffect(() => {
    const markDirty = (event: Event) => { if ((event.target as HTMLInputElement)?.form?.id === formId) dirty.current = true; };
    const guardProfile = (event: Event) => {
      const form = event.target;
      if (dirty.current && form instanceof HTMLFormElement && form.id !== formId && form.classList.contains("company-settings-form") && !window.confirm("Clock-in location has unsaved changes. Save company details without saving the location changes?")) event.preventDefault();
    };
    const guardLeave = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
    document.addEventListener("input", markDirty);
    document.addEventListener("change", markDirty);
    document.addEventListener("submit", guardProfile, true);
    window.addEventListener("beforeunload", guardLeave);
    return () => { document.removeEventListener("input", markDirty); document.removeEventListener("change", markDirty); document.removeEventListener("submit", guardProfile, true); window.removeEventListener("beforeunload", guardLeave); };
  }, []);
  return <SaveContext.Provider value={{ state, pending, markDirty: () => { dirty.current = true; } }}><form id={formId} action={formAction} />{children}</SaveContext.Provider>;
}

export type CompanyLocationView = {
  kind: "single" | "zero" | "legacy" | "denied";
  branch?: { id: string; name: string };
  values?: AttendanceSettingValues;
  configured: boolean;
  canManage: boolean;
  hrEnabled: boolean;
};
export function CompanyClockInLocation({ view }: { view: CompanyLocationView }) {
  const { state, pending, markDirty } = useContext(SaveContext);
  return <section id="clock-in-location" tabIndex={-1} className="company-settings-sheet" aria-labelledby="clock-in-location-heading">
    <h3 id="clock-in-location-heading">Clock-in location</h3>
    <p>Used by Staff App for location-based attendance.</p>
    {view.kind === "legacy" ? <><p>This business has multiple locations. Manage each location in HR Attendance Settings.</p><a href="/team/attendance-settings">Manage locations →</a></> : view.kind === "zero" ? <p role="alert">No active location is available. Contact your administrator.</p> : view.kind === "denied" ? <p>You do not have permission to access attendance location settings.</p> : <>
      <p><strong>{view.configured || state.status === "success" ? "Location configured" : "Location not configured"}</strong></p>
      {!view.configured && state.status !== "success" && <p>Staff cannot use location-based clock-in until a location is configured.</p>}
      {!view.hrEnabled ? <p>HR is not enabled. Enable HR in Modules &amp; access before changing attendance location settings.</p> : !view.values?.isEnabled ? <p>Attendance is not currently enabled. Saving a location will not enable attendance.</p> : !view.values.requireGeofence ? <p>Location restriction is currently off.</p> : null}
      {view.canManage && view.hrEnabled && view.branch && view.values ? <>
        <AttendanceLocationFields branch={view.branch} initialValues={view.values} pending={pending} formId={formId} onDirty={markDirty} />
        {state.message && <p role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
        <button className="primary-button" type="submit" form={formId} disabled={pending}>{pending ? "Saving location..." : view.configured ? "Update location" : "Save clock-in location"}</button>
      </> : <><p>You do not have permission to change attendance location settings.</p>{view.configured && view.values && <dl><dt>Latitude</dt><dd>{view.values.latitude}</dd><dt>Longitude</dt><dd>{view.values.longitude}</dd><dt>Radius</dt><dd>{view.values.geofenceRadiusMeters} m</dd><dt>GPS accuracy</dt><dd>{view.values.minimumAccuracyMeters} m</dd></dl>}</>}
    </>}
    <p>Changing the company address will not change the clock-in location. Save each section separately.</p>
  </section>;
}
