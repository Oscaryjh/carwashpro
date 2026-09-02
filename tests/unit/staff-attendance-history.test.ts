import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildStaffAttendancePrimaryStatus,
  staffAttendanceIssueCopy,
  type StaffAttendanceIssue,
} from "../../src/lib/staff-pwa/attendance-history";

const readServiceSource = readFileSync(
  new URL("../../src/lib/attendance/read-service.ts", import.meta.url),
  "utf8",
);
const historySource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-history.tsx", import.meta.url),
  "utf8",
);
const exceptionServiceSource = readFileSync(
  new URL("../../src/lib/attendance/exception-service.ts", import.meta.url),
  "utf8",
);
const cssSource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-attendance-history-v2.module.css", import.meta.url),
  "utf8",
);

function issue(type: string, status = "OPEN"): StaffAttendanceIssue {
  return { type, status, ...staffAttendanceIssueCopy(type) };
}

test("normal ended punch session is compact Completed, not an inferred attendance outcome", () => {
  const status = buildStaffAttendancePrimaryStatus({
    sessionStatuses: ["COMPLETED"],
    issues: [],
    finalOutcome: null,
    adjusted: false,
    resolved: false,
  });
  assert.equal(status.label, "Completed");
  assert.equal(status.key, "COMPLETED");
  assert.match(historySource, /Punch status:/);
});

test("active clock-in remains In progress until a canonical issue exists", () => {
  const status = buildStaffAttendancePrimaryStatus({
    sessionStatuses: ["OPEN"],
    issues: [],
    finalOutcome: null,
    adjusted: false,
    resolved: false,
  });
  assert.equal(status.label, "In progress");
  assert.equal(status.key, "IN_PROGRESS");
});

test("canonical missing clock-out and short attendance issues take priority", () => {
  const missing = buildStaffAttendancePrimaryStatus({
    sessionStatuses: ["INCOMPLETE"],
    issues: [issue("MISSING_CLOCK_OUT")],
    finalOutcome: null,
    adjusted: false,
    resolved: false,
  });
  assert.equal(missing.label, "Missing clock-out");
  assert.equal(missing.key, "MISSING_PUNCH");

  const short = buildStaffAttendancePrimaryStatus({
    sessionStatuses: ["COMPLETED"],
    issues: [issue("EARLY_DEPARTURE")],
    finalOutcome: null,
    adjusted: false,
    resolved: false,
  });
  assert.equal(short.label, "Short attendance");
  assert.equal(short.key, "NEEDS_REVIEW");
});

test("unauthorized absence is only rendered from the canonical final outcome", () => {
  const unresolved = buildStaffAttendancePrimaryStatus({
    sessionStatuses: [],
    issues: [issue("NO_ATTENDANCE_RECORDED")],
    finalOutcome: null,
    adjusted: false,
    resolved: false,
  });
  assert.equal(unresolved.label, "Missing attendance");
  assert.doesNotMatch(unresolved.label, /Unauthorized/i);

  const final = buildStaffAttendancePrimaryStatus({
    sessionStatuses: [],
    issues: [],
    finalOutcome: "UNAUTHORIZED_ABSENCE",
    adjusted: false,
    resolved: true,
  });
  assert.equal(final.label, "Unauthorized absence");
  assert.match(readServiceSource, /group\.finalResult\?\.outcome/);
});

test("history read model preserves scheduled evidence, canonical totals, multiple sessions and timezone", () => {
  assert.match(readServiceSource, /attendanceExpectedDay\.findMany/);
  assert.match(readServiceSource, /status: "CURRENT"/);
  assert.match(readServiceSource, /totalWorkedMinutes: orderedSessions\.reduce/);
  assert.match(readServiceSource, /orderedSessions\.length > 1/);
  assert.match(readServiceSource, /timezoneSnapshot/);
  assert.match(historySource, /timeZone: timezone/);
  assert.match(historySource, /styles\.sessionList/);
});

test("GPS and adjustment are detail evidence with specific employee wording", () => {
  assert.match(historySource, /Location evidence/);
  assert.match(historySource, /Location accuracy was insufficient/);
  assert.match(historySource, /Punch status:/);
  assert.match(readServiceSource, /Adjustment approved/);
  assert.doesNotMatch(historySource, /Approval:\s*\{/);
});

test("locked attendance remains readable and correction writes cannot bypass the lock", () => {
  assert.match(readServiceSource, /attendanceMonthlyTimesheet\.findMany/);
  assert.match(historySource, /This attendance record belongs to a finalized timesheet/);
  assert.match(exceptionServiceSource, /assertAttendancePeriodOpen/);
  assert.match(exceptionServiceSource, /status: "LOCKED"/);
  assert.match(exceptionServiceSource, /Contact your manager if a correction is required/);
});

test("iPhone history layout is compact and clips horizontal overflow", () => {
  assert.match(cssSource, /\.page\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(cssSource, /\.record summary\s*\{[\s\S]*?min-height:\s*68px/);
  assert.match(cssSource, /@media \(max-width: 380px\)[\s\S]*?\.record summary/);
  assert.match(historySource, /history\.pagination\.totalPages > 1/);
});
