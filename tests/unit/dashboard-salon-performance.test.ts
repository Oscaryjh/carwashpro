import assert from "node:assert/strict";
import test, { before, beforeEach, after } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactElement } from "react";

const require = createRequire(import.meta.url);
const fromDate = new Date("2026-10-01T18:00:00Z");
const toDateExclusive = new Date("2026-10-02T18:00:00Z");
type Fact = { businessId: string; branchId: string | null; status: string; [key: string]: unknown };
type Where = Record<string, unknown>;
const inWindow = new Date("2026-10-02T03:00:00Z");
const appointment = (id: string, status: string, assignedStaffId: string | null, customerId: string, extra: Partial<Fact> = {}): Fact => ({ id, businessId: "business", branchId: "a", status, assignedStaffId, customerId, scheduledAt: inWindow, ...extra });
const invoice = (id: string, amount: number, staffId: string | null, extra: Partial<Fact> = {}): Fact => ({ id, businessId: "business", branchId: "a", status: "PAID", issuedAt: inWindow, appointmentId: staffId ? "appointment" : null, workOrderId: staffId ? null : "work", appointment: staffId ? { assignedStaffId: staffId, assignedStaff: { id: staffId, name: staffId === "s1" ? "Alice" : "Bob" } } : null, items: [{ name: "Service", quantity: 1, lineTotal: amount }], total: amount, tipAmount: 0, discountAmount: 0, loyaltyDiscountAmount: 0, payments: [], ...extra });
const appointments = [
  appointment("1", "COMPLETED", "s1", "repeat"), appointment("2", "CONFIRMED", "s1", "repeat"),
  appointment("3", "ARRIVED", "s2", "new"), appointment("4", "IN_SERVICE", null, "walkin"),
  appointment("5", "CANCELLED", "s1", "repeat"), appointment("6", "NO_SHOW", "s2", "new"),
  appointment("7", "COMPLETED", "s2", "other", { branchId: "b" }),
  appointment("8", "COMPLETED", "s1", "other", { businessId: "other" }),
  appointment("9", "COMPLETED", "s1", "other", { scheduledAt: toDateExclusive }),
  appointment("10", "COMPLETED", "s1", "other", { scheduledAt: new Date(fromDate.getTime() - 1) }),
];
const invoices = [invoice("i1", 30, "s1"), invoice("i2", 20, "s1"), invoice("i3", 10, null),
  invoice("void", 900, "s1", { status: "VOID" }), invoice("direct", 5, "s1", { appointmentId: null, workOrderId: null }),
  invoice("branch", 70, "s2", { branchId: "b" }), invoice("tenant", 800, "s2", { businessId: "other" }),
  invoice("end", 600, "s1", { issuedAt: toDateExclusive }), invoice("before", 400, "s1", { issuedAt: new Date(fromDate.getTime() - 1) })];

