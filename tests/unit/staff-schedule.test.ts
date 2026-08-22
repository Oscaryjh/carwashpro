import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStaffScheduleDay,
  type StaffScheduleAssignment,
} from "../../src/lib/staff-pwa/schedule";

const timezone = "Asia/Kuala_Lumpur";

function assignment(overrides: Partial<StaffScheduleAssignment> = {}): StaffScheduleAssignment {
  return {
    id: "shift-1",
    kind: "WORK_SHIFT",
    shiftNameSnapshot: "Morning shift",
    startAt: new Date("2026-08-17T03:45:00.000Z"),
    endAt: new Date("2026-08-17T12:45:00.000Z"),
    breakMinutes: 60,
    breakPaidSnapshot: false,
    timezoneSnapshot: timezone,
    branch: { id: "branch-1", name: "Young Parlor TWU" },
    ...overrides,
  };
}

test("Schedule formats a normal published shift with branch, break and expected time", () => {
  const view = buildStaffScheduleDay({ assignments: [assignment()] });

  assert.equal(view.status, "SHIFT");
  assert.equal(view.title, "Morning shift");
  assert.equal(view.timeLabel, "11:45 – 20:45");
  assert.deepEqual(view.branches, ["Young Parlor TWU"]);
  assert.equal(view.shifts[0].breakLabel, "1 hour unpaid");
  assert.equal(view.shifts[0].expectedWorkingTime, "8 hours");
});

test("Schedule displays a rest day without attendance judgement", () => {
  const view = buildStaffScheduleDay({ assignments: [assignment({ kind: "REST_DAY", startAt: null, endAt: null })] });

  assert.equal(view.status, "REST_DAY");
  assert.equal(view.title, "Rest Day");
  assert.equal(view.supportingLabel, "No shift scheduled");
});

test("Approved leave takes presentation precedence over a published shift", () => {
  const view = buildStaffScheduleDay({
    assignments: [assignment()],
    leaves: [{ label: "Annual Leave" }],
  });

  assert.equal(view.status, "APPROVED_LEAVE");
  assert.equal(view.title, "Annual Leave");
  assert.equal(view.supportingLabel, "Approved");
  assert.equal(view.shifts.length, 1);
});

test("A public holiday is shown when there is no published shift", () => {
  const view = buildStaffScheduleDay({
    assignments: [],
    holidays: [{ name: "National Day", branchName: "Young Parlor TWU" }],
  });

  assert.equal(view.status, "PUBLIC_HOLIDAY");
  assert.equal(view.title, "Public Holiday");
  assert.equal(view.supportingLabel, "National Day");
});

test("An empty day stays neutral and never becomes an attendance outcome", () => {
  const view = buildStaffScheduleDay({ assignments: [] });

  assert.equal(view.status, "NOT_SCHEDULED");
  assert.equal(view.title, "Not Scheduled");
  assert.doesNotMatch(JSON.stringify(view), /Absent|No-show/i);
});

test("An overnight shift ends at 00:00 instead of 23:59", () => {
  const view = buildStaffScheduleDay({
    assignments: [assignment({
      startAt: new Date("2026-08-17T07:00:00.000Z"),
      endAt: new Date("2026-08-17T16:00:00.000Z"),
    })],
  });

  assert.equal(view.timeLabel, "15:00 – 00:00");
  assert.equal(view.shifts[0].overnight, true);
});

test("Multiple shifts and branches are grouped without dropping rows", () => {
  const view = buildStaffScheduleDay({
    assignments: [
      assignment({
        id: "shift-1",
        startAt: new Date("2026-08-17T02:00:00.000Z"),
        endAt: new Date("2026-08-17T06:00:00.000Z"),
      }),
      assignment({
        id: "shift-2",
        shiftNameSnapshot: "Evening shift",
        startAt: new Date("2026-08-17T10:00:00.000Z"),
        endAt: new Date("2026-08-17T14:00:00.000Z"),
        branch: { id: "branch-2", name: "Tetamu Salon" },
      }),
    ],
  });

  assert.equal(view.title, "2 shifts");
  assert.equal(view.timeLabel, "10:00 – 22:00");
  assert.equal(view.shifts.length, 2);
  assert.deepEqual(view.branches, ["Young Parlor TWU", "Tetamu Salon"]);
});
