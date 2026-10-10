import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string, options?: { url: string }) => { window: Window & typeof globalThis } };

test("Inventory workflow guidance overrides globally hidden header descriptions", async () => {
  const css = await readFile("src/components/inventory-hub.module.css", "utf8");
  assert.match(css, /\.workflow :global\(\.page-header\) p\s*\{[^}]*display:\s*block/);
});

test("Inventory Hub presents existing workflows according to effective capabilities", async t => {
  const cache = join(process.cwd(), "node_modules/.cache");
  await mkdir(cache, { recursive: true });
  const dir = await mkdtemp(join(cache, "inventory-hub-ui-"));
  const state = {
    access: { granted: true, source: "DIRECT_BUSINESS", identityRole: "BUSINESS_OWNER", effectiveBusinessRole: "BUSINESS_OWNER", actorRole: "BUSINESS_OWNER", permissions: [] as string[] },
    branches: [{ id: "A", name: "Store A" }],
    products: [] as Array<{ id: string; name: string; sku: string; status?: "ACTIVE" | "INACTIVE"; costPrice: number; stocks: Array<{ id: string; branchId: string; quantity: number; reorderLevel: number; branch: {name: string} }> }>,
    suppliers: [] as Array<{ id: string; name: string }>,
    movements: [] as Array<{id: string; createdAt: Date; type: string; quantityDelta: number; quantityBefore: number; quantityAfter: number; reason: string; reference: string; sourceType: string; sourceId: string; product: {name: string; sku: string}; branch: {name: string}; actor: {name: string}}>,
  };
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.__inventoryHubUI = state;
  let serial = 0;
  async function render(path: string, query = {}) {
    const outfile = join(dir, `${serial++}.cjs`);
    await build({ entryPoints: [path], outfile, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent", plugins: [{ name: "read-only-boundaries", setup(b) {
      b.onResolve({ filter: /^(next\/link|@\/lib\/(auth\/business-user|prisma|branches|outlet-ui-context|inventory\/(authorization|stock-count-service))|(?:\.\.\/)+(purchasing-actions|stock-count-actions))$/ }, args => ({ path: args.path, namespace: "boundary" }));
      b.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: "css" }));
      b.onLoad({ filter: /.*/, namespace: "css" }, () => ({ contents: 'export default new Proxy({},{get:(_,key)=>String(key)})' }));
      b.onLoad({ filter: /.*/, namespace: "boundary" }, args => {
        const ref = "globalThis.__inventoryHubUI";
        if (args.path.endsWith("/outlet-ui-context")) return { contents: `export const resolveInventoryOutletReadContext=async()=>({kind:'legacy_multi_branch',businessId:'biz',branches:${ref}.branches});export const outletBranches=c=>c.branches;export const outletPresentation=()=>({kind:'legacy_multi_branch'});`, resolveDir: process.cwd() };
        const contents = args.path.endsWith("/stock-count-service") ? 'export async function getReorderView(){return {rows:[{branchId:"A",productId:"P",productName:"Shampoo",sku:"S",onHand:0,reorderLevel:2,onOrderQuantity:0,projectedStock:0,targetStockLevel:10,suggestedQuantity:10,revision:0}],total:1,page:1,pageSize:50}}' : args.path === "next/link" ? 'import React from "react";export default function Link(p){return React.createElement("a",p,p.children)}' : args.path.endsWith("business-user") ? `export async function requireBusinessUserForModule(){return {businessId:"biz",access:${ref}.access,user:{role:${ref}.access.identityRole,permissions:${ref}.access.permissions}}}` : args.path.endsWith("/branches") ? `export async function getOperationalBranches(){return ${ref}.branches}` : args.path.endsWith("/authorization") ? `export async function resolveInventoryReadScope(){};export async function getInventoryReadBranches(){return ${ref}.branches}` : args.path.endsWith("/prisma") ? `export const prisma={product:{findMany:async()=>${ref}.products},supplier:{findMany:async()=>${ref}.suppliers,count:async()=>0},inventoryMovement:{findMany:async()=>[]},stockCountSession:{findMany:async()=>[],count:async()=>0}}` : 'export async function createSupplierAction(){};export async function createPurchaseOrderAction(){};export async function createStockCountAction(){};export async function setReorderSettingsAction(){}';
        return { contents: contents.replace('inventoryMovement:{findMany:async()=>[]}', `inventoryMovement:{findMany:async()=>${ref}.movements,count:async()=>${ref}.movements.length}`).replace('businessId:"biz",access:', 'businessId:"biz",moduleContext:{enabledModules:new Set(["POS","INVENTORY"])},access:'), resolveDir: process.cwd() };
      });
    } }] });
    const page = createRequire(import.meta.url)(outfile).default;
    return new JSDOM(renderToStaticMarkup(await page({ searchParams: Promise.resolve(query) }))).window.document;
  }
  try {
    await t.test("Owner sees three workflow actions and compact stock/purchasing/history navigation", async () => {
      const doc = await render("src/app/(business)/inventory/page.tsx");
      const actions = doc.querySelector('[aria-label="Stock actions"]')!;
      assert.deepEqual(Array.from(actions.querySelectorAll('a')).map(a => [a.textContent, a.getAttribute('href')]), [["Add Stock", "/inventory/stock-in"], ["Use / Remove", "/inventory/stock-out"], ["Quick Count", "/inventory/adjustment"]]);
      assert.match(doc.body.textContent!, /Stock History/);
      assert.equal(doc.querySelector('a[href="/inventory?view=purchasing"]')?.closest('details')?.querySelector('summary')?.textContent, "More");
      assert.equal(doc.querySelector('a[href="/inventory/transfer"]'), null, "Single store has no transfer shortcut");
      assert.doesNotMatch(doc.body.textContent!, /Retail value|Units across the selected scope/);
      assert.ok(doc.querySelector('input[name="q"]'));
      assert.ok(doc.querySelector('select[name="status"]'));
      assert.match(doc.body.textContent!, /Negative stock blocked/);
    });
    await t.test("Advanced count permission does not grant Quick Count or stock writers", async () => {
      state.access.identityRole = "STAFF"; state.access.actorRole = "STAFF"; state.access.effectiveBusinessRole = "STAFF";
      state.access.permissions = ["INVENTORY_VIEW", "STOCK_COUNTS_VIEW"];
      const doc = await render("src/app/(business)/inventory/page.tsx");
      assert.equal(doc.querySelector('a[href="/inventory/adjustment"]'), null);
      assert.equal(doc.querySelector('[aria-label="Stock actions"] a'), null);
      assert.equal(doc.querySelector('a[href="/inventory/stock-counts"]')?.textContent, "Advanced Stock Counts");
      state.access.permissions = ["INVENTORY_ADJUST"];
      const adjust = await render("src/app/(business)/inventory/page.tsx");
      assert.equal(adjust.querySelector('a[href="/inventory/adjustment"]')?.textContent, "Quick Count");
      state.access.identityRole = "BUSINESS_OWNER"; state.access.actorRole = "BUSINESS_OWNER"; state.access.effectiveBusinessRole = "BUSINESS_OWNER"; state.access.permissions = [];
    });
    await t.test("Stock table focuses on quantity and low stock links carry product/store preselection", async () => {
      state.branches = [{ id: "A", name: "Store A" }, { id: "B", name: "Store B" }];
      state.products = [{ id: "P", name: "Shampoo", sku: "SH", status: "ACTIVE", costPrice: 10, stocks: [{ id: "S", branchId: "A", quantity: 0, reorderLevel: 2, branch: { name: "Store A" } }] }];
      const doc = await render("src/app/(business)/inventory/page.tsx");
      assert.deepEqual(Array.from(doc.querySelectorAll('table thead th')).map(e => e.textContent), ["Product", "Store", "Quantity", "Status"]);
      const shortcut = doc.querySelector('a[href^="/inventory/stock-in?"]')!;
      const url = new URL(shortcut.getAttribute('href')!, 'http://localhost');
      assert.equal(url.searchParams.get('productId'), 'P');
      assert.equal(url.searchParams.get('branchId'), 'A');
      assert.ok(doc.querySelector('a[href="/inventory/transfer"]'));
      state.products = []; state.branches = [{ id: "A", name: "Store A" }];
    });
    await t.test("History preserves original evidence behind compact readable rows", async () => {
      state.movements = [{id: "M", createdAt: new Date("2026-10-09T00:00:00Z"), type: "STOCK_OUT", quantityDelta: -2, quantityBefore: 10, quantityAfter: 8, reason: "Historical free text", reference: "REF-1", sourceType: "MANUAL_COMMAND", sourceId: "operation-1", product: {name: "Shampoo", sku: "SH"}, branch: {name: "Store A"}, actor: {name: "Owner"}}];
      const doc = await render("src/app/(business)/inventory/movements/page.tsx");
      assert.deepEqual(Array.from(doc.querySelectorAll('thead th')).map(e => e.textContent), ["Date", "Product", "Store", "Change", "Reason", "User"]);
      assert.match(doc.querySelector('tbody')!.textContent!, /Stock removed/);
      assert.match(doc.querySelector('details')!.textContent!, /10[\s\S]*8[\s\S]*REF-1/);
      assert.match(doc.querySelector('tbody')!.textContent!, /Historical free text/);
      assert.doesNotMatch(doc.querySelector('tbody')!.textContent!, /Damaged|Lost/);
      assert.equal(doc.querySelector('option[value="ADJUSTMENT_IN"]')?.textContent, 'Stock corrected (increase)');
      assert.equal(doc.querySelector('option[value="ADJUSTMENT_OUT"]')?.textContent, 'Stock corrected (decrease)');
      state.movements = [];
    });
    await t.test("GM raw Owner identity has no inventory write or purchasing controls", async () => {
      state.access.source = "GROUP_ACCESS"; state.access.actorRole = "GROUP_MANAGER"; state.access.effectiveBusinessRole = "GROUP_MANAGER_READ_ONLY";
      const doc = await render("src/app/(business)/inventory/page.tsx");
      for (const path of ["stock-in", "stock-out", "adjustment", "transfer", "purchase-orders/new"]) assert.equal(doc.querySelector(`a[href="/inventory/${path}"]`), null);
      assert.doesNotMatch(doc.body.textContent!, /Receive stock/);
      state.access.source = "DIRECT_BUSINESS"; state.access.actorRole = "BUSINESS_OWNER"; state.access.effectiveBusinessRole = "BUSINESS_OWNER";
    });
    await t.test("GM raw Owner cannot see reorder writers or inaccessible count entry", async () => {
      state.access.source = "GROUP_ACCESS"; state.access.identityRole = "BUSINESS_OWNER"; state.access.actorRole = "GROUP_MANAGER"; state.access.effectiveBusinessRole = "GROUP_MANAGER_READ_ONLY";
      const doc = await render("src/app/(business)/inventory/reorder/page.tsx");
      assert.equal(doc.querySelector('input[name="operationKey"]'), null);
      assert.equal(doc.querySelector('a[href^="/inventory/purchase-orders/new"]'), null);
      assert.equal(doc.querySelector('a[href="/inventory/stock-counts"]'), null);
      state.access.source = "DIRECT_BUSINESS"; state.access.actorRole = "BUSINESS_OWNER"; state.access.effectiveBusinessRole = "BUSINESS_OWNER";
    });
    await t.test("PO setup gate hides incomplete form and shows it only after prerequisites", async () => {
      const path = "src/app/(business)/inventory/purchase-orders/new/page.tsx";
      const missing = await render(path);
      assert.match(missing.body.textContent!, /Before creating a purchase order/);
      assert.equal(missing.querySelector('input[name="operationKey"]'), null);
      state.products = [{ id: "P", name: "Shampoo", sku: "SH", costPrice: 10, stocks: [] }];
      state.suppliers = [{ id: "S", name: "Supplier" }];
      const ready = await render(path);
      assert.ok(ready.querySelector('input[name="operationKey"]'));
      assert.match(ready.body.textContent!, /another authorized user/);
    });
    await t.test("Supplier read-only hides creation form", async () => {
      state.suppliers = [];
      state.access.identityRole = "STAFF"; state.access.permissions = ["SUPPLIERS_VIEW"];
      const doc = await render("src/app/(business)/inventory/suppliers/page.tsx");
      assert.equal(doc.querySelector('input[name="operationKey"]'), null);
    });
    await t.test("Read-only inventory navigation never offers transfer or unrelated purchasing actions", async () => {
      state.access.identityRole = "STAFF";
      state.access.effectiveBusinessRole = "STAFF";
      state.access.permissions = ["INVENTORY_VIEW", "INVENTORY_TRANSFER"];
      const doc = await render("src/app/(business)/inventory/page.tsx", { view: "purchasing" });
      for (const path of ["transfer", "stock-in", "stock-out", "purchase-orders", "suppliers", "supplier-bills", "accounts-payable"]) assert.equal(doc.querySelector(`a[href="/inventory/${path}"]`), null);
      assert.ok(doc.querySelector('a[href="/inventory/reorder"]'));
      assert.equal(doc.querySelector('select[name="status"]'), null, "Purchasing is not the Stock table");
    });
    await t.test("Create-only count user cannot enter a create-and-inaccessible-detail dead end", async () => {
      state.access.identityRole = "STAFF"; state.access.permissions = ["STOCK_COUNTS_CREATE"];
      const doc = await render("src/app/(business)/inventory/stock-counts/new/page.tsx");
      assert.equal(doc.querySelector('input[name="operationKey"]'), null);
      assert.match(doc.body.textContent!, /view stock counts/i);
      state.access.permissions = ["STOCK_COUNTS_VIEW"];
      const list = await render("src/app/(business)/inventory/stock-counts/page.tsx");
      assert.equal(list.querySelector('a[href="/inventory/stock-counts/new"]'), null);
    });
  } finally { delete globals.__inventoryHubUI; await rm(dir, { recursive: true, force: true }); }
});
