import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const attendanceCss = readFileSync(
  "src/app/(business)/team/attendance/attendance.module.css",
  "utf8",
);
const globalCss = readFileSync("src/app/globals.css", "utf8");

test("Attendance employee links expose a visible 24px target without widening the table", () => {
  const rule = attendanceCss.match(/\.employeeLink\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /display:\s*inline-flex;/);
  assert.match(rule, /align-items:\s*center;/);
  assert.match(rule, /min-height:\s*24px;/);
  assert.match(rule, /max-width:\s*100%;/);
  assert.match(attendanceCss, /\.employeeLink:hover,\s*\.employeeLink:focus-visible\s*\{/);
});

test("the controlled-logo brand link has a visible keyboard-focusable 24px target", () => {
  const rule = globalCss.match(/\.brand-name-link\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /align-items:\s*center;/);
  assert.match(rule, /display:\s*inline-flex;/);
  assert.match(rule, /min-height:\s*24px;/);
  assert.match(rule, /min-width:\s*0;/);
  assert.match(
    globalCss,
    /\.brand-name-link:focus-visible\s*\{[^}]*outline:[^;}]+;[^}]*outline-offset:[^;}]+;[^}]*\}/,
  );
});
