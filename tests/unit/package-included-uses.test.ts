import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

async function fixture(saved?: number) {
  const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{PackageForm}from'./src/components/package-form';
    createRoot(document.getElementById('root')).render(<PackageForm action={async()=>{throw Error('Unexpected submit')}} isSalonBusiness branches={[{id:'branch',name:'Local'}]} categories={[{id:'cat',name:'Package',status:'ACTIVE'}]} services={[{id:'a',name:'Facial',category:'Facial',price:'90.00'},{id:'b',name:'Haircut',category:'Hair',price:'45.00'}]} serviceBenefits={[{serviceId:'a',totalUses:${saved ?? 1}}]} ${saved !== undefined ? "packagePlan={{id:'p',name:'Saved package',price:'280.00',description:'',status:'ACTIVE',totalUses:5,categoryId:'cat',branchId:'branch'}}" : ""} />);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic" });
  const { JSDOM } = createRequire(import.meta.url)("jsdom");
  const dom = new JSDOM(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`, { runScripts: "dangerously", url: "http://ui.test" });
  const doc = dom.window.document;
  const settle = () => new Promise(r => setTimeout(r, 25));
  for (let i = 0; !doc.querySelector('form') && i < 100; i++) await settle();
  const input = () => doc.querySelector('[name="benefitTotalUses"]');
  const button = (label: string) => {
    const found = doc.querySelector(`button[aria-label="${label}"]`);
    assert.ok(found, `Missing quantity control: ${label}`);
    return found;
  };
  const change = async (raw: string) => {
    input().focus();
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input(), raw);
    input().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await settle();
  };
  return { dom, doc, settle, input, button, change,
    text: () => doc.querySelector('#root').textContent.replace(/\u00a0/g, ' '),
    data: () => new dom.window.FormData(doc.querySelector('form')),
    close: () => dom.window.close() };
}

test("new rows default to one; minus and plus stay within existing bounds and update reference", async () => {
  const f = await fixture(); try {
    assert.equal(f.input().value, '1');
    const minus = f.button('Decrease included uses'), plus = f.button('Increase included uses');
    assert.equal(minus.type, 'button'); assert.equal(plus.type, 'button');
    assert.equal(minus.disabled, true);
    assert.match(f.text(), /Regular valueRM\s*90.00/);
    plus.click(); await f.settle();
    assert.equal(f.input().value, '2');
    assert.match(f.text(), /Regular valueRM\s*180.00/);
    minus.click(); await f.settle();
    assert.equal(f.input().value, '1'); assert.equal(minus.disabled, true);
    f.doc.querySelector('.package-benefit-add button').click(); await f.settle();
    assert.deepEqual([...f.doc.querySelectorAll('[name="benefitTotalUses"]')].map((el: any) => el.value), ['1','1']);
    await f.change('999'); assert.equal(plus.disabled, true);
    plus.click(); await f.settle(); assert.equal(f.input().value, '999');
  } finally { f.close(); }
});

test("empty stays empty during editing, becomes an error on blur and cannot submit", async () => {
  const f = await fixture(); try {
    await f.change('');
    assert.equal(f.input().value, '');
    assert.equal(f.doc.querySelector('.package-quantity-error'), null);
    assert.match(f.text(), /Regular value unavailable/);
    f.input().blur(); await f.settle();
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    assert.ok(f.doc.querySelector('.package-quantity-error'));
    assert.equal(f.input().checkValidity(), false);
    assert.equal(f.data().get('benefitTotalUses'), '');
  } finally { f.close(); }
});

for (const raw of ['0','-1','1.5','abc','1000','']) {
  test(`included uses rejects ${JSON.stringify(raw)} at submission and exposes validation`, async () => {
    const f = await fixture(5); try {
      await f.change(raw);
      // This exercises the native submit constraint-validation path without posting.
      assert.equal(f.input().reportValidity(), false);
      let submits = 0;
      f.doc.querySelector('form').addEventListener('submit', (event: Event) => { event.preventDefault(); submits++; });
      f.doc.querySelector('form').requestSubmit();
      assert.equal(submits, 0);
      await f.settle();
      assert.equal(f.input().getAttribute('aria-invalid'), 'true');
      assert.ok(f.doc.querySelector('.package-quantity-error'));
      assert.match(f.text(), /Regular value unavailable/);
      await f.change('5');
      assert.equal(f.input().checkValidity(), true);
      assert.notEqual(f.input().getAttribute('aria-invalid'), 'true');
    } finally { f.close(); }
  });
}

test("focus selects current number, direct input and the existing payload stay intact", async () => {
  const f = await fixture(2); try {
    let selections = 0;
    f.input().addEventListener('select', () => { selections++; });
    f.input().focus(); await f.settle();
    assert.equal(selections, 1);
    await f.change('5');
    assert.equal(f.input().value, '5');
    assert.match(f.text(), /Regular valueRM\s*450.00/);
    assert.deepEqual(f.data().getAll('benefitTotalUses'), ['5']);
    assert.deepEqual(f.data().getAll('benefitServiceId'), ['a']);
    assert.equal(f.data().get('price'), '280.00');
    assert.deepEqual([...new Set(f.data().keys())].sort(), ['benefitServiceId','benefitTotalUses','branchId','categoryId','description','name','packageId','price','status']);
  } finally { f.close(); }
});

test("saved quantities are preserved; historical zero remains zero with an immediate error", async () => {
  for (const saved of [5,0]) {
    const f = await fixture(saved); try {
      assert.equal(f.input().value, String(saved));
      assert.equal(f.data().get('benefitTotalUses'), String(saved));
      if (saved === 0) {
        assert.equal(f.input().getAttribute('aria-invalid'), 'true');
        assert.ok(f.doc.querySelector('.package-quantity-error'));
        assert.equal(f.input().checkValidity(), false);
        await f.settle(); assert.equal(f.input().value, '0');
      }
    } finally { f.close(); }
  }
});
