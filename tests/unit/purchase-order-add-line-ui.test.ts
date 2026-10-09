import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { act, createElement } from "react";
const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string) => { window: Window & typeof globalThis } };

test("PO Add line has readable scoped styling and preserves line editing and payload", async () => {
  const cache = join(process.cwd(), "node_modules/.cache");
  await mkdir(cache, { recursive: true });
  const dir = await mkdtemp(join(cache, "po-add-line-"));
  const dom = new JSDOM('<div id="root"></div>');
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    const outfile = join(dir, "form.cjs");
    await build({ entryPoints: ["src/components/purchase-order-form.tsx"], outfile, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", loader: { ".css": "local-css" }, logLevel: "silent" });
    const css = await readFile(join(dir, "form.css"), "utf8").catch(() => "");
    const style = dom.window.document.createElement("style");
    style.textContent = '.secondary-button { color: white; background: rgba(255,255,255,.1); width:100%; }' + css;
    dom.window.document.head.append(style);
    const { PurchaseOrderForm } = createRequire(import.meta.url)(outfile);
    await act(async () => root.render(createElement(PurchaseOrderForm, { action: async () => {}, operationKey: "op", expectedRevision: 3, purchaseOrderId: "po", branches: [{ id: "A", name: "Store A" }], suppliers: [{ id: "S", name: "Supplier" }], products: [{ id: "P", name: "Shampoo", sku: "SH", costPrice: 10 }] })));
    const doc = dom.window.document;
    const add = Array.from(doc.querySelectorAll("button")).find(b => b.textContent === "Add line")!;
    assert.notEqual(dom.window.getComputedStyle(add).color, "rgb(255, 255, 255)", "Add line must be readable on the white PO panel");
    assert.equal(add.type, "button", "Adding a line must not submit the PO");
    assert.equal((doc.querySelector('.danger-button') as HTMLButtonElement).disabled, true);
    await act(async () => add.click());
    assert.equal(doc.querySelectorAll('select[aria-label^="Product "]').length, 2);
    let data = new dom.window.FormData(doc.querySelector("form")!);
    assert.deepEqual(JSON.parse(String(data.get("lines"))), [{ expectedUnitCost: 10, orderedQuantity: 1, productId: "P" }, { expectedUnitCost: 10, orderedQuantity: 1, productId: "P" }]);
    await act(async () => (doc.querySelector('.danger-button') as HTMLButtonElement).click());
    data = new dom.window.FormData(doc.querySelector("form")!);
    assert.equal(JSON.parse(String(data.get("lines"))).length, 1);
    assert.equal(data.get("operationKey"), "op"); assert.equal(data.get("expectedRevision"), "3"); assert.equal(data.get("purchaseOrderId"), "po");
    assert.equal(doc.querySelectorAll('select[name="supplierId"],select[name="branchId"]').length, 2);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    await rm(dir, { recursive: true, force: true });
  }
});
