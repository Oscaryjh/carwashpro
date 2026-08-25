import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("business settings does not duplicate the workspace Team activity entry", async () => {
  const source = await readFile(
    path.join(
      process.cwd(),
      "src/app/(business)/business/settings/page.tsx",
    ),
    "utf8",
  );

  assert.doesNotMatch(source, /href="\/team\?section=activity"/);
  assert.doesNotMatch(source, />\s*Staff activity\s*</);
  assert.doesNotMatch(source, /\/business\/settings\/logs/);
});
