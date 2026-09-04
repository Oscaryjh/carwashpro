import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildStaffScheduleDay, type StaffScheduleAssignment } from "../../src/lib/staff-pwa/schedule";
import {
  buildStaffScheduleV2Day,
  buildStaffScheduleV2Week,
} from "../../src/lib/staff-pwa/schedule-v2";

const pageSource = readFileSync("src/app/staff/roster/page.tsx", "utf8");
const componentSource = readFileSync("src/components/staff-pwa/staff-schedule-v2.tsx", "utf8");
const scheduleCss = readFileSync("src/components/staff-pwa/staff-schedule-v2.module.css", "utf8");
const legacyCss = `${readFileSync("src/app/staff/staff.css", "utf8")}\n${readFileSync("src/app/staff/staff-consolidation.css", "utf8")}`;
const navigationSource = readFileSync("src/lib/staff-pwa/navigation.ts", "utf8");

const monday = new Date("2026-08-24T00:00:00.000Z");
const tuesday = new Date("2026-08-25T00:00:00.000Z");

test("Schedule V2 keeps the stable route and employee-facing Schedule language", () => {
  assert.match(pageSource, /metadata: Metadata = \{ title: "Schedule" \}/);
  assert.match(componentSource, /title="Schedule"/);
  assert.match(componentSource, /Your expected work and approved time away/);
  assert.doesNotMatch(`${pageSource}\n${componentSource}`, />\s*Roster\s*</i);
  assert.match(pageSource, /\/staff\/roster\?week=/);
});

