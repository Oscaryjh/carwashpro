import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(
  new URL(`../../${path}`, import.meta.url),
  "utf8",
);

const homePage = read("src/app/staff/page.tsx");
const homeOverview = read("src/components/staff-pwa/staff-home-overview.tsx");
const today = read("src/components/staff-pwa/staff-today.tsx");
const homeReader = read("src/lib/staff-pwa/home.ts");
const consolidationCss = read("src/app/staff/staff-consolidation.css");
const staffCss = read("src/app/staff/staff.css");
const homeV2Css = read("src/components/staff-pwa/staff-v2.module.css");

test("manager approval priority appears after Attendance only when actionable work exists", () => {
  assert.match(homePage, /approvalSummary && approvalSummary\.total > 0/);
  assert.match(homePage, /<StaffToday[\s\S]*afterAttendance=/);
  assert.match(homeOverview, /if \(!summary \|\| summary\.total <= 0\) return null/);
  assert.match(homeOverview, /Needs my approval/);
  assert.match(homeOverview, /Review pending staff requests/);

  const attendanceEnd = today.indexOf("{afterAttendance}");
  assert.ok(attendanceEnd > 0);
  assert.match(today.slice(0, attendanceEnd), /StaffV2HeroStatus/);
  assert.doesNotMatch(today.slice(attendanceEnd), /staff-schedule-card/);
});
test("empty upcoming schedule is omitted while useful and unavailable states remain supported", () => {
  assert.match(homeOverview, /overview\.upNext && overview\.upNext\.status !== "EMPTY"/);
  assert.match(homeReader, /status: "EMPTY"/);
  assert.match(homeReader, /status: "READY"/);
  assert.match(homeReader, /status: "UNAVAILABLE"/);
  assert.match(today, /kicker=\{today\.expectedAttendance \? expectedAttendanceLabel/);
  assert.match(today, /Schedule not available/);
  assert.match(today, /Check Schedule or ask your manager/);
  assert.doesNotMatch(today, /staff-schedule-card/);
});

test("mobile Staff shell reserves fixed nav, safe-area and comfortable scroll clearance", () => {
  assert.match(
    consolidationCss,
    /@media \(max-width: 430px\)[\s\S]*?padding-bottom: calc\(96px \+ env\(safe-area-inset-bottom\)\)/,
  );
  assert.match(
    consolidationCss,
    /@media \(max-width: 430px\)[\s\S]*?scroll-padding-bottom: calc\(96px \+ env\(safe-area-inset-bottom\)\)/,
  );
  assert.match(consolidationCss, /\.staff-pwa-nav \{[\s\S]*?bottom:0/);
});

test("Quick Access remains limited to Appointments, Schedule and Leave", () => {
  assert.match(homeReader, /domain: "APPOINTMENTS"/);
  assert.match(homeReader, /domain: "ROSTER", label: "Schedule"/);
  assert.match(homeReader, /domain: "LEAVE", label: "Leave"/);
  assert.doesNotMatch(homeReader, /domain: "CLAIMS", label:/);
  assert.doesNotMatch(homeReader, /domain: "TIMESHEET", label:/);
});

test("Home V2 reserves a solid mobile canvas and compact actions", () => {
  assert.match(homeV2Css, /--staff-v2-canvas:/);
  assert.match(staffCss, /staff-pwa-shell\.staff-home-v2-shell/);
  assert.doesNotMatch(homeV2Css, /radial-gradient|backdrop-filter/);
  assert.match(homeV2Css, /\.quickAction \{[\s\S]*?min-height: 60px/);
  assert.match(homeV2Css, /@media \(max-width: 380px\)/);
});
