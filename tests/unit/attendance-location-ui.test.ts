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
test("empty location exposes editable coordinates without a confirmation step", () => {
  const html = renderToStaticMarkup(createElement(AttendanceLocationFields, { branch: { id: "a", name: "Outlet" }, initialValues: { ...initialValues, latitude: "", longitude: "" }, compact: true }));
  assert.match(html, /Use current device location/);
  assert.match(html, /name="latitude"/);
  assert.doesNotMatch(html, /hidden=""|<dialog/);
  assert.doesNotMatch(html, /<iframe/);
  assert.match(html, /Map preview will appear after valid coordinates are entered/);
});
test("configured location presents store-friendly rules and separate saving copy", () => {
  const html = renderToStaticMarkup(createElement(CompanyClockInLocation, { view: { kind: "single", branch: { id: "a", name: "Outlet" }, values: initialValues, configured: true, canManage: true, hrEnabled: true } }));
  for (const label of ["Configured", "Use current device location", "Save clock-in location", "Clock-in rules", "Clock-in radius", "GPS accuracy requirement", "Business address and clock-in location are saved separately."]) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /Geofence validation|around the branch/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Save clock-in location/);
});
test("pending location save locks every editable location field", () => {
  const html = renderToStaticMarkup(createElement(AttendanceLocationFields, { branch: { id: "a", name: "Outlet" }, initialValues, pending: true }));
  const controls = html.match(/<(?:input|select)\b[^>]*>/g) ?? [];
  assert.equal(controls.length, 5);
  for (const control of controls) assert.match(control, /disabled=""/);
});

test("read-only location uses the same GPS rule labels", () => {
  const html = renderToStaticMarkup(createElement(CompanyClockInLocation, { view: { kind: "single", values: initialValues, configured: true, canManage: false, hrEnabled: true } }));
  assert.match(html, /Clock-in radius/);
  assert.match(html, /<details[^>]*><summary[^>]*>Advanced settings<\/summary>[\s\S]*GPS accuracy requirement/);
  assert.doesNotMatch(html, /<input|<select|<details[^>]*\bopen/);
  assert.doesNotMatch(html, /<dt>GPS accuracy<\/dt>/);
});

test("company advanced rule is collapsed but retains its enabled form field and stored value", () => {
  const html = renderToStaticMarkup(createElement(AttendanceLocationFields, { branch: { id: "a", name: "Outlet" }, initialValues, compact: true, formId: "location-save" }));
  const advanced = html.match(/<details\b[^>]*>[\s\S]*?<\/details>/)?.[0];
  assert.ok(advanced, "advanced disclosure must exist");
  assert.doesNotMatch(advanced, /<details[^>]*\bopen/);
  assert.match(advanced, /<summary[^>]*>Advanced settings<\/summary>/);
  assert.match(advanced, /GPS accuracy requirement/);
  assert.match(advanced, /<input[^>]*form="location-save"[^>]*name="minimumAccuracyMeters"[^>]*value="80"/);
  assert.doesNotMatch(advanced, /disabled|name="geofenceRadiusMeters"|name="timezone"/);
  const ordinary = html.replace(advanced, "");
  assert.doesNotMatch(ordinary, /name="minimumAccuracyMeters"|Maximum GPS error allowed/);
  assert.match(ordinary, /name="geofenceRadiusMeters"[^>]*value="100"/);
  assert.match(ordinary, /value="Asia\/Kuching" selected/);
});

test("legacy HR keeps its visible GPS rule and existing labels", () => {
  const html = renderToStaticMarkup(createElement(AttendanceLocationFields, { branch: { id: "a", name: "Outlet" }, initialValues }));
  assert.doesNotMatch(html, /<details/);
  assert.match(html, /Allowed clock-in radius/);
  assert.match(html, /Maximum GPS error allowed/);
  assert.match(html, /name="minimumAccuracyMeters"[^>]*value="80"/);
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
