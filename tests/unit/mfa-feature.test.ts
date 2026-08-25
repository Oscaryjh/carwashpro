import assert from "node:assert/strict";
import test from "node:test";
import { isMfaFeatureEnabled } from "../../src/lib/auth/mfa-feature";

test("MFA is hidden by default", () => {
  assert.equal(isMfaFeatureEnabled({}), false);
});

test("the master switch can restore MFA without code changes", () => {
  assert.equal(isMfaFeatureEnabled({ TETAMU_MFA_ENABLED: "true" }), true);
  assert.equal(isMfaFeatureEnabled({ TETAMU_MFA_ENABLED: "false" }), false);
});

test("security regression tests exercise MFA unless explicitly disabled", () => {
  assert.equal(isMfaFeatureEnabled({ NODE_TEST_CONTEXT: "child-v8" }), true);
  assert.equal(
    isMfaFeatureEnabled({
      NODE_TEST_CONTEXT: "child-v8",
      TETAMU_MFA_ENABLED: "false",
    }),
    false,
  );
});
