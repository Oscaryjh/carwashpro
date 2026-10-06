import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { before, beforeEach, after } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { StaffPerformanceDetail } from "../../src/lib/business-performance/staff-performance";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: new (html: string) => { window: Window & typeof globalThis } };
const staffId = "11111111-1111-4111-8111-111111111111";
const query = { range: "custom", from: "2026-10-01", to: "2026-10-31", branchId: "old" };
const fixture: StaffPerformanceDetail = {
  subject: { type: "staff", userId: staffId }, name: "Alice",
  summary: { attributedSales: 20, appointments: 3, completedAppointments: 2, customersServed: 1, servicesSold: 3 },
  invoiceCount: 21, averageAttributedInvoice: 20 / 21, serviceBreakdown: [{ serviceId: "s1", name: "Haircut", quantity: 3, amount: 25 }],
  topService: { serviceId: "s1", name: "Haircut", quantity: 3, amount: 25 }, otherAttributedItems: -5,
  activity: [{ id: "inv1", invoiceNumber: "1001", issuedAt: new Date("2026-10-01T18:00:00Z"), branchId: "old", customerName: "Customer", serviceNames: [], amount: 20 }], page: 1, pageCount: 2,
};
const emptyFixture: StaffPerformanceDetail = {
  subject: { type: "staff", userId: staffId }, name: "Alice",
  summary: { attributedSales: 0, appointments: 0, completedAppointments: 0, customersServed: 0, servicesSold: 0 },
  invoiceCount: 0, averageAttributedInvoice: null, serviceBreakdown: [], topService: null, otherAttributedItems: 0, activity: [], page: 1, pageCount: 1,
};
const state = { denied: false, invoiceAllowed: true, role: "BUSINESS_OWNER", branchId: "a", pos: true, industry: "SALON_BEAUTY", nullDetail: false, emptyDetail: false, calls: [] as string[], input: {} as Record<string, unknown> };
const globals = globalThis as typeof globalThis & { __staffUITest?: { state: typeof state; fixture: StaffPerformanceDetail; emptyFixture: StaffPerformanceDetail } };
type Query = { range?: string; from?: string; to?: string; branchId?: string };
let api: {
  Detail: (props: { data: StaffPerformanceDetail; query: Query; period: string; timezone: string; invoiceViewIds: string[] }) => ReactElement;
  Section: (props: { data: Record<string, unknown>; query: Query }) => ReactElement;
  Page: (props: { params: Promise<{ staffId: string }>; searchParams: Promise<Record<string, string>> }) => Promise<ReactElement>;
  parseStaffPerformanceSubject: (token: string) => unknown;
  staffPerformanceHref: (token: string, query: Query, page?: number) => string;
  dashboardPerformanceHref: (query: Query) => string;
};
before(async () => {
  globals.__staffUITest = { state, fixture, emptyFixture };
  const stubs: Record<string, string> = {
    "@/lib/prisma": "export const prisma={business:{findUniqueOrThrow:async()=>({timezone:'Asia/Singapore',businessDayCutoffTime:'02:00',industryType:globalThis.__staffUITest.state.industry})}};",
    "@/lib/tenant": "export async function getBusinessContext(cap){let s=globalThis.__staffUITest.state;s.calls.push(cap);if(s.denied)throw Error('DENIED');return {isPlatformAdmin:false,businessId:'biz',user:{role:s.role,branchId:s.branchId},access:{source:'DIRECT_BUSINESS',granted:true}};}",
    "@/lib/auth/staff-permissions": "export function assertStaffPermission(u,p){globalThis.__staffUITest.state.calls.push(p)}",
    "@/lib/business-groups/business-access": "export const hasBusinessCapability=(a,c)=>{globalThis.__staffUITest.state.calls.push(c);return globalThis.__staffUITest.state.invoiceAllowed};",
    "@/lib/modules/entitlements": "export const isBusinessModuleEnabled=async()=>globalThis.__staffUITest.state.pos;",
    "@/lib/business-performance/staff-performance": "export const readStaffPerformance=async(input)=>{const t=globalThis.__staffUITest;t.state.input=input;return t.state.nullDetail?null:t.state.emptyDetail?t.emptyFixture:t.fixture};",
    "@/lib/business-performance/read-model": "export const resolvePerformancePeriods=(input)=>{globalThis.__staffUITest.state.calls.push('period:'+input.range);return {current:{fromDate:new Date('2026-10-01'),toDateExclusive:new Date('2026-11-01'),fromDateValue:'2026-10-01',toDateValue:'2026-10-31'}}};",
    "next/navigation": "export function notFound(){throw Error('NOT_FOUND')}",
    "next/link": "import{createElement}from'react';export default({children,...p})=>createElement('a',p,children);",
  };
  const result = await build({ stdin: { contents: 'export {StaffPerformanceDetailView as Detail} from "./src/components/dashboard/staff-performance-detail";export {SalonPerformanceSection as Section} from "./src/components/dashboard/salon-performance";export {default as Page} from "./src/app/(business)/dashboard/staff/[staffId]/page";export * from "./src/lib/business-performance/staff-performance-navigation";', resolveDir: process.cwd() }, bundle: true, platform: "node", packages: "external", format: "cjs", write: false, jsx: "automatic", plugins: [{ name: "ui-boundaries", setup(b) {
    b.onResolve({ filter: /.*/ }, a => stubs[a.path] ? { path: a.path, namespace: "stub" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: stubs[a.path], loader: "ts", resolveDir: process.cwd() }));
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: "export default new Proxy({}, {get:(_,key)=>key});", loader: "js" }));
  } }] });
  const bundle = { exports: {} }; new Function("require", "module", "exports", result.outputFiles[0].text)(require, bundle, bundle.exports); api = bundle.exports as typeof api;
});
beforeEach(() => { Object.assign(state, { denied: false, invoiceAllowed: true, role: "BUSINESS_OWNER", branchId: "a", pos: true, industry: "SALON_BEAUTY", nullDetail: false, emptyDetail: false, calls: [], input: {} }); });
after(() => { delete globals.__staffUITest; });
const render = (data = fixture) => renderToStaticMarkup(createElement(api.Detail, { data, query, period: "2026-10-01 — 2026-10-31", timezone: "Asia/Singapore", invoiceViewIds: ["inv1"] }));
const page = (token = staffId) => api.Page({ params: Promise.resolve({ staffId: token }), searchParams: Promise.resolve({ ...query, page: "2" }) });
test("explicit subject and allowlisted navigation preserve period/branch, not unrelated parameters", () => {
  assert.deepEqual(api.parseStaffPerformanceSubject("unassigned"), { type: "unassigned" });
  assert.deepEqual(api.parseStaffPerformanceSubject(staffId), { type: "staff", userId: staffId });
  assert.equal(api.parseStaffPerformanceSubject("fake"), null);
  const href = api.staffPerformanceHref(staffId, { ...query, ignored: "secret" } as Query, 2);
  const url = new URL(href, "http://localhost"); assert.equal(url.searchParams.get("page"), "2"); assert.equal(url.searchParams.get("branchId"), "old"); assert.equal(url.searchParams.has("ignored"), false);
  assert.equal(api.dashboardPerformanceHref(query), "/dashboard?range=custom&from=2026-10-01&to=2026-10-31&branchId=old");
});
test("main staff list is exactly four columns and retains Unassigned and period View", () => {
  const html = renderToStaticMarkup(createElement(api.Section, { query, data: { staffSales: [{ id: "unassigned", name: "Unassigned", appointments: 1, amount: 2 }], totalAppointments: 0, repeatCustomers: 0, statusRows: [] } }));
  assert.equal((html.match(/<th>/g) ?? []).length, 4);
  assert.match(html, /<th>Staff<\/th><th>Appointments<\/th><th>Attributed Sales<\/th><th>View<\/th>/);
  assert.match(html, /\/dashboard\/staff\/unassigned\?range=custom/);
  assert.doesNotMatch(html, /Customers Served|Services Sold/);
});
test("detail labels, signed other items and definitions do not redefine financial metrics", () => {
  const html = render();
  for (const label of ["Staff Performance", "Attributed Sales", "Appointments", "Completed Appointments", "Customers Served", "Services Sold", "Average Attributed Invoice", "Top Service", "By quantity sold", "Service Breakdown", "Quantity Sold", "Other attributed sales", "Invoice Activity", "Sales metrics follow invoice date.", "Appointment metrics follow appointment date.", "CRM customer records"]) assert.ok(html.includes(label), label);
  assert.match(html, /-5\.00/); assert.doesNotMatch(html, /Services Performed|Net Attributed Sales|Returning Customer Rate/);
  assert.match(html, /\/invoices\/inv1/); assert.match(html, /page=2/);
  assert.match(render({ ...fixture, otherAttributedItems: 5 }), /Other attributed sales/);
  assert.doesNotMatch(render({ ...fixture, otherAttributedItems: 0 }), /Other attributed sales/);
  assert.doesNotMatch(html, /Other attributed items/);
  assert.match(render({ ...fixture, averageAttributedInvoice: null }), /Average Attributed Invoice<\/dt><dd>—/);
});
test("employee heading leads the detail and five summary values remain unchanged", () => {
  const document = new JSDOM(render()).window.document;
  assert.equal(document.querySelector("h1")?.textContent, "Alice");
  assert.ok(document.querySelector("header")?.textContent?.includes("Staff Performance · Custom"));
  assert.ok(document.querySelector("header")?.textContent?.includes("1 Oct – 31 Oct 2026"));
  const summary = document.querySelector('[aria-label="Summary"]');
  assert.deepEqual(Array.from(summary?.querySelectorAll("dt") ?? [], node => node.textContent), ["Attributed Sales", "Appointments", "Completed Appointments", "Customers Served", "Services Sold"]);
  assert.deepEqual(Array.from(summary?.querySelectorAll("dd") ?? [], node => node.textContent), ["RM20.00", "3", "2", "1", "3"]);
  assert.equal(document.querySelector('a[href="/dashboard?range=custom&from=2026-10-01&to=2026-10-31&branchId=old"]')?.textContent, "Back to Dashboard");
});

