import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

// Real client components and React events. Only the remote write is substituted.
async function fixture(enabled = false) {
  const { JSDOM } = createRequire(import.meta.url)("jsdom");
  const bundle = await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
      import {CashierOperationsSettings} from './src/components/cashier-operations-settings';
      import {CompanySettingsDialog,CompanySettingsDialogTrigger} from './src/components/company-settings-dialog';
      createRoot(document.getElementById('root')).render(<>
        <CompanySettingsDialogTrigger dialogId="cashier-operations-dialog" index="" label="Open settings" description=""/>
        <CompanySettingsDialog id="cashier-operations-dialog" title="Cashier operations" eyebrow="Company settings" description="Choose how your business uses Cashier." initiallyOpen>
          <CashierOperationsSettings enabled={${enabled}}/>
        </CompanySettingsDialog></>);`, resolveDir: process.cwd(), loader: "tsx" },
    write: false, bundle: true, platform: "browser", format: "iife", jsx: "automatic",
    plugins: [{ name: "boundaries", setup(b) {
      b.onResolve({ filter: /^@\/app\/.*cashier-operations-actions$/ }, a => ({ path: a.path, namespace: "action" }));
      b.onLoad({ filter: /.*/, namespace: "action" }, () => ({ contents: `export async function saveCashierOperationsAction(previous,data){window.calls.push(Object.fromEntries(data));if(window.hold)await new Promise(r=>window.release=r);return window.result;}` }));
      b.onLoad({ filter: /\.module\.css$/ }, () => ({ contents: "export default {};", loader: "js" }));
    } }],
  });
  const dom = new JSDOM(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`, {
    runScripts: "dangerously", url: "http://disposable-ui.test", beforeParse(w: any) {
      w.calls = []; w.result = { status: "success", message: "Cashier operations saved." };
      w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event("close")); };
    },
  });
  const doc = dom.window.document;
  const wait = async (check: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!check()) { assert.ok(Date.now() < deadline, "UI did not settle"); await new Promise(r => setTimeout(r, 10)); }
  };
  await wait(() => !!doc.querySelector('button[type="submit"]') && doc.querySelector('dialog')?.open);
  const save = () => doc.querySelector('button[type="submit"]') as HTMLButtonElement;
  const control = () => doc.querySelector('[role="switch"]') as HTMLButtonElement;
  const toggle = async () => { assert.ok(control(), "dropdown must become a switch"); await wait(() => !control().disabled); const old = control().getAttribute("aria-checked"); control().click(); await wait(() => control().getAttribute("aria-checked") !== old); };
  return { dom, doc, wait, save, control, toggle, dispose: () => dom.window.close() };
}

test("OFF: accessible switch, only OFF guidance, no unchanged submission or success", async () => {
  const f = await fixture(); try {
    assert.ok(f.control(), "dropdown must become a switch");
    assert.equal(f.control().getAttribute("aria-checked"), "false");
    assert.equal(f.control().getAttribute("aria-label"), "Cashier shifts");
    assert.match(f.control().textContent!, /OFF/);
    assert.equal(f.save().disabled, true);
    assert.match(f.doc.querySelector('#root').textContent!, /Recommended for most businesses/);
    assert.doesNotMatch(f.doc.querySelector('#root').textContent!, /Requires staff to start|unchanged/);
    assert.equal(f.doc.querySelector('[role="status"]'), null);
    f.save().click(); assert.equal(f.dom.window.calls.length, 0);
    assert.deepEqual([...new f.dom.window.FormData(f.doc.querySelector('form')).keys()], ["cashierShiftsEnabled"]);
  } finally { f.dispose(); }
});

test("OFF to ON replaces guidance and enables save; reverting disables it", async () => {
  const f = await fixture(); try {
    await f.toggle(); assert.equal(f.save().disabled, false);
    assert.match(f.doc.querySelector('#root').textContent!, /Requires staff to start a shift, enter opening cash/);
    assert.doesNotMatch(f.doc.querySelector('#root').textContent!, /Recommended for most businesses|Use Cashier directly/);
    await f.toggle(); assert.equal(f.save().disabled, true);
  } finally { f.dispose(); }
});

