import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Payroll bank execution and export use the explicit first-launch disabled label", () => {
  const source = readFileSync("src/app/(business)/team/payroll/payments/page.tsx", "utf8");
  assert.match(source, /Bank execution &amp; Payment Export/);
  assert.match(source, /\{NOT_ENABLED_LABEL\}/);
});
