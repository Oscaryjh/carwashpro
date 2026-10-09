import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string, options?: { url: string }) => { window: Window & typeof globalThis } };
import { act, createElement } from "react";

test("Actual quantity submits existing delta/revision and resets when product or store changes", async () => {
  const cache = join(process.cwd(), "node_modules/.cache");
  await mkdir(cache, { recursive: true });
  const dir = await mkdtemp(join(cache, "inventory-adjust-ui-"));
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    const outfile = join(dir, "form.cjs");
    await build({ entryPoints: ["src/components/inventory-command-form.tsx"], outfile, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent" });
    const { InventoryCommandForm } = createRequire(import.meta.url)(outfile);
    await act(async () => root.render(createElement(InventoryCommandForm, { action: async () => {}, mode: "ADJUSTMENT", branches: [{ id: "A", name: "A" }, { id: "B", name: "B" }], products: [{ id: "P", name: "Shampoo", sku: null, stocks: [{ branchId: "A", quantity: 10, revision: 7 }, { branchId: "B", quantity: 5, revision: 9 }] }, { id: "Q", name: "Oil", sku: null, stocks: [] }] })));
    const doc = dom.window.document;
    async function select(name: string, value: string) {
      const input = doc.querySelector(`select[name="${name}"]`) as HTMLSelectElement;
      await act(async () => { input.value = value; input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    }
    await select("productId", "P"); await select("branchId", "A");
    const actual = doc.querySelector('input[aria-label="Actual quantity"]') as HTMLInputElement;
    assert.ok(actual, "User enters final actual quantity, not a signed delta");
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(actual, "8");
      actual.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    const data = new dom.window.FormData(doc.querySelector("form")!);
    assert.equal(data.get("delta"), "-2");
    assert.equal(data.get("expectedRevision"), "7");
    await select("branchId", "B");
    assert.equal(actual.value, "");
    assert.equal(new dom.window.FormData(doc.querySelector("form")!).get("expectedRevision"), "9");
    await select("productId", "Q");
    assert.equal(actual.value, "");
    assert.equal((doc.querySelector('button[type="submit"]') as HTMLButtonElement).disabled, true);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globals[key]; }
    await rm(dir, { recursive: true, force: true });
  }
});
