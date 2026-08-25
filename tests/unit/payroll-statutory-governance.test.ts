import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertArrearsDecision,
  classificationBlockingScope,
  effectiveClassificationTreatment,
  isClassificationActivationBlocking,
  isClassificationRuntimeBlocking,
} from "../../src/lib/payroll/statutory-classification-policy";
import { statutoryStepUpReadiness } from "../../src/lib/payroll/statutory-governance-service";

test("unreviewed UNKNOWN is a global activation blocker and runtime fails closed", () => {
  const input = {
    componentCode: "CUSTOM_UNKNOWN_EARNING",
    currentTreatment: "UNKNOWN" as const,
    latestDecision: null,
  };
  assert.equal(isClassificationActivationBlocking(input), true);
  assert.equal(isClassificationRuntimeBlocking(input), true);
  assert.equal(classificationBlockingScope(input), "GLOBAL_ACTIVATION_BLOCKER");
});

test("explicit Keep UNKNOWN is conditional for non-core components but remains runtime blocking", () => {
  const input = {
    componentCode: "CUSTOM_UNKNOWN_EARNING",
    currentTreatment: "UNKNOWN" as const,
    latestDecision: "KEEP_UNKNOWN" as const,
  };
  assert.equal(isClassificationActivationBlocking(input), false);
  assert.equal(isClassificationRuntimeBlocking(input), true);
  assert.equal(classificationBlockingScope(input), "CONDITIONAL_RUNTIME_BLOCKER");
});

test("core wage kept UNKNOWN remains a global activation blocker", () => {
  assert.equal(classificationBlockingScope({
    componentCode: "BASIC_SALARY",
    currentTreatment: "UNKNOWN",
    latestDecision: "KEEP_UNKNOWN",
  }), "GLOBAL_ACTIVATION_BLOCKER");
});

test("evidence-backed decisions resolve effective treatment without mutating the base record", () => {
  assert.equal(effectiveClassificationTreatment({
    currentTreatment: "UNKNOWN", latestDecision: "INCLUDED",
  }), "INCLUDED");
  assert.equal(effectiveClassificationTreatment({
    currentTreatment: "UNKNOWN", latestDecision: "EXCLUDED",
  }), "EXCLUDED");
  assert.equal(effectiveClassificationTreatment({
    currentTreatment: "UNKNOWN", latestDecision: "ADDITIONAL_REMUNERATION",
  }), "ADDITIONAL_REMUNERATION");
});

test("arrears cannot receive a generic included or excluded legal treatment", () => {
  assert.throws(() => assertArrearsDecision("ARREARS", "INCLUDED"),
    /ARREARS_STATUTORY_SOURCE_NATURE_REQUIRED/);
  assert.throws(() => assertArrearsDecision("ARREARS", "EXCLUDED"),
    /ARREARS_STATUTORY_SOURCE_NATURE_REQUIRED/);
  assert.doesNotThrow(() => assertArrearsDecision("ARREARS", "KEEP_UNKNOWN"));
  assert.throws(() => assertArrearsDecision("SALARY_ARREARS", "ADDITIONAL_REMUNERATION"),
    /ARREARS_STATUTORY_SOURCE_NATURE_REQUIRED/);
  assert.doesNotThrow(() => assertArrearsDecision("SALARY_ARREARS", "KEEP_UNKNOWN"));
});

test("statutory step-up framework is ready without bypassing per-user verification", () => {
  assert.deepEqual(statutoryStepUpReadiness({ authority: "KWSP" }), {
    status: "READY", blocker: null,
  });
  assert.deepEqual(statutoryStepUpReadiness({ authority: "TEST_ONLY" }), {
    status: "READY", blocker: null,
  });
});

test("human governance migration is additive, immutable and audit-capable", () => {
  const sql = readFileSync(resolve(
    process.cwd(),
    "prisma/migrations/20260810170000_statutory_human_governance_closure/migration.sql",
  ), "utf8");
  assert.match(sql, /CREATE TABLE "statutory_component_review_decisions"/);
  assert.match(sql, /STATUTORY_COMPONENT_REVIEW_DECISION_IMMUTABLE/);
  assert.match(sql, /STATUTORY_REGISTERED_CLASSIFICATION_IMMUTABLE/);
  assert.match(sql, /HUMAN_REVIEW_COMPLETED/);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE TABLE/);
});