test("pending disables controls; successful save updates baseline and feedback expires", async () => {
  const f = await fixture(); try {
    await f.toggle(); f.dom.window.hold = true; f.save().click();
    await f.wait(() => !!f.dom.window.release);
    assert.equal(f.save().disabled, true); assert.equal(f.control().disabled, true);
    assert.deepEqual(JSON.parse(JSON.stringify(f.dom.window.calls)), [{ cashierShiftsEnabled: "true" }]);
    f.dom.window.release(); await f.wait(() => !!f.doc.querySelector('[role="status"]'));
    assert.equal(f.doc.querySelector('[role="status"]')!.textContent, "Cashier operations updated.");
    assert.equal(f.save().disabled, true);
    await f.wait(() => !f.doc.querySelector('[role="status"]'));
    await f.toggle(); assert.equal(f.save().disabled, false);
    await f.toggle(); assert.equal(f.save().disabled, true);
  } finally { f.dispose(); }
});

test("closing during save reopens at the successfully saved baseline", async () => {
  const f = await fixture(); try {
    await f.toggle(); f.dom.window.hold = true; f.save().click();
    await f.wait(() => !!f.dom.window.release);
    f.doc.querySelector('[aria-label="Close Cashier operations"]').click();
    await f.wait(() => f.control().getAttribute('aria-checked') === 'false');
    f.dom.window.release();
    await f.wait(() => !f.control().disabled);
    f.doc.querySelector('button').click();
    assert.equal(f.control().getAttribute('aria-checked'), 'true');
    assert.equal(f.save().disabled, true);
    assert.equal(f.dom.window.calls.length, 1);
  } finally { f.dispose(); }
});

test("OPEN shift rejection preserves OFF selection and original ON baseline", async () => {
  const f = await fixture(true); try {
    f.dom.window.result = { status: "error", message: "Close all open cashier shifts before disabling cashier shifts." };
    await f.toggle(); f.save().click(); await f.wait(() => !!f.doc.querySelector('[role="alert"]') && !f.control().disabled);
    assert.equal(f.doc.querySelector('[role="alert"]')!.textContent, "End all open cashier shifts before turning Cashier shifts off.");
    assert.equal(f.control().getAttribute("aria-checked"), "false"); assert.equal(f.save().disabled, false);
    await f.toggle(); assert.equal(f.save().disabled, true);
    assert.equal(f.doc.querySelector('[role="status"]'), null);
  } finally { f.dispose(); }
});

for (const method of ["Cancel", "X"]) test(`${method} discards unsaved selection and never submits`, async () => {
  const f = await fixture(); try {
    await f.toggle();
    const close = method === "X" ? f.doc.querySelector('[aria-label="Close Cashier operations"]') : [...f.doc.querySelectorAll('button')].find((b: any) => b.textContent === "Cancel");
    assert.ok(close); (close as HTMLButtonElement).click();
    await f.wait(() => !f.doc.querySelector('dialog').open);
    await f.wait(() => f.control().getAttribute('aria-checked') === 'false');
    f.doc.querySelector('button').click();
    assert.equal(f.save().disabled, true); assert.equal(f.dom.window.calls.length, 0);
  } finally { f.dispose(); }
});

test("unchanged response has no banner; other server errors remain intact", async () => {
  const f = await fixture(); try {
    f.dom.window.result = { status: "success", message: "Cashier operations unchanged." };
    await f.toggle(); f.save().click(); await f.wait(() => f.dom.window.calls.length === 1 && !f.control().disabled);
    assert.equal(f.doc.querySelector('[role="status"]'), null); assert.equal(f.save().disabled, true);
    f.dom.window.result = { status: "error", message: "Permission denied." };
    await f.toggle(); f.save().click(); await f.wait(() => !!f.doc.querySelector('[role="alert"]'));
    assert.equal(f.doc.querySelector('[role="alert"]')!.textContent, "Permission denied.");
  } finally { f.dispose(); }
});