// In-memory database boundary: production builds the filters and computes the result.
function matches(row: Fact, where: Where): boolean {
  return Object.entries(where).every(([key, rule]) => {
    if (key === "OR") return (rule as Where[]).some(part => matches(row, part));
    const value = row[key];
    if (rule !== null && typeof rule === "object") {
      const filter = rule as Record<string, unknown>;
      if ("in" in filter && !(filter.in as unknown[]).includes(value)) return false;
      if ("notIn" in filter && (filter.notIn as unknown[]).includes(value)) return false;
      if ("not" in filter && value === filter.not) return false;
      if ("gte" in filter && !(value instanceof Date && value >= (filter.gte as Date))) return false;
      if ("lt" in filter && !(value instanceof Date && value < (filter.lt as Date))) return false;
      return true;
    }
    return value === rule;
  });
}
const state = { empty: false, branchIds: ["a"], role: "BUSINESS_OWNER", denied: false, industry: "SALON_BEAUTY", pos: true, historical: false, reversed: false, group: false };
const historicalAppointments = [appointment("old", "COMPLETED", "s1", "old", { branchId: "inactive" }), appointment("null", "COMPLETED", null, "null", { branchId: null })];
const historicalInvoices = [invoice("old", 11, "s1", { branchId: "inactive" }), invoice("null", 13, null, { branchId: null })];
const db = {
  business: { findUniqueOrThrow: async () => ({ id: "business", name: "Synthetic Salon", timezone: "Asia/Singapore", businessDayCutoffTime: "02:00", industryType: state.industry }) },
  branch: { findMany: async ({ where }: { where: Where }) => {
    if (where.id === "foreign") throw new Error("invalid input syntax for type uuid");
    return ["a", "b", "inactive"].map(id => ({ id, name: id, businessId: "business", branchId: id, status: id === "inactive" ? "INACTIVE" : "ACTIVE" })).filter(row => matches(row, where));
  } },
  appointment: { groupBy: async ({ where, by }: { where: Where; by: string[] }) => {
    const grouped = new Map<unknown, number>();
    const facts = [...appointments, ...(state.historical ? historicalAppointments : [])];
    if (state.reversed) facts.reverse();
    for (const row of state.empty ? [] : facts.filter(row => matches(row, where))) grouped.set(row[by[0]], (grouped.get(row[by[0]]) ?? 0) + 1);
    return [...grouped].map(([key, count]) => ({ [by[0]]: key, _count: count }));
  } },
  invoice: { findMany: async ({ where }: { where: Where }) => state.empty ? [] : [...invoices, ...(state.historical ? historicalInvoices : [])].filter(row => matches(row, where)) },
  user: { findMany: async () => [{ id: "s1", name: "Alice" }, { id: "s2", name: "Bob" }, { id: "s3", name: "Bob" }] },
  invoiceItem: { groupBy: async () => [] }, payment: { findMany: async () => [] }, paymentRefund: { findMany: async () => [] },
};
const globals = globalThis as typeof globalThis & { __dashboardSalonTest?: { db: typeof db; state: typeof state } };
type Performance = { staffSales: { id: string; name: string; appointments: number; amount: number }[]; totalAppointments: number; completedAppointments: number; cancelledAppointments: number; noShowAppointments: number; repeatCustomers: number; statusRows: { status: string; appointments: number }[] };
type Model = { salonPerformance?: Performance | null; sales: { netSalesCents: number; transactions: number; averageTransactionValueCents: number }; dateRange: { from: string; to: string } };
let api: {
  model: (input: Record<string, unknown>) => Promise<Model>;
  report: (input: Record<string, unknown>) => Promise<Performance & { serviceSales: unknown[] }>;
  Dashboard: (props: { searchParams: Promise<Record<string, string>> }) => Promise<ReactElement>;
  Section: (props: { data: Performance | null }) => ReactElement | null;
  periods: (input: Record<string, unknown>) => { current: { fromDate: Date; toDateExclusive: Date } };
};
before(async () => {
  globals.__dashboardSalonTest = { db, state };
  const stubs: Record<string, string> = {
    "@/lib/prisma": "export const prisma=globalThis.__dashboardSalonTest.db;",
    "@/lib/modules/entitlements": "export const isBusinessModuleEnabled=async()=>false;export const loadBusinessModuleContext=async()=>({enabledModules:new Set(globalThis.__dashboardSalonTest.state.pos?['POS']:[])});",
    "@/lib/expense/service": "export const getExpenseDashboard=()=>{throw Error('unexpected expense read')};",
    "@/lib/expense/source-integration": "export const reconcileExpenseSources=()=>{throw Error('unexpected expense read')};",
    "@/lib/inventory/supplier-ap-service": "export const getAccountsPayableOverview=()=>{};export const reconcileAccountsPayable=()=>{};",
    "@/lib/inventory/service": "export const reconcileInventory=()=>{};",
    "@/lib/reports/wallet-activity": "export const readWalletActivity=async()=>undefined;",
    "@/components/wallet/wallet-financial-summary": "export const WalletFinancialSummary=()=>null;",
    "@/lib/tenant": "export const getBusinessContext=async(capability)=>{const s=globalThis.__dashboardSalonTest.state;if(s.group&&capability!=='VIEW_DASHBOARD')throw Error('CAPABILITY_REQUIRED');return {businessId:'business',isPlatformAdmin:false,user:{branchId:s.branchIds[0],role:s.role},access:{granted:true,businessId:'business',branchId:s.branchIds[0],permissions:[],source:s.group?'GROUP_ACCESS':'DIRECT_BUSINESS',effectiveBusinessRole:s.group?'GROUP_MANAGER_READ_ONLY':s.role}}};",
    "@/lib/auth/staff-permissions": "export const assertStaffPermission=(u,p)=>{if(p!=='DASHBOARD'||globalThis.__dashboardSalonTest.state.denied)throw Error('DASHBOARD denied')};",
    "next/link": "import {createElement} from 'react';export default ({children,...p})=>createElement('a',p,children);",
  };
  const source = await readFile("src/app/(business)/reports/page.tsx", "utf8");
  const section = source.slice(source.indexOf("type SalonServiceReportRow"), source.indexOf("function SalonReportSections"));
  const sharedImport = source.match(/import[^\r\n]+from ["']@\/lib\/business-performance\/salon-performance["'];/)?.[0];
  const scopeImport = source.match(/import[^\r\n]+from ["']@\/lib\/business-performance\/salon-scope["'];/)?.[0];
  const output = await build({ stdin: { contents: 'export {getBusinessPerformanceReadModel as model,resolvePerformancePeriods as periods} from "./src/lib/business-performance/read-model";export {default as Dashboard} from "./src/app/(business)/dashboard/page";export {SalonPerformanceSection as Section} from "./src/components/dashboard/salon-performance";export {getSalonReportData as report} from "test:reports";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", packages: "external", format: "cjs", jsx: "automatic", plugins: [{ name: "read-boundaries", setup(b) {
    b.onResolve({ filter: /^test:reports$/ }, () => ({ path: "reports", namespace: "report" }));
    b.onLoad({ filter: /.*/, namespace: "report" }, () => ({ contents: `import {prisma} from '@/lib/prisma';const branchWhere=id=>id?{branchId:id}:{};${sharedImport ?? ""}\n${scopeImport ?? ""}\n${section}\nexport {getSalonReportData};`, loader: "ts", resolveDir: process.cwd() }));
    b.onResolve({ filter: /.*/ }, a => stubs[a.path] ? { path: a.path, namespace: "stub" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: stubs[a.path], loader: "js", resolveDir: process.cwd() }));
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: "export default new Proxy({},{get:(_,k)=>k})", loader: "js" }));
  } }] });
  const compiled = { exports: {} };
  new Function("require", "module", "exports", output.outputFiles[0].text)(require, compiled, compiled.exports);
  api = compiled.exports as typeof api;
});
after(() => { delete globals.__dashboardSalonTest; });
beforeEach(() => { state.empty = false; state.branchIds = ["a"]; state.role = "BUSINESS_OWNER"; state.denied = false; state.industry = "SALON_BEAUTY"; state.pos = true; state.historical = false; state.reversed = false; state.group = false; });
const input = { businessId: "business", allowedBranchIds: ["a"], selectedBranchId: "a", includeBusinessWide: false, range: "custom", from: "2026-10-02", to: "2026-10-02" };
const expected: Performance = { staffSales: [{ id: "s1", name: "Alice", appointments: 2, amount: 50 }, { id: "unassigned", name: "Unassigned", appointments: 1, amount: 10 }, { id: "s2", name: "Bob", appointments: 1, amount: 0 }], totalAppointments: 6, completedAppointments: 1, cancelledAppointments: 1, noShowAppointments: 1, repeatCustomers: 1, statusRows: [{ status: "SCHEDULED", appointments: 3 }, { status: "COMPLETED", appointments: 1 }, { status: "CANCELLED", appointments: 1 }, { status: "NO_SHOW", appointments: 1 }] };
function metrics(value: Performance): Performance { return Object.fromEntries(Object.keys(expected).map(key => [key, value[key as keyof Performance]])) as Performance; }

