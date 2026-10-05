import assert from "node:assert/strict";
import test, { before, after, beforeEach } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const wallet = () => ({ topUpPrincipalCents: 0, topUpBonusCents: 0, redemptionPaidCents: 0, redemptionBonusCents: 0, refundPaidCents: 0, refundBonusCents: 0, reversedPrincipalCents: 0, reversedBonusCents: 0, voidRestoredPaidCents: 0, voidRestoredBonusCents: 0 });
const branch = (id: string) => ({ branchId: id, branchName: id, netSalesCents: 10000, transactions: 2, averageTransactionValueCents: 5000, refundsCents: 500, recordedSpending: "20.00", incomeVsSpending: "80.00" });
function fixture() {
  return {
    scope: { businessName: "Local", branchIds: ["a"] },
    dateRange: { range: "today", from: "2026-10-05", to: "2026-10-05", timezone: "Asia/Kuching", businessDayCutoffTime: "02:00" },
    sales: { netSalesCents: 10000, transactions: 2, averageTransactionValueCents: 5000, refundsCents: 500, externalRefundsCents: 300, change: { kind: "NO_CHANGE" }, previousNetSalesCents: 10000, trend: [{ date: "2026-10-05", netSalesCents: 10000 }] },
    businessSpending: { recorded: "20.00", incomeVsRecordedSpending: "80.00", bySource: [{ sourceType: "MANUAL", count: 1, amount: "20.00" }] },
    branchPerformance: [branch("a")],
    inventory: { trackedProducts: 3, lowStock: 0, outOfStock: 0, sellingValue: "30.00" },
    accountsPayable: { totalOutstanding: "0.00", dueSoon: 0, overdue: 0, openBills: 0 },
    walletActivity: wallet(),
    coverage: { unallocatedBusinessWideSpending: "0.00", enabledModules: ["POS", "EXPENSE", "INVENTORY", "WALLET"] },
    reconciliationHealth: { status: "HEALTHY", issues: 0, domains: { sales: "CANONICAL", expense: "MATCH", inventory: "MATCH", ap: "BALANCED" } },
    salonPerformance: { staffSales: [{ id: "u", name: "Unassigned", appointments: 1, amount: 25 }], totalAppointments: 1, completedAppointments: 1, cancelledAppointments: 0, noShowAppointments: 0, repeatCustomers: 0, statusRows: [] },
    topServices: [{ name: "Service", quantity: 1, sales: "25.00" }], topProducts: [],
  };
}
let model = fixture();
const globals = globalThis as typeof globalThis & { __dashboardPresentation?: () => object };
let page: (props: { searchParams: Promise<object> }) => Promise<ReactElement>;
before(async () => {
  globals.__dashboardPresentation = () => model;
  const stubs: Record<string, string> = {
    "@/lib/business-performance/read-model": "export const getBusinessPerformanceReadModel=async()=>globalThis.__dashboardPresentation();",
    "@/lib/tenant": "export const getBusinessContext=async()=>({businessId:'local',user:{},access:{source:'DIRECT_BUSINESS'}});",
    "@/lib/auth/staff-permissions": "export const assertStaffPermission=()=>{};",
    "@/lib/expense/access": "export const resolveExpenseReadScope=async()=>({branches:[{id:'a',name:'A'}],allowedBranchIds:['a'],includeBusinessWide:true});",
    "@/lib/modules/entitlements": "export const isBusinessModuleEnabled=async()=>false;",
    "@/lib/prisma": "export const prisma={};",
    "next/link": "import {createElement} from 'react';export default ({children,...p})=>createElement('a',p,children);",
  };
  const result = await build({ entryPoints: ["src/app/(business)/dashboard/page.tsx"], bundle: true, write: false, platform: "node", packages: "external", format: "cjs", jsx: "automatic", plugins: [{ name: "presentation-boundary", setup(b) {
    b.onResolve({ filter: /.*/ }, a => stubs[a.path] ? { path: a.path, namespace: "stub" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: stubs[a.path], resolveDir: process.cwd() }));
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: "export default new Proxy({},{get:(_,k)=>k})", loader: "js" }));
  } }] });
  const compiled = { exports: {} as { default: typeof page } };
  new Function("require", "module", result.outputFiles[0].text)(require, compiled);
  page = compiled.exports.default;
});
beforeEach(() => { model = fixture(); });
after(() => { delete globals.__dashboardPresentation; });
async function documentFor() {
  const dom = new JSDOM(renderToStaticMarkup(await page({ searchParams: Promise.resolve({}) })));
  const document: Document = dom.window.document;
  return { dom, document };
}

