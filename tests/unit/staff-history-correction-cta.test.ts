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

test("an active Resolution Case owns the correction state", () => {
  assert.equal(getMissingClockOutCorrectionState({
    ...actionable,
    resolutionCaseId: "resolution-1",
    resolutionCaseStatus: "OPEN",
    requiresApproval: true,
    approvalStatus: "PENDING",
  }), "ACTIONABLE");
  assert.equal(getMissingClockOutCorrectionState({
    ...actionable,
    resolutionCaseId: "resolution-1",
    resolutionCaseStatus: "UNDER_REVIEW",
  }), "PENDING");
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

test("History shows a contextual CTA only when Home has no Resolution Case", async () => {
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
  assert.match(history, /status\.correctionState === "ACTIONABLE" && !item\.resolutionCaseId/);
  assert.doesNotMatch(history, /Continue correction/);
  assert.doesNotMatch(history, /\/api\/employee-attendance\/p2-corrections/);
});

test("legacy exception submission refuses a duplicate active Resolution Case", async () => {
  const service = await readFile(
    "src/lib/attendance/exception-service.ts",
    "utf8",
  );
  assert.match(service, /attendanceSession\?\.resolutionCase/);
  assert.match(service, /already has an active correction/);
});
