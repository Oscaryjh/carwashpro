import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformSync } from "esbuild";
import { MODULE_REGISTRY, moduleKeys, type ModuleKey } from "../../src/lib/modules/registry";

// Render the real page section with the real registry, without importing its DB loaders.
function renderModules(enabled: readonly ModuleKey[]) {
  const source = readFileSync("src/app/(business)/business/settings/page.tsx", "utf8");
  const start = source.indexOf('<div className="company-settings-sheet company-settings-secondary-section');
  const end = source.indexOf('<div className="company-settings-sheet company-settings-secondary-section" id="subscription">', start);
  const section = source.slice(start, end).trim();
  const { code } = transformSync(`function View(){return (${section});}`, { loader: "tsx", jsx: "transform" });
  const element = new Function("React", "MODULE_REGISTRY", "moduleKeys", "moduleContext", `${code};return View();`)(
    React, MODULE_REGISTRY, moduleKeys, { enabledModules: new Set(enabled) },
  );
  const { JSDOM } = createRequire(import.meta.url)("jsdom");
  return new JSDOM(renderToStaticMarkup(element));
}

test("module names remain the complete ordered registry labels and primary text", () => {
  const dom = renderModules([]);
  try {
    assert.deepEqual([...dom.window.document.querySelectorAll('#modules strong')].map((n: any) => n.textContent), [
      "Core platform", "POS", "Member Wallet", "Inventory", "Salon appointments", "Vehicle Work Orders",
      "WhatsApp", "Business group", "HR", "Payroll", "Statutory", "Claims", "Commission", "Expenses", "AI Business Analysis", "Loyalty",
    ]);
  } finally { dom.window.close(); }
});

test("enabled and disabled status are compact non-interactive text, not headings", () => {
  const dom = renderModules(["POS", "WALLET"]);
  try {
    const badges = [...dom.window.document.querySelectorAll('.company-module-status')];
    assert.equal(badges.length, 16);
    assert.equal(badges.filter((n: any) => n.textContent === "Enabled").length, 2);
    assert.equal(badges.filter((n: any) => n.textContent === "Disabled").length, 14);
    assert.ok(badges.every((n: any) => n.tagName === "SPAN"));
  } finally { dom.window.close(); }
});

test("dependency rows keep the real rules and omit placeholders", () => {
  const dom = renderModules([]);
  try {
    const rows = [...dom.window.document.querySelectorAll('#modules small')].map((n: any) => n.textContent);
    assert.deepEqual(rows, ["Requires POS", "Requires POS", "Requires HR", "Requires PAYROLL", "Requires HR", "Requires CORE", "Requires CORE"]);
    assert.equal(dom.window.document.querySelectorAll('#modules small:empty').length, 0);
    assert.doesNotMatch(dom.window.document.body.textContent, /No dependency/);
  } finally { dom.window.close(); }
});

test("all enabled modules render once without introducing settings controls or action wiring", () => {
  const dom = renderModules(moduleKeys);
  try {
    const section = dom.window.document.querySelector('#modules');
    assert.equal(section.querySelectorAll('.company-module-status').length, 16);
    assert.equal(section.querySelectorAll('.company-module-status[data-enabled="true"]').length, 16);
    assert.equal(section.querySelectorAll('button, input, select, form, a, [tabindex]').length, 0);
    assert.match(section.textContent, /Only Platform Admins can change module access\./);
  } finally { dom.window.close(); }
});
