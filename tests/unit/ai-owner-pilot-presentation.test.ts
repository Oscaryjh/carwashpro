import assert from "node:assert/strict";
import test from "node:test";
import { getAskTetamuViewState } from "@/components/ask-tetamu-view-state";

test("Pilot restricted users cannot send even with USE capability and active allowance", () => {
  const state = getAskTetamuViewState({ canUse: true, configured: true, status: "ACTIVE", remainingRequests: 100, pilotAccess: "restricted" });
  assert.equal(state.canAsk, false);
  assert.equal(state.reason, "Ask Tetamu Pilot is currently available to Business Owners only.");
});
test("Pilot restriction is accurate even when allowance is not configured", () => {
  const state = getAskTetamuViewState({ canUse: true, configured: false, status: "NOT_CONFIGURED", pilotAccess: "restricted" });
  assert.equal(state.canAsk, false);
  assert.match(state.reason!, /Business Owners only/);
});
