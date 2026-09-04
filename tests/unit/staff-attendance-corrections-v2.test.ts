import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { EmployeeCorrectionArchiveItem } from "../../src/lib/attendance/employee-correction-archive";
import {
  appendEmployeeCorrectionArchiveItems,
  auditEmployeeCorrectionActionRoute,
  getEmployeeCorrectionFinalResultCopy,
  getEmployeeCorrectionStatusPresentation,
  getEmployeeCorrectionTypeCopy,
} from "../../src/lib/staff-pwa/attendance-corrections-v2";

const read = (path: string) => readFile(path, "utf8");

const baseItem: EmployeeCorrectionArchiveItem = {
  sourceKey: "resolution:11111111-1111-4111-8111-111111111111",
  sourceType: "RESOLUTION_CASE",
  businessId: "22222222-2222-4222-8222-222222222222",
  employeeMembershipId: "33333333-3333-4333-8333-333333333333",
  branchId: "44444444-4444-4444-8444-444444444444",
  branchName: "A very long employee workplace branch name for mobile wrapping",
  workDate: "2026-08-31",
  employeeStatus: "PENDING",
  correctionType: "MISSING_CLOCK_OUT",
  submittedAt: "2026-08-31T02:05:00.000Z",
  requestedAt: null,
  reviewedAt: null,
  resolvedAt: null,
  requestedClockIn: null,
  requestedClockOut: "2026-08-31T10:00:00.000Z",
  reason: "The clock-out punch was missing after the employee completed the shift.",
  managerNote: null,
  canEmployeeAct: false,
  nextAction: "NONE",
  resolutionEvents: [],
  currentFinalResult: null,
  finalDisposition: null,
};

test("normalized correction statuses have one employee-facing presentation", () => {
  const expected = {
    ACTION_REQUIRED: "Action needed",
    PENDING: "Waiting for manager",
    RETURNED: "Returned for update",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    CANCELLED: "Cancelled",
    SUPERSEDED: "Superseded",
    UNKNOWN: "Status unavailable",
  } as const;

  for (const [status, label] of Object.entries(expected)) {
    assert.equal(
      getEmployeeCorrectionStatusPresentation(status as keyof typeof expected).label,
      label,
    );
  }
  assert.doesNotMatch(getEmployeeCorrectionStatusPresentation("UNKNOWN").detail, /UNKNOWN/);
});

test("correction types and final results use employee-safe copy", () => {
  assert.equal(getEmployeeCorrectionTypeCopy("MISSING_CLOCK_IN"), "Missing clock in");
  assert.equal(getEmployeeCorrectionTypeCopy("MISSING_CLOCK_OUT"), "Missing clock out");
  assert.equal(getEmployeeCorrectionTypeCopy("CLOCK_IN_CORRECTION"), "Clock-in correction");
  assert.equal(getEmployeeCorrectionTypeCopy("CLOCK_OUT_CORRECTION"), "Clock-out correction");
  assert.equal(getEmployeeCorrectionTypeCopy("DAY_ATTENDANCE_CORRECTION"), "Attendance correction");
  assert.equal(getEmployeeCorrectionTypeCopy("UNSUPPORTED"), "Attendance correction");
  assert.equal(getEmployeeCorrectionFinalResultCopy("INCLUDED"), "Included in attendance result");
  assert.equal(getEmployeeCorrectionFinalResultCopy("EXCLUDED"), "Not included in attendance result");
  assert.equal(getEmployeeCorrectionFinalResultCopy(null), null);
});

test("only actionable Resolution cases navigate to the existing canonical employee flow", () => {
  assert.deepEqual(auditEmployeeCorrectionActionRoute({
    canEmployeeAct: true,
    nextAction: "SUBMIT",
    sourceType: "RESOLUTION_CASE",
  }), {
    status: "SAFE_EXISTING_ROUTE",
    href: "/staff#attendance-issues",
    label: "Complete correction",
    helper: "Continue in the existing attendance response flow.",
  });
  assert.equal(auditEmployeeCorrectionActionRoute({
    canEmployeeAct: true,
    nextAction: "UPDATE",
    sourceType: "RESOLUTION_CASE",
  }).label, "Update correction");
  assert.equal(auditEmployeeCorrectionActionRoute({
    canEmployeeAct: false,
    nextAction: "NONE",
    sourceType: "P2_CORRECTION_REQUEST",
  }).status, "NO_EMPLOYEE_ACTION_ROUTE");
  assert.equal(auditEmployeeCorrectionActionRoute({
    canEmployeeAct: true,
    nextAction: "UPDATE",
    sourceType: "P2_CORRECTION_REQUEST",
  }).status, "ACTION_ROUTE_ENRICHMENT_REQUIRED");
});

test("cursor pages append in server order and defensively dedupe sourceKey", () => {
  const first = [baseItem, { ...baseItem, sourceKey: "exception:55555555-5555-4555-8555-555555555555" }];
  const second = [
    { ...baseItem },
    { ...baseItem, sourceKey: "p2-request:66666666-6666-4666-8666-666666666666" },
  ];
  assert.deepEqual(
    appendEmployeeCorrectionArchiveItems(first, second).map((item) => item.sourceKey),
    [first[0]?.sourceKey, first[1]?.sourceKey, second[1]?.sourceKey],
  );
});

