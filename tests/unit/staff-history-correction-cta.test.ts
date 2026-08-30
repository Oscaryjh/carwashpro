import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getMissingClockOutCorrectionState } from "../../src/lib/staff-pwa/attendance-correction-eligibility";

const actionable = {
  approvalStatus: "NOT_REQUIRED",
  clockOutAt: null,
  requiresApproval: false,
  status: "INCOMPLETE",
};

test("an incomplete session without clock-out or pending review is employee-actionable", () => {
  assert.equal(getMissingClockOutCorrectionState(actionable), "ACTIONABLE");
});

test("a pending request is not offered as a duplicate correction", () => {
  assert.equal(
    getMissingClockOutCorrectionState({
      ...actionable,
      approvalStatus: "PENDING",
      requiresApproval: true,
    }),
    "PENDING",
  );
});

test("completed, active and cancelled sessions do not get the missing clock-out CTA", () => {
  for (const status of ["COMPLETED", "OPEN", "ON_BREAK", "CANCELLED"]) {
    assert.equal(
      getMissingClockOutCorrectionState({ ...actionable, status }),
      "NOT_ACTIONABLE",
    );
  }
  assert.equal(
    getMissingClockOutCorrectionState({
      ...actionable,
      clockOutAt: "2026-08-24T09:00:00.000Z",
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
  assert.match(history, /setCorrectionSessionId\(item\.id\)/);
  assert.match(history, /setCorrectionBranchId\(item\.branch\.id\)/);
  assert.match(history, /\/api\/employee-attendance\/exception/);
  assert.match(history, /This request is already pending/);
  assert.doesNotMatch(history, /\/api\/employee-attendance\/p2-corrections/);
});
