import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runListSource = readFileSync(
  new URL("../../src/app/(business)/team/payroll/runs/page.tsx", import.meta.url),
  "utf8",
);
const runDetailSource = readFileSync(
  new URL("../../src/app/(business)/team/payroll/runs/[runId]/page.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../../src/app/(business)/team/payroll/runs/runs.module.css", import.meta.url),
  "utf8",
);

test("payroll table action headers do not create off-viewport hidden content", () => {
  assert.match(runListSource, /<th aria-label="Action"\s*\/>/);
  assert.match(runDetailSource, /<th aria-label="Entry actions"\s*\/>/);
  assert.doesNotMatch(styles, /\.visuallyHidden\s*\{/);
});

test("payroll employee links meet the 24px mobile target minimum", () => {
  assert.match(
    styles,
    /\.employeeLink\s*\{[^}]*display:\s*inline-flex;[^}]*min-height:\s*24px;/,
  );
});