test("service quantities need not equal identified breakdown quantities and Activity retains real nameless-ID service labels", () => {
  const data = { ...fixture, summary: { ...fixture.summary, servicesSold: 10 }, otherAttributedItems: 0,
    serviceBreakdown: [{ serviceId: "s1", name: "Haircut", quantity: 9, amount: 20 }],
    activity: [{ ...fixture.activity[0], serviceNames: ["Historical Service"] }] };
  const document = new JSDOM(render(data)).window.document;
  assert.deepEqual(Array.from(document.querySelector('[aria-label="Summary"]')?.querySelectorAll("dd") ?? [], node => node.textContent), ["RM20.00", "3", "2", "1", "10"]);
  assert.ok(document.querySelector('.activity')?.textContent?.includes("Historical Service"));
  assert.doesNotMatch(document.body.textContent ?? "", /Other attributed sales|UNKNOWN_LEGACY|LEGACY_SERVICE_CANDIDATE/);
});

test("detail explanations distinguish customers, sold services and signed non-service attribution", () => {
  const document = new JSDOM(render()).window.document;
  for (const copy of ["Distinct CRM customers from completed appointments in this period.", "Quantity of service items sold; not a count of services performed.", "Includes attributed sales from products, packages, or other non-service items."]) assert.ok(document.body.textContent?.includes(copy), copy);
  const other = document.querySelector('.other')?.parentElement;
  assert.ok(other?.textContent?.includes('RM-5.00'));
  assert.doesNotMatch(other?.querySelector('.helper')?.textContent ?? '', /payment|net/i);
});

