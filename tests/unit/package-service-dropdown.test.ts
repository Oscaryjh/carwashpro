import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

async function fixture(edit = false, salon = true) {
  const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{PackageForm}from'./src/components/package-form';
    createRoot(document.getElementById('root')).render(<PackageForm action={async()=>{throw Error('Must not submit')}} isSalonBusiness={${salon}} branches={[{id:'branch',name:'Local'}]} categories={[{id:'c',name:'Package',status:'ACTIVE'}]} services={[{id:'a',name:'Classic Facial',category:'Facial',price:'90.00'},{id:'b',name:'A very long service name that must never push the service price out of view',category:'Facial',price:'150.00'},{id:'c',name:'Haircut',category:'Hair',price:'45.00'}]} ${edit ? "packagePlan={{id:'p',name:'Saved',price:'280.00',status:'ACTIVE',description:'',totalUses:4,categoryId:'c',branchId:'branch'}} serviceBenefits={[{serviceId:'a',totalUses:2},{serviceId:'c',totalUses:2}]}" : ""} />);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic" });
  const { JSDOM } = createRequire(import.meta.url)("jsdom");
  const dom = new JSDOM(`<button id="outside">Outside</button><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`, { runScripts: "dangerously", url: "http://ui.test" });
  const doc = dom.window.document;
  const settle = () => new Promise(r => setTimeout(r, 25));
  for (let i = 0; !doc.querySelector('form') && i < 100; i++) await settle();
  const trigger = (index = 0) => {
    const el = doc.querySelectorAll('[role="combobox"]')[index];
    assert.ok(el, "Package service must expose an accessible custom combobox");
    return el;
  };
  const open = async (index = 0) => { trigger(index).focus(); trigger(index).click(); await settle(); };
  const key = async (value: string, index = 0) => { trigger(index).dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); await settle(); };
  const option = (name: string) => [...doc.querySelectorAll('[role="option"]')].find((el: any) => el.textContent.includes(name)) as any;
  return { dom, doc, settle, trigger, open, key, option, data: () => new dom.window.FormData(doc.querySelector('form')), close: () => dom.window.close() };
}

test("grouped options and selected field separate names from formatted prices", async () => {
  const f = await fixture(); try {
    await f.open();
    assert.deepEqual([...f.doc.querySelectorAll('[role="listbox"] [role="group"]')].map((el: any) => el.getAttribute('aria-label')), ['Facial', 'Hair']);
    const category = f.doc.querySelector('.package-service-category');
    assert.equal(category.textContent, 'Facial');
    assert.equal(category.querySelector('.package-service-price'), null);
    const a = f.option('Classic Facial');
    assert.equal(a.querySelector('.package-service-name').textContent, 'Classic Facial');
    assert.match(a.querySelector('.package-service-price').textContent, /^RM\s*90\.00$/);
    assert.ok(f.option('A very long').querySelector('.package-service-name').title.includes('never push'));
    a.click(); await f.settle();
    assert.equal(f.trigger().querySelector('.package-service-name').textContent, 'Classic Facial');
    assert.match(f.trigger().querySelector('.package-service-price').textContent, /^RM\s*90\.00$/);
    assert.equal(f.trigger().getAttribute('aria-expanded'), 'false');
    assert.deepEqual(f.data().getAll('benefitServiceId'), ['a']);
    assert.equal(f.data().get('price'), '');
  } finally { f.close(); }
});

test("edit keeps payload and other rows; duplicate selection is disabled for mouse and keys", async () => {
  const f = await fixture(true); try {
    assert.deepEqual(f.data().getAll('benefitServiceId'), ['a','c']);
    await f.open();
    assert.equal(f.option('Classic Facial').getAttribute('aria-selected'), 'true');
    assert.equal(f.option('Haircut').getAttribute('aria-disabled'), 'true');
    f.option('Haircut').click(); await f.settle();
    assert.deepEqual(f.data().getAll('benefitServiceId'), ['a','c']);
    await f.key('ArrowDown'); await f.key('ArrowDown'); await f.key('Enter');
    assert.deepEqual(f.data().getAll('benefitServiceId'), ['b','c']);
    assert.deepEqual(f.data().getAll('benefitTotalUses'), ['2','2']);
    assert.equal(f.data().get('price'), '280.00');
    assert.equal(f.data().get('packageId'), 'p');
    assert.deepEqual([...new Set(f.data().keys())].sort(), ['benefitServiceId','benefitTotalUses','branchId','categoryId','description','name','packageId','price','status']);
  } finally { f.close(); }
});

test("Arrow keys navigate, Enter selects, Escape and Tab close without altering selection", async () => {
  const f = await fixture(); try {
    f.trigger().focus();
    await f.key('ArrowDown');
    assert.equal(f.trigger().getAttribute('aria-expanded'), 'true');
    await f.key('ArrowDown'); await f.key('ArrowUp'); await f.key('Enter');
    assert.deepEqual(f.data().getAll('benefitServiceId'), ['a']);
    assert.equal(f.doc.activeElement, f.trigger());
    await f.open(); await f.key('ArrowDown'); await f.key('Escape');
    assert.equal(f.trigger().getAttribute('aria-expanded'), 'false');
    assert.deepEqual(f.data().getAll('benefitServiceId'), ['a']);
    await f.open(); await f.key('Tab');
    assert.equal(f.trigger().getAttribute('aria-expanded'), 'false');
    assert.deepEqual(f.data().getAll('benefitServiceId'), ['a']);
  } finally { f.close(); }
});

test("outside click closes; required invalid field focuses trigger and selection clears error", async () => {
  const f = await fixture(); try {
    await f.open();
    f.doc.querySelector('#outside').dispatchEvent(new f.dom.window.Event('pointerdown', { bubbles: true }));
    await f.settle();
    assert.equal(f.trigger().getAttribute('aria-expanded'), 'false');
    const submitted = f.doc.querySelector('[name="benefitServiceId"]');
    assert.equal(submitted.checkValidity(), false);
    await f.settle();
    assert.equal(f.trigger().getAttribute('aria-invalid'), 'true');
    assert.equal(f.trigger().getAttribute('aria-required'), 'true');
    assert.equal(f.doc.activeElement, f.trigger());
    assert.ok(f.doc.querySelector('[role="alert"]'));
    await f.open(); f.option('Classic Facial').click(); await f.settle();
    assert.equal(submitted.checkValidity(), true);
    assert.notEqual(f.trigger().getAttribute('aria-invalid'), 'true');
  } finally { f.close(); }
});

test("optional wash service can be selected then cleared without changing serviceId payload or manual price", async () => {
  const f = await fixture(false, false); try {
    assert.equal(f.data().get('serviceId'), '');
    assert.equal(f.doc.querySelector('[name="serviceId"]').checkValidity(), true);
    await f.open(); f.option('Classic Facial').click(); await f.settle();
    assert.equal(f.data().get('serviceId'), 'a');
    await f.open(); f.option('Any wash service').click(); await f.settle();
    assert.equal(f.data().get('serviceId'), '');
    assert.equal(f.data().get('price'), '180.00');
    assert.equal(f.data().get('totalUses'), '10');
    assert.equal(f.doc.querySelector('[name="serviceId"]').checkValidity(), true);
    assert.equal(f.trigger().getAttribute('aria-expanded'), 'false');
  } finally { f.close(); }
});
