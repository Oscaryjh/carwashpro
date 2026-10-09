import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string, options?: { url: string }) => { window: Window & typeof globalThis } };

test("Reorder pagination retains search, branch and status and filters submit without stale page", async () => {
  const cache = join(process.cwd(), "node_modules/.cache");
  await mkdir(cache, { recursive: true });
  const dir = await mkdtemp(join(cache, "reorder-page-"));
  const globals = globalThis as unknown as Record<string, unknown>;
  const calls: Array<Record<string, unknown>> = [];
  globals.__reorderPage = { read: async (input: Record<string, unknown>) => { calls.push(input); return { rows: [], total: 120, page: 2, pageSize: 50 }; } };
  try {
    const outfile = join(dir, "page.cjs");
    await build({ entryPoints: ["src/app/(business)/inventory/reorder/page.tsx"], outfile, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent", plugins: [{ name: "page-boundaries", setup(b) {
      b.onResolve({ filter: /^(next\/link|@\/lib\/auth\/business-user|@\/lib\/inventory\/(authorization|stock-count-service)|\.\.\/stock-count-actions)$/ }, args => ({ path: args.path, namespace: "page" }));
      b.onLoad({ filter: /.*/, namespace: "page" }, args => {
        const contents = args.path === "next/link" ? 'import React from "react";export default function Link(p){return React.createElement("a",p,p.children)}' : args.path.endsWith("business-user") ? 'export async function requireBusinessUserForModule(){return {businessId:"biz",user:{role:"STAFF",permissions:[]},access:{}}}' : args.path.endsWith("authorization") ? 'export async function resolveInventoryReadScope(){};export async function getInventoryReadBranches(){return [{id:"A",name:"Store A"},{id:"B",name:"Store B"}]}' : args.path.endsWith("stock-count-service") ? 'export const getReorderView=globalThis.__reorderPage.read' : 'export async function setReorderSettingsAction(){}';
        return { contents, resolveDir: process.cwd() };
      });
    } }] });
    const page = createRequire(import.meta.url)(outfile).default;
    const dom = new JSDOM(renderToStaticMarkup(await page({ searchParams: Promise.resolve({ q: "Shampoo & oil", branchId: "A", status: "low", page: "2" }) })));
    for (const [label, expectedPage] of [["Previous", "1"], ["Next", "3"]]) {
      const link = Array.from(dom.window.document.querySelectorAll("a")).find(a => a.textContent === label)!;
      const url = new URL(link.href, "http://localhost");
      assert.equal(url.searchParams.get("q"), "Shampoo & oil");
      assert.equal(url.searchParams.get("branchId"), "A");
      assert.equal(url.searchParams.get("status"), "low");
      assert.equal(url.searchParams.get("page"), expectedPage);
    }
    assert.equal(calls[0].status, "low");
    assert.deepEqual(calls[0].branchIds, ["A"]);
    assert.equal(dom.window.document.querySelector('form input[name="page"]'), null);
    dom.window.close();
  } finally {
    delete globals.__reorderPage;
    await rm(dir, { recursive: true, force: true });
  }
});

test("Reorder filters the complete authorized result before pagination and normalizes stale pages", async () => {
  const cache = join(process.cwd(), "node_modules/.cache");
  await mkdir(cache, { recursive: true });
  const dir = await mkdtemp(join(cache, "reorder-query-"));
  const products = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `Product ${i}`, sku: `SKU${i}` }));
  const stocks = products.map((p, i) => ({ productId: p.id, branchId: "A", quantity: i < 10 ? 8 : 0, reorderLevel: 2, targetStockLevel: 10, revision: 3 }));
  const database = {
    branch: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map(id => ({ id, name: id })) },
    product: { findMany: async ({ where }: { where: { OR?: unknown } }) => where.OR ? products.slice(10) : products },
    productStock: { findMany: async () => stocks },
    purchaseOrderLine: { findMany: async () => [{ productId: "p10", orderedQuantity: 5, receivedQuantity: 2, purchaseOrder: { branchId: "A" } }] },
  };
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.__reorderQueryDb = database;
  try {
    const outfile = join(dir, "reader.cjs");
    await build({ entryPoints: ["src/lib/inventory/stock-count-service.ts"], outfile, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent", plugins: [{ name: "db-boundary", setup(b) {
      b.onResolve({ filter: /^@\/lib\/(prisma|audit|modules\/entitlements|inventory\/(service|authorization))$/ }, args => ({ path: args.path, namespace: "boundary" }));
      b.onLoad({ filter: /.*/, namespace: "boundary" }, args => ({ contents: args.path.endsWith("/prisma") ? "export const prisma=globalThis.__reorderQueryDb" : "export function writeAuditLog(){};export function isBusinessModuleEnabled(){};export function applyInventoryMovement(){};export class InventoryConflictError extends Error{};export function runInventorySerializable(){};export function assertInventoryBranchWrite(){};export function assertInventoryDocumentWrite(){}" }));
    } }] });
    const { getReorderView } = createRequire(import.meta.url)(outfile);
    const input = { businessId: "business", branchIds: ["A"], pageSize: 10, status: "out" };
    const first = await getReorderView(input);
    assert.equal(first.total, 2);
    assert.deepEqual(first.rows.map((r: { productId: string }) => r.productId), ["p10", "p11"]);
    assert.equal(first.rows[0].onOrderQuantity, 3);
    assert.equal(first.rows[0].projectedStock, 3);
    assert.equal(first.rows[0].suggestedQuantity, 7);
    for (const page of [99, NaN, Infinity, -1, 1.5]) {
      const result = await getReorderView({ ...input, page });
      assert.equal(result.page, 1);
      assert.equal(result.rows.length, 2);
    }
    assert.equal((await getReorderView({ ...input, status: "low", query: "Product 1" })).total, 2);
    assert.equal((await getReorderView({ ...input, branchIds: [] })).total, 0);
    assert.equal((await getReorderView({ ...input, status: "", page: 2 })).rows.length, 2);
  } finally {
    delete globals.__reorderQueryDb;
    await rm(dir, { recursive: true, force: true });
  }
});