test("Activity retains all columns and permission-safe nonwrapping View with aligned amounts", () => {
  const document = new JSDOM(render()).window.document;
  const table = document.querySelector('.activity');
  assert.deepEqual(Array.from(table?.querySelectorAll('th') ?? [], node => node.textContent), ['Date', 'Invoice', 'Customer', 'Services', 'Attributed Sales', 'View']);
  assert.equal(table?.querySelector('a')?.textContent, 'View →');
  assert.ok(table?.querySelector('a')?.classList.contains('action'));
  assert.equal(table?.querySelector('a')?.getAttribute('href'), '/invoices/inv1');
  assert.equal(table?.querySelector('a')?.getAttribute('aria-label'), 'View invoice 1001');
  assert.ok(table?.querySelector('tbody td:nth-child(5)')?.classList.contains('amount'));
  const css = readFileSync('src/components/dashboard/staff-performance-detail.module.css', 'utf8');
  assert.match(css, /\.action\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.amount\s*\{[^}]*text-align:\s*right/);
  assert.match(css, /\.action\s*\{[^}]*min-height:\s*44px/);
});
test("metric definitions stay available in a disclosure collapsed by default", () => {
  const document = new JSDOM(render()).window.document;
  const disclosure = document.querySelector("details");
  assert.equal(disclosure?.querySelector("summary")?.textContent, "About these metrics");
  assert.equal(disclosure?.hasAttribute("open"), false);
  for (const explanation of ["Sales metrics follow invoice date.", "Appointment metrics follow appointment date.", "Customers Served counts distinct CRM customer records in completed appointments.", "Attributed Sales includes original eligible invoice items; refunds are not deducted; void invoices are excluded."]) assert.ok(disclosure?.textContent?.includes(explanation), explanation);
});
test("Insights is absent only when both insights are missing and retains a zero average", () => {
  assert.doesNotMatch(render({ ...fixture, averageAttributedInvoice: null, topService: null }), /aria-label="Insights"/);
  const averageOnly = new JSDOM(render({ ...fixture, averageAttributedInvoice: 0, topService: null })).window.document;
  assert.ok(averageOnly.querySelector('[aria-label="Insights"]'));
  assert.equal(averageOnly.querySelector('[aria-label="Insights"] dd')?.textContent, "RM0.00");
  assert.match(render({ ...fixture, averageAttributedInvoice: null }), /aria-label="Insights"/);
});
test("empty service breakdown hides only when no signed non-service amount needs reconciliation", () => {
  assert.doesNotMatch(render({ ...fixture, serviceBreakdown: [], otherAttributedItems: 0 }), /Service Breakdown/);
  for (const amount of [5, -5]) {
    const html = render({ ...fixture, serviceBreakdown: [], otherAttributedItems: amount });
    assert.match(html, /Service Breakdown/);
    assert.match(html, /Other attributed sales/);
    assert.match(html, amount > 0 ? /RM5\.00/ : /RM-5\.00/);
  }
});
test("zero invoice Activity retains its empty state without pagination or a zero-count footer", () => {
  const html = render({ ...fixture, activity: [], invoiceCount: 0, page: 1, pageCount: 1 });
  assert.match(html, /Invoice Activity/);
  assert.match(html, /No attributed invoices in this period\./);
  assert.doesNotMatch(html, /Invoice Activity pages|Page 1 of 1|0 invoices/);
  const document = new JSDOM(render()).window.document;
  assert.equal(document.querySelector('[aria-label="Invoice Activity pages"]')?.textContent, "Page 1 of 2 · 21 invoicesNext");
  assert.equal(document.querySelector('[aria-label="Invoice Activity pages"] a')?.getAttribute("href"), `/dashboard/staff/${staffId}?range=custom&from=2026-10-01&to=2026-10-31&branchId=old&page=2`);
});
test("route requires Dashboard capability and denies invalid/missing subjects and non-salon/POS contexts", async () => {
  state.denied = true; await assert.rejects(page(), /DENIED/); assert.deepEqual(state.calls, ["VIEW_DASHBOARD"]);
  state.denied = false; await assert.rejects(page("bad-uuid"), /NOT_FOUND/);
  state.nullDetail = true; await assert.rejects(page(), /NOT_FOUND/);
  state.nullDetail = false; state.pos = false; await assert.rejects(page(), /NOT_FOUND/);
  state.pos = true; state.industry = "OTHER"; await assert.rejects(page(), /NOT_FOUND/);
});
test("authorized zero DTO renders through the route without notFound and preserves empty-page navigation", async () => {
  state.emptyDetail = true;
  const document = new JSDOM(renderToStaticMarkup(await page())).window.document;
  assert.equal(document.querySelector("h1")?.textContent, "Alice");
  const summary = document.querySelector('[aria-label="Summary"]');
  assert.deepEqual(Array.from(summary?.querySelectorAll("dd") ?? [], node => node.textContent), ["RM0.00", "0", "0", "0", "0"]);
  assert.match(document.body.textContent ?? "", /Staff Performance · Custom|No attributed invoices in this period\./);
  assert.equal(document.querySelector('[aria-label="Insights"]'), null);
  assert.ok(!Array.from(document.querySelectorAll("h2"), node => node.textContent).includes("Service Breakdown"));
  assert.equal(document.querySelector('[aria-label="Invoice Activity pages"]'), null);
  assert.equal(document.querySelector('a[href^="/invoices/"]'), null);
  assert.equal(document.querySelector("details summary")?.textContent, "About these metrics");
  assert.equal(document.querySelector('a[href^="/dashboard?"]')?.getAttribute("href"), "/dashboard?range=custom&from=2026-10-01&to=2026-10-31&branchId=old");
});
test("fake Unassigned tokens cannot render empty detail and read-layer denial still calls notFound", async () => {
  state.emptyDetail = true;
  for (const token of ["unassigned-xxx", "unknown", "bad-uuid"]) await assert.rejects(page(token), /NOT_FOUND/);
  state.nullDetail = true;
  await assert.rejects(page(), /NOT_FOUND/);
});
test("Invoice View requires original capability AND operational branch, independent of historical access", async () => {
  assert.match(renderToStaticMarkup(await page()), /\/invoices\/inv1/);
  assert.ok(state.calls.includes("VIEW_DASHBOARD")); assert.ok(state.calls.includes("DASHBOARD")); assert.ok(state.calls.includes("VIEW_INVOICES"));
  assert.deepEqual((state.input.salonAccess as { requestedBranchId: string }).requestedBranchId, "old");
  assert.equal(state.input.page, "2");
  state.invoiceAllowed = false; assert.doesNotMatch(renderToStaticMarkup(await page()), /\/invoices\/inv1/);
  state.invoiceAllowed = true; state.role = "STAFF"; assert.doesNotMatch(renderToStaticMarkup(await page()), /\/invoices\/inv1/);
  state.branchId = "old"; assert.match(renderToStaticMarkup(await page()), /\/invoices\/inv1/);
});
