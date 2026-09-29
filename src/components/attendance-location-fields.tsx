"use client";
import { useState } from "react";
import type { AttendanceSettingValues } from "./attendance-settings-form";
import styles from "@/app/(business)/team/attendance-settings/attendance-settings.module.css";
type PendingDeviceLocation = { latitude: number; longitude: number; accuracyMeters: number };
export function AttendanceLocationFields({ branch, initialValues, pending = false, formId, onDirty }: { branch: { id: string; name: string }; initialValues: AttendanceSettingValues; pending?: boolean; formId?: string; onDirty?: () => void }) {
  const [latitude, setLatitude] = useState(initialValues.latitude);
  const [longitude, setLongitude] = useState(initialValues.longitude);
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [pendingDeviceLocation, setPendingDeviceLocation] =
    useState<PendingDeviceLocation | null>(null);
  const isMalaysiaTimezone = initialValues.timezone === "Asia/Kuching" || initialValues.timezone === "Asia/Kuala_Lumpur";
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
    if (!pendingDeviceLocation || pending) {
      return;
    }

    setLatitude(pendingDeviceLocation.latitude.toFixed(6));
    setLongitude(pendingDeviceLocation.longitude.toFixed(6));
    onDirty?.();
    setPendingDeviceLocation(null);
    setLocationMessage(
      "Location selected. Save clock-in location to apply it.",
    );
  }

  return (<>
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
                disabled={locating || pending}
                onClick={useCurrentLocation}
                type="button"
              >
                {locating ? "Locating..." : "Try location again"}
              </button>
              <button disabled={pending} onClick={confirmCurrentLocation} type="button">
                Use this location
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p>CLOCK-IN LOCATION</p>
            <h2>Clock-in location</h2>
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
              form={formId}
              inputMode="decimal"
              disabled={pending}
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
              form={formId}
              inputMode="decimal"
              disabled={pending}
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
        {latitude.trim() && longitude.trim() && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) && Math.abs(Number(latitude)) <= 90 && Math.abs(Number(longitude)) <= 180 ? (
          <div className={styles.locationMapFrame}><iframe loading="lazy" referrerPolicy="no-referrer-when-downgrade" title="Clock-in location map" src={`https://www.google.com/maps?q=${Number(latitude)},${Number(longitude)}&z=18&output=embed`} /></div>
        ) : <p>Enter coordinates or use your device location to preview the map.</p>}
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
            <span>Geofence radius (metres)</span>
            <input
              form={formId}
              defaultValue={initialValues.geofenceRadiusMeters}
              disabled={pending}
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
            <span>GPS accuracy (metres)</span>
            <input
              form={formId}
              defaultValue={initialValues.minimumAccuracyMeters}
              disabled={pending}
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
              form={formId}
              aria-describedby="attendance-timezone-help"
              disabled={pending}
              defaultValue={
                initialValues.timezone
              }
              name="timezone"
              required
            >
              {!isMalaysiaTimezone ? (
                <option value={initialValues.timezone}>
                  {initialValues.timezone} (Current)
                </option>
              ) : null}
              <option value={isMalaysiaTimezone ? initialValues.timezone : "Asia/Kuala_Lumpur"}>Malaysia (UTC+8)</option>
            </select>
            <small id="attendance-timezone-help">
              Malaysia time is used for clock-in dates, shifts and overnight work.
            </small>
          </label>
        </div>

      </section>
  </>);
}
