import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  getPaymentBankAdapter,
  getPaymentProviderReadiness,
  listPaymentBankAdapters,
  PaymentProviderAccessError,
  paymentProviderReadiness,
  requireReleaseReadyPaymentBankAdapter,
} from "../../src/lib/payroll/payment/providers";

const root = process.cwd();

test("Public Bank remains blocked until its official field-level specification exists", () => {
  assert.deepEqual(paymentProviderReadiness.PUBLIC_BANK, {
    providerKey: "PUBLIC_BANK",
    reason: "PUBLIC_BANK_SPEC_NOT_READY",
    releaseReady: false,
    status: "NOT_RELEASE_READY",
  });
  assert.deepEqual(
    getPaymentProviderReadiness("PUBLIC_BANK"),
    paymentProviderReadiness.PUBLIC_BANK,
  );
  assert.equal(getPaymentBankAdapter("PUBLIC_BANK"), null);
  assert.deepEqual(listPaymentBankAdapters(), []);
});

test("unknown providers and blocked Public Bank access fail closed with safe errors", () => {
  assert.equal(getPaymentProviderReadiness("UNKNOWN_BANK"), null);
  assert.throws(
    () => requireReleaseReadyPaymentBankAdapter("UNKNOWN_BANK"),
    (error: unknown) => {
      assert.ok(error instanceof PaymentProviderAccessError);
      assert.equal(error.code, "PAYMENT_PROVIDER_UNKNOWN");
      assert.doesNotMatch(error.message, /UNKNOWN_BANK/);
      return true;
    },
  );
  assert.throws(
    () => requireReleaseReadyPaymentBankAdapter("PUBLIC_BANK"),
    (error: unknown) => {
      assert.ok(error instanceof PaymentProviderAccessError);
      assert.equal(error.code, "PUBLIC_BANK_SPEC_NOT_READY");
      assert.doesNotMatch(error.message, /account|beneficiary|configuration/i);
      return true;
    },
  );
});

test("no guessed Public Bank adapter, artifact route or golden file is present", () => {
  assert.equal(
    existsSync(
      join(
        root,
        "src",
        "lib",
        "payroll",
        "payment",
        "providers",
        "public-bank",
      ),
    ),
    false,
  );
  assert.equal(
    existsSync(
      join(
        root,
        "src",
        "app",
        "(business)",
        "team",
        "payroll",
        "payments",
        "[batchId]",
        "artifacts",
      ),
    ),
    false,
  );
  assert.equal(
    existsSync(join(root, "tests", "fixtures", "payments", "public-bank")),
    false,
  );
});

test("readiness document records the hard block and does not treat PBB as an official identifier", () => {
  const document = readFileSync(
    join(root, "docs", "payroll-payment-p3-public-bank-readiness.md"),
    "utf8",
  );
  assert.match(document, /FULL FIELD-LEVEL PUBLIC BANK SPECIFICATION NOT AVAILABLE/);
  assert.match(
    document,
    /PBB[\s\S]*not an official clearing or\s+file identifier/i,
  );
  assert.match(document, /No schema field should be added/);
  assert.match(document, /must not authorise or release funds/i);
  assert.match(document, /PAYMENT P3A PUBLIC BANK - PARTIALLY READY/);
  assert.match(document, /Result file specification not publicly available/);
});

test("provider-neutral contract has no result-import responsibility", () => {
  const contract = readFileSync(
    join(
      root,
      "src",
      "lib",
      "payroll",
      "payment",
      "providers",
      "contract.ts",
    ),
    "utf8",
  );
  for (const method of [
    "validateConfiguration",
    "validateBatch",
    "validateInstruction",
    "verifyLimits",
    "calculateControlTotals",
    "buildFilename",
    "buildArtifact",
  ]) {
    assert.match(contract, new RegExp(`${method}\\(`));
  }
  assert.doesNotMatch(contract, /parseResult\s*\(/);
  assert.match(contract, /instructionSequence: number/);
  assert.match(contract, /ascending instructionSequence order/);
  assert.doesNotMatch(contract, /@prisma\/client|react|next\//i);
  const validationIssue = contract.match(
    /export type PaymentValidationIssue = Readonly<\{([\s\S]*?)\}>;/,
  );
  assert.ok(validationIssue);
  assert.doesNotMatch(validationIssue[1], /message|value|account/i);
});
