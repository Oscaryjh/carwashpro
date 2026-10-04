import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { formatLoyaltyActivityDetails } from "../../src/components/loyalty-activity-copy";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
type ActivityRead = { where: { businessId: string; type?: string; OR?: unknown[] } };
type ActivityPages = {
  Overview: typeof import("../../src/app/(business)/loyalty/page").default;
  Activity: typeof import("../../src/app/(business)/loyalty/activity/page").default;
};
const cases = [
  ["EARN", "Wallet invoice points (v1)", "Points earned from purchase"],
  ["REDEEM", "internal checkout code v2", "Points redeemed at checkout"],
  ["REDEMPTION_REFUND", "Wallet invoice redeemed points restored (v1)", "Points restored from refund"],
  ["REFUND_REVERSAL", "Wallet invoice cumulative refund (v1)", "Points reversed after refund"],
  ["WELCOME_BONUS", "Welcome bonus", "Welcome points"],
  ["MANUAL_ADJUSTMENT", "internal reason key", "Points adjusted"],
  ["LEGACY_UNKNOWN", "Wallet invoice points (v1)", "Points activity"],
  [null, "Points earned from payment", "Points activity"],
] as const;

test("missing or unknown historical type uses neutral copy, not a guessed purchase", () => {
  for (const type of [null, undefined, "", "LEGACY_UNKNOWN", "toString", "constructor"]) {
    assert.equal(formatLoyaltyActivityDetails(type), "Points activity");
  }
});

async function fixture() {
  const rows = cases.map(([type, description], i) => ({
    id: `entry-${i}`, type: type as string | null, description, points: i === 1 ? -100 : 100,
    customerId: "customer", customer: { name: "Alice", phone: "0123456789" },
    createdAt: new Date("2026-10-03T08:33:00Z"), createdBy: { name: "Cashier A" },
  }));
  const reads: ActivityRead[] = [];
  const f = { db: {
    customerMembership: { count: async () => 1, aggregate: async () => ({ _sum: { pointsBalance: 900, lifetimePointsEarned: 1000, lifetimePointsReversed: 0 } }) },
    loyaltyTransaction: { count: async () => rows.length, findMany: async (args: ActivityRead) => { reads.push(args); return rows; } },
  } };
  const stubs: Record<string, string> = {
    "next/link": "import React from 'react';export default function Link(p){return React.createElement('a',p)}",
    "@/lib/prisma": "export const prisma=f.db;",
    "@/lib/auth/business-user": "export const requireBusinessUserForModule=async()=>({businessId:'business',user:{role:'BUSINESS_OWNER'}});",
    "@/lib/auth/staff-permissions": "export const assertStaffPermission=()=>{};",
  };
  const bundle = await build({
    stdin: { contents: "export {default as Overview} from './src/app/(business)/loyalty/page';export {default as Activity} from './src/app/(business)/loyalty/activity/page';", loader: "tsx", resolveDir: process.cwd() },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" },
    plugins: [{ name: "read-boundaries", setup(b) {
      b.onResolve({ filter: /.*/ }, a => stubs[a.path] ? { path: a.path, namespace: "fixture" } : undefined);
      b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: stubs[a.path], resolveDir: process.cwd() }));
    } }],
  });
  const activityPages = { exports: {} as ActivityPages };
  new Function("require", "module", "exports", "f", bundle.outputFiles[0].text)(require, activityPages, activityPages.exports, f);
  return { ...activityPages.exports, rows, reads };
}

