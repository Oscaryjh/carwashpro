"use client";

import { createContext, useActionState, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { BranchAttendanceSettingActionState } from "@/app/(business)/team/attendance-settings/actions";
import { AttendanceLocationFields, type LocationValues, type LocationDraftState } from "./attendance-location-fields";
import type { AttendanceSettingValues } from "./attendance-settings-form";
import styles from "./clock-in-location.module.css";

const formId = "company-clock-in-location-form";
const SaveContext = createContext<{ state: BranchAttendanceSettingActionState; pending: boolean; savedValues?: LocationValues; markDirty: (dirty: boolean) => void }>({ state: { status: "idle", message: "" }, pending: false, markDirty: () => {} });
export function CompanyLocationSaveProvider({ action, children }: { action: (state: BranchAttendanceSettingActionState, form: FormData) => Promise<BranchAttendanceSettingActionState>; children: ReactNode }) {
  const [savedValues, setSavedValues] = useState<LocationValues>();
  const [state, formAction, pending] = useActionState(async (previous: BranchAttendanceSettingActionState, form: FormData) => {
    const submitted = Object.fromEntries(["latitude", "longitude", "geofenceRadiusMeters", "minimumAccuracyMeters", "timezone"].map(key => [key, String(form.get(key) ?? "")])) as LocationValues;
    const result = await action(previous, form);
    if (result.status === "success") setSavedValues(submitted);
    return result;
  }, { status: "idle", message: "" });
  const dirty = useRef(false);
  const markDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  useEffect(() => {
    const guardProfile = (event: Event) => {
      const form = event.target;
      if (dirty.current && form instanceof HTMLFormElement && form.id !== formId && form.classList.contains("company-settings-form") && !window.confirm("Clock-in location has unsaved changes. Save company details without saving the location changes?")) event.preventDefault();
    };
    const guardLeave = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
    document.addEventListener("submit", guardProfile, true);
    window.addEventListener("beforeunload", guardLeave);
    return () => { document.removeEventListener("submit", guardProfile, true); window.removeEventListener("beforeunload", guardLeave); };
  }, []);
  return <SaveContext.Provider value={{ state, pending, savedValues, markDirty }}><form id={formId} action={formAction} />{children}</SaveContext.Provider>;
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
  const { state, pending, savedValues, markDirty } = useContext(SaveContext);
  const [draft, setDraft] = useState<LocationDraftState>({ status: view.configured ? "Configured" : "Not configured", dirty: false, canSave: false });
  const onDraftChange = useCallback((value: LocationDraftState) => { setDraft(value); markDirty(value.dirty); }, [markDirty]);
  return <section id="clock-in-location" tabIndex={-1} className={styles.card} aria-labelledby="clock-in-location-heading">
    <div className={styles.heading}><h3 id="clock-in-location-heading">Clock-in location</h3>{view.kind === "single" && <span className={draft.status === "Configured" ? styles.badge : draft.status === "Unsaved location" ? styles.badgeUnsaved : styles.badgeEmpty}>{draft.status}</span>}</div>
    <p className={styles.hint}>Used by Staff App for location-based attendance.</p>
    {view.kind === "legacy" ? <><p>This business has multiple locations. Manage each location in HR Attendance Settings.</p><a href="/team/attendance-settings">Manage locations →</a></> : view.kind === "zero" ? <p role="alert">No active location is available. Contact your administrator.</p> : view.kind === "denied" ? <p>You do not have permission to access attendance location settings.</p> : <>
      {!view.hrEnabled ? <p className={styles.notice}>HR is not enabled. Enable HR in Modules &amp; access before changing attendance location settings.</p> : !view.values?.isEnabled ? <p className={styles.info}>Attendance is currently disabled. Saving this location will not enable attendance.</p> : !view.values.requireGeofence ? <p className={styles.notice}>Location restriction is currently off.</p> : null}
      {view.canManage && view.hrEnabled && view.branch && view.values ? <>
        <AttendanceLocationFields branch={view.branch} businessName={businessName} initialValues={view.values} savedValues={savedValues} pending={pending} formId={formId} compact onDraftChange={onDraftChange} />
        {state.status === "error" && state.message && <p role="alert">{state.message}</p>}
        {state.status === "success" && !draft.dirty && <p role="status">Clock-in location saved.</p>}
        <div className={styles.footer}><div className={styles.hint}><p>Business address and clock-in location are saved separately.</p><p>Changing the business address does not automatically update the clock-in location.</p></div><button className={styles.primaryButton} type="submit" form={formId} disabled={pending || !draft.canSave}>{pending ? "Saving..." : "Save clock-in location"}</button></div>
      </> : <><p>You do not have permission to change attendance location settings.</p>{view.configured && view.values && <><dl><dt>Latitude</dt><dd>{view.values.latitude}</dd><dt>Longitude</dt><dd>{view.values.longitude}</dd><dt>Clock-in radius</dt><dd>{view.values.geofenceRadiusMeters} m</dd><dt>Time zone</dt><dd>{view.values.timezone === "Asia/Kuching" || view.values.timezone === "Asia/Kuala_Lumpur" ? "Malaysia (UTC+8)" : view.values.timezone}</dd></dl><details className={styles.advanced}><summary>Advanced settings</summary><dl><dt>GPS accuracy requirement</dt><dd>{view.values.minimumAccuracyMeters} m</dd></dl></details></>}</>}
    </>}
  </section>;
}
