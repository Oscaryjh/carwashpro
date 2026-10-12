import assert from "node:assert/strict";
import test from "node:test";
import { getAskTetamuViewState } from "../../src/components/ask-tetamu-view-state";

test("read-only business-data semantics do not prevent an authorized user from asking", () => {
  assert.equal(getAskTetamuViewState({ canUse: true, configured: true, status: "ACTIVE", remainingRequests: 10 }).canAsk, true);
});
test("VIEW without USE retains history but cannot create questions", () => {
  const state = getAskTetamuViewState({ canUse: false, configured: true, status: "ACTIVE", remainingRequests: 10 });
  assert.equal(state.canAsk, false); assert.equal(state.label, "Read-only");
  assert.match(state.reason!, /previous conversations/);
});
test("unconfigured, exhausted and suspended are distinct presentation states", () => {
  const missing = getAskTetamuViewState({ canUse: true, configured: false, status: "NOT_CONFIGURED" });
  assert.equal(missing.label, "Usage not configured");
  assert.equal(missing.canAsk, false);
  assert.match(missing.reason!, /usage allowance hasn't been configured/);
  assert.doesNotMatch(missing.reason!, /isn't enabled/);
  assert.match(getAskTetamuViewState({ canUse: true, configured: true, status: "ACTIVE", remainingRequests: 0 }).reason!, /month/);
  assert.equal(getAskTetamuViewState({ canUse: true, configured: true, status: "SUSPENDED", remainingRequests: 10 }).canAsk, false);
});

test("inactive policy is unavailable rather than missing and an active unlimited policy permits questions", () => {
  for (const status of ["SUSPENDED", "EXPIRED"]) {
    const state = getAskTetamuViewState({ canUse: true, configured: true, status, remainingRequests: 10 });
    assert.equal(state.label, "Unavailable");
    assert.equal(state.canAsk, false);
  }
  assert.equal(getAskTetamuViewState({ canUse: true, configured: true, status: "ACTIVE", remainingRequests: null }).canAsk, true);
  assert.equal(getAskTetamuViewState({ canUse: true, configured: true, status: "ACTIVE", remainingRequests: 0 }).label, "Monthly limit reached");
});
