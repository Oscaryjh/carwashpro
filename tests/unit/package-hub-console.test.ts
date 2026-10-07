import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { packageHubHarness } from "../helpers/package-hub-ui-harness";

type TestWindow = Window & { close(): void; Event: typeof Event; KeyboardEvent: typeof KeyboardEvent; MouseEvent: typeof MouseEvent };
const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string, options: object) => { window: TestWindow } };
async function mount(view: string, restricted = false, query: Record<string, string> = {}, emptyCurrent = false) {
  const h = await packageHubHarness(); h.state.links = !restricted;
  const props = { ...(await h.api.Page({ searchParams: Promise.resolve({ view, ...query }) })).props }; h.close();
  if (emptyCurrent && props.overview) props.overview = { ...props.overview, current: { activePackages: 0, usesLeft: 0, currentlyUsedUp: 0 } };
  const before = JSON.stringify(props);
  const built = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{PackageHub}from'./src/components/packages/package-hub';HTMLDialogElement.prototype.showModal=function(){this.open=true};HTMLDialogElement.prototype.close=function(){this.open=false};flushSync(()=>createRoot(document.getElementById('root')).render(<PackageHub {...window.props}/>));`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", plugins: [{ name: "ui-boundaries", setup(b) {
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "import React from 'react';export default({children,...props})=><a {...props}>{children}</a>", loader: "jsx", resolveDir: process.cwd() }));
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: "export default new Proxy({}, {get:(_,key)=>key});", loader: "js" }));
  } }] });
  const dom = new JSDOM(`<div id="root"></div><script>${built.outputFiles[0].text}</script>`, { runScripts: "dangerously", url: "http://local-ui.test/package-hub", beforeParse(w: { props: typeof props }) { w.props = props; } });
  return { dom, doc: dom.window.document, props, before };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(check(), "UI update completes");
}
for (const range of ["today", "month", "last-month", "custom"]) test(`Overview ${range}: compact current metrics preserve period-independent Uses Left`, async () => {
  const { dom, doc, props, before } = await mount("overview", false, { range, from: "2026-08-01", to: "2026-08-09" });
  try {
    const sections = [...doc.querySelectorAll("section")];
    const current = sections.find(section => section.querySelector(":scope > h2")?.textContent === "Current state")!;
    const period = sections.find(section => section.querySelector(":scope > h2")?.textContent?.startsWith("Period activity"))!;
    assert.deepEqual([...current.querySelectorAll(".metric span")].map(el => el.textContent), ["Active packages", "Uses Left", "Used-up packages"]);
    assert.deepEqual([...current.querySelectorAll(".metric strong")].map(el => el.textContent), ["7", "27", "2"]);
    assert.deepEqual([...period.querySelectorAll(".metric span")].map(el => el.textContent), ["Packages sold", "Uses", "Uses restored"]);
    assert.deepEqual([...period.querySelectorAll(".metric strong")].map(el => el.textContent), ["13", "29", "3"]);
    assert.equal(JSON.stringify(props), before);
  } finally { dom.window.close(); }
});
test("Overview empty current state displays integer zero Uses Left", async () => {
  const { dom, doc } = await mount("overview", false, {}, true);
  try {
    const metric = [...doc.querySelectorAll(".metric")].find(el => el.querySelector("span")?.textContent === "Uses Left");
    assert.ok(metric); assert.equal(metric.querySelector("strong")?.textContent, "0");
  } finally { dom.window.close(); }
});
for (const [view, labels] of [
  ["sales", ["Total Uses", "Uses Left"]],
  ["customers", ["Uses Left"]],
  ["activity", ["Uses Changed", "Uses Left"]],
  ["overview", ["Uses", "Uses restored"]],
] as const) test(`${view}: package terminology labels preserve the canonical DTO`, async () => {
  const { dom, doc, props, before } = await mount(view);
  try {
    const text = doc.getElementById("root")!.textContent ?? "";
    for (const label of labels) assert.ok(text.includes(label), label);
    assert.doesNotMatch(text, /Initial uses|Current remaining|Sessions|Credits/);
    assert.equal(JSON.stringify(props), before);
  } finally { dom.window.close(); }
});
for (const view of ["activity", "sales", "customers"]) test(`${view}: readonly drawer stays outside table, preserves DTO and returns focus`, async () => {
  const { dom, doc, props, before } = await mount(view);
  try {
    assert.equal(doc.querySelectorAll("tbody details").length, 0);
    const trigger = doc.querySelector<HTMLButtonElement>('tbody button[aria-haspopup="dialog"]'); assert.ok(trigger);
    const table = doc.querySelector("tbody")!.textContent;
    trigger.focus(); trigger.click(); await until(() => !!doc.querySelector("dialog[open]"));
    const dialog = doc.querySelector("dialog")!;
    assert.equal(dialog.closest("table"), null);
    for (const value of ["Alice", "Haircut bundle", "Earlier package activity is unavailable."]) assert.ok(dialog.textContent?.includes(value), value);
    assert.equal(dialog.querySelectorAll("input,select,form").length, 0);
    assert.doesNotMatch(dialog.textContent ?? "", /entryKey|FinancialOperation|sequence|migration/);
    assert.equal(doc.querySelector("tbody")!.textContent, table);
    dialog.querySelector<HTMLButtonElement>('button[aria-label="Close package details"]')!.click();
    await until(() => !doc.querySelector("dialog")); assert.equal(doc.activeElement, trigger);
    trigger.click(); await until(() => !!doc.querySelector("dialog[open]"));
    doc.querySelector("dialog")!.dispatchEvent(new dom.window.Event("cancel", { cancelable: true }));
    await until(() => !doc.querySelector("dialog")); assert.equal(JSON.stringify(props), before);
  } finally { dom.window.close(); }
});
test("restricted drawer has no invoice or customer drilldown", async () => {
  const { dom, doc } = await mount("activity", true);
  try {
    doc.querySelector<HTMLButtonElement>('tbody button')!.click(); await until(() => !!doc.querySelector("dialog[open]"));
    assert.equal(doc.querySelector("dialog")!.querySelectorAll("a").length, 0);
  } finally { dom.window.close(); }
});
test("Settings contains only existing management route and closes on Escape and outside press", async () => {
  const { dom, doc } = await mount("activity");
  try {
    const menu = doc.querySelector<HTMLDetailsElement>('header details')!;
    const trigger = menu.querySelector('summary')!; trigger.click(); assert.equal(menu.open, true);
    const link = menu.querySelector('a')!; assert.equal(link.getAttribute('href'), '/packages');
    assert.equal(link.textContent, 'Manage Packages'); assert.equal(menu.querySelectorAll('a').length, 1);
    link.focus(); link.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(menu.open, false); assert.equal(doc.activeElement, trigger);
    trigger.click(); doc.body.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
    assert.equal(menu.open, false);
  } finally { dom.window.close(); }
});
