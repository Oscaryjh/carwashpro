import assert from "node:assert/strict";
import test, { before, after, beforeEach } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactElement } from "react";

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
    topServices: [{ serviceId: "service", name: "Service", quantity: 1, sales: "25.00" }], topProducts: [],
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

test('canonical Services with identical names render separately and use identity keys', async () => {
  model.topServices = [{ serviceId: 'service-a', name: 'Haircut', quantity: 2, sales: '20.00' }, { serviceId: 'service-b', name: 'Haircut', quantity: 1, sales: '15.00' }];
  const tree = await page({ searchParams: Promise.resolve({}) });
  function descendants(value: unknown): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(value)) return value.flatMap(descendants);
    if (!isValidElement<Record<string, unknown>>(value)) return [];
    return [value, ...descendants(value.props.children)];
  }
  const ranking = descendants(tree).find(element => typeof element.type === 'function' && element.type.name === 'Ranking' && element.props.title === 'Top Services');
  assert.ok(ranking);
  const component = ranking.type as (props: Record<string, unknown>) => ReactElement;
  const keys = descendants(component(ranking.props)).filter(element => element.type === 'li').map(element => element.key);
  assert.deepEqual(keys, ['service-a', 'service-b']);
  const { dom, document: d } = await documentFor();
  try {
    const services = [...d.querySelectorAll('section[aria-label="Performance"] li')].filter(row => row.textContent?.includes('Haircut'));
    assert.equal(services.length, 2); assert.match(services[0].textContent!, /2 sold.*20.00/); assert.match(services[1].textContent!, /1 sold.*15.00/);
  } finally { dom.window.close(); }
});

for (const range of ['today', 'yesterday', 'this_week', 'last_week', 'month', 'last_month']) {
  test(`${range} hides date inputs but preserves resolved period and Custom access`, async () => {
    model.dateRange = { ...model.dateRange, range, from: '2026-10-01', to: '2026-10-06' };
    const { dom, document: d } = await documentFor();
    try {
      assert.equal(d.querySelectorAll('input[type="date"]').length, 0);
      assert.match(d.querySelector('.performance-period')!.textContent!, /2026-10-01 — 2026-10-06.*Asia\/Kuching.*02:00/);
      assert.equal([...d.querySelectorAll('nav a')].find(e => e.textContent === 'Custom')?.getAttribute('href'), '/dashboard?range=custom');
      assert.equal(d.querySelector('input[name="range"]')?.getAttribute('value'), range);
    } finally { dom.window.close(); }
  });
}
test('Custom exposes the existing GET dates without changing the resolved DTO', async () => {
  model.dateRange = { ...model.dateRange, range: 'custom', from: '2026-10-01', to: '2026-10-06' };
  const before = JSON.stringify(model);
  const { dom, document: d } = await documentFor();
  try {
    assert.equal(d.querySelector('form')?.getAttribute('action'), '/dashboard');
    assert.equal(d.querySelector('input[name="from"]')?.getAttribute('value'), '2026-10-01');
    assert.equal(d.querySelector('input[name="to"]')?.getAttribute('value'), '2026-10-06');
    assert.equal(JSON.stringify(model), before);
  } finally { dom.window.close(); }
});
test('compact Trend keeps bar scaling, values and previous comparison; Services belongs to Performance', async () => {
  const { dom, document: d } = await documentFor();
  try {
    const trend = d.querySelector('.performance-trend');
    assert.ok(trend?.classList.contains('compactTrend'));
    assert.match(trend!.textContent!, /RM 100.00.*10-05/);
    assert.match(trend!.querySelector('.performance-trend-point > div')!.getAttribute('style')!, /130px/);
    assert.match(trend!.parentElement!.textContent!, /Previous comparable period:.*RM 100.00/);
    const performance = d.querySelector('section[aria-label="Performance"]')!;
    assert.match(performance.textContent!, /Top Services.*Service.*1 sold.*RM 25.00/);
    assert.deepEqual([...performance.querySelectorAll('th')].map(e => e.textContent), ['Staff', 'Appointments', 'Attributed Sales', 'View']);
    assert.equal(performance.querySelector('a[aria-label="View Unassigned performance"]')?.textContent, 'View →');
  } finally { dom.window.close(); }
});
test('Appointments uses DTO total, active group and preserves other statuses and repeat customer count', async () => {
  Object.assign(model.salonPerformance, { totalAppointments: 90, completedAppointments: 66, cancelledAppointments: 5, noShowAppointments: 5, repeatCustomers: 28, statusRows: [{ status: 'SCHEDULED', appointments: 13 }, { status: 'CONVERTED_TO_JOB', appointments: 1 }] });
  const { dom, document: d } = await documentFor();
  try {
    const performance = d.querySelector('section[aria-label="Performance"]')!;
    assert.match(performance.textContent!, /90 total/);
    for (const [label, value] of [['Active appointments', '13'], ['Completed', '66'], ['Cancelled', '5'], ['No-show', '5'], ['Repeat customers', '28'], ['Converted to job', '1']]) {
      const row = [...performance.querySelectorAll('dl > div')].find(e => e.querySelector('dt')?.textContent === label);
      assert.equal(row?.querySelector('dd')?.textContent, value);
    }
  } finally { dom.window.close(); }
});

test('service-only Salon activity remains grouped with the discoverable empty state', async () => {
  Object.assign(model.salonPerformance, { staffSales: [], totalAppointments: 0, completedAppointments: 0, repeatCustomers: 0 });
  const { dom, document: d } = await documentFor();
  try {
    const performance = d.querySelector('[aria-label="Performance"]')!;
    assert.match(performance.textContent!, /No staff activity today.*View this month.*Top Services.*1 sold/);
    assert.equal(performance.querySelector('table'), null);
  } finally { dom.window.close(); }
});
test('non-Salon service rankings remain available without manufacturing Salon Performance', async () => {
  Object.assign(model, { salonPerformance: null });
  const { dom, document: d } = await documentFor();
  try {
    assert.equal(d.querySelector('[aria-label="Performance"]'), null);
    assert.match(d.body.textContent!, /Top Services.*Service.*1 sold.*RM 25.00/);
  } finally { dom.window.close(); }
});

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
