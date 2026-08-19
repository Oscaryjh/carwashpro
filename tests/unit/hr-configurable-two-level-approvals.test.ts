import assert from "node:assert/strict";
import test from "node:test";
import { policyRequiresSecondLevel } from "../../src/lib/approvals/policy-service";

test("one-level approval never requires owner final approval", () => {
  assert.equal(policyRequiresSecondLevel({ domain: "LEAVE", mode: "ONE_LEVEL", thresholdValue: null }, 30), false);
});

test("always-two-level approval requires owner approval for ordinary requests", () => {
  assert.equal(policyRequiresSecondLevel({ domain: "CLAIMS", mode: "TWO_LEVEL_ALWAYS", thresholdValue: null }, 1), true);
});

test("threshold approval routes only values at or above the configured threshold", () => {
  const policy = { domain: "CLAIMS" as const, mode: "TWO_LEVEL_THRESHOLD" as const, thresholdValue: 500 };
  assert.equal(policyRequiresSecondLevel(policy, 499.99), false);
  assert.equal(policyRequiresSecondLevel(policy, 500), true);
  assert.equal(policyRequiresSecondLevel(policy, 750), true);
});
