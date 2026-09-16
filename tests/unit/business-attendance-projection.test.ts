import assert from "node:assert/strict";
import test from "node:test";
import { effectiveAttendanceStatusWhere } from "../../src/lib/attendance/business-attendance-projection";

test("daily completed filter includes approved correction IDs before pagination", () => {
  assert.deepEqual(effectiveAttendanceStatusWhere("COMPLETED", ["corrected"]), {
    OR: [{ status: "COMPLETED" }, { id: { in: ["corrected"] } }],
  });
});
for (const status of ["INCOMPLETE", "OPEN", "ON_BREAK", "CANCELLED"] as const) {
  test(`daily ${status} filter excludes approved correction IDs`, () => {
    assert.deepEqual(effectiveAttendanceStatusWhere(status, ["corrected"]), {
      AND: [{ status }, { id: { notIn: ["corrected"] } }],
    });
  });
}
test("no correction preserves ordinary filters; ALL adds no restriction", () => {
  assert.deepEqual(effectiveAttendanceStatusWhere("ALL", ["corrected"]), {});
  assert.deepEqual(effectiveAttendanceStatusWhere("INCOMPLETE", []), { status: "INCOMPLETE" });
  assert.deepEqual(effectiveAttendanceStatusWhere("COMPLETED", []), { status: "COMPLETED" });
});