test("Schedule V2 uses one week navigator, seven rows and no separate Today card", () => {
  assert.match(componentSource, /StaffV2PeriodNavigator/);
  assert.match(componentSource, /StaffV2RowGroup/);
  assert.match(pageSource, /Array\.from\(\{ length: 7 \}/);
  assert.match(componentSource, /day\.isToday \? <em>Today<\/em>/);
  assert.doesNotMatch(pageSource, /TodayCard|staff-roster-today/);
  assert.match(pageSource, /View previous week/);
  assert.match(pageSource, /View next week/);
  assert.match(pageSource, /Return to current week/);
});

test("scheduled shift presents employee-friendly time and shift name", () => {
  const assignment = shift({
    id: "morning",
    startAt: "2026-08-24T01:00:00.000Z",
    endAt: "2026-08-24T10:00:00.000Z",
    label: "Morning shift",
  });
  const view = buildStaffScheduleDay({ assignments: [assignment] });
  const day = buildStaffScheduleV2Day(source(monday, view, [assignment]), "Branch A");
  assert.equal(day.primary, "1:00 AM – 10:00 AM");
  assert.deepEqual(day.secondary, ["Morning shift"]);
  assert.equal(day.expandable, true);
});

test("simple schedule states stay distinct and No Schedule is never Rest day", () => {
  const restAssignment = assignment({ id: "rest", kind: "REST_DAY" });
  const rest = buildStaffScheduleV2Day(source(
    tuesday,
    buildStaffScheduleDay({ assignments: [restAssignment] }),
    [restAssignment],
  ), null);
  const holiday = buildStaffScheduleV2Day(source(
    tuesday,
    buildStaffScheduleDay({ assignments: [], holidays: [{ name: "National Day", branchName: "Branch A" }] }),
    [],
    ["Branch A"],
  ), "Branch A");
  const leave = buildStaffScheduleV2Day(source(
    tuesday,
    buildStaffScheduleDay({ assignments: [], leaves: [{ label: "Annual Leave" }] }),
    [],
  ), null);
  const noSchedule = buildStaffScheduleV2Day(source(
    monday,
    buildStaffScheduleDay({ assignments: [] }),
    [],
  ), null);
  assert.equal(rest.primary, "Rest day");
  assert.equal(holiday.primary, "Public Holiday");
  assert.deepEqual(holiday.secondary, ["National Day"]);
  assert.equal(leave.primary, "Annual Leave");
  assert.deepEqual(leave.secondary, ["Approved leave"]);
  assert.equal(noSchedule.primary, "No schedule");
  assert.deepEqual(noSchedule.secondary, ["Ask your manager if you expected a shift."]);
  assert.notEqual(noSchedule.primary, rest.primary);
});

test("multiple shifts remain separate in detail and summarize only the outer range", () => {
  const first = shift({
    id: "first",
    startAt: "2026-08-24T01:00:00.000Z",
    endAt: "2026-08-24T05:00:00.000Z",
    label: "Morning shift",
    branch: "Branch A",
  });
  const second = shift({
    id: "second",
    startAt: "2026-08-24T07:00:00.000Z",
    endAt: "2026-08-24T12:00:00.000Z",
    label: "Evening shift",
    branch: "Branch B",
  });
  const view = buildStaffScheduleDay({ assignments: [first, second] });
  const day = buildStaffScheduleV2Day(source(monday, view, [first, second]), null);
  assert.equal(day.primary, "2 shifts");
  assert.equal(day.secondary[0], "1:00 AM – 12:00 PM");
  assert.equal(day.secondary.at(-1), "2 branches");
  assert.deepEqual(day.shifts.map((item) => item.label), ["Morning shift", "Evening shift"]);
});

test("cross-midnight shift shows Ends next day and exact canonical date boundaries", () => {
  const overnight = shift({
    id: "night",
    startAt: "2026-08-31T22:00:00.000Z",
    endAt: "2026-09-01T06:00:00.000Z",
    label: "Night shift",
  });
  const view = buildStaffScheduleDay({ assignments: [overnight] });
  const day = buildStaffScheduleV2Day(source(new Date("2026-08-31T00:00:00.000Z"), view, [overnight]), "Branch A");
  assert.equal(day.primary, "10:00 PM – 6:00 AM");
  assert.equal(day.secondary[0], "Night shift · Ends next day");
  assert.equal(day.shifts[0]?.startsLabel, "31 Aug · 10:00 PM");
  assert.equal(day.shifts[0]?.endsLabel, "1 Sept · 6:00 AM");
});

test("common Branch is de-duplicated while a different Branch stays visible", () => {
  const branchA = shift({ id: "a", branch: "Branch A" });
  const branchB = shift({ id: "b", branch: "Branch B", startAt: "2026-08-25T01:00:00.000Z", endAt: "2026-08-25T10:00:00.000Z" });
  const commonWeek = buildStaffScheduleV2Week([
    source(monday, buildStaffScheduleDay({ assignments: [branchA] }), [branchA]),
    source(tuesday, buildStaffScheduleDay({ assignments: [] }), []),
  ]);
  assert.equal(commonWeek.commonBranch, "Branch A");
  assert.equal(commonWeek.days[0]?.branchLabel, null);

  const variedWeek = buildStaffScheduleV2Week([
    source(monday, buildStaffScheduleDay({ assignments: [branchA] }), [branchA]),
    source(tuesday, buildStaffScheduleDay({ assignments: [branchB] }), [branchB]),
  ]);
  assert.equal(variedWeek.commonBranch, null);
  assert.equal(variedWeek.days[0]?.branchLabel, "Branch A");
  assert.equal(variedWeek.days[1]?.branchLabel, "Branch B");
});

test("shift and Public Holiday coexist without losing either fact", () => {
  const work = shift({ id: "holiday-work", label: "Morning shift" });
  const view = buildStaffScheduleDay({
    assignments: [work],
    holidays: [{ name: "National Day", branchName: "Branch A" }],
  });
  const day = buildStaffScheduleV2Day(source(monday, view, [work], ["Branch A"]), "Branch A");
  assert.match(day.primary, /AM/);
  assert.deepEqual(day.secondary, ["Morning shift", "Public Holiday · National Day"]);
  assert.equal(day.holidayLabel, "National Day");
});

test("empty week is compact and legacy Schedule presentation selectors are retired", () => {
  assert.match(componentSource, /No schedule this week/);
  assert.match(componentSource, /Published shifts and approved time away will appear here/);
  assert.doesNotMatch(componentSource, /large illustration|min-height:\s*[2-9]\d\d/);
  assert.doesNotMatch(legacyCss, /\.staff-roster-(today|week|day|nav|detail|empty-week|note)/);
});

test("Schedule V2 mobile geometry and existing bottom navigation remain safe", () => {
  assert.match(scheduleCss, /grid-template-columns:\s*46px minmax\(0, 1fr\) 20px/);
  assert.match(scheduleCss, /min-height:\s*68px/);
  assert.match(scheduleCss, /min-height:\s*56px/);
  assert.match(scheduleCss, /overflow-wrap:\s*anywhere/);
  assert.match(scheduleCss, /@media \(max-width: 380px\)/);
  assert.match(scheduleCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(navigationSource, /Home/);
  assert.match(navigationSource, /Time/);
  assert.match(navigationSource, /Approvals/);
  assert.match(navigationSource, /Pay/);
  assert.match(navigationSource, /Profile/);
});

function source(
  day: Date,
  view: ReturnType<typeof buildStaffScheduleDay>,
  assignments: StaffScheduleAssignment[],
  holidayBranches: string[] = [],
) {
  return { day, today: monday, view, assignments, holidayBranches };
}

function assignment(input: {
  id: string;
  kind: StaffScheduleAssignment["kind"];
  startAt?: string;
  endAt?: string;
  label?: string;
  branch?: string;
}): StaffScheduleAssignment {
  return {
    id: input.id,
    kind: input.kind,
    shiftNameSnapshot: input.label ?? null,
    startAt: input.startAt ? new Date(input.startAt) : null,
    endAt: input.endAt ? new Date(input.endAt) : null,
    breakMinutes: 0,
    breakPaidSnapshot: false,
    timezoneSnapshot: "UTC",
    branch: { id: input.branch ?? "Branch A", name: input.branch ?? "Branch A" },
  };
}

function shift(input: {
  id: string;
  startAt?: string;
  endAt?: string;
  label?: string;
  branch?: string;
}): StaffScheduleAssignment {
  return assignment({
    id: input.id,
    kind: "WORK_SHIFT",
    startAt: input.startAt ?? "2026-08-24T01:00:00.000Z",
    endAt: input.endAt ?? "2026-08-24T10:00:00.000Z",
    label: input.label ?? "Morning shift",
    branch: input.branch,
  });
}