test("Reports baseline preserves attributed invoice lines, active appointments, statuses, repeat and Unassigned", async () => {
  const report = await api.report({ businessId: "business", branchId: "a", fromDate, toDateExclusive });
  assert.deepEqual(metrics(report), expected);
  assert.deepEqual(report.serviceSales, [{ name: "Service", quantity: 3, amount: 60 }]);
});
test("Dashboard and Reports are directly equivalent for the same Business / Branch / business-day period", async () => {
  const dashboard = await api.model(input);
  const report = await api.report({ businessId: "business", branchId: "a", fromDate, toDateExclusive });
  assert.ok(dashboard.salonPerformance, "Dashboard must expose shared Salon performance");
  assert.deepEqual(metrics(dashboard.salonPerformance), metrics(report));
  assert.deepEqual(metrics(dashboard.salonPerformance), expected);
});
test("Dashboard existing financial metrics and period remain unchanged", async () => {
  const data = await api.model(input);
  assert.equal(data.sales.netSalesCents, 6500);
  assert.equal(data.sales.transactions, 4);
  assert.equal(data.sales.averageTransactionValueCents, 1625);
  assert.equal(data.dateRange.from, "2026-10-02");
  assert.equal(data.dateRange.to, "2026-10-02");
});
test("Dashboard keeps authorised branch restriction even for a tampered selected branch", async () => {
  const data = await api.model({ ...input, selectedBranchId: "b" });
  assert.ok(data.salonPerformance);
  assert.deepEqual(metrics(data.salonPerformance), expected);
  const none = await api.model({ ...input, allowedBranchIds: [] });
  assert.equal(none.salonPerformance?.totalAppointments, 0);
  assert.deepEqual(none.salonPerformance?.staffSales, []);
});
test("Multi-branch Dashboard matches Reports all-branch performance without leaking other businesses", async () => {
  const data = await api.model({ ...input, allowedBranchIds: ["a", "b"], selectedBranchId: null });
  const report = await api.report({ businessId: "business", branchId: null, fromDate, toDateExclusive });
  assert.ok(data.salonPerformance);
  assert.deepEqual(metrics(data.salonPerformance), metrics(report));
  assert.equal(data.salonPerformance.staffSales[0].amount, 70);
  assert.equal(data.salonPerformance.totalAppointments, 7);
});
test("Dashboard renders compact Performance with full columns and preserves period heading", async () => {
  state.role = "STAFF";
  const html = renderToStaticMarkup(await api.Dashboard({ searchParams: Promise.resolve({ range: "custom", from: "2026-10-02", to: "2026-10-02" }) }));
  assert.match(html, /aria-label="Performance"/);
  for (const label of ["Top Staff", "Staff", "Appointments", "Attributed Sales", "Unassigned", "Repeat visits", "Business period", "2026-10-02"]) assert.ok(html.includes(label), label);
  const section = html.split('aria-label="Performance"')[1]?.split("</section>")[0] ?? "";
  assert.doesNotMatch(section, /dashboard-kpi-card|performance-primary-kpis/);
  assert.match(section, /50\.00/);
});
test("Empty data hides Performance rather than showing zero cards", async () => {
  state.empty = true;
  const html = renderToStaticMarkup(await api.Dashboard({ searchParams: Promise.resolve({}) }));
  assert.doesNotMatch(html, /aria-label="Performance"/);
});
test("Dashboard permission remains required without requiring Reports permission", async () => {
  state.denied = true;
  await assert.rejects(api.Dashboard({ searchParams: Promise.resolve({}) }), /DASHBOARD denied/);
});
test("Salon-only addition does not change non-Salon or POS-disabled dashboards", async () => {
  state.industry = "AUTO_DETAILING";
  assert.equal((await api.model(input)).salonPerformance, null);
  state.industry = "SALON_BEAUTY"; state.pos = false;
  assert.equal((await api.model(input)).salonPerformance, null);
});

