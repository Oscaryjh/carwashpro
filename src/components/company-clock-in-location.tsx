"use client";

import { createContext, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { BranchAttendanceSettingActionState } from "@/app/(business)/team/attendance-settings/actions";
import { AttendanceLocationFields } from "./attendance-location-fields";
import type { AttendanceSettingValues } from "./attendance-settings-form";
import styles from "./clock-in-location.module.css";

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
export function CompanyClockInLocation({ view, businessName }: { view: CompanyLocationView; businessName?: string }) {
  const { state, pending, markDirty } = useContext(SaveContext);
  const [ready, setReady] = useState(view.configured);
  const configured = view.configured || state.status === "success";
  return <section id="clock-in-location" tabIndex={-1} className={styles.card} aria-labelledby="clock-in-location-heading">
    <div className={styles.heading}><h3 id="clock-in-location-heading">Clock-in location</h3>{view.kind === "single" && <span className={configured ? styles.badge : styles.badgeEmpty}>{configured ? "Configured" : "Not configured"}</span>}</div>
    <p className={styles.hint}>Used by Staff App for location-based attendance.</p>
    {view.kind === "legacy" ? <><p>This business has multiple locations. Manage each location in HR Attendance Settings.</p><a href="/team/attendance-settings">Manage locations →</a></> : view.kind === "zero" ? <p role="alert">No active location is available. Contact your administrator.</p> : view.kind === "denied" ? <p>You do not have permission to access attendance location settings.</p> : <>
      {!view.hrEnabled ? <p className={styles.notice}>HR is not enabled. Enable HR in Modules &amp; access before changing attendance location settings.</p> : !view.values?.isEnabled ? <p className={styles.notice}>Attendance is not enabled. Saving a location will not enable it.</p> : !view.values.requireGeofence ? <p className={styles.notice}>Location restriction is currently off.</p> : null}
      {view.canManage && view.hrEnabled && view.branch && view.values ? <>
        <AttendanceLocationFields branch={view.branch} businessName={businessName} initialValues={view.values} pending={pending} formId={formId} compact onDirty={markDirty} onReadyChange={setReady} />
        {state.message && <p role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
        <div className={styles.footer}><p className={styles.hint}>Business address and clock-in location are saved separately.</p><button className={styles.primaryButton} type="submit" form={formId} disabled={pending || !ready}>{pending ? "Saving location..." : "Save clock-in location"}</button></div>
      </> : <><p>You do not have permission to change attendance location settings.</p>{view.configured && view.values && <dl><dt>Latitude</dt><dd>{view.values.latitude}</dd><dt>Longitude</dt><dd>{view.values.longitude}</dd><dt>Allowed clock-in radius</dt><dd>{view.values.geofenceRadiusMeters} m</dd><dt>Maximum GPS error allowed</dt><dd>{view.values.minimumAccuracyMeters} m</dd></dl>}</>}
    </>}
  </section>;
}
