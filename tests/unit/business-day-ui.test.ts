import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
const require = createRequire(import.meta.url);
require.extensions[".css"] = (module) => { module.exports = {}; };
const { BusinessForm } = require("../../src/components/business-form");

test("Business day explains reporting boundaries without changing stored values or save action", () => {
  const action = async () => {};
  const props = { action, mode: "edit", settingsLayout: true, business: { id: "synthetic", name: "Synthetic outlet", slug: "synthetic", status: "active", industryType: "SALON", timezone: "Asia/Kuching", businessDayCutoffTime: "02:00" } };
  assert.equal(BusinessForm(props).props.action, action);
  const html = renderToStaticMarkup(createElement(BusinessForm, props));
  const dialog = html.match(/<dialog[^>]*id="business-day-dialog"[\s\S]*?<\/dialog>/)?.[0];
  assert.ok(dialog);
  assert.match(dialog, /Choose when Tetamu POS starts a new reporting day\./);
  assert.match(dialog, /New business day starts at/);
  assert.match(dialog, /Transactions before 2:00 AM are counted toward the previous business day\./);
  assert.match(dialog, /Used for reports, appointments and shifts\./);
  assert.match(dialog, /This does not change your store opening hours\./);
  assert.match(dialog, /value="Asia\/Kuching" selected/);
  assert.match(dialog, /Malaysia \(UTC\+8\)/);
  assert.match(dialog, /name="businessDayCutoffTime"[^>]*value="02:00"/);
  assert.match(dialog, />Save changes</);
});

test("time edits update only helper presentation and preserve the native field contract", async () => {
  const dir = await mkdtemp(join(process.cwd(), "node_modules/.cache/business-day-ui-"));
  const hooks = { value: undefined as string | undefined };
  (globalThis as any).__businessDayUI = hooks;
  try {
    await build({ entryPoints: ["src/components/business-day-start-field.tsx"], outfile: join(dir, "field.cjs"), bundle: true, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "hook-storage", setup(b) {
      b.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "hooks" }));
      b.onLoad({ filter: /.*/, namespace: "hooks" }, () => ({ contents: "export function useState(initial){const h=globalThis.__businessDayUI;if(h.value===undefined)h.value=initial;return [h.value,v=>h.value=v]}" }));
    } }] });
    const { BusinessDayStartField } = require(join(dir, "field.cjs"));
    const render = () => BusinessDayStartField({ initialTime: "02:00" });
    const children = () => render().props.children;
    assert.equal(children()[2].props.children, "Transactions before 2:00 AM are counted toward the previous business day.");
    for (const [value, display] of [["03:00", "3:00 AM"], ["00:00", "12:00 AM"], ["12:00", "12:00 PM"], ["23:59", "11:59 PM"]]) {
      children()[1].props.onChange({ target: { value } });
      assert.equal(children()[2].props.children, `Transactions before ${display} are counted toward the previous business day.`);
      assert.equal(children()[1].props.name, "businessDayCutoffTime");
      assert.equal(children()[1].props.type, "time");
      assert.equal(children()[1].props.defaultValue, "02:00");
      assert.equal(children()[1].props.value, undefined, "helper must not overwrite native input values");
    }
    children()[1].props.onChange({ target: { value: "" } });
    assert.equal(children()[2].props.children, "Choose when the new reporting day starts.");
    assert.equal(children()[1].props.required, true);
  } finally { delete (globalThis as any).__businessDayUI; await rm(dir, { recursive: true, force: true }); }
});
