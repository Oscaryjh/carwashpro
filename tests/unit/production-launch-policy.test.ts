import assert from "node:assert/strict";
import test from "node:test";
import { buildOfficialSubmissionFile } from "../../src/lib/payroll/statutory-submission";
import { downloadOrCreateStatutoryArtifact } from "../../src/lib/payroll/statutory-artifact";
import { activateStatutoryRule } from "../../src/lib/payroll/statutory-activation-service";
import { requireReleaseReadyPaymentBankAdapter } from "../../src/lib/payroll/payment/providers";
import { decryptInternalTestPaymentArtifact } from "../../src/lib/payroll/payment/payment-artifact-service";

// A removal or environment-dependent bypass of the release deny must fail these
// tests before any employee data, retained artifact, or activation state is read.
const noDatabase = new Proxy({}, {
  get() { throw new Error("DATABASE_MUST_NOT_BE_ACCESSED"); },
});

test("payment export remains release-disabled regardless of provider or environment switches", () => {
  for (const provider of ["PUBLIC_BANK", "UNKNOWN_BANK"]) {
    assert.throws(() => requireReleaseReadyPaymentBankAdapter(provider), /PAYMENT_EXPORT_NOT_ENABLED/);
  }
});

test("retained internal test payment bytes cannot be decrypted as a Production export", async () => {
  await assert.rejects(decryptInternalTestPaymentArtifact(null as never, { NODE_ENV: "production", APP_ENVIRONMENT: "production" }), /PAYMENT_EXPORT_NOT_ENABLED/);
});

test("first release denies official PCB bytes before processing payroll data", () => {
  assert.throws(() => buildOfficialSubmissionFile("PCB", null as never, null as never),
    /PCB_OFFICIAL_EXPORT_NOT_ENABLED/);
});

test("first release denies both new and retained PCB artifacts before database access", async () => {
  for (const revision of [undefined, 1]) {
    await assert.rejects(downloadOrCreateStatutoryArtifact({
      provider: "PCB", revision,
    } as Parameters<typeof downloadOrCreateStatutoryArtifact>[0], noDatabase as never),
    /PCB_OFFICIAL_EXPORT_NOT_ENABLED/);
  }
});

test("first release denies PCB activation even with a claimed human admin identity", async () => {
  await assert.rejects(activateStatutoryRule({
    expectedScheme: "PCB", actor: { id: "synthetic-admin", role: "PLATFORM_ADMIN", actorType: "HUMAN_USER", capabilities: [] },
  } as unknown as Parameters<typeof activateStatutoryRule>[0], noDatabase as never),
  /PCB_PRODUCTION_ACTIVATION_NOT_ENABLED/);
});

test("environment flags cannot enable official PCB export", () => {
  const keys = ["PCB_PRODUCTION_ENABLED", "OFFICIAL_EXPORT_ELIGIBLE", "GOVERNMENT_SUBMISSION_ENABLED", "TETAMU_PAYROLL_ENVIRONMENT"];
  const before = keys.map(key => process.env[key]);
  try {
    Object.assign(process.env, { PCB_PRODUCTION_ENABLED: "true", OFFICIAL_EXPORT_ELIGIBLE: "true", GOVERNMENT_SUBMISSION_ENABLED: "true", TETAMU_PAYROLL_ENVIRONMENT: "TESTING" });
    assert.throws(() => buildOfficialSubmissionFile("PCB", null as never, null as never),
      /PCB_OFFICIAL_EXPORT_NOT_ENABLED/);
  } finally {
    keys.forEach((key, index) => { if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index]; });
  }
});
