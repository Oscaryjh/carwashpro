import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getPublicPayrollErrorMessage,
  sanitizePayrollNotice,
} from "../../src/lib/payroll/error-message";

const triggerFixSql = readFileSync(
  new URL(
    "../../prisma/migrations/20260731170000_payroll_trigger_fix/migration.sql",
    import.meta.url,
  ),
  "utf8",
).replaceAll("\r\n", "\n");

test("Payroll trigger fix never reads OLD during an INSERT", () => {
  assert.match(triggerFixSql, /^BEGIN;/);
  assert.match(
    triggerFixSql,
    /IF TG_OP = 'DELETE' THEN\s+target_run_id := OLD\."payroll_run_id";/,
  );
  assert.match(
    triggerFixSql,
    /ELSE\s+target_run_id := NEW\."payroll_run_id";/,
  );
  assert.doesNotMatch(
    triggerFixSql,
    /CASE WHEN TG_OP = 'DELETE' THEN OLD\."payroll_run_id" ELSE NEW\."payroll_run_id"/,
  );
  assert.match(triggerFixSql, /COMMIT;\s*$/);
});

test("Unexpected Payroll errors use a friendly fallback", () => {
  const internal = new Error(
    "Invalid prisma.payrollEntry.create() invocation: column old does not exist",
  );
  assert.equal(
    getPublicPayrollErrorMessage(internal, "Unable to generate payroll draft."),
    "Unable to generate payroll draft.",
  );
});

test("Payroll notices do not expose database details", () => {
  assert.equal(
    sanitizePayrollNotice(
      "Invalid prisma.payrollEntry.create() invocation: The column old does not exist in the current database.",
      "error",
    ),
    "Payroll could not be completed. Please refresh and try again.",
  );
  assert.equal(
    sanitizePayrollNotice("Payroll draft generated.", "success"),
    "Payroll draft generated.",
  );
});

test("Statutory profile validation is safe to show to managers", () => {
  const message = "Select the employee's SOCSO contribution category.";
  assert.equal(
    getPublicPayrollErrorMessage(
      new Error(message),
      "Unable to save statutory profile.",
    ),
    message,
  );
});