for (const range of ["today", "yesterday", "this_week", "last_week", "month", "last_month", "custom"]) {
  test(`${range} uses Dashboard's resolved period for directly equivalent Reports performance`, async () => {
    const now = new Date("2026-10-02T17:59:00Z");
    const period = api.periods({ ...input, range, now, timezone: "Asia/Singapore", businessDayCutoffTime: "02:00" });
    const dashboard = await api.model({ ...input, range, now });
    const report = await api.report({ businessId: "business", branchId: "a", ...period.current });
    assert.ok(dashboard.salonPerformance);
    assert.deepEqual(metrics(dashboard.salonPerformance), metrics(report));
  });
}
test("Top Staff renders every ranked row, including a low-value Unassigned bucket", () => {
  const staffSales = Array.from({ length: 15 }, (_, n) => ({ id: `s${n}`, name: `Staff ${n}`, appointments: 1, amount: 100 - n }));
  staffSales.push({ id: "unassigned", name: "Unassigned", appointments: 0, amount: 0.01 });
  const html = renderToStaticMarkup(createElement(api.Section, { data: { ...expected, staffSales } }));
  assert.equal((html.match(/<tr>/g) ?? []).length, 17);
  assert.ok(html.indexOf("Staff 0") < html.indexOf("Staff 14"));
  assert.ok(html.indexOf("Staff 14") < html.indexOf("Unassigned"));
  assert.match(html, /RM0\.01/);
});
test("Staff and Appointments independently hide without discarding scheduled or cancelled activity", () => {
  const zero = { ...expected, staffSales: [], totalAppointments: 0, repeatCustomers: 0, statusRows: [] };
  assert.equal(renderToStaticMarkup(createElement(api.Section, { data: zero })), "");
  const staffOnly = renderToStaticMarkup(createElement(api.Section, { data: { ...zero, staffSales: expected.staffSales } }));
  assert.match(staffOnly, /<h3>Top Staff<\/h3>/);
  assert.doesNotMatch(staffOnly, /<h3>Appointments<\/h3>/);
  const appointmentsOnly = renderToStaticMarkup(createElement(api.Section, { data: { ...expected, staffSales: [] } }));
  assert.doesNotMatch(appointmentsOnly, /Top Staff/);
  assert.match(appointmentsOnly, /3 scheduled/);
  for (const label of ["Completed", "Cancelled", "No-show", "Repeat visits"]) assert.match(appointmentsOnly, new RegExp(`<dt>${label}</dt><dd>1</dd>`));
});

