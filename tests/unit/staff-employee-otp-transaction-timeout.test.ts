import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const otpServiceSource = readFileSync(
  "src/lib/attendance/employee-auth/otp-service.ts",
  "utf8",
);

test("Staff OTP interactive transactions allow Railway cold database requests to finish", () => {
  assert.match(
    otpServiceSource,
    /const EMPLOYEE_OTP_TRANSACTION_OPTIONS = \{\s*maxWait: 5_000,\s*timeout: 15_000,/,
  );

  const protectedTransactions = otpServiceSource.match(
    /}, EMPLOYEE_OTP_TRANSACTION_OPTIONS\);/g,
  );

  assert.equal(
    protectedTransactions?.length,
    5,
    "request, verification, failure, approval, and login transactions must share the explicit timeout",
  );
});
