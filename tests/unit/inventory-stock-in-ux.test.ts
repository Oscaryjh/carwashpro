import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { act, createElement } from "react";

test("Add Stock uses selected store quantities, integer preview and unchanged submission fields", async () => {
  const require = createRequire(import.meta.url);
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  await mkdir("node_modules/.cache", { recursive: true });
  const dir = await mkdtemp("node_modules/.cache/stock-in-ux-");
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    const outfile = join(dir, "form.cjs");
    await build({ entryPoints: ["src/components/inventory-command-form.tsx"], outfile, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent" });
    const { InventoryCommandForm } = require(join(process.cwd(), outfile));
    const branches = [{ id: "A", name: "Store A" }, { id: "B", name: "Store B" }];
    const products = [{ id: "P", name: "Shampoo", sku: "S1", stocks: [{ branchId: "A", quantity: 12, revision: 3 }, { branchId: "B", quantity: 5, revision: 9 }] }, { id: "Q", name: "Oil", sku: null, stocks: [] }];
    let submitted: FormData | undefined;
    let finish: (() => void) | undefined;
    const action = async (data: FormData) => { submitted = data; await new Promise<void>(resolve => { finish = resolve; }); };
    const doc = dom.window.document as Document;
    const button = () => doc.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const quantity = () => doc.querySelector<HTMLInputElement>('input[name="quantity"]')!;
    async function render(extra = {}) {
      await act(async () => root.render(createElement(InventoryCommandForm, { key: JSON.stringify(extra), mode: "STOCK_IN", action, branches, products, ...extra })));
    }
    async function select(name: string, value: string) {
      const el = doc.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
      await act(async () => { el.value = value; el.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    }
    async function input(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
      await act(async () => {
        const proto = el.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
        el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
    }
    await render();
    assert.equal(button().disabled, true, "Cannot submit without product/store/quantity");
    assert.match(doc.body.textContent!, /Quantity to add/);
    assert.equal(quantity().placeholder, "e.g. 10");
    const details = doc.querySelector("details")!;
    assert.equal(details.open, false);
    assert.equal(details.querySelector("summary")?.textContent, "More details");
    assert.ok(details.querySelector('input[name="reference"]'));
    assert.ok(details.querySelector("textarea"));
    await select("branchId", "A"); await select("productId", "P");
    assert.equal(doc.activeElement, quantity(), "Product selection moves focus to quantity");
    const productSelect = doc.querySelector<HTMLSelectElement>('select[name="productId"]')!;
    productSelect.focus();
    await act(async () => productSelect.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await select("productId", "Q");
    assert.equal(doc.activeElement?.getAttribute("name"), "productId", "Keyboard browsing must not steal focus from Product");
    await select("productId", "P");
    assert.equal(doc.activeElement?.getAttribute("name"), "productId", "Consecutive keyboard choices keep Product focus");
    await act(async () => productSelect.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true })));
    await select("productId", "Q");
    assert.equal(doc.activeElement, quantity(), "Pointer selection still moves focus to quantity");
    await select("productId", "P");
    assert.match(doc.body.textContent!, /Current stock:\s*12/);
    await input(quantity(), "10");
    assert.match(doc.body.textContent!, /After adding:\s*22/);
    assert.equal(button().disabled, false);
    for (const value of ["0", "-1", "1.5", ""]) {
      await input(quantity(), value);
      assert.equal(button().disabled, true, `Reject ${value}`);
      assert.doesNotMatch(doc.body.textContent!, /After adding:/);
    }
    await input(quantity(), "10"); await select("branchId", "B");
    assert.match(doc.body.textContent!, /Current stock:\s*5/);
    assert.match(doc.body.textContent!, /After adding:\s*15/);
    await select("productId", "Q");
    assert.match(doc.body.textContent!, /Current stock:\s*0/);
    assert.match(doc.body.textContent!, /After adding:\s*10/);
    const key = new dom.window.FormData(doc.querySelector("form")).get("operationKey");
    assert.match(key, /^inventory:stock_in:/);
    details.open = true;
    await input(doc.querySelector<HTMLInputElement>('input[name="reference"]')!, "Delivery 21");
    await input(doc.querySelector<HTMLTextAreaElement>("textarea")!, "Shelf refill");
    await act(async () => { doc.querySelector("form")!.requestSubmit(); });
    assert.equal(button().disabled, true);
    assert.match(button().textContent!, /Adding stock/);
    assert.equal(submitted?.get("operationKey"), key);
    assert.deepEqual(Object.fromEntries(submitted!), { operationKey: key, productId: "Q", branchId: "B", quantity: "10", reference: "Delivery 21", reason: "Stock added: Shelf refill" });
    await act(async () => finish!());
    assert.equal(button().textContent, "Add Stock");
    await render({ branches: [branches[0]], initialProductId: "P", initialBranchId: "A" });
    assert.equal(doc.querySelector('select[name="branchId"]'), null);
    assert.match(doc.body.textContent!, /Store:\s*Store A/);
    assert.match(doc.body.textContent!, /Current stock:\s*12/);
    assert.equal(new dom.window.FormData(doc.querySelector("form")).get("branchId"), "A");
    await render({ initialProductId: "foreign", initialBranchId: "foreign" });
    assert.equal(new dom.window.FormData(doc.querySelector("form")).get("productId"), "");
    assert.equal(new dom.window.FormData(doc.querySelector("form")).get("branchId"), "");
    for (const mode of ["STOCK_OUT", "ADJUSTMENT", "TRANSFER"]) {
      await render({ mode });
      assert.equal(doc.querySelector(".stock-in-form"), null, `${mode} keeps original presentation`);
      assert.doesNotMatch(doc.body.textContent!, /More details|After adding|Quantity to add/);
    }
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    await rm(dir, { recursive: true, force: true });
  }
});