test("primary has exactly four unchanged sales values; spending is secondary and details closed", async () => {
  const { dom, document: d } = await documentFor();
  try {
    assert.deepEqual([...d.querySelectorAll('.performance-primary-kpis .dashboard-kpi-card > span')].map(e => e.textContent), ["Net Sales", "Transactions", "Average Sale", "Refunds"]);
    assert.deepEqual([...d.querySelectorAll('.performance-primary-kpis strong')].map(e => e.textContent), ["RM 100.00", "2", "RM 50.00", "RM 5.00"]);
    const more = d.querySelector('details'); assert.ok(more); assert.equal(more.hasAttribute('open'), false);
    assert.equal(more.querySelector('summary')?.textContent, 'More details');
    assert.match(d.body.textContent!, /Operating Balance.*RM 80.00.*Not accounting profit\./s);
    assert.ok(more.textContent?.includes('COGS'));
    assert.doesNotMatch(d.body.textContent!, /Canonical|Materialized|CANONICAL|MATCH|BALANCED|Coverage|Outstanding AP/);
    assert.ok(!d.body.textContent?.includes('Branch Performance'));
    assert.ok(!d.body.textContent?.includes('Needs Attention'));
    assert.ok(!d.body.textContent?.includes('Wallet activity'));
    assert.ok(!d.body.textContent?.includes('Top Products'));
    assert.ok(more.textContent?.includes('Spending by Source'));
  } finally { dom.window.close(); }
});
test("Performance follows Trend and branch comparison has only four columns", async () => {
  model.branchPerformance.push(branch('b'));
  const { dom, document: d } = await documentFor();
  try {
    const headings = [...d.querySelectorAll('h2')].map(e => e.textContent);
    assert.equal(headings.indexOf('Performance'), headings.indexOf('Net Sales Trend') + 1);
    const table = [...d.querySelectorAll('table')].find(e => e.textContent?.includes('Operating Balance'));
    assert.ok(table);
    assert.deepEqual([...table.querySelectorAll('th')].map(e => e.textContent), ['Branch', 'Net Sales', 'Transactions', 'Operating Balance']);
    assert.match(table.textContent!, /RM 80.00/);
    assert.match(d.body.textContent!, /Unassigned/);
  } finally { dom.window.close(); }
});
const emptyBranch = (id: string) => ({ ...branch(id), netSalesCents: 0, transactions: 0, averageTransactionValueCents: 0, refundsCents: 0, recordedSpending: "0.00", incomeVsSpending: "0.00" });
for (const activeCount of [0, 1, 2]) {
  test(`two authorized branches with ${activeCount} meaningful rows only compare when both have activity`, async () => {
    model.branchPerformance = [activeCount > 0 ? branch('a') : emptyBranch('a'), activeCount > 1 ? branch('b') : emptyBranch('b')];
    const before = JSON.stringify(model);
    const { dom, document: d } = await documentFor();
    try {
      assert.equal(d.body.textContent!.includes('Branch Performance'), activeCount === 2);
      assert.equal(JSON.stringify(model), before);
    } finally { dom.window.close(); }
  });
}
test("hidden branch comparison does not hide non-zero unallocated spending", async () => {
  model.branchPerformance = [branch('a'), emptyBranch('b')];
  model.coverage.unallocatedBusinessWideSpending = '12.00';
  const { dom, document: d } = await documentFor();
  try {
    assert.ok(!d.body.textContent!.includes('Branch Performance'));
    assert.match(d.querySelector('details')!.textContent!, /Business-wide spending kept unallocated:.*RM 12.00/s);
  } finally { dom.window.close(); }
});
for (const [fact, value] of [['netSalesCents', -100], ['transactions', 1], ['incomeVsSpending', '-1.00'], ['recordedSpending', '1.00'], ['refundsCents', 100]] as const) {
  test(`${fact} alone keeps a meaningful branch; empty rows are omitted without changing facts`, async () => {
    model.branchPerformance = [branch('a'), { ...emptyBranch('b'), [fact]: value }, emptyBranch('empty')];
    const before = JSON.stringify(model);
    const { dom, document: d } = await documentFor();
    try {
      const table = [...d.querySelectorAll('table')].find(e => e.textContent?.includes('Operating Balance'));
      assert.ok(table);
      assert.deepEqual([...table.querySelectorAll('tbody tr td:first-child')].map(e => e.textContent), ['a', 'b']);
      assert.equal(JSON.stringify(model), before);
    } finally { dom.window.close(); }
  });
}
test("only actual current inventory/AP issues create attention; health warning has no technical matrix", async () => {
  model.inventory.lowStock = 3; model.inventory.outOfStock = 1;
  model.accountsPayable.dueSoon = 2; model.accountsPayable.overdue = 1;
  model.reconciliationHealth.status = 'NEEDS_REVIEW'; model.reconciliationHealth.issues = 1;
  const { dom, document: d } = await documentFor();
  try {
    const section = [...d.querySelectorAll('section')].find(e => e.querySelector('h2')?.textContent === 'Needs Attention');
    assert.ok(section); assert.match(section.textContent!, /Current/);
    for (const label of ['Low Stock', 'Out of Stock', 'Due Soon', 'Overdue', 'Some business data needs attention']) assert.ok(section.textContent?.includes(label));
    assert.doesNotMatch(section.textContent!, /CANONICAL|MATCH|BALANCED/);
  } finally { dom.window.close(); }
});
test("Wallet summary preserves principal and paid/bonus totals; ledger stays in closed details", async () => {
  Object.assign(model.walletActivity, { topUpPrincipalCents: 1000, topUpBonusCents: 200, redemptionPaidCents: 300, redemptionBonusCents: 100, refundPaidCents: 50, refundBonusCents: 25 });
  const before = JSON.stringify(model);
  const { dom, document: d } = await documentFor();
  try {
    assert.match(d.body.textContent!, /Top-ups.*RM 10.00.*Wallet used.*RM 4.00.*Wallet refunds.*RM 0.75/s);
    assert.ok(d.querySelector('details')?.textContent?.includes('Top-up principal'));
    assert.equal(JSON.stringify(model), before);
  } finally { dom.window.close(); }
});
test("reversal-only Wallet activity and unallocated business spending remain discoverable", async () => {
  model.walletActivity.voidRestoredBonusCents = 100;
  model.coverage.unallocatedBusinessWideSpending = '12.00';
  const { dom, document: d } = await documentFor();
  try {
    assert.ok(d.querySelector('details')?.textContent?.includes('Invoice void — bonus credit restored'));
    assert.match(d.body.textContent!, /Business-wide spending.*RM 12.00/s);
  } finally { dom.window.close(); }
});
