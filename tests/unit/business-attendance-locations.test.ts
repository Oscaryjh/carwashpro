import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BusinessAttendanceLocations, type BusinessAttendanceBranch } from "../../src/components/business-attendance-locations";

const branch: BusinessAttendanceBranch = { id: "branch-a", name: "Branch A", attendanceSetting: null };
const render = (branches: BusinessAttendanceBranch[], available = true, hrEnabled = true) =>
  renderToStaticMarkup(createElement(BusinessAttendanceLocations, { branches, available, hrEnabled }));

test("unconfigured branch opens its existing HR settings without submitting the company form", () => {
  const html = render([branch]);
  assert.match(html, /Clock-in location not set/);
  assert.match(html, /Set clock-in location/);
  assert.match(html, />Branch</);
  assert.match(html, /Managed separately in HR settings/);
  assert.match(html, /href="\/team\/attendance-settings\/branch-a"/);
  assert.match(html, /target="_blank"/);
  assert.doesNotMatch(html, /<button|<form|name="latitude"|name="longitude"/);
});

test("summary distinguishes active, paused and unrestricted attendance", () => {
  const configured = { ...branch, attendanceSetting: { isEnabled: true, requireGeofence: true, geofenceRadiusMeters: 150 } };
  assert.match(render([configured]), /Attendance active/);
  assert.match(render([configured]), /Clock-in location configured/);
  assert.match(render([configured]), /Manage clock-in location/);
  assert.match(render([configured]), /Radius: 150 m/);
  assert.match(render([{ ...configured, attendanceSetting: { ...configured.attendanceSetting, isEnabled: false } }]), /Attendance paused/);
  const unrestricted = render([{ ...configured, attendanceSetting: { ...configured.attendanceSetting, requireGeofence: false } }]);
  assert.match(unrestricted, /Location restriction is off/);
  assert.doesNotMatch(unrestricted, /Radius: 150 m/);
});

test("multiple branches have a selector; unavailable access and empty branches have no edit link", () => {
  assert.match(render([branch, { ...branch, id: "branch-b", name: "Branch B" }]), /<select/);
  assert.doesNotMatch(render([branch]), /<select/);
  assert.doesNotMatch(render([branch], false), /href=|Branch A/);
  assert.match(render([branch], false, false), /HR is not enabled/);
  assert.match(render([branch], false, false), /Enable HR in Modules &amp; access/);
  assert.doesNotMatch(render([branch], false, false), /href=|Branch A/);
  assert.match(render([]), /No active branches/);
  assert.doesNotMatch(render([]), /href=/);
});
