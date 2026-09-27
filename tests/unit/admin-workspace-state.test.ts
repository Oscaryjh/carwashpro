import assert from "node:assert/strict";
import test from "node:test";
import { workspaceSection, workspaceHref, matchesWorkspaceSearch, passwordConfirmationError, rememberedWorkspaceSection, submitWorkspaceBranchChange } from "../../src/components/admin-workspace-state";

test("unknown and missing sections fall back to overview; valid deep links select their panel", () => {
  assert.equal(workspaceSection(null), "overview");
  assert.equal(workspaceSection("__proto__"), "overview");
  assert.equal(workspaceSection("users"), "users");
  assert.equal(workspaceSection("modules"), "modules");
});
test("section navigation preserves unrelated query state but drops old action feedback", () => {
  assert.equal(workspaceHref("/admin/businesses/one", "type=success&message=Saved&filter=active", "branches"), "/admin/businesses/one?filter=active&section=branches");
});
test("directory search trims, ignores case and accepts missing optional fields", () => {
  assert.equal(matchesWorkspaceSearch("  ADELINE  ", ["Adeline Yong", null]), true);
  assert.equal(matchesWorkspaceSearch("owner@example.com", ["Adeline", "OWNER@example.com"]), true);
  assert.equal(matchesWorkspaceSearch("missing", [null, "Adeline"]), false);
  assert.equal(matchesWorkspaceSearch("  ", [null]), true);
});
test("password confirmation rejects mismatch without trimming or changing the password", () => {
  assert.equal(passwordConfirmationError("abcdef", "abcdef"), "");
  assert.equal(passwordConfirmationError("abcdef ", "abcdef"), "Passwords do not match.");
  assert.equal(passwordConfirmationError("abcdef", ""), "Passwords do not match.");
});

test("explicit deep-link section overrides saved navigation; redirects restore the saved section", () => {
  assert.equal(rememberedWorkspaceSection("modules", "users"), "modules");
  assert.equal(rememberedWorkspaceSection(null, "profile"), "profile");
  assert.equal(rememberedWorkspaceSection("invalid", "users"), "overview");
});

test("branch feedback waits for the existing action and never reports a failed save as success", async () => {
  const data = new FormData(); data.set("branchId", "branch-one");
  let calls = 0;
  const success = await submitWorkspaceBranchChange(async (received) => { assert.equal(received, data); calls += 1; }, data);
  assert.deepEqual(success, { ok: true }); assert.equal(calls, 1);
  const failure = await submitWorkspaceBranchChange(async () => { throw new Error("private DB detail"); }, data);
  assert.deepEqual(failure, { ok: false, message: "Unable to update this branch. Please try again." });
});
