import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

async function fixture(options: { edit?: boolean; prices?: string[]; salon?: boolean } = {}) {
  const prices = options.prices ?? ["120.00", "45.00"];
  const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{PackageForm}from'./src/components/package-form';
    const props={action:async()=>{throw Error('Unexpected submit')},isSalonBusiness:${options.salon !== false},branches:[{id:'branch',name:'Local'}],services:[{id:'facial',name:'Classic Facial',category:'Facial',price:${JSON.stringify(prices[0])}},{id:'hair',name:"Men's Haircut",category:'Hair',price:${JSON.stringify(prices[1])}}],${options.edit ? "packagePlan:{id:'saved',name:'Saved package',price:'280.00',description:'',status:'ACTIVE',totalUses:4,serviceId:'facial'},serviceBenefits:[{serviceId:'facial',totalUses:2},{serviceId:'hair',totalUses:2}]," : ""}};
    window.renderPrices=(value)=>{props.services[0].price=value;render()};function render(){root.render(<PackageForm {...props}/>)};const root=createRoot(document.getElementById('root'));render();`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic" });
  const { JSDOM } = createRequire(import.meta.url)("jsdom");
  const dom = new JSDOM(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`, { runScripts: "dangerously", url: "http://ui.test" });
  const doc = dom.window.document;
  const wait = async (fn: () => boolean) => { const end = Date.now() + 4000; while (!fn()) { assert.ok(Date.now() < end, "UI did not settle"); await new Promise(r => setTimeout(r, 10)); } };
  await wait(() => !!doc.querySelector('[name="price"]'));
  const text = () => doc.querySelector('#root').textContent.replace(/\u00a0/g, " ");
  const change = async (selector: string, value: string) => {
    const el = doc.querySelector(selector);
    const proto = el.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new dom.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 20));
  };
  return { dom, doc, text, change, wait, close: () => dom.window.close() };
}

test("service options retain groups and show current prices; quantity updates reference without setting price", async () => {
  const f = await fixture(); try {
    f.doc.querySelector('[role="combobox"]').click();
    await f.wait(() => !!f.doc.querySelector('[role="option"]'));
    assert.match(f.doc.querySelector('[role="option"]').textContent.replace(/\u00a0/g, ' '), /Classic Facial.*RM\s*120.00/);
    assert.deepEqual([...f.doc.querySelectorAll('optgroup')].map((g: any) => g.label), ['Facial', 'Hair']);
    await f.change('[name="benefitServiceId"]', 'facial');
    assert.match(f.text(), /Regular valueRM\s*120.00/);
    await f.change('[name="benefitTotalUses"]', '2');
    assert.match(f.text(), /Regular valueRM\s*240.00/);
    assert.equal(f.doc.querySelector('[name="price"]').value, '');
  } finally { f.close(); }
});

test("edit retains saved price and quantities, sums services and updates savings live", async () => {
  const f = await fixture({ edit: true }); try {
    await f.wait(() => /Regular value/.test(f.text()));
    assert.equal(f.doc.querySelector('[name="price"]').value, '280.00');
    assert.deepEqual([...f.doc.querySelectorAll('[name="benefitTotalUses"]')].map((n: any) => n.value), ['2', '2']);
    assert.match(f.text(), /Regular valueRM\s*330.00/);
    assert.match(f.text(), /Customer savesRM\s*50.00/);
    await f.change('[name="price"]', '300');
    assert.match(f.text(), /Regular valueRM\s*330.00/);
    assert.match(f.text(), /Customer savesRM\s*30.00/);
    await f.change('[name="price"]', '330');
    assert.match(f.text(), /Customer savesRM\s*0.00/);
    await f.change('[name="price"]', '350');
    assert.doesNotMatch(f.text(), /Customer saves.*-/);
    assert.match(f.text(), /Package price is RM\s*20.00 above regular value/);
    assert.equal(f.doc.querySelector('[name="price"]').value, '350');
  } finally { f.close(); }
});

test("adding and removing rows recalculates reference and never adds price-reference payload fields", async () => {
  const f = await fixture(); try {
    await f.change('[name="benefitServiceId"]', 'facial');
    f.doc.querySelector('.package-benefit-add button').click();
    await f.wait(() => f.doc.querySelectorAll('[name="benefitServiceId"]').length === 2);
    await f.wait(() => /Regular value unavailable/.test(f.text()));
    assert.match(f.text(), /Regular value unavailable/);
    await f.change('.package-benefit-row:nth-child(2) [name="benefitServiceId"]', 'hair');
    assert.match(f.text(), /Regular valueRM\s*165.00/);
    f.doc.querySelector('[aria-label="Remove service 1"]').click();
    await f.wait(() => /Regular valueRM\s*45.00/.test(f.text()));
    const data = new f.dom.window.FormData(f.doc.querySelector('form'));
    assert.deepEqual(data.getAll('benefitServiceId'), ['hair']);
    assert.deepEqual(data.getAll('benefitTotalUses'), ['1']);
    assert.equal(data.get('price'), '');
    assert.deepEqual([...new Set(data.keys())].sort(), ['benefitServiceId', 'benefitTotalUses', 'branchId', 'categoryId', 'description', 'name', 'price']);
  } finally { f.close(); }
});

