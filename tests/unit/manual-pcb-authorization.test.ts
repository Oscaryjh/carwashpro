import assert from "node:assert/strict";
import test from "node:test";
import { getSensitiveActionPolicy } from "../../src/lib/auth/sensitive-actions";
test("manual PCB is a resource-bound one-time MFA action using existing payroll edit capability", () => {
  const policy = getSensitiveActionPolicy("PCB_MANUAL_CONFIRM");
  assert.equal(policy?.requiredAssurance, "MFA");
  assert.equal(policy.requiredCapability, "EDIT_PAYROLL_ENTRY");
  assert.equal(policy.resourceType, "PAYROLL_ENTRY");
  assert.equal(policy.requiredModule, "PAYROLL");
  assert.equal(policy.oneTime, true);
});
