import assert from "node:assert/strict";
import test from "node:test";
import { suggestNextEmployeeCode } from "../../src/lib/team/employee-code";

test("starts employee numbering at EMP-001", () => {
  assert.equal(suggestNextEmployeeCode([]), "EMP-001");
});

test("suggests the sequence after the highest existing employee code", () => {
  assert.equal(
    suggestNextEmployeeCode(["EMP-001", "EMP-009", "EMP-004"]),
    "EMP-010",
  );
});

test("ignores custom employee code formats", () => {
  assert.equal(
    suggestNextEmployeeCode(["STAFF-200", "EMPLOYEE-9", "emp-007"]),
    "EMP-008",
  );
});

test("preserves a wider established sequence", () => {
  assert.equal(suggestNextEmployeeCode(["EMP-0099"]), "EMP-0100");
});
