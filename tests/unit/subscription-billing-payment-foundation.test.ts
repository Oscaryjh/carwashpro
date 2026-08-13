import test from "node:test";
import assert from "node:assert/strict";
import { getSensitiveActionPolicy } from "../../src/lib/auth/sensitive-actions";
import { parseMoneyToCents } from "../../src/lib/commercial/money";

test("subscription payment and void actions require resource-bound true MFA", () => {
  assert.deepEqual(
    ["SUBSCRIPTION_PAYMENT_RECORD", "SUBSCRIPTION_PAYMENT_REVERSE", "SUBSCRIPTION_INVOICE_VOID"].map(key => {
      const policy = getSensitiveActionPolicy(key as Parameters<typeof getSensitiveActionPolicy>[0]);
      return [policy.requiredAssurance, policy.oneTime, policy.resourceBound, policy.requiredCapability];
    }),
    [
      ["MFA", true, true, "MANAGE_COMMERCIAL_BILLING"],
      ["MFA", true, true, "MANAGE_COMMERCIAL_BILLING"],
      ["MFA", true, true, "MANAGE_COMMERCIAL_BILLING"],
    ],
  );
});

test("subscription billing accepts exact integer cents and never treats missing price as zero", () => {
  assert.equal(parseMoneyToCents("159.00"), 15_900);
  assert.equal(parseMoneyToCents(""), null);
});
