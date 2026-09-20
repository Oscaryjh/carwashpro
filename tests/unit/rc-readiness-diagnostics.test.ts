import test from "node:test";
import assert from "node:assert/strict";
import { readinessDiagnostic } from "../helpers/rc-readiness-diagnostics";

test("readiness diagnostic aggregates blocker codes without copying employee data or messages", () => {
  const issues = [
    { code: "PCB_MANUAL_CONFIRMATION_REQUIRED" as const, message: "private message", employeeName: "private name", membershipId: "private identifier" },
    { code: "PCB_MANUAL_CONFIRMATION_REQUIRED" as const, message: "different private message" },
    { code: "MISSING_LOCKED_TIMESHEET" as const, message: "private detail" },
  ];
  assert.deepEqual(readinessDiagnostic({ blockers: issues }), {
    blockerCount: 3,
    codes: { PCB_MANUAL_CONFIRMATION_REQUIRED: 2, MISSING_LOCKED_TIMESHEET: 1 },
  });
});
