"use client";

import { useEffect, useRef, useState } from "react";
import type { AttendanceSettingValues } from "./attendance-settings-form";
import styles from "./clock-in-location.module.css";

export type LocationValues = { latitude: string; longitude: string; geofenceRadiusMeters: string; minimumAccuracyMeters: string; timezone: string };
export type LocationDraftState = { status: "Not configured" | "Unsaved location" | "Configured"; dirty: boolean; canSave: boolean };

type Props = {
  branch: { id: string; name: string };
  initialValues: AttendanceSettingValues;
  pending?: boolean;
  formId?: string;
  compact?: boolean;
  businessName?: string;
  onDirty?: () => void;
  onReadyChange?: (ready: boolean) => void;
  savedValues?: LocationValues;
  onDraftChange?: (state: LocationDraftState) => void;
};

export function AttendanceLocationFields({ initialValues, pending = false, formId, onDirty, onReadyChange, savedValues, onDraftChange }: Props) {

  const [latitude, setLatitude] = useState(initialValues.latitude);
  const [longitude, setLongitude] = useState(initialValues.longitude);
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [deviceAccuracy, setDeviceAccuracy] = useState<number | null>(null);
  const [maximumError, setMaximumError] = useState(String(initialValues.minimumAccuracyMeters));
  const [radius, setRadius] = useState(String(initialValues.geofenceRadiusMeters));
  const [timezone, setTimezone] = useState(initialValues.timezone);
  const [locationFailed, setLocationFailed] = useState(false);
  const [originalValues] = useState(() => ({ latitude: initialValues.latitude, longitude: initialValues.longitude, geofenceRadiusMeters: String(initialValues.geofenceRadiusMeters), minimumAccuracyMeters: String(initialValues.minimumAccuracyMeters), timezone: initialValues.timezone }));
  const baseline = savedValues ?? originalValues;
  const normalize = (value: string) => value.trim() !== "" && Number.isFinite(Number(value)) ? String(Number(value)) : value.trim();
  const dirty = normalize(latitude) !== normalize(baseline.latitude) || normalize(longitude) !== normalize(baseline.longitude) || normalize(radius) !== normalize(baseline.geofenceRadiusMeters) || normalize(maximumError) !== normalize(baseline.minimumAccuracyMeters) || timezone !== baseline.timezone;
  const hasSavedLocation = baseline.latitude.trim() !== "" && baseline.longitude.trim() !== "" && Number.isFinite(Number(baseline.latitude)) && Math.abs(Number(baseline.latitude)) <= 90 && Number.isFinite(Number(baseline.longitude)) && Math.abs(Number(baseline.longitude)) <= 180;
  const requestId = useRef(0);
  const savePending = useRef(pending);
  savePending.current = pending;
  const isMalaysiaTimezone = initialValues.timezone === "Asia/Kuching" || initialValues.timezone === "Asia/Kuala_Lumpur";
  const coordinatesValid = latitude.trim() !== "" && longitude.trim() !== "" && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) && Math.abs(Number(latitude)) <= 90 && Math.abs(Number(longitude)) <= 180;
  const rulesValid = Number.isInteger(Number(radius)) && Number(radius) >= 20 && Number(radius) <= 1000 && Number.isInteger(Number(maximumError)) && Number(maximumError) >= 10 && Number(maximumError) <= 500 && timezone !== "";
  const status = dirty ? "Unsaved location" : hasSavedLocation ? "Configured" : "Not configured";
  const canSave = dirty && coordinatesValid && rulesValid && !pending && !locating;
  useEffect(() => { onDraftChange?.({ status, dirty, canSave }); }, [status, dirty, canSave, onDraftChange]);
  useEffect(() => () => { requestId.current++; }, []);
  useEffect(() => { onReadyChange?.(coordinatesValid && !locating); }, [coordinatesValid, locating, onReadyChange]);
  useEffect(() => {
    if (pending) { requestId.current++; setLocating(false); }
  }, [pending]);

  function editCoordinate(setValue: (value: string) => void, value: string) {
    requestId.current++;
    setLocating(false);
    setDeviceAccuracy(null);
    setLocationMessage("");
    setLocationFailed(false);
    setValue(value);
    onDirty?.();
  }

  function useCurrentLocation() {
    if (pending) return;
    const currentRequest = ++requestId.current;
    setDeviceAccuracy(null);
    setLocationFailed(false);
    if (!navigator.geolocation) {
      setLocationMessage("Unable to get your device location. This browser does not provide device location. Enter coordinates manually.");
      setLocationFailed(true);
      return;
    }
    setLocating(true);
    setLocationMessage("Requesting the current device location...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (requestId.current !== currentRequest || savePending.current) return;
        const { latitude: lat, longitude: lng, accuracy } = position.coords;
        if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) {
          setLocationMessage("Unable to get your device location. This device returned invalid coordinates. Enter coordinates manually.");
          setLocationFailed(true);
          setLocating(false);
          return;
        }
        setLatitude(lat.toFixed(6));
        setLongitude(lng.toFixed(6));
        setDeviceAccuracy(Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null);
        setLocationMessage(Number.isFinite(accuracy) && accuracy >= 0 ? "" : "Location detected. Check the map before saving.");
        onDirty?.();
        onReadyChange?.(true);
        setLocating(false);
      },
      (error) => {
        if (requestId.current !== currentRequest || savePending.current) return;
        setLocationFailed(true);
        setLocationMessage("Unable to get your device location. " + (error.code === error.PERMISSION_DENIED
          ? "Location access is off. Allow location for this site in your browser settings, then try again."
          : error.code === error.TIMEOUT
            ? "Location took too long. Move near a window or outdoors, then try again."
            : "Check GPS and precise-location settings, then try again."));
        setLocating(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  }

  return <div className={styles.editor}>
    <div>
      <div className={styles.fieldGrid}>
        <label><span>Latitude</span><input form={formId} inputMode="decimal" disabled={pending} max="90" min="-90" name="latitude" onChange={(event) => editCoordinate(setLatitude, event.target.value)} required step="0.000001" value={latitude} /><small>-90 to 90</small></label>
        <label><span>Longitude</span><input form={formId} inputMode="decimal" disabled={pending} max="180" min="-180" name="longitude" onChange={(event) => editCoordinate(setLongitude, event.target.value)} required step="0.000001" value={longitude} /><small>-180 to 180</small></label>
      </div>
    </div>
    <div className={styles.actions}>
      <button className={styles.secondaryButton} disabled={locating || pending} onClick={useCurrentLocation} type="button">{locating ? "Locating..." : "Use current device location"}</button>
    </div>
    {locationMessage && <p className={styles.hint} role="status">{locationMessage}</p>}
    {locationFailed && <button className={styles.secondaryButton} type="button" disabled={pending || locating} onClick={useCurrentLocation}>Try again</button>}
    {deviceAccuracy !== null && <div className={deviceAccuracy > 80 ? styles.accuracyWarning : styles.accuracyGood} role={deviceAccuracy > 80 ? "alert" : "status"}>
      <strong>{deviceAccuracy > 1000 ? "Low-confidence device location" : deviceAccuracy > 80 ? "Approximate device location" : "Location detected"}</strong>
      <p>Device location accuracy: ~{deviceAccuracy >= 1000 ? `${(deviceAccuracy / 1000).toLocaleString("en-MY", { maximumFractionDigits: 1 })} km` : `${deviceAccuracy.toLocaleString("en-MY", { maximumFractionDigits: 1 })} m`}</p>
      {deviceAccuracy > 80 && <p>{deviceAccuracy > 1000 ? "This location may be far from your actual store. Check the map carefully or enter the coordinates manually." : "Check the map and adjust the coordinates manually if needed."}</p>}
    </div>}
    {coordinatesValid ? <div className={styles.map}><iframe loading="lazy" referrerPolicy="no-referrer-when-downgrade" title="Clock-in location map" src={`https://www.google.com/maps?q=${Number(latitude)},${Number(longitude)}&z=18&output=embed`} /></div> : <div className={styles.mapEmpty}><p>Enter coordinates manually or use your current device location.</p><p>Map preview will appear after valid coordinates are entered.</p></div>}
    <section className={styles.rules}>
      <h4>Clock-in rules</h4>
      <div className={styles.rulesGrid}>
        <label><span>Allowed clock-in radius</span><div className={styles.unitInput}><input form={formId} value={radius} onChange={(event) => setRadius(event.target.value)} disabled={pending} max="1000" min="20" name="geofenceRadiusMeters" required step="1" type="number" /><span>metres</span></div><small>The permitted area around the store where staff can clock in.</small></label>
        <label><span>Maximum GPS error allowed</span><div className={styles.unitInput}><input form={formId} value={maximumError} onChange={(event) => setMaximumError(event.target.value)} disabled={pending} max="500" min="10" name="minimumAccuracyMeters" required step="1" type="number" /><span>metres</span></div><small>Used when staff clock in. This does not limit how you set the store location.</small></label>
        <label><span>Time zone</span><select form={formId} disabled={pending} value={timezone} onChange={(event) => setTimezone(event.target.value)} name="timezone" required>{!isMalaysiaTimezone && <option value={initialValues.timezone}>{initialValues.timezone} (Current)</option>}<option value={isMalaysiaTimezone ? initialValues.timezone : "Asia/Kuala_Lumpur"}>Malaysia (UTC+8)</option></select><small>Used for attendance dates, shifts and overnight work.</small></label>
      </div>
    </section>
  </div>;
}