test("Attendance Corrections V2 route consumes the unified read-only archive", async () => {
  const [page, component, loading, error] = await Promise.all([
    read("src/app/staff/history/corrections/page.tsx"),
    read("src/components/staff-pwa/staff-attendance-corrections-v2.tsx"),
    read("src/app/staff/history/corrections/loading.tsx"),
    read("src/app/staff/history/corrections/error.tsx"),
  ]);
  assert.match(page, /requireEmployeeModulePage\("HR"\)/);
  assert.match(page, /<StaffAttendanceCorrectionsV2/);
  assert.match(component, /\/api\/employee-attendance\/corrections\?limit=\$\{PAGE_SIZE\}/);
  assert.match(component, /response\.data\.nextCursor/);
  assert.match(component, /response\.data\.hasMore/);
  assert.match(component, /appendEmployeeCorrectionArchiveItems/);
  assert.doesNotMatch(component, /method:\s*["'](?:POST|PATCH|PUT|DELETE)/);
  assert.match(loading, /CorrectionsLoadingRows/);
  assert.match(error, /Attendance corrections couldn&apos;t load/);
});

test("rows use one normalized status and progressively disclose only provided evidence", async () => {
  const component = await read("src/components/staff-pwa/staff-attendance-corrections-v2.tsx");
  assert.match(component, /getEmployeeCorrectionStatusPresentation\(item\.employeeStatus\)/);
  assert.equal((component.match(/<StaffV2StatusBadge/g) ?? []).length, 2);
  assert.match(component, /item\.requestedClockIn \?/);
  assert.match(component, /item\.requestedClockOut \?/);
  assert.match(component, /item\.managerNote \?/);
  assert.match(component, /item\.resolutionEvents\.map/);
  assert.match(component, /hasTimeline \?/);
  assert.match(component, /finalResult \?/);
  assert.doesNotMatch(component, />\s*RESOLUTION_CASE\s*</);
  assert.doesNotMatch(component, />\s*STANDALONE_EXCEPTION\s*</);
  assert.doesNotMatch(component, />\s*P2_CORRECTION_REQUEST\s*</);
  assert.match(component, /key=\{item\.sourceKey\}/);
  assert.doesNotMatch(component, /<[^>]+>\s*\{item\.sourceKey\}\s*<\//);
  assert.doesNotMatch(component, /\{item\.sourceType\}/);
  assert.doesNotMatch(component, />\s*(?:INCLUDED|EXCLUDED)\s*</);
});

test("all lifecycle fixture states remain readable without a second status machine", () => {
  const fixtures = [
    { ...baseItem, employeeStatus: "ACTION_REQUIRED", canEmployeeAct: true, nextAction: "SUBMIT" },
    { ...baseItem, employeeStatus: "PENDING" },
    { ...baseItem, employeeStatus: "RETURNED", canEmployeeAct: true, nextAction: "UPDATE", managerNote: "Please add the correct clock-out time and explain the late update in enough detail for review." },
    { ...baseItem, employeeStatus: "APPROVED", finalDisposition: "INCLUDED" },
    { ...baseItem, employeeStatus: "REJECTED", finalDisposition: "EXCLUDED" },
    { ...baseItem, employeeStatus: "CANCELLED" },
    { ...baseItem, employeeStatus: "SUPERSEDED" },
    { ...baseItem, employeeStatus: "UNKNOWN" },
  ] satisfies EmployeeCorrectionArchiveItem[];
  assert.deepEqual(fixtures.map((item) => getEmployeeCorrectionStatusPresentation(item.employeeStatus).label), [
    "Action needed",
    "Waiting for manager",
    "Returned for update",
    "Approved",
    "Rejected",
    "Cancelled",
    "Superseded",
    "Status unavailable",
  ]);
});

test("same-day unrelated records are preserved and source-specific missing timelines stay empty", () => {
  const standalone = {
    ...baseItem,
    sourceKey: "exception:77777777-7777-4777-8777-777777777777",
    sourceType: "STANDALONE_EXCEPTION",
    resolutionEvents: [],
  } satisfies EmployeeCorrectionArchiveItem;
  const p2 = {
    ...baseItem,
    sourceKey: "p2-request:88888888-8888-4888-8888-888888888888",
    sourceType: "P2_CORRECTION_REQUEST",
    resolutionEvents: [],
  } satisfies EmployeeCorrectionArchiveItem;
  const merged = appendEmployeeCorrectionArchiveItems([], [standalone, p2]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.workDate, merged[1]?.workDate);
  assert.equal(standalone.resolutionEvents.length, 0);
  assert.equal(p2.resolutionEvents.length, 0);
});

test("mobile CSS preserves compact rows, wrapping, touch targets and bottom clearance", async () => {
  const [css, sharedCss] = await Promise.all([
    read("src/components/staff-pwa/staff-attendance-corrections-v2.module.css"),
    read("src/components/staff-pwa/staff-v2.module.css"),
  ]);
  assert.match(css, /min-width:\s*0/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media \(max-width: 370px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(sharedCss, /--staff-v2-shell-bottom-clearance/);
  assert.match(sharedCss, /safe-area-inset-bottom/);
});

test("Time routes employees to the archive while Requests and manager ownership stay separate", async () => {
  const [requests, historyPage, managerPage, timesheet, navigation, timeHub] = await Promise.all([
    read("src/app/staff/requests/page.tsx"),
    read("src/app/staff/history/records/page.tsx"),
    read("src/app/staff/requests/attendance-corrections/page.tsx"),
    read("src/components/staff-pwa/staff-timesheet-v2.tsx"),
    read("src/lib/staff-pwa/navigation.ts"),
    read("src/components/staff-pwa/staff-time-hub.tsx"),
  ]);
  assert.doesNotMatch(requests, /href="\/staff\/history\/corrections"/);
  assert.match(timeHub, /href="\/staff\/history\/corrections"/);
  assert.match(historyPage, /<StaffHistory/);
  assert.match(managerPage, /Manager access required/);
  assert.match(timesheet, /\/staff\/history\/records#attendance-correction/);
  for (const label of ["Home", "Time", "Approvals", "Pay", "Profile"]) {
    assert.match(navigation, new RegExp(`label: "${label}"`));
  }
});
