import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(
  new URL("../../src/app/(business)/team/payroll/payments/payments.module.css", import.meta.url),
  "utf8",
);

test("payment recovery links meet the 24px mobile target minimum", () => {
  assert.match(
    styles,
    /\.empty a,\s*\.table td small a\s*\{[^}]*display:\s*inline-flex;[^}]*min-height:\s*24px;/,
  );
});