const ownerAccess = { granted: true, businessId: "business", source: "DIRECT_BUSINESS", effectiveBusinessRole: "BUSINESS_OWNER", branchId: "a", permissions: [] };
for (const scenario of [
  { name: "Owner all history", access: ownerAccess, branch: undefined, amount: 154, count: 9 },
  { name: "Group Manager authorized business", access: { ...ownerAccess, source: "GROUP_ACCESS", effectiveBusinessRole: "GROUP_MANAGER_READ_ONLY" }, branch: undefined, amount: 154, count: 9 },
  { name: "Group Manager other business denied", access: { ...ownerAccess, businessId: "other", source: "GROUP_ACCESS", effectiveBusinessRole: "GROUP_MANAGER_READ_ONLY" }, branch: undefined, amount: 0, count: 0 },
  { name: "Staff own branch", access: { ...ownerAccess, effectiveBusinessRole: "STAFF" }, branch: undefined, amount: 60, count: 6 },
  { name: "Staff ALL_BRANCHES", access: { ...ownerAccess, effectiveBusinessRole: "STAFF", permissions: ["ALL_BRANCHES"] }, branch: undefined, amount: 154, count: 9 },
  { name: "explicit inactive history", access: ownerAccess, branch: "inactive", amount: 11, count: 1 },
  { name: "explicit active branch", access: ownerAccess, branch: "b", amount: 70, count: 1 },
  { name: "tampered Staff branch", access: { ...ownerAccess, effectiveBusinessRole: "STAFF" }, branch: "b", amount: 0, count: 0 },
  { name: "nonexistent explicit branch", access: ownerAccess, branch: "foreign", amount: 0, count: 0 },
  { name: "denied access", access: { granted: false }, branch: undefined, amount: 0, count: 0 },
  { name: "Staff without verified branch", access: { ...ownerAccess, effectiveBusinessRole: "STAFF", branchId: null }, branch: undefined, amount: 0, count: 0 },
  { name: "explicit blank is not all-scope", access: ownerAccess, branch: " ", amount: 0, count: 0 },
]) {
  test(`${scenario.name}: both consumers resolve the same history without changing financial or Top Services scope`, async () => {
    state.historical = true;
    const salonAccess = { access: scenario.access, requestedBranchId: scenario.branch };
    const dashboard = await api.model({ ...input, salonAccess });
    const report = await api.report({ businessId: "business", branchId: "a", fromDate, toDateExclusive, salonAccess });
    assert.ok(dashboard.salonPerformance);
    assert.deepEqual(metrics(dashboard.salonPerformance), metrics(report));
    assert.equal(report.staffSales.reduce((sum, row) => sum + row.amount, 0), scenario.amount);
    assert.equal(report.totalAppointments, scenario.count);
    assert.equal(dashboard.sales.netSalesCents, 6500);
    assert.deepEqual(report.serviceSales, [{ name: "Service", quantity: 3, amount: 60 }]);
  });
}
test("Group Manager real Dashboard entrance supplies VIEW_DASHBOARD", async () => {
  state.group = true;
  await api.Dashboard({ searchParams: Promise.resolve({ range: "custom", from: "2026-10-02", to: "2026-10-02" }) });
});
test("Dashboard All authorised branches GET form empty value preserves all-history Performance", async () => {
  state.historical = true;
  const dates = { range: "custom", from: "2026-10-02", to: "2026-10-02" };
  const defaultHtml = renderToStaticMarkup(await api.Dashboard({ searchParams: Promise.resolve(dates) }));
  const formHtml = renderToStaticMarkup(await api.Dashboard({ searchParams: Promise.resolve({ ...dates, branchId: "" }) }));
  const performance = (html: string) => html.split('aria-label="Performance"')[1]?.split('</section>')[0];
  assert.ok(performance(defaultHtml));
  assert.equal(performance(formHtml), performance(defaultHtml));
});
test("equal-value staff order is independent of database arrival order", async () => {
  const period = { fromDate: new Date("2026-10-03"), toDateExclusive: new Date("2026-10-04") };
  // Appointment-only rows all have zero attribution; the resolver must sort by name/id.
  const added = [appointment("tie-z", "COMPLETED", "s3", "tie", { scheduledAt: new Date("2026-10-03T04:00Z") }), appointment("tie-b", "COMPLETED", "s2", "tie", { scheduledAt: new Date("2026-10-03T04:00Z") }), appointment("tie-a", "COMPLETED", "s1", "tie", { scheduledAt: new Date("2026-10-03T04:00Z") })];
  appointments.push(...added);
  try {
    const first = await api.report({ businessId: "business", branchId: "a", ...period });
    state.reversed = true;
    const second = await api.report({ businessId: "business", branchId: "a", ...period });
    assert.deepEqual(first.staffSales.map(row => row.id), ["s1", "s2", "s3"]);
    assert.deepEqual(first.staffSales, second.staffSales);
  } finally { appointments.splice(-added.length); }
});
