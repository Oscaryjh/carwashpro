import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("People readiness detail links keep a usable mobile tap target", async () => {
  const css = await readFile("src/components/people-directory.module.css", "utf8");

  assert.match(css, /\.moreIssues\{[^}]*min-height:36px/);
  assert.match(css, /\.moreIssues\{[^}]*align-items:center/);
});
