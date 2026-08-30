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

test("manager approval priority appears after Attendance only when actionable work exists", () => {
  assert.match(homePage, /approvalSummary && approvalSummary\.total > 0/);
  assert.match(homePage, /<StaffToday[\s\S]*afterAttendance=/);
  assert.match(homeOverview, /if \(!summary \|\| summary\.total <= 0\) return null/);
  assert.match(homeOverview, /NEEDS MY APPROVAL/);
  assert.match(homeOverview, />Review</);

  const attendanceEnd = today.indexOf("{afterAttendance}");
  const scheduleStart = today.indexOf('className={`staff-page-card staff-schedule-card');
  assert.ok(attendanceEnd > 0);
  assert.ok(scheduleStart > attendanceEnd, "manager priority must render before Schedule");
});

test("empty upcoming schedule is omitted while useful and unavailable states remain supported", () => {
  assert.match(homeOverview, /overview\.upNext && overview\.upNext\.status !== "EMPTY"/);
  assert.match(homeReader, /status: "EMPTY"/);
  assert.match(homeReader, /status: "READY"/);
  assert.match(homeReader, /status: "UNAVAILABLE"/);
  assert.match(today, /staff-schedule-card\$\{today\.expectedAttendance \? "" : " is-empty"\}/);
  assert.match(today, />No schedule yet</);
  assert.match(today, /This is not shown as a rest day/);
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
