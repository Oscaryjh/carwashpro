import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  attendanceHistoryPeriodLabel,
  attendanceHistoryStatusFilterLabel,
  getAttendanceHistoryV2Status,
} from "../../src/lib/staff-pwa/attendance-history-v2";
import type { AttendanceHistoryItem } from "../../src/lib/staff-pwa/types";

const read = (path: string) => readFileSync(path, "utf8");
const page = read("src/app/staff/history/records/page.tsx");
const hubPage = read("src/app/staff/history/page.tsx");
const history = read("src/components/staff-pwa/staff-history.tsx");
const css = read("src/components/staff-pwa/staff-attendance-history-v2.module.css");
const loading = read("src/app/staff/history/records/loading.tsx");
const error = read("src/app/staff/history/records/error.tsx");
const navigation = read("src/lib/staff-pwa/navigation.ts");
const inputSchema = read("src/lib/attendance/punch-input.ts");
const legacyRedirect = read("src/components/staff-pwa/staff-time-hub-legacy-redirect.tsx");

test("records route renders Attendance History V2 while /staff/history remains Time Hub", () => {
  assert.match(page, /<StaffHistory/);
  assert.match(hubPage, /<StaffTimeHub/);
  assert.match(history, /staff-attendance-history-v2\.module\.css/);
  assert.match(history, /title="Attendance history"/);
  assert.match(history, /Your actual clock-ins and worked time/);
});

