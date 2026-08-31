import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getStaffHomeAttendanceViewState } from "../../src/components/staff-pwa/staff-home-attendance-view";

const read = (path: string) => readFileSync(
  new URL(`../../${path}`, import.meta.url),
  "utf8",
);

const overview = read("src/components/staff-pwa/staff-home-overview.tsx");
const attendanceView = read("src/components/staff-pwa/staff-home-attendance-view.ts");
const primitives = read("src/components/staff-pwa/staff-home-v2-primitives.tsx");
const today = read("src/components/staff-pwa/staff-today.tsx");
const chrome = read("src/components/staff-pwa/staff-pwa-chrome.tsx");
const css = read("src/components/staff-pwa/staff-home-v2.module.css");
const staffCss = read("src/app/staff/staff.css");
const navigation = read("src/lib/staff-pwa/navigation.ts");

test("Home V2 provides the approved reusable primitive family", () => {
  for (const name of [
    "StaffV2PageHeader",
    "StaffV2HeroStatus",
    "StaffV2CompactSummary",
    "StaffV2ListRow",
    "StaffV2ActionRow",
    "StaffV2StatusBadge",
    "StaffV2EmptyState",
  ]) {
    assert.match(primitives, new RegExp(`export function ${name}`));
  }
  assert.match(css, /--staff-v2-surface:/);
  assert.match(css, /--staff-v2-ink:/);
  assert.match(css, /--staff-v2-brand:/);
});

test("Home V2 removes the welcome hero and keeps Attendance as its only hero", () => {
  assert.doesNotMatch(overview, /staff-welcome-card/);
  assert.match(overview, /StaffV2PageHeader/);
  assert.match(today, /StaffV2HeroStatus/);
  assert.equal((today.match(/<StaffV2HeroStatus/g) ?? []).length, 1);
  assert.doesNotMatch(today, /staff-schedule-card/);
});

test("Attendance facts are progressively disclosed without empty dash metrics", () => {
  assert.match(attendanceView, /if \(today\.clockInAt\)/);
  assert.match(attendanceView, /if \(today\.currentSession\?\.clockOutAt\)/);
  assert.match(attendanceView, /if \(today\.status \|\| today\.totalCompletedBreakMinutes > 0\)/);
  assert.match(attendanceView, /if \(today\.status \|\| today\.currentWorkedMinutes > 0\)/);
  assert.doesNotMatch(today, /value=\{today\.clockInAt[^\n]*"—"/);
  assert.doesNotMatch(today, /staff-metrics/);
});

test("Home attendance view state covers ready, working, break and completed geometry", () => {
  const base = {
    clockInAt: null,
    currentSession: null,
    currentWorkedMinutes: 0,
    sessionCount: 0,
    status: null,
    totalCompletedBreakMinutes: 0,
  } as const;
  const ready = getStaffHomeAttendanceViewState(base);
  assert.deepEqual(ready.facts, []);
  assert.equal(ready.badgeLabel, null);

  const openInput = {
    ...base,
    clockInAt: "2026-08-31T01:00:00.000Z",
    currentWorkedMinutes: 45,
    status: "OPEN" as const,
  };
  const open = getStaffHomeAttendanceViewState(openInput);
  assert.equal(open.headline, "You are currently working");
  assert.deepEqual(open.facts, ["clockIn", "break", "worked"]);

  const onBreak = getStaffHomeAttendanceViewState({ ...openInput, status: "ON_BREAK" });
  assert.equal(onBreak.tone, "warning");
  assert.equal(onBreak.badgeLabel, null);

  const completed = getStaffHomeAttendanceViewState({
    ...openInput,
    currentSession: {
      approvalStatus: "NOT_REQUIRED",
      clockInAt: "2026-08-31T01:00:00.000Z",
      clockOutAt: "2026-08-31T09:00:00.000Z",
      id: "session",
      requiresApproval: false,
      status: "COMPLETED",
      workDate: "2026-08-31",
    },
    sessionCount: 2,
    status: "COMPLETED",
  });
  assert.equal(completed.badgeLabel, "Shift 2");
  assert.deepEqual(completed.facts, ["clockIn", "clockOut", "break", "worked"]);
});

test("Home V2 preserves canonical Attendance actions and exception flow", () => {
  assert.match(today, /today\.allowedActions\.map/);
  assert.match(today, /createAttendanceIdempotencyKey\(action\)/);
  assert.match(today, /requestGps\(\)/);
  assert.match(today, /Request manager approval/);
  assert.match(today, /StaffResolutionCases/);
  assert.match(today, /createPortal/);
});

test("Home V2 presents one relevant next row and only approved quick actions", () => {
  assert.match(overview, /nextAppointment \? \(/);
  assert.match(overview, /\) : usefulUpNext \? \(/);
  assert.match(overview, /overview\.quickAccess\.map/);
  assert.doesNotMatch(overview, /appointment-count|View all/);
  assert.match(css, /min-height: 60px/);
});

test("Home V2 final polish removes duplicate state and mixed quick action artwork", () => {
  assert.match(attendanceView, /badgeLabel: today\.sessionCount > 1 \? `Shift \$\{today\.sessionCount\}` : null/);
  assert.match(today, /viewState\.badgeLabel \? \(/);
  assert.doesNotMatch(today, />Ready<|>Working<|>On break<|>Shift done</);
  assert.match(overview, /APPOINTMENTS: "clock"/);
  assert.match(overview, /ROSTER: "calendar"/);
  assert.match(overview, /LEAVE: "leaf"/);
  assert.doesNotMatch(overview, /quickAccessIcons\[item\.domain\]/);
  assert.match(css, /\.quickAction > span:first-child/);
  assert.match(css, /\.quickAction svg \{ height: 24px; width: 24px; \}/);
  assert.match(css, /\.quickAction:focus-visible/);
  assert.match(css, /font-size: 11px/);
});

test("Home V2 final polish keeps identity and no-schedule guidance compact", () => {
  assert.match(overview, /height=\{32\}/);
  assert.match(overview, /width=\{32\}/);
  assert.match(css, /\.pageHeaderLeading[\s\S]*height: 32px;[\s\S]*width: 32px;/);
  assert.match(today, /"Check Schedule or ask your manager\."/);
  assert.match(today, /meta=\{today\.expectedAttendance/);
});

test("manager approval entry remains capability-result driven and hidden at zero", () => {
  assert.match(overview, /if \(!summary \|\| summary\.total <= 0\) return null/);
  assert.match(overview, /href="\/staff\/approvals"/);
  assert.match(overview, /count=\{summary\.total\}/);
});

test("Home-only shell is solid and canonical navigation remains unchanged", () => {
  assert.match(chrome, /currentPath === "\/staff" \? " staff-home-v2-shell"/);
  assert.match(staffCss, /staff-pwa-shell\.staff-home-v2-shell/);
  assert.match(staffCss, /staff-home-v2-shell \.staff-pwa-header/);
  assert.match(staffCss, /staff-home-v2-shell \.staff-pwa-brand > span/);
  assert.doesNotMatch(css, /radial-gradient|linear-gradient|backdrop-filter/);
  for (const label of ["Home", "Time", "Requests", "Pay", "Profile"]) {
    assert.match(navigation, new RegExp(`label: "${label}"`));
  }
});

test("Home V2 mobile contract prevents horizontal overflow and preserves nav clearance", () => {
  assert.match(css, /min-width: 0/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /@media \(max-width: 380px\)/);
  assert.match(css, /min-height: 48px/);
  assert.match(css, /padding-bottom: 12px/);
});
