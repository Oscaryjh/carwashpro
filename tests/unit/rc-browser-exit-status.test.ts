import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

test("browser wrapper preserves failure and improvement statuses as nonzero exit", () => {
  const source = readFileSync("scripts/production-rc-local-browser.mjs", "utf8");
  const report = source.slice(source.indexOf("function report(result)"), source.indexOf("async function run(args"));
  for (const [statuses, expected] of [
    [["PASS"], 0], [["FAIL"], 1], [["NEEDS_IMPROVEMENT"], 1], [["FAIL", "PASS"], 1],
  ] as const) {
    const actual = runInNewContext(`let exit = 0; const results = []; ${report}
      for (const status of statuses) report({ status }); exit;`, { statuses, console: { log() {} } });
    assert.equal(actual, expected, `browser exit must preserve ${statuses.join(",")}`);
  }
});