test("service repricing changes reference only, never the edited package price", async () => {
  const f = await fixture({ edit: true }); try {
    f.dom.window.renderPrices('150.00');
    await f.wait(() => /Regular valueRM\s*390.00/.test(f.text()));
    assert.equal(f.doc.querySelector('[name="price"]').value, '280.00');
    assert.deepEqual([...f.doc.querySelectorAll('[name="benefitTotalUses"]')].map((n: any) => n.value), ['2', '2']);
  } finally { f.close(); }
});

test("decimal service amounts use integer cents; zero is known and invalid price has no savings", async () => {
  const f = await fixture({ edit: true, prices: ['0.10', '0.20'] }); try {
    assert.match(f.text(), /Regular valueRM\s*0.60/);
    await f.change('[name="price"]', '');
    assert.doesNotMatch(f.text(), /Customer saves/);
    f.dom.window.renderPrices('0.00');
    await f.wait(() => /Regular valueRM\s*0.40/.test(f.text()));
  } finally { f.close(); }
});

test("wash package without a linked service does not invent a zero reference", async () => {
  const f = await fixture({ salon: false }); try {
    assert.match(f.text(), /Regular value unavailable/);
    await f.change('[name="serviceId"]', 'facial');
    assert.match(f.text(), /Regular valueRM\s*1,200.00/);
    assert.equal(f.doc.querySelector('[name="price"]').value, '180.00');
    await f.change('[name="totalUses"]', '2');
    assert.match(f.text(), /Regular valueRM\s*240.00/);
  } finally { f.close(); }
});

test("edit presents compact service values and a read-only price summary without duplicate labels", async () => {
  const f = await fixture({ edit: true }); try {
    const form = f.doc.querySelector('form');
    assert.ok(form.classList.contains('package-edit-form'));
    assert.deepEqual([...f.doc.querySelectorAll('.package-benefit-columns span')].map((n: any) => n.textContent), ['Service', 'Included uses', 'Value', 'Remove']);
    assert.deepEqual([...f.doc.querySelectorAll('.package-benefit-value')].map((n: any) => n.textContent.replace(/\u00a0/g, ' ')), ['RM 240.00', 'RM 90.00']);
    assert.equal(f.doc.querySelector('.package-benefits-summary'), null);
    assert.equal(f.doc.querySelector('.package-service-value'), null);
    assert.equal(f.doc.querySelectorAll('.package-service-field > .sr-only').length, 0, 'Edit removes the redundant label node so mobile CSS cannot reveal it');
    assert.match(f.doc.querySelector('.package-price-reference').textContent.replace(/\u00a0/g, ' '), /Regular valueRM 330.00Package priceRM 280.00Customer savesRM 50.00/);
    assert.equal(f.doc.querySelectorAll('[name="price"]').length, 1);
    assert.equal(f.doc.querySelector('.package-description-label small').textContent, 'Optional');
    assert.equal(f.doc.querySelector('textarea').rows, 3);
    await f.change('[name="price"]', '300');
    assert.match(f.doc.querySelector('.package-price-reference').textContent.replace(/\u00a0/g, ' '), /Package priceRM 300.00Customer savesRM 30.00/);
    const data = new f.dom.window.FormData(form);
    assert.deepEqual(data.getAll('benefitServiceId'), ['facial', 'hair']);
    assert.deepEqual(data.getAll('benefitTotalUses'), ['2', '2']);
    assert.deepEqual([...new Set(data.keys())].sort(), ['benefitServiceId', 'benefitTotalUses', 'branchId', 'categoryId', 'description', 'name', 'packageId', 'price', 'status']);
  } finally { f.close(); }
});

test("create keeps its original service reference and total uses presentation", async () => {
  const f = await fixture(); try {
    await f.change('[name="benefitServiceId"]', 'facial');
    assert.ok(f.doc.querySelector('.package-create-form'));
    assert.equal(f.doc.querySelector('.package-edit-form'), null);
    assert.match(f.doc.querySelector('.package-service-value').textContent, /× 1 =/);
    assert.match(f.doc.querySelector('.package-benefits-summary').textContent, /Total Uses: 1/);
    assert.equal(f.doc.querySelector('.package-benefit-value'), null);
  } finally { f.close(); }
});
