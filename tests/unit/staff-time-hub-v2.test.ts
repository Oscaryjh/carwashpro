import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(
  new URL(`../../${path}`, import.meta.url),
  "utf8",
);

const page = read("src/app/staff/history/page.tsx");
const loading = read("src/app/staff/history/loading.tsx");
const recordsPage = read("src/app/staff/history/records/page.tsx");
const hub = read("src/components/staff-pwa/staff-time-hub.tsx");
const history = read("src/components/staff-pwa/staff-history.tsx");
const loader = read("src/lib/staff-pwa/time-hub.ts");
const legacyRedirect = read("src/components/staff-pwa/staff-time-hub-legacy-redirect.tsx");
const primitives = read("src/components/staff-pwa/staff-v2-primitives.tsx");
const css = read("src/components/staff-pwa/staff-v2.module.css");
const navigation = read("src/lib/staff-pwa/navigation.ts");

test("/staff/history renders the light Time Hub V2", () => {
  assert.match(page, /getStaffTimeHub/);
  assert.match(page, /<StaffTimeHub model=\{model\}/);
  assert.match(hub, /title="Time"/);
  assert.doesNotMatch(hub, /staff-history-filters|AttendanceHistory|HistoryCard/);
});

test("Time Hub uses canonical readers without duplicating Attendance actions", () => {
  assert.match(loader, /getEmployeeAttendanceToday\(\{ auth \}\)/);
  assert.match(loader, /getEmployeeAttendanceHistory/);
  assert.match(loader, /getEmployeeTimesheetOverview\(auth\)/);
  assert.doesNotMatch(hub, /Clock In|Clock Out|Start Break|requestGps|geofence/);
});

test("Time route streams stable V2 skeleton geometry", () => {
  assert.match(loading, /aria-busy="true"/);
  assert.equal((loading.match(/styles\.skeleton/g) ?? []).length, 4);
  assert.match(css, /\.skeleton/);
});

test("one canonical actionable Attendance summary is shown and pending items get no Fix CTA", () => {
  assert.match(loader, /getMissingClockOutCorrectionState\(item\) === "ACTIONABLE"/);
  assert.match(loader, /actionable\.length/);
  assert.equal((hub.match(/<StaffV2ActionRow/g) ?? []).length, 1);
  assert.match(hub, /model\.attention \? \(/);
  assert.doesNotMatch(loader, /=== "PENDING"[^\n]*href/);
});

test("Schedule summary reuses the canonical schedule projector and never guesses Rest Day", () => {
  assert.match(loader, /buildStaffScheduleDay/);
  assert.match(loader, /getEmployeePublishedRoster/);
  assert.match(loader, /membershipId: auth\.membershipId/);
  assert.match(loader, /view\.status === "REST_DAY"/);
  assert.match(loader, /view\.status === "NOT_SCHEDULED"/);
  assert.match(loader, /No schedule today/);
  assert.doesNotMatch(loader, /!assignments\.length[^\n]*Rest day/i);
  assert.doesNotMatch(loader, /operatingHours|businessHours|openingHours/);
});

test("completed Today state removes the redundant badge and shows only canonical facts", () => {
  assert.match(loader, /today\.sessionCount === 1/);
  assert.match(loader, /today\.currentSession\?\.clockInAt/);
  assert.match(loader, /today\.currentSession\.clockOutAt/);
  assert.match(loader, /badge: null/);
  assert.doesNotMatch(loader, /badge: "Done"/);
  assert.match(hub, /model\.today\.badge\s*\?/);
});

test("Timesheet count names the counted unit and review state", () => {
  assert.match(loader, /item needs/);
  assert.match(loader, /items need/);
  assert.match(loader, /item.*awaiting manager review/);
  assert.match(loader, /items.*awaiting manager review/);
  assert.doesNotMatch(loader, /waiting for manager/);
});

test("Time Hub keeps stable destinations and moves the archive to its child route", () => {
  assert.match(hub, /href="\/staff\/roster"/);
  assert.match(hub, /href="\/staff\/history\/records"/);
  assert.match(hub, /href="\/staff\/timesheet"/);
  assert.match(recordsPage, /<StaffHistory/);
  assert.match(history, /staff-history-filters/);
  assert.doesNotMatch(hub, /staff-history-filters/);
});

test("legacy correction deep links safely continue to the contextual History flow", () => {
  assert.match(legacyRedirect, /window\.location\.hash === "#attendance-correction"/);
  assert.match(legacyRedirect, /\/staff\/history\/records#attendance-correction/);
  assert.match(history, /id="attendance-correction"/);
});

test("shared Staff V2 scope is neutral and protects Home/Time mobile geometry", () => {
  assert.match(primitives, /staff-v2\.module\.css/);
  assert.match(primitives, /StaffV2RowGroup/);
  assert.match(primitives, /StaffV2SectionLabel/);
  assert.match(css, /\.scope \{/);
  assert.match(css, /--staff-v2-canvas:/);
  assert.match(css, /--staff-v2-safe-bottom:/);
  assert.match(css, /--staff-v2-bottom-clearance:/);
  assert.match(css, /min-width: 0/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /@media \(max-width: 380px\)/);
  assert.match(css, /@media \(min-width: 381px\) and \(max-width: 430px\)/);
});

test("bottom navigation and manager-personal Time contract stay unchanged", () => {
  assert.match(navigation, /href: "\/staff\/history"/);
  for (const label of ["Home", "Time", "Requests", "Pay", "Profile"]) {
    assert.match(navigation, new RegExp(`label: "${label}"`));
  }
  assert.doesNotMatch(hub, /Approval Center|Needs My Approval|Team approvals/);
});
