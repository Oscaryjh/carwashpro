import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ABSOLUTE_ATTENDANCE_CORRECTION_BREAK_LIMIT_MINUTES,
  getAttendanceCorrectionBreakLimit,
  getLocalCorrectionElapsedMinutes,
  summarizeAttendanceCorrectionBreakPunches,
} from "../../src/lib/staff-pwa/attendance-correction-breaks";

const read = (path: string) => readFileSync(
  new URL(`../../${path}`, import.meta.url),
  "utf8",
);

test("employee correction break limit follows shift length and workplace policy", () => {
  assert.equal(getAttendanceCorrectionBreakLimit({
    elapsedMinutes: 480,
    recommendedBreakMinutes: 60,
  }), 180);
  assert.equal(getAttendanceCorrectionBreakLimit({
    elapsedMinutes: 120,
    recommendedBreakMinutes: 60,
  }), 120);
  assert.equal(getAttendanceCorrectionBreakLimit({
    elapsedMinutes: 600,
    recommendedBreakMinutes: 240,
  }), 240);
  assert.equal(getAttendanceCorrectionBreakLimit({
    elapsedMinutes: 1_440,
    recommendedBreakMinutes: 1_440,
  }), ABSOLUTE_ATTENDANCE_CORRECTION_BREAK_LIMIT_MINUTES);
});

test("local correction duration is deterministic and rejects invalid ranges", () => {
  assert.equal(
    getLocalCorrectionElapsedMinutes("2026-09-02T10:00", "2026-09-02T18:00"),
    480,
  );
  assert.equal(
    getLocalCorrectionElapsedMinutes("2026-09-02T22:00", "2026-09-03T06:00"),
    480,
  );
  assert.equal(
    getLocalCorrectionElapsedMinutes("2026-09-02T18:00", "2026-09-02T10:00"),
    null,
  );
  assert.equal(getLocalCorrectionElapsedMinutes("", "2026-09-02T18:00"), null);
});

test("recorded break punches distinguish none, complete and incomplete evidence", () => {
  assert.deepEqual(summarizeAttendanceCorrectionBreakPunches([]), {
    status: "NONE",
    recordedMinutes: 0,
    periods: [],
  });
  assert.deepEqual(summarizeAttendanceCorrectionBreakPunches([
    { type: "BREAK_START", serverTimestamp: "2026-09-02T04:00:00.000Z" },
    { type: "BREAK_END", serverTimestamp: "2026-09-02T05:00:00.000Z" },
  ]), {
    status: "COMPLETE",
    recordedMinutes: 60,
    periods: [{
      startAt: "2026-09-02T04:00:00.000Z",
      endAt: "2026-09-02T05:00:00.000Z",
    }],
  });
  assert.equal(summarizeAttendanceCorrectionBreakPunches([
    { type: "BREAK_START", serverTimestamp: "2026-09-02T04:00:00.000Z" },
  ]).status, "INCOMPLETE");
});

test("employee form explains and enforces the effective break maximum", () => {
  const component = read("src/components/staff-pwa/staff-resolution-cases.tsx");
  const workflow = read("src/lib/attendance/resolution-workflow-service.ts");
  const reader = read("src/lib/attendance/resolution-read-service.ts");

  assert.match(component, /max=\{breakLimit\}/);
  assert.match(component, /Workplace target: \{item\.branch\.recommendedBreakMinutes\} min/);
  assert.match(component, /Maximum \{breakLimit\} min/);
  assert.match(component, /Explain why this exceeds the workplace break target/);
  assert.match(component, /!clockIn \|\| !clockOut \|\| invalidBreak/);
  assert.match(component, /reason\.trim\(\)\.length < 3 \|\| invalidCorrection/);
  assert.match(component, /Based on completed break punches/);
  assert.match(component, /Complete break record/);
  assert.match(component, /item\.breakRecord\.status === "NONE"/);
  assert.match(workflow, /getAttendanceCorrectionBreakLimit/);
  assert.match(workflow, /Recorded break minutes are locked/);
  assert.match(workflow, /Complete the missing break start or end/);
  assert.doesNotMatch(workflow, /max\(1_440\)/);
  assert.match(reader, /targetBreakMinutes/);
  assert.match(reader, /summarizeAttendanceCorrectionBreakPunches/);
});

test("manual break declaration is opt-in without an extra confirmation checkbox", () => {
  const component = read("src/components/staff-pwa/staff-resolution-cases.tsx");
  assert.match(component, /\[breakMinutes, setBreakMinutes\] = useState\(""\)/);
  assert.match(component, /\[includeBreakCorrection, setIncludeBreakCorrection\] = useState\(false\)/);
  assert.match(component, /I also forgot to record my break/);
  assert.match(component, /includeBreakCorrection \? \(/);
  assert.match(component, /Actual break taken \(minutes\)/);
  assert.match(component, /subject to manager approval/);
  assert.match(component, /Leaving this unchecked does not mean you took no break/);
  assert.match(component, /item\.breakRecord\.status === "NONE" && includeBreakCorrection\s*\? Number\(breakMinutes\)\s*: null/);
  assert.match(component, /onChange=\{\(event\) => setBreakMinutes\(event\.target\.value\)\}/);
  assert.doesNotMatch(component, /actualBreakConfirmed|I confirm this is my actual break time/);
});

test("both manager surfaces leave undeclared breaks blank for verification", () => {
  for (const path of [
    "src/app/(business)/team/attendance/resolutions/page.tsx",
    "src/app/staff/requests/attendance-corrections/page.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /breakNeedsVerification/);
    assert.match(source, /breakNeedsVerification \? "" :/);
    assert.match(source, /Verified break minutes/);
    assert.match(source, /name="correctedBreakMinutes"[^>]*required/);
    assert.doesNotMatch(source, /proposedBreakMinutes \?\? 0/);
  }
});
