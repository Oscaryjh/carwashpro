import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("leave administration separates daily, policy and restricted maintenance work", async () => {
  const page = await readFile("src/app/(business)/team/leave/page.tsx", "utf8");

  assert.match(page, /manage=balances/);
  assert.match(page, /manage=types/);
  assert.match(page, /manage=policy/);
  assert.match(page, /manage=compliance/);
  assert.match(page, /manage=maintenance/);
  assert.match(page, /Advanced compliance & maintenance/);
  assert.match(page, /Draft rules never affect employee balances or Payroll/);
  assert.match(page, /leave-entitlements-modal-title/);
  assert.match(page, /leave-management-modal-title/);
  assert.match(page, /className=\{styles\.modalBackdrop\}/);
  assert.match(page, /className=\{`\$\{styles\.management\} \$\{styles\.managementModal\}`\}/);
  assert.match(page, /role="dialog"/);
  assert.match(page, /aria-modal="true"/);
});

test("leave administration modal cards are scrollable and become bottom sheets on small screens", async () => {
  const css = await readFile("src/app/(business)/team/leave/leave.module.css", "utf8");

  assert.match(css, /\.managementModal\s*\{[\s\S]*?max-height:\s*calc\(100dvh - 48px\);[\s\S]*?overflow-y:\s*auto;/);
  assert.match(css, /\.managementModal\s*>\s*\.modalHeader\s*\{[\s\S]*?position:\s*sticky;/);
  assert.match(css, /@media[\s\S]*?\.managementModal\s*\{[\s\S]*?max-height:\s*94dvh;/);
});
