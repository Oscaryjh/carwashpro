import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { compileHandoffPages, handoffFixture } from "../helpers/products-inventory-handoff-fixture";
import { isValidElement, type ReactNode } from "react";

function submittingAction(node: ReactNode): (data: FormData) => Promise<void> {
  if (Array.isArray(node)) {
    for (const child of node) { try { return submittingAction(child); } catch { /* search remaining siblings */ } }
  } else if (isValidElement<{ action?: (data: FormData) => Promise<void>; children?: ReactNode }>(node)) {
    if (node.props.action) return node.props.action;
    return submittingAction(node.props.children);
  }
  throw new Error("No submitting form");
}

test("actual Add Stock page preflight rejects stale topology and foreign branch before delegate", async () => {
  const fixture = structuredClone(handoffFixture);
  fixture.branches = [fixture.branches[0]];
  try {
    const pages = await compileHandoffPages(fixture);
    const tree = await pages.AddStock({ searchParams: Promise.resolve({}) });
    const action = submittingAction(tree);
    const data = new FormData(); data.set("branchId", "a"); data.set("operationKey", "original-operation-key"); data.set("quantity", "10");
    fixture.branches.push({ id: "b", name: "New Store" });
    await assert.rejects(action(data), /changed/);
    assert.equal(fixture.writes.length, 0);
    fixture.branches.pop(); data.set("branchId", "foreign");
    await assert.rejects(action(data), /changed|access/);
    assert.equal(fixture.writes.length, 0);
    data.set("branchId", "a");
    await action(data);
    assert.deepEqual(fixture.writes, [{ action: "stockIn", fields: [...data] }]);
  } finally { delete (globalThis as Record<string, unknown>).__handoffFixture; }
});

test("single Inventory shows only current stock without Store presentation; no-location never falls back", async () => {
  const fixture = structuredClone(handoffFixture);
  fixture.branches = [fixture.branches[0]];
  fixture.products[0].stocks[0].quantity = 10;
  fixture.products[0].stocks.push({ ...fixture.products[0].stocks[0], id: "old", branchId: "old", quantity: 99, branch: { name: "Historic Store" } });
  try {
    const pages = await compileHandoffPages(fixture);
    let html = renderToStaticMarkup(await pages.Inventory({ searchParams: Promise.resolve({}) }));
    assert.doesNotMatch(html, /<th>Store<\/th>|Main Store|Historic Store|All accessible stores|Product\/store/);
    assert.match(html, /<th>Product<\/th><th>Quantity<\/th><th>Status<\/th>/);
    assert.doesNotMatch(html, />99<\/td>|href="\/inventory\/transfer"/);
    fixture.branches = [];
    html = renderToStaticMarkup(await pages.Inventory({ searchParams: Promise.resolve({}) }));
    assert.match(html, /This business does not have an operating location set up yet\./);
    assert.doesNotMatch(html, /Shampoo|<table/);
  } finally { delete (globalThis as Record<string, unknown>).__handoffFixture; }
});

test("command forms hide Store only for explicit single mode, retain branch, revision and legacy UX", async () => {
  const directory = await mkdtemp(join(process.cwd(), "node_modules/.cache/inventory-single-"));
  try {
    const outfile = join(directory, "form.cjs");
    await build({ entryPoints: ["src/components/inventory-command-form.tsx"], outfile, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent" });
    const Form = createRequire(import.meta.url)(outfile).InventoryCommandForm as ComponentType<Record<string, unknown>>;
    const base = { action: async () => {}, branches: [{ id: "A", name: "Main Store" }], products: [{ id: "P", name: "Shampoo", sku: "S1", stocks: [{ branchId: "A", quantity: 10, revision: 7 }] }], initialProductId: "P" };
    for (const mode of ["STOCK_IN", "STOCK_OUT", "ADJUSTMENT"]) {
      const html = renderToStaticMarkup(createElement(Form, { ...base, mode, outlet: { kind: "single_outlet", internalBranchId: "A" } }));
      assert.doesNotMatch(html, /Main Store|<span>Store<\/span>|Store:|select[^>]*name="branchId"/);
      assert.match(html, /name="branchId"[^>]*value="A"/);
      assert.match(html, /Current stock:.*10/);
      assert.match(html, /name="operationKey"/);
      if (mode === "ADJUSTMENT") assert.match(html, /name="expectedRevision"[^>]*value="7"/);
      const legacy = renderToStaticMarkup(createElement(Form, { ...base, mode, outlet: { kind: "legacy_multi_branch" } }));
      assert.match(legacy, /Main Store/);
    }
    for (const kind of ["no_location", "denied"]) {
      const html = renderToStaticMarkup(createElement(Form, { ...base, mode: "STOCK_IN", outlet: { kind } }));
      assert.doesNotMatch(html, /<form|name="branchId"|Shampoo/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("History hides Store only in single mode and keeps scoped historical records unchanged", async () => {
  const fixture = structuredClone(handoffFixture);
  fixture.branches = [fixture.branches[0]];
  fixture.movements.push({ ...fixture.movements[0], id: "old", branchId: "historical", quantityDelta: 99, branch: { name: "Historical Store" } });
  try {
    const pages = await compileHandoffPages(fixture);
    const html = renderToStaticMarkup(await pages.History({ searchParams: Promise.resolve({}) }));
    assert.match(html, /<th>Date<\/th><th>Product<\/th><th>Change<\/th><th>Reason<\/th><th>User<\/th>/);
    assert.doesNotMatch(html, /<th>Store<\/th>|Main Store|Historical Store|>\+99</);
    assert.match(html, /Before/); assert.match(html, /After/); assert.match(html, /Source ID/);
    assert.equal(fixture.movements[1].branchId, "historical");
    fixture.branches.push({ id: "b", name: "Second Store" });
    const legacy = renderToStaticMarkup(await pages.History({ searchParams: Promise.resolve({}) }));
    assert.match(legacy, /<th>Store<\/th>/); assert.match(legacy, /name="branchId"/);
  } finally { delete (globalThis as Record<string, unknown>).__handoffFixture; }
});
