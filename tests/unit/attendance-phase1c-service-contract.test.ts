import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const punchSource = readFileSync(
  new URL("../../src/lib/attendance/punch-service.ts", import.meta.url),
  "utf8",
);
const exceptionSource = readFileSync(
  new URL("../../src/lib/attendance/exception-service.ts", import.meta.url),
  "utf8",
);
const readSource = readFileSync(
  new URL("../../src/lib/attendance/read-service.ts", import.meta.url),
  "utf8",
);

test("same-key replay follows current principal validation but precedes GPS re-evaluation", () => {
  const transactionStart = punchSource.indexOf(
    "const principal = await loadEmployeeAttendancePrincipal",
  );
  const replay = punchSource.indexOf(
    "const replay = await resolveExistingIdempotency",
    transactionStart,
  );
  const geofence = punchSource.indexOf(
    "const evaluation = evaluateAttendanceGeofence",
    transactionStart,
  );

  assert.ok(transactionStart >= 0);
  assert.ok(replay > transactionStart);
  assert.ok(geofence > replay);
});

test("Punch concurrency loser is a safe invalid-state response when no replay exists", () => {
  assert.match(
    punchSource,
    /if \(isConcurrencyError\(failure\)\)[\s\S]*if \(replay\)[\s\S]*failure = new AttendanceApiError\(\s*"INVALID_ATTENDANCE_STATE"/,
  );
});

test("Punch response preserves cumulative session approval state", () => {
  assert.match(
    punchSource,
    /requiresApproval:\s*input\.attendanceSession\.requiresApproval \|\|\s*input\.exceptionId !== null/,
  );
  assert.match(
    punchSource,
    /const attendanceSessionResultSelect = \{[\s\S]*requiresApproval: true/,
  );
});

test("Punch audit uses the exact release action names and omits raw GPS/device evidence", () => {
  for (const action of [
    "ATTENDANCE_CLOCK_IN",
    "ATTENDANCE_BREAK_STARTED",
    "ATTENDANCE_BREAK_ENDED",
    "ATTENDANCE_CLOCK_OUT",
    "ATTENDANCE_EXCEPTION_SUBMITTED",
    "ATTENDANCE_PUNCH_REJECTED",
  ]) {
    assert.match(punchSource, new RegExp(`"${action}"`));
  }

  const punchAuditStart = punchSource.indexOf(
    "action: auditActionForPunch",
  );
  const punchAuditEnd = punchSource.indexOf(
    "transaction,",
    punchAuditStart,
  );
  const auditPayload = punchSource.slice(
    punchAuditStart,
    punchAuditEnd,
  );
  assert.doesNotMatch(
    auditPayload,
    /latitude|longitude|deviceIdentifier|distanceFromBranchMeters/,
  );
});

test("standalone GPS exceptions enforce branch policy and recover concurrency duplicates", () => {
  assert.match(
    exceptionSource,
    /assertExceptionPolicyAllowed\([\s\S]*allowOutsideGeofenceRequest/,
  );
  assert.match(
    exceptionSource,
    /catch \(error\)[\s\S]*isConcurrencyError[\s\S]*findPendingException/,
  );
});

test("Today response does not expose internal employee account or membership IDs", () => {
  const employeeObjectStart = readSource.indexOf("employee: {");
  const employeeObjectEnd = readSource.indexOf(
    "},",
    employeeObjectStart,
  );
  const employeeObject = readSource.slice(
    employeeObjectStart,
    employeeObjectEnd,
  );

  assert.doesNotMatch(
    employeeObject,
    /employeeAccountId|membershipId/,
  );
  assert.match(employeeObject, /employeeCode/);
  assert.match(employeeObject, /fullName/);
});