for (const page of ["Overview", "Activity"] as const) {
  test(`${page} maps ledger types to business details without exposing raw descriptions or changing facts`, async () => {
    const f = await fixture();
    // A missing historical type is tested through the mapper separately; existing badge expects a string.
    f.rows[7].type = "";
    const before = structuredClone(f.rows);
    const d = new JSDOM(renderToStaticMarkup(await f[page]({ searchParams: Promise.resolve({}) }))).window.document as Document;
    const rows = [...d.querySelectorAll('.loyalty-activity-row')];
    assert.deepEqual(rows.map(r => r.querySelector('.loyalty-activity-detail > span')!.textContent), cases.map(c => c[2]));
    assert.doesNotMatch(rows.map(r => r.querySelector('.loyalty-activity-detail')!.textContent).join(' '), /\(v1\)|v2|Wallet invoice|internal reason/);
    assert.deepEqual(rows.map(r => r.querySelector('strong.points-positive, strong.points-negative')!.textContent), ["+100", "-100", "+100", "+100", "+100", "+100", "+100", "+100"]);
    for (const row of rows) {
      assert.equal(row.querySelector('.loyalty-activity-member a')!.getAttribute('href'), '/crm/customers/customer');
      if (page === 'Overview') {
        assert.equal(row.querySelector('.loyalty-activity-detail small')!.textContent, `${before[0].createdAt.toLocaleString("en-MY")} - Cashier A`);
      } else {
        const metadata = row.querySelector('.loyalty-activity-detail small')!.textContent!;
        assert.match(metadata, /^\d{1,2} [A-Za-z]{3} \d{4}, \d{1,2}:\d{2} [ap]m · Cashier A$/);
        assert.ok(metadata.startsWith(before[0].createdAt.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })));
        assert.doesNotMatch(metadata, /:\d{2}:\d{2}/);
        assert.ok(metadata.includes(before[0].createdAt.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit', hour12: true })));
      }
    }
    assert.equal(rows[0].querySelector('.loyalty-activity-type')!.textContent, 'earn');
    assert.deepEqual(f.rows, before, "render must not rewrite persisted descriptions or ledger facts");
    assert.deepEqual(f.reads, [{ where: { businessId: 'business' }, include: { customer: true, createdBy: true }, orderBy: { createdAt: 'desc' }, ...(page === 'Activity' ? { skip: 0 } : {}), take: page === 'Activity' ? 25 : 8 }]);
    if (page === 'Overview') assert.ok(d.body.textContent!.includes('900'));
  });
}

test("activity heading precedes filters with unchanged fields, action and count", async () => {
  const f = await fixture(); f.rows[7].type = "";
  const d = new JSDOM(renderToStaticMarkup(await f.Activity({ searchParams: Promise.resolve({}) }))).window.document;
  const header = d.querySelector('.point-activity-heading');
  assert.ok(header);
  assert.equal(header.querySelector('h2').textContent, 'Point activity');
  assert.equal(header.querySelector('p').textContent, 'Showing 1–8 of 8 entries.');
  assert.equal(header.nextElementSibling.tagName, 'FORM');
  const form = header.nextElementSibling;
  assert.equal(form.getAttribute('action'), '/loyalty/activity');
  assert.equal(form.querySelector('input[name="q"]').placeholder, 'Customer, phone, staff, or description');
  assert.equal(form.querySelector('[name="transactionType"] option').textContent, 'All activity types');
  assert.equal(form.querySelector('[name="range"] option').textContent, 'All dates');
  assert.equal(form.querySelector('[type="submit"]').textContent, 'Filter');
  assert.deepEqual([...d.querySelectorAll('.loyalty-activity-columns span')].map((n: Element)=>n.textContent), ['Member', 'Activity', 'Points', 'Details']);
});

test("activity empty state retains filters and does not render empty column headers", async () => {
  const f = await fixture(); f.rows.splice(0);
  const d = new JSDOM(renderToStaticMarkup(await f.Activity({ searchParams: Promise.resolve({q:' Alice ', transactionType:'EARN'}) }))).window.document;
  assert.equal(d.querySelector('.point-activity-heading p')?.textContent, 'No point activity found.');
  assert.equal(d.querySelector('.empty-state').textContent, 'No point activity matches these filters.');
  assert.equal(d.querySelector('.loyalty-activity-columns'), null);
  assert.equal(d.querySelector('[name="q"]').value, 'Alice');
  assert.equal(f.reads[0].where.type, 'EARN');
  assert.deepEqual(f.reads[0].where.OR, [
    {customer:{name:{contains:'Alice',mode:'insensitive'}}}, {customer:{phone:{contains:'Alice'}}},
    {description:{contains:'Alice',mode:'insensitive'}}, {createdBy:{name:{contains:'Alice',mode:'insensitive'}}},
  ]);
});
