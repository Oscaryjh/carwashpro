import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const paymentRoot = path.join(root, "src/app/(business)/team/payroll/payments");

test("Payment P2 exposes only canonical payment workspace routes", async () => {
  const [list, create, detail] = await Promise.all([
    source("page.tsx"),
    source("new/page.tsx"),
    source("[batchId]/page.tsx"),
  ]);
  assert.match(list, /Payroll Payments/);
  assert.match(create, /Payment Readiness/);
  assert.match(detail, /Payment instructions/);
  assert.match(create, /createPaymentBatchAction/);
  assert.match(detail, /submitPaymentBatchAction/);
  assert.match(detail, /approvePaymentBatchAction/);
  assert.match(detail, /cancelPaymentBatchAction/);
  assert.match(detail, /createCorrectionPaymentBatchAction/);
});

test("Payment P2 server actions use canonical P0 commands and whole-business capabilities", async () => {
  const actions = await source("actions.ts");
  for (const command of [
    "createPayrollPaymentBatch",
    "submitPayrollPaymentBatch",
    "approvePayrollPaymentBatch",
    "cancelPayrollPaymentBatch",
    "createCorrectionPaymentBatch",
  ]) assert.match(actions, new RegExp(`\\b${command}\\b`));
  for (const capability of [
    "CREATE_PAYMENT_BATCH",
    "SUBMIT_PAYMENT_BATCH",
    "APPROVE_PAYMENT_BATCH",
    "CANCEL_PAYMENT_BATCH",
  ]) assert.match(actions, new RegExp(`(?:requireWholeBusinessPayroll|runBatchAction)\\([^\\n]*${JSON.stringify(capability)}`));
  assert.doesNotMatch(actions, /prisma\.(?:payrollPaymentBatch|payrollPaymentInstruction)\.(?:create|update|delete|upsert)/);
});

test("Payment P2 query DTOs never select encrypted bank fields", async () => {
  const [read, readiness, detail] = await Promise.all([
    readFile(path.join(root, "src/lib/payroll/payment/payment-read.ts"), "utf8"),
    readFile(path.join(root, "src/lib/payroll/payment/payment-readiness.ts"), "utf8"),
    source("[batchId]/page.tsx"),
  ]);
  assert.match(read, /accountNumberLast4Snapshot/);
  assert.doesNotMatch(read, /accountNumberCiphertextSnapshot|accountNumberIvSnapshot|accountNumberAuthTagSnapshot|accountFingerprintSnapshot|encryptionKeyVersionSnapshot/);
  assert.match(readiness, /accountNumberLast4/);
  assert.match(detail, /Full bank account numbers are never returned/);
  assert.doesNotMatch(detail, /Ciphertext|Auth Tag|Encryption Key|Fingerprint/);
});

test("Payment P2 product language never claims bank execution or settlement", async () => {
  const ui = [await source("page.tsx"), await source("new/page.tsx"), await source("[batchId]/page.tsx")].join("\n");
  assert.match(ui, /Finalized is not paid/);
  assert.match(ui, /does not create a bank file/);
  assert.doesNotMatch(ui, /Mark Paid|Settled|Reconciled|Submit to bank|Download bank file/);
});

test("Payment P2 has responsive, loading, denied, error and not-found states", async () => {
  const [styles, loading, error, missing] = await Promise.all([
    source("payments.module.css"),
    source("loading.tsx"),
    source("error.tsx"),
    source("[batchId]/not-found.tsx"),
  ]);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(styles, /@media\(max-width:390px\)/);
  assert.match(loading, /Checking authorization/);
  assert.match(error, /could not be loaded/);
  assert.match(missing, /not found/);
});

function source(relative: string) {
  return readFile(path.join(paymentRoot, relative), "utf8");
}