test("one compact grouped row replaces standalone cards and four metric blocks", () => {
  assert.match(history, /StaffV2RowGroup/);
  assert.match(history, /<details>/);
  assert.match(history, /formatClockRange\(item, timezone\)/);
  assert.match(history, /Worked \$\{formatMinutesAsHours/);
  assert.doesNotMatch(history, /staff-history-card|staff-history-times|staff-history-flags/);
  assert.doesNotMatch(history, /No approval required|GPS evidence/);
  assert.match(css, /min-height:\s*68px/);
});

test("canonical status mapper distinguishes employee action and manager waiting", () => {
  assert.deepEqual(getAttendanceHistoryV2Status(item()), {
    label: "Completed",
    tone: "success",
    correctionState: "NOT_ACTIONABLE",
  });
  assert.equal(getAttendanceHistoryV2Status(item({ status: "OPEN", clockOutAt: null })).label, "In progress");
  assert.equal(getAttendanceHistoryV2Status(item({ status: "ON_BREAK", clockOutAt: null })).label, "On break");
  assert.equal(getAttendanceHistoryV2Status(item({ status: "INCOMPLETE", clockOutAt: null })).label, "Action needed");
  assert.equal(getAttendanceHistoryV2Status(item({
    status: "INCOMPLETE",
    clockOutAt: null,
    requiresApproval: true,
    approvalStatus: "PENDING",
  })).label, "Waiting for manager");
});

test("pending correction has no duplicate employee action", () => {
  assert.match(history, /status\.correctionState === "ACTIONABLE"/);
  assert.match(history, /status\.correctionState === "ACTIONABLE" && !item\.resolutionCaseId/);
  assert.match(history, /status\.correctionState === "PENDING"/);
  assert.match(history, /No action needed — your manager is reviewing this correction/);
  assert.doesNotMatch(history, /Continue correction/);
  assert.match(
    history,
    /status\.correctionState === "PENDING" \? \(\s*<p className=\{styles\.pendingNote\}>/,
  );
});

test("contextual correction preserves canonical preselection and endpoint", () => {
  assert.match(history, /setCorrectionSessionId\(item\.correctionSessionId \?\? item\.id\)/);
  assert.match(history, /setCorrectionBranchId\(item\.branch\.id\)/);
  assert.match(history, /formatWorkDate\(selectedCorrectionSession\.workDate\)/);
  assert.match(history, /\/api\/employee-attendance\/exception/);
  assert.match(history, /result\.data\.duplicate/);
  assert.match(history, /Report missing clock in\/out/);
  assert.match(history, /not already shown on Home/);
  assert.doesNotMatch(history, /Report another missing punch/);
  assert.match(css, /\.fallbackReport[\s\S]*grid-template-columns:\s*36px minmax\(0, 1fr\) 16px/);
  assert.match(css, /\.fallbackReport[\s\S]*min-height:\s*60px/);
});

test("filter sheet uses server-supported raw filters and preserves the 31-day rule", () => {
  assert.match(history, /<dialog/);
  assert.match(history, /Filter history/);
  assert.match(history, /Choose up to 31 days/);
  for (const status of ["OPEN", "ON_BREAK", "COMPLETED", "INCOMPLETE", "CANCELLED"]) {
    assert.match(history, new RegExp(`value="${status}"`));
    assert.match(inputSchema, new RegExp(`"${status}"`));
  }
  assert.doesNotMatch(history, /value="(ACTION_NEEDED|WAITING_FOR_MANAGER|CORRECTED|REJECTED)"/);
  assert.match(history, /hasMultipleBranches \? \(/);
  assert.equal(attendanceHistoryStatusFilterLabel("INCOMPLETE"), "Incomplete records");
});

test("period, pagination, empty, loading and safe error states are compact", () => {
  assert.equal(attendanceHistoryPeriodLabel("2026-08-01", "2026-08-31"), "August 2026");
  assert.match(history, /history\.pagination\.totalPages > 1/);
  assert.match(history, /No attendance records in this period/);
  assert.match(loading, /<HistorySkeleton/);
  assert.equal((history.match(/styles\.rowSkeleton/g) ?? []).length, 3);
  assert.match(error, /Attendance couldn&apos;t load/);
  assert.doesNotMatch(error, />[^<]*(?:Prisma|database|digest)[^<]*</i);
});

test("detail contains only DTO-backed facts and adjustment does not invent corrected", () => {
  assert.match(history, /Clock-in location/);
  assert.match(history, /item\.adjusted \? <div><dt>Adjustment<\/dt><dd>Recorded/);
  assert.doesNotMatch(history, /adjusted[^\n]*Corrected/);
  assert.doesNotMatch(history, /Manager note|Schedule difference|session ID|coordinates/i);
});

test("legacy deep-link and Time bottom navigation remain compatible", () => {
  assert.match(legacyRedirect, /\/staff\/history\/records#attendance-correction/);
  assert.match(history, /window\.location\.hash === "#attendance-correction"/);
  assert.match(navigation, /href: "\/staff\/history"/);
  assert.match(navigation, /activePrefixes: \["\/staff\/history"/);
});

test("mobile geometry is safe at 360, 390 and 412 classes", () => {
  assert.match(css, /min-width:\s*0/);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /@media \(max-width: 380px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /^\s{2,}min-width:\s*[4-9]\d\dpx/m);
});

function item(overrides: Partial<AttendanceHistoryItem> = {}): AttendanceHistoryItem {
  return {
    id: "record-1",
    workDate: "2026-08-30",
    branch: {
      id: "branch-1",
      name: "salon online",
      timezone: "Asia/Kuala_Lumpur",
    },
    primaryStatus: {
      key: "COMPLETED",
      label: "Completed",
      tone: "complete",
    },
    attention: null,
    scheduled: null,
    actual: {
      clockInAt: "2026-08-30T08:47:00.000Z",
      clockOutAt: "2026-08-30T09:49:00.000Z",
      totalBreakMinutes: 0,
      totalWorkedMinutes: 62,
    },
    finalOutcome: null,
    flags: [],
    locked: false,
    sessions: [],
    clockInAt: "2026-08-30T08:47:00.000Z",
    clockOutAt: "2026-08-30T09:49:00.000Z",
    totalBreakMinutes: 0,
    totalWorkedMinutes: 62,
    status: "COMPLETED",
    geofenceStatus: "INSIDE",
    geofenceEvidence: [],
    approvalStatus: "NOT_REQUIRED",
    requiresApproval: false,
    adjusted: false,
    correctionSessionId: null,
    resolutionCaseId: null,
    resolutionCaseStatus: null,
    ...overrides,
  };
}
