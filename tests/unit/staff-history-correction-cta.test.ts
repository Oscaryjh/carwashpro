import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getMissingClockOutCorrectionState } from "../../src/lib/staff-pwa/attendance-correction-eligibility";

const actionable = {
  locked: false,
  primaryStatus: {
    key: "MISSING_PUNCH",
    label: "Missing punch",
    tone: "attention" as const,
  },
  sessions: [
    {
      id: "attendance-session-1",
      clockInAt: "2026-08-24T01:00:00.000Z",
      clockOutAt: null,
      totalBreakMinutes: 0,
      totalWorkedMinutes: 0,
      punchStatus: "INCOMPLETE",
      approvalLabel: null,
      adjusted: false,
      locked: false,
      breakPeriods: [],
      geofenceEvidence: [],
    },
  ],
};

test("an incomplete session without clock-out or pending review is employee-actionable", () => {
  assert.equal(getMissingClockOutCorrectionState(actionable), "ACTIONABLE");
});

test("a pending request is not offered as a duplicate correction", () => {
  assert.equal(
    getMissingClockOutCorrectionState({
      ...actionable,
      sessions: actionable.sessions.map((session) => ({
        ...session,
        approvalLabel: "Attendance correction pending",
      })),
    }),
    "PENDING",
  );
});

test("completed, active, cancelled and locked records do not get the missing clock-out CTA", () => {
  for (const key of ["COMPLETED", "IN_PROGRESS", "CANCELLED"]) {
    assert.equal(
      getMissingClockOutCorrectionState({
        ...actionable,
        primaryStatus: { ...actionable.primaryStatus, key },
      }),
      "NOT_ACTIONABLE",
    );
  }
  assert.equal(
    getMissingClockOutCorrectionState({
      ...actionable,
      locked: true,
    }),
    "NOT_ACTIONABLE",
  );
});

test("History card exposes contextual CTA through the canonical exception route", async () => {
  const history = await readFile(
    "src/components/staff-pwa/staff-history.tsx",
    "utf8",
  );
  assert.match(history, /Submit correction/);
  assert.match(history, /openMissingClockOutCorrection/);
  assert.match(history, /item\.correctionSessionId \?\? item\.id/);
  assert.match(history, /setCorrectionBranchId\(item\.branch\.id\)/);
  assert.match(history, /\/api\/employee-attendance\/exception/);
  assert.match(history, /already waiting for your manager/);
  assert.doesNotMatch(history, /\/api\/employee-attendance\/p2-corrections/);
});
