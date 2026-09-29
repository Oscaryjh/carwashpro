import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require.extensions[".css"] = (module) => { module.exports = {}; };
const { AttendanceSettingsForm } = require("../../src/components/attendance-settings-form");
const { AttendanceLocationFields } = require("../../src/components/attendance-location-fields");
const { CompanyClockInLocation, CompanyLocationSaveProvider } = require("../../src/components/company-clock-in-location");
const initialValues = { latitude: "5.1", longitude: "116.1", geofenceRadiusMeters: 100, minimumAccuracyMeters: 80, requireGeofence: true, allowOutsideGeofenceRequest: true, timezone: "Asia/Kuching", breakPolicy: "MANUAL_PUNCH", targetBreakMinutes: 60, normalWorkMinutesPerDay: 480, shiftSpanMinutes: 540, isEnabled: true };
test("pending location save locks every editable location field", () => {
  const html = renderToStaticMarkup(createElement(AttendanceLocationFields, { branch: { id: "a", name: "Outlet" }, initialValues, pending: true }));
  const controls = html.match(/<(?:input|select)\b[^>]*>/g) ?? [];
  assert.equal(controls.length, 5);
  for (const control of controls) assert.match(control, /disabled=""/);
});
test("unconfigured single outlet cannot claim attendance is active or save policy before location", () => {
  const html = renderToStaticMarkup(createElement(AttendanceSettingsForm, { action: async () => ({ status: "success", message: "" }), branch: { id: "a", name: "Outlet" }, isConfigured: false, initialValues: { ...initialValues, isEnabled: false }, locationManagedElsewhere: true } as any));
  assert.match(html, /Configure the clock-in location in Business details first/);
  assert.doesNotMatch(html, />Active<|Staff can use Attendance|Saving valid settings will activate/);
  assert.match(html, /<button disabled="" type="submit"/);
});
test("single-outlet HR form offers location summary and keeps work rules without a duplicate location editor", () => {
  const html = renderToStaticMarkup(createElement(AttendanceSettingsForm, { action: async () => ({ status: "success", message: "" }), branch: { id: "a", name: "Outlet" }, isConfigured: true, initialValues, locationManagedElsewhere: true } as any));
  assert.match(html, /Managed in Business details/);
  assert.match(html, /100 m/);
  assert.match(html, /name="breakPolicy"/);
  assert.doesNotMatch(html, /name="latitude"|name="longitude"|name="geofenceRadiusMeters"/);
});
test("company location fields belong only to their separate save form and preserve the exact timezone", () => {
  const html = renderToStaticMarkup(createElement(CompanyLocationSaveProvider, { action: async () => ({ status: "success", message: "" }) }, createElement("form", { id: "profile" }, createElement(CompanyClockInLocation, { view: { kind: "single", branch: { id: "a", name: "Outlet" }, values: initialValues, configured: true, canManage: true, hrEnabled: true } }))));
  assert.match(html, /id="company-clock-in-location-form"[^>]*><\/form><form id="profile"/);
  for (const name of ["latitude", "longitude", "geofenceRadiusMeters", "minimumAccuracyMeters", "timezone"]) {
    assert.match(html, new RegExp(`<(?:input|select)[^>]*form="company-clock-in-location-form"[^>]*name="${name}"`));
  }
  assert.match(html, /value="Asia\/Kuching" selected/);
  assert.doesNotMatch(html, /name="branchId"|Select branch/);
  assert.match(html, /title="Clock-in location map"/);
  assert.match(html, /maps\?q=5.1,116.1/);
});
test("company location denied, disabled, zero and legacy states do not offer editable coordinates", () => {
  for (const overrides of [{ canManage: false }, { hrEnabled: false }, { kind: "zero" }, { kind: "legacy" }, { kind: "denied" }]) {
    const html = renderToStaticMarkup(createElement(CompanyClockInLocation, { view: { kind: "single", branch: { id: "a", name: "Outlet" }, values: initialValues, configured: true, canManage: true, hrEnabled: true, ...overrides } }));
    assert.doesNotMatch(html, /name="latitude"|type="submit"/);
  }
});
