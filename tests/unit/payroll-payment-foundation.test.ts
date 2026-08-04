import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { businessCapabilities } from "../../src/lib/business-groups/capabilities";
import {
  classifyPaymentNetAmount,
  paymentCommandFingerprint,
} from "../../src/lib/payroll/payment";

const root = process.cwd();
const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
const migration = readFileSync(
  join(
    root,
    "prisma",
    "migrations",
    "20260804120000_payment_integrity_foundation",
    "migration.sql",
  ),
  "utf8",
);

test("Payment P0 additive schema creates an independent payment domain", () => {
  for (const model of [
    "EmployeeBankAccountVersion",
    "PayrollPaymentBatch",
    "PayrollPaymentInstruction",
    "PayrollPaymentCommandRecord",
    "PayrollPaymentEvent",
    "PayrollPaymentArtifact",
  ]) {
    assert.match(schema, new RegExp(`model\\s+${model}\\b`));
  }
  assert.doesNotMatch(migration, /\b(?:DROP\s+(?:TABLE|COLUMN|TYPE)|DELETE\s+FROM)\b/i);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+"?(?:payroll_payment|employee_bank)/i);
  assert.match(migration, /Payroll payment batches require a finalized payroll run/);
  assert.match(migration, /payroll_payment_batches_one_active_run_key/);
  assert.match(migration, /Payment instructions are immutable after the batch leaves draft/);
  assert.match(migration, /Payroll payment integrity records are append-only/);
  assert.match(migration, /tetamu\.payroll_payment_test_maintenance/);
});

test("Payment capabilities are fine-grained and legacy PROCESS_PAYMENT remains compatible", () => {
  for (const capability of [
    "VIEW_BANK_ACCOUNT",
    "EDIT_BANK_ACCOUNT",
    "VERIFY_BANK_ACCOUNT",
    "VIEW_PAYMENT_BATCH",
    "CREATE_PAYMENT_BATCH",
    "SUBMIT_PAYMENT_BATCH",
    "APPROVE_PAYMENT_BATCH",
    "EXPORT_PAYMENT_FILE",
    "CANCEL_PAYMENT_BATCH",
    "VIEW_PAYMENT_AUDIT",
    "PROCESS_PAYMENT",
  ]) {
    assert.ok(businessCapabilities.includes(capability as never));
  }
});

test("Payment command fingerprint is deterministic and payload-sensitive", () => {
  const left = paymentCommandFingerprint({ command: { a: 1, b: 2 }, type: "CREATE" });
  const reordered = paymentCommandFingerprint({ type: "CREATE", command: { b: 2, a: 1 } });
  const changed = paymentCommandFingerprint({ command: { a: 1, b: 3 }, type: "CREATE" });
  assert.equal(left, reordered);
  assert.notEqual(left, changed);
  assert.match(left, /^[0-9a-f]{64}$/);
});

test("Payment readiness excludes zero and blocks negative net pay", () => {
  assert.deepEqual(classifyPaymentNetAmount(0), {
    blockerCode: null,
    status: "EXCLUDED",
  });
  assert.deepEqual(classifyPaymentNetAmount(-1), {
    blockerCode: "NET_PAY_NEGATIVE",
    status: "BLOCKED",
  });
  assert.equal(classifyPaymentNetAmount(1), null);
});

test("Payment P0 exposes no UI, public download, bank adapter, or generic CSV route", () => {
  const paymentFiles = readdirSync(
    join(root, "src", "lib", "payroll", "payment"),
  );
  assert.ok(paymentFiles.every((name) => !/csv|maybank|cimb|public-route/i.test(name)));
  const source = paymentFiles
    .filter((name) => name.endsWith(".ts"))
    .map((name) => readFileSync(join(root, "src", "lib", "payroll", "payment", name), "utf8"))
    .join("\n");
  assert.doesNotMatch(source, /PAID|SETTLED|RECONCILED/);
  assert.doesNotMatch(source, /public\/uploads|\/api\/.*payment|text\/csv/i);
  assert.match(source, /INSTRUCTION_READY/);
});

test("Existing POS Payment model and Payroll snapshots are not repurposed", () => {
  const posPayment = schema.match(/model Payment \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(posPayment, /invoiceId/);
  assert.match(posPayment, /workOrderId/);
  assert.doesNotMatch(posPayment, /payrollRunId|payrollEntryId|paymentBatchId/);

  const payrollRun = schema.match(/model PayrollRun \{[\s\S]*?\n\}/)?.[0] ?? "";
  const payrollEntry = schema.match(/model PayrollEntry \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(payrollRun, /paidAt|paymentStatus/);
  assert.doesNotMatch(payrollEntry, /paidAt|paymentStatus/);

});

test("Runtime mutation surface is restricted to canonical Payment P0 services", () => {
  const sourceFiles = walk(join(root, "src")).filter((path) => path.endsWith(".ts"));
  const mutationPattern =
    /\.(?:employeeBankAccountVersion|payrollPaymentBatch|payrollPaymentInstruction|payrollPaymentCommandRecord|payrollPaymentEvent|payrollPaymentArtifact)\.(?:create|update|delete|upsert|createMany|updateMany|deleteMany)\s*\(/;
  const mutationFiles = sourceFiles
    .filter((path) => mutationPattern.test(readFileSync(path, "utf8")))
    .map((path) => path.replaceAll("\\", "/"));
  assert.ok(mutationFiles.length > 0);
  assert.ok(
    mutationFiles.every((path) => path.includes("/src/lib/payroll/payment/")),
    `Unexpected Payment P0 mutation source:\n${mutationFiles.join("\n")}`,
  );

  const runtime = sourceFiles
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  assert.doesNotMatch(
    runtime,
    /payrollPayment(?:CommandRecord|Event|Artifact)\.(?:update|delete|upsert|updateMany|deleteMany)\s*\(/,
  );
  assert.doesNotMatch(
    runtime,
    /set_config\(['"]tetamu\.payroll_payment_test_maintenance/i,
  );
});

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
