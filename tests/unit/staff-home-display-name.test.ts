import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const homeSource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-home-overview.tsx", import.meta.url),
  "utf8",
);

test("Staff home preserves HR master-data capitalization in employee names", () => {
  assert.match(
    homeSource,
    /function formatDisplayName\(fullName: string\) \{\s*return fullName\.trim\(\)\.replace\(\/\\s\+\/g, " "\);\s*\}/,
  );
  assert.doesNotMatch(homeSource, /toLocaleLowerCase/);
});
