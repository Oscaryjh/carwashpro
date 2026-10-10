import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { compileHandoffPages, handoffFixture } from "../helpers/products-inventory-handoff-fixture";

test("single Product list reads only internal Branch stock, never historical inactive 99", async () => {
  const fixture = structuredClone(handoffFixture);
  fixture.branches = [{ id: "a", name: "Main Store" }];
  fixture.products[0].stocks[0].quantity = 10;
  fixture.products[0].stocks.push({ ...fixture.products[0].stocks[0], id: "historic-stock", branchId: "historic", quantity: 99, branch: { name: "Old Store" } });
  fixture.products.push({ ...structuredClone(fixture.products[0]), id: "off", name: "Untracked", trackInventory: false });
  try {
    const pages = await compileHandoffPages(fixture);
    const html = renderToStaticMarkup(await pages.Products({ searchParams: Promise.resolve({}) }));
    assert.match(html, /<th>Stock<\/th>/);
    assert.match(html, />10<\/td>/);
    assert.doesNotMatch(html, /Across stores|Total stock|>109<\/td>/);
    assert.match(html, /Not tracked/);
    assert.match(html, /Stock tracking on/);
  } finally { delete (globalThis as Record<string, unknown>).__handoffFixture; }
});

test("Product form uses explicit single mode, retains internal fields and excludes historical stock", async () => {
  const directory = await mkdtemp(join(process.cwd(), "node_modules/.cache/product-single-"));
  try {
    const outfile = join(directory, "form.cjs");
    await build({ entryPoints: ["src/components/product-form.tsx"], outfile, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent" });
    const Form = createRequire(import.meta.url)(outfile).ProductForm as ComponentType<Record<string, unknown>>;
    const base = { action: async () => {}, branches: [{ id: "A", name: "Current Store" }, { id: "historical", name: "Old Store" }], categories: [], inventoryEnabled: true, submitLabel: "Save product",
      product: { id: "P", name: "Shampoo", price: 10, status: "ACTIVE", trackInventory: true, stocks: [{ branchId: "A", quantity: 10, reorderLevel: 2 }, { branchId: "historical", quantity: 99, reorderLevel: 3 }] } };
    const render = (extra: Record<string, unknown>) => renderToStaticMarkup(createElement(Form, { ...base, ...extra }));
    const html = render({ outlet: { kind: "single_outlet", internalBranchId: "A" } });
    assert.doesNotMatch(html, /Store:|Current Store|Old Store|each store|stock_historical|reorder_historical/);
    assert.match(html, /name="stock_A"[^>]*value="10"/);
    assert.match(html, /name="reorder_A"[^>]*value="2"/);
    assert.match(html.match(/<input[^>]*name="stock_A"[^>]*>/)?.[0] ?? "", /readOnly/);
    const legacy = render({ outlet: { kind: "legacy_multi_branch" } });
    assert.match(legacy, /Store: Current Store/); assert.match(legacy, /Store: Old Store/);
    assert.match(legacy, /stock_historical/);
    for (const owner of [true, false]) {
      const empty = render({ branches: [], outlet: { kind: "no_location", owner } });
      assert.match(empty, /This business does not have an operating location set up yet\./);
      assert.match(empty, owner ? /Platform Admin/ : /business owner/);
      assert.doesNotMatch(empty, /name="stock_|name="reorder_/);
      assert.doesNotMatch(empty.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? "", /disabled/);
    }
    const denied = render({ outlet: { kind: "denied" } });
    assert.doesNotMatch(denied, /<form|stock_A|Shampoo/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
