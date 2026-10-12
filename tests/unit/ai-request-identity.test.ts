import assert from "node:assert/strict";
import test from "node:test";
import { aiRequestFingerprint, storedAiRequestFingerprint } from "@/lib/ai/request-identity";

const input = { actorUserId: "actor", businessId: "business", question: " Sales ", branch: { kind: "absent" as const } };
test("fingerprint binds actor, Business, question, requested conversation and period", () => {
  const original = aiRequestFingerprint(input);
  assert.equal(aiRequestFingerprint({ ...input, question: "Sales", range: "month", conversationId: null }), original);
  for (const change of [{ actorUserId: "other" }, { businessId: "other" }, { question: "Payments" }, { conversationId: "server-created" }, { range: "today" }, { from: "2026-10-01" }, { to: "2026-10-12" }]) assert.notEqual(aiRequestFingerprint({ ...input, ...change }), original);
});
test("fingerprint distinguishes absent, null and explicit Branch; stored proof fails closed", () => {
  const absent = aiRequestFingerprint(input);
  const nil = aiRequestFingerprint({ ...input, branch: { kind: "explicit", value: null } });
  const value = aiRequestFingerprint({ ...input, branch: { kind: "explicit", value: "branch" } });
  assert.equal(new Set([absent, nil, value]).size, 3);
  assert.equal(storedAiRequestFingerprint({ requestFingerprint: absent }), absent);
  for (const invalid of [null, {}, { requestFingerprint: "legacy" }, []]) assert.equal(storedAiRequestFingerprint(invalid), null);
});
