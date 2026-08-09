import assert from "node:assert/strict";
import test from "node:test";
import { detectAttendanceExceptions } from "../../src/lib/attendance/p2-detection";

const workDate = new Date("2026-08-05T00:00:00.000Z");
const base = {
  businessId: "business-a",
  membershipId: "member-a",
  workDate,
  leave: null,
  approvedCorrectionCountThisMonth: 0,
  facts: {
    sessionId: null,
    firstClockInAt: null,
    lastClockOutAt: null,
    totalBreakMinutes: 0,
    totalWorkedMinutes: 0,
  },
};

test("P2 no schedule plus no punch is NO_ATTENDANCE_RECORDED, never no-show or leave", () => {
  const result = detectAttendanceExceptions({ ...base, expected: null });
  assert.deepEqual(result.exceptions.map((item) => item.type), ["NO_ATTENDANCE_RECORDED"]);
  assert.equal(result.suggestedOutcome, null);
  assert.ok(!JSON.stringify(result).includes("UNPAID_LEAVE"));
});

test("P2 scheduled workday plus no punch is suspected no-show", () => {
  const result = detectAttendanceExceptions({ ...base, expected: workday() });
  assert.deepEqual(result.exceptions.map((item) => item.type), ["SUSPECTED_NO_SHOW"]);
});

test("P2 approved leave outcome comes only from Leave-domain treatment", () => {
  const paid = detectAttendanceExceptions({
    ...base,
    expected: workday(),
    leave: { id: "leave-a", status: "APPROVED", payTreatment: "PAID", emergency: false },
  });
  const unpaid = detectAttendanceExceptions({
    ...base,
    expected: workday(),
    leave: { id: "leave-b", status: "APPROVED", payTreatment: "UNPAID", emergency: false },
  });
  assert.equal(paid.suggestedOutcome, "APPROVED_PAID_LEAVE");
  assert.equal(unpaid.suggestedOutcome, "APPROVED_UNPAID_LEAVE");
  assert.equal(paid.exceptions.length, 0);
});

test("P2 missing punches remain blockers and never overwrite raw facts", () => {
  const missingOut = detectAttendanceExceptions({
    ...base,
    expected: workday(),
    facts: { ...base.facts, sessionId: "session-a", firstClockInAt: at("09:00") },
  });
  const missingIn = detectAttendanceExceptions({
    ...base,
    expected: workday(),
    facts: { ...base.facts, sessionId: "session-b", lastClockOutAt: at("18:00") },
  });
  assert.deepEqual(missingOut.exceptions.map((item) => item.type), ["MISSING_CLOCK_OUT"]);
  assert.deepEqual(missingIn.exceptions.map((item) => item.type), ["MISSING_CLOCK_IN"]);
  assert.ok(missingOut.exceptions.every((item) => item.severity === "BLOCKER"));
});

test("P2 late uses expected start plus policy grace and early uses expected end", () => {
  const withinGrace = detectAttendanceExceptions({
    ...base,
    expected: workday(),
    facts: completeFacts("09:04", "18:00"),
  });
  const lateEarly = detectAttendanceExceptions({
    ...base,
    expected: workday(),
    facts: completeFacts("09:08", "17:45"),
  });
  assert.equal(withinGrace.exceptions.length, 0);
  assert.deepEqual(lateEarly.exceptions.map((item) => [item.type, item.exceptionMinutes]), [
    ["LATE_ARRIVAL", 3],
    ["EARLY_DEPARTURE", 15],
  ]);
});

test("P2 does not infer late or early without workday expected times", () => {
  const result = detectAttendanceExceptions({ ...base, expected: null, facts: completeFacts("12:00", "13:00") });
  assert.equal(result.suggestedOutcome, "PRESENT");
  assert.equal(result.exceptions.length, 0);
});

test("P2 approved leave plus attendance produces explicit conflict", () => {
  const result = detectAttendanceExceptions({
    ...base,
    expected: workday(),
    leave: { id: "leave-a", status: "APPROVED", payTreatment: "PAID", emergency: false },
    facts: completeFacts("09:00", "18:00"),
  });
  assert.ok(result.exceptions.some((item) => item.type === "LEAVE_ATTENDANCE_CONFLICT"));
});

test("P2 rest day, holiday and not-scheduled outcomes preserve context without pay calculation", () => {
  for (const [kind, outcome] of [
    ["REST_DAY", "REST_DAY"],
    ["PUBLIC_HOLIDAY", "PUBLIC_HOLIDAY"],
    ["NOT_SCHEDULED", "NOT_SCHEDULED"],
  ] as const) {
    const result = detectAttendanceExceptions({
      ...base,
      expected: { ...workday(), kind, expectedStartAt: null, expectedEndAt: null },
    });
    assert.equal(result.suggestedOutcome, outcome);
    assert.equal(result.exceptions.length, 0);
  }
});

test("P2 detection is idempotent and repeated corrections are warnings, not blockers", () => {
  const input = { ...base, expected: workday(), facts: completeFacts("09:08", "18:00"), approvedCorrectionCountThisMonth: 3 };
  const first = detectAttendanceExceptions(input);
  const second = detectAttendanceExceptions(input);
  assert.deepEqual(first, second);
  assert.equal(first.exceptions[0]?.stableKey, second.exceptions[0]?.stableKey);
  assert.deepEqual(first.warnings.map((item) => item.type), ["REPEATED_CORRECTION_WARNING"]);
});

test("P2 overnight evidence compares the next-day clock-out without creating a missing punch", () => {
  const result = detectAttendanceExceptions({
    ...base,
    expected: {
      ...workday(),
      expectedStartAt: new Date("2026-08-05T22:00:00.000Z"),
      expectedEndAt: new Date("2026-08-06T06:00:00.000Z"),
    },
    facts: {
      ...completeFacts("22:00", "06:00"),
      lastClockOutAt: new Date("2026-08-06T06:00:00.000Z"),
    },
  });
  assert.equal(result.exceptions.length, 0);
  assert.ok(result.warnings.some((item) => item.type === "OVERNIGHT_EVIDENCE_REVIEW"));
});

function workday() {
  return {
    id: "expected-a",
    kind: "WORKDAY" as const,
    expectedStartAt: at("09:00"),
    expectedEndAt: at("18:00"),
    graceMinutes: 5,
    revision: 1,
  };
}

function completeFacts(clockIn: string, clockOut: string) {
  return {
    sessionId: "session-a",
    firstClockInAt: at(clockIn),
    lastClockOutAt: at(clockOut),
    totalBreakMinutes: 60,
    totalWorkedMinutes: 480,
  };
}

function at(time: string) {
  return new Date(`2026-08-05T${time}:00.000Z`);
}
