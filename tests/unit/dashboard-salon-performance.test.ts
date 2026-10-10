import assert from "node:assert/strict";
import test, { before, beforeEach, after } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactElement } from "react";
import { salonInvoiceWhere, salonInvoiceSubjectWhere, attributedLineTotal } from "../../src/lib/business-performance/salon-attribution";

test("shared attribution preserves all non-VOID linked invoices and signed item totals", () => {
  const where = salonInvoiceWhere({ businessId: "business", branchFilter: { branchId: "a" }, fromDate, toDateExclusive });
  for (const status of ["PAID", "UNPAID", "PARTIALLY_PAID", "REFUNDED"]) {
    assert.equal(matches(invoice("linked", 4, "s1", { status }), where), true);
  }
  assert.equal(matches(invoice("void", 4, "s1", { status: "VOID" }), where), false);
  assert.equal(matches(invoice("direct", 4, "s1", { appointmentId: null, workOrderId: null }), where), false);
  assert.equal(matches(invoice("work", 4, null), where), true);
  assert.deepEqual(salonInvoiceSubjectWhere({ type: "unassigned" }), { OR: [{ appointment: null }, { appointment: { is: { assignedStaffId: null } } }] });
  assert.deepEqual(salonInvoiceSubjectWhere({ type: "staff", userId: "s1" }), { appointment: { is: { assignedStaffId: "s1" } } });
  assert.equal(attributedLineTotal([{ lineTotal: "20.00" }, { lineTotal: "5.25" }, { lineTotal: "-7.50" }]), 17.75);
});

const require = createRequire(import.meta.url);
const fromDate = new Date("2026-10-01T18:00:00Z");
const toDateExclusive = new Date("2026-10-02T18:00:00Z");
type Fact = { businessId: string; branchId: string | null; status: string; [key: string]: unknown };
type Where = Record<string, unknown>;
const inWindow = new Date("2026-10-02T03:00:00Z");
const appointment = (id: string, status: string, assignedStaffId: string | null, customerId: string, extra: Partial<Fact> = {}): Fact => ({ id, businessId: "business", branchId: "a", status, assignedStaffId, customerId, scheduledAt: inWindow, ...extra });
const invoice = (id: string, amount: number, staffId: string | null, extra: Partial<Fact> = {}): Fact => ({ id, businessId: "business", branchId: "a", status: "PAID", issuedAt: inWindow, appointmentId: staffId ? "appointment" : null, workOrderId: staffId ? null : "work", appointment: staffId ? { assignedStaffId: staffId, assignedStaff: { id: staffId, name: staffId === "s1" ? "Alice" : "Bob" } } : null, items: [{ kind: null, serviceId: "service", productId: null, name: "Service", quantity: 1, lineTotal: amount }], total: amount, tipAmount: 0, discountAmount: 0, loyaltyDiscountAmount: 0, payments: [], ...extra });
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
function matches(row: Where, where: Where): boolean {
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
  invoiceItem: { groupBy: async ({ where, by }: { where: Where; by: string[] }) => {
    if (!by.includes("kind")) return []; // Existing Top Products fixture remains unchanged.
    const groups = new Map<string, Where & { _sum: { quantity: number; lineTotal: number } }>();
    for (const fact of state.empty ? [] : [...invoices, ...(state.historical ? historicalInvoices : [])].filter(row => matches(row, where.invoice as Where))) {
      for (const item of fact.items as Where[]) {
        if (!matches({ businessId: fact.businessId, ...item }, Object.fromEntries(Object.entries(where).filter(([key]) => key !== "invoice")))) continue;
        const fields = Object.fromEntries(by.map(key => [key, item[key]]));
        const key = JSON.stringify(fields); const row = groups.get(key) ?? { ...fields, _sum: { quantity: 0, lineTotal: 0 } };
        row._sum.quantity += Number(item.quantity); row._sum.lineTotal += Number(item.lineTotal); groups.set(key, row);
      }
    }
    return [...groups.values()];
  } }, service: { findMany: async () => [{ id: "service", name: "Service" }, { id: "service-a", name: "A" }, { id: "service-b", name: "B" }] },
  payment: { findMany: async () => [] }, paymentRefund: { findMany: async () => [] },
};
const globals = globalThis as typeof globalThis & { __dashboardSalonTest?: { db: typeof db; state: typeof state } };
type Performance = { staffSales: { id: string; name: string; appointments: number; amount: number }[]; totalAppointments: number; completedAppointments: number; cancelledAppointments: number; noShowAppointments: number; repeatCustomers: number; statusRows: { status: string; appointments: number }[] };
type CanonicalRow = { serviceId: string; name: string; quantity: number; salesAmount: string };
type Model = { canonicalTopServices: CanonicalRow[]; topServices: { serviceId?: string; name: string; quantity: number; sales: string }[]; topProducts: unknown[]; salonPerformance?: Performance | null; sales: { netSalesCents: number; transactions: number; averageTransactionValueCents: number }; dateRange: { from: string; to: string } };
let api: {
  model: (input: Record<string, unknown>) => Promise<Model>;
  report: (input: Record<string, unknown>) => Promise<{ canonicalTopServices: CanonicalRow[]; serviceSales: unknown[] }>;
  performance: (input: { businessId: string; branchFilter: { branchId?: string }; fromDate: Date; toDateExclusive: Date }) => Promise<Performance>;
  Dashboard: (props: { searchParams: Promise<Record<string, string>> }) => Promise<ReactElement>;
  Section: (props: { data: Performance | null }) => ReactElement | null;
  periods: (input: Record<string, unknown>) => { current: { fromDate: Date; toDateExclusive: Date } };
};
before(async () => {
  globals.__dashboardSalonTest = { db, state };
  const stubs: Record<string, string> = {
    "@/lib/prisma": "export const prisma=globalThis.__dashboardSalonTest.db;",
    "@/lib/report-outlet-context": "export async function resolveReportOutletScope(input){const s=globalThis.__dashboardSalonTest.state;const branches=(await globalThis.__dashboardSalonTest.db.branch.findMany({where:{businessId:'business',status:'ACTIVE'}})).filter(b=>s.role==='BUSINESS_OWNER'||s.group||s.branchIds.includes(b.id));const explicit=Object.hasOwn(input,'explicitBranchInput')&&input.explicitBranchInput!=='';if(explicit&&!branches.some(b=>b.id===input.explicitBranchInput))return {kind:'denied'};return {kind:'ready',topologyMode:'legacy_multi_branch',access:{granted:true,businessId:'business',source:s.group?'GROUP_ACCESS':'DIRECT_BUSINESS',effectiveBusinessRole:s.group?'GROUP_MANAGER_READ_ONLY':s.role,branchId:s.branchIds[0],permissions:[]},branches,selection:explicit?{kind:'branch',branchId:input.explicitBranchInput}:{kind:'authorized_branches',branchIds:branches.map(b=>b.id)},businessScopeAllowed:s.role==='BUSINESS_OWNER'||s.group,expenseScope:{allowedBranchIds:branches.map(b=>b.id),includeBusinessWide:!explicit}}}",
    "next/navigation": "export function notFound(){throw Error('NOT_FOUND')}",
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
  const scopeImport = source.match(/import[^\r\n]+from ["']@\/lib\/business-performance\/salon-scope["'];/)?.[0];
  const canonicalImport = source.match(/import[^\r\n]+from ["']@\/lib\/business-performance\/top-services["'];/)?.[0];
  const output = await build({ stdin: { contents: 'export {getBusinessPerformanceReadModel as model,resolvePerformancePeriods as periods} from "./src/lib/business-performance/read-model";export {default as Dashboard} from "./src/app/(business)/dashboard/page";export {SalonPerformanceSection as Section} from "./src/components/dashboard/salon-performance";export {readSalonPerformance as performance} from "./src/lib/business-performance/salon-performance";export {getSalonReportData as report} from "test:reports";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", packages: "external", format: "cjs", jsx: "automatic", plugins: [{ name: "read-boundaries", setup(b) {
    b.onResolve({ filter: /^test:reports$/ }, () => ({ path: "reports", namespace: "report" }));
    b.onLoad({ filter: /.*/, namespace: "report" }, () => ({ contents: `${scopeImport ?? ""}\n${canonicalImport ?? ""}\n${section}\nexport {getSalonReportData};`, loader: "ts", resolveDir: process.cwd() }));
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

test("Shared Salon reader preserves attributed invoice lines, active appointments, statuses, repeat and Unassigned", async () => {
  const performance = await api.performance({ businessId: "business", branchFilter: { branchId: "a" }, fromDate, toDateExclusive });
  const report = await api.report({ businessId: "business", branchId: "a", fromDate, toDateExclusive });
  assert.deepEqual(metrics(performance), expected);
  assert.deepEqual(report.serviceSales, []); // Missing verified access must not broaden service ranking.
});
test("Dashboard and shared Salon reader are directly equivalent for the same Business / Branch / business-day period", async () => {
  const dashboard = await api.model(input);
  const performance = await api.performance({ businessId: "business", branchFilter: { branchId: "a" }, fromDate, toDateExclusive });
  assert.ok(dashboard.salonPerformance, "Dashboard must expose shared Salon performance");
  assert.deepEqual(metrics(dashboard.salonPerformance), metrics(performance));
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
test("Multi-branch Dashboard matches shared all-branch performance without leaking other businesses", async () => {
  const data = await api.model({ ...input, allowedBranchIds: ["a", "b"], selectedBranchId: null });
  const performance = await api.performance({ businessId: "business", branchFilter: {}, fromDate, toDateExclusive });
  assert.ok(data.salonPerformance);
  assert.deepEqual(metrics(data.salonPerformance), metrics(performance));
  assert.equal(data.salonPerformance.staffSales[0].amount, 70);
  assert.equal(data.salonPerformance.totalAppointments, 7);
});
test("Dashboard renders compact Performance with full columns and preserves period heading", async () => {
  state.role = "STAFF";
  const html = renderToStaticMarkup(await api.Dashboard({ searchParams: Promise.resolve({ range: "custom", from: "2026-10-02", to: "2026-10-02" }) }));
  assert.match(html, /aria-label="Performance"/);
  for (const label of ["Top Staff", "Staff", "Appointments", "Attributed Sales", "Unassigned", "Repeat customers", "Business period", "2026-10-02"]) assert.ok(html.includes(label), label);
  const section = html.split('aria-label="Performance"')[1]?.split("</section>")[0] ?? "";
  assert.doesNotMatch(section, /dashboard-kpi-card|performance-primary-kpis/);
  assert.match(section, /50\.00/);
});
test("Empty Salon data keeps Performance discoverable without fake cards", async () => {
  state.empty = true;
  const html = renderToStaticMarkup(await api.Dashboard({ searchParams: Promise.resolve({}) }));
  assert.match(html, /aria-label="Performance"/);
  assert.match(html, /No staff activity today\./);
  assert.match(html, /href="\/dashboard\?range=month">View this month<\/a>/);
  assert.doesNotMatch(html, /<h3>Top Staff<\/h3>|<h3>Appointments<\/h3>/);
});

for (const [range, copy] of [
  ["yesterday", "No staff activity yesterday."],
  ["this_week", "No staff activity this week."],
  ["last_week", "No staff activity last week."],
  ["month", "No staff activity this month."],
  ["last_month", "No staff activity last month."],
  ["custom", "No staff activity in this period."],
  ["7days", "No staff activity in this period."],
] as const) {
  test(`${range} empty Performance uses the resolved period and avoids a self-link`, async () => {
    state.empty = true;
    const html = renderToStaticMarkup(await api.Dashboard({ searchParams: Promise.resolve({ range, from: "2026-10-01", to: "2026-10-02" }) }));
    assert.ok(html.includes(copy), copy);
    assert.equal(html.includes('>View this month</a>'), range !== "month");
  });
}

test("Empty Performance month action preserves only the authorised selected branch", async () => {
  state.empty = true;
  const params = { range: "custom", from: "2026-10-01", to: "2026-10-02", branchId: "a", page: "3", staff: "s1", unknown: "value" };
  const html = renderToStaticMarkup(await api.Dashboard({ searchParams: Promise.resolve(params) }));
  const action = html.match(/<a[^>]+href="([^"]+)"[^>]*>View this month<\/a>/)?.[1];
  assert.equal(action, "/dashboard?range=month&amp;branchId=a");
  await assert.rejects(api.Dashboard({ searchParams: Promise.resolve({ ...params, branchId: "foreign" }) }), /NOT_FOUND/);
});

test("Invalid custom dates retain the resolver's custom range semantics", async () => {
  state.empty = true;
  const html = renderToStaticMarkup(await api.Dashboard({ searchParams: Promise.resolve({ range: "custom", from: "invalid", to: "invalid" }) }));
  assert.match(html, /No staff activity in this period\./);
  assert.doesNotMatch(html, /No staff activity today\./);
});

test("Unknown range uses the resolved Today empty copy", async () => {
  state.empty = true;
  const html = renderToStaticMarkup(await api.Dashboard({ searchParams: Promise.resolve({ range: "unknown" }) }));
  assert.match(html, /No staff activity today\./);
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

test("Non-Salon and POS-disabled pages have no Performance discovery section", async () => {
  state.empty = true;
  for (const [industry, pos] of [["RETAIL", true], ["SALON_BEAUTY", false]] as const) {
    state.industry = industry; state.pos = pos;
    const html = renderToStaticMarkup(await api.Dashboard({ searchParams: Promise.resolve({}) }));
    assert.doesNotMatch(html, /aria-label="Performance"|View this month|No staff activity/);
  }
});

for (const range of ["today", "yesterday", "this_week", "last_week", "month", "last_month", "custom"]) {
  test(`${range} uses Dashboard's resolved period for directly equivalent shared performance`, async () => {
    const now = new Date("2026-10-02T17:59:00Z");
    const period = api.periods({ ...input, range, now, timezone: "Asia/Singapore", businessDayCutoffTime: "02:00" });
    const dashboard = await api.model({ ...input, range, now });
    const performance = await api.performance({ businessId: "business", branchFilter: { branchId: "a" }, ...period.current });
    assert.ok(dashboard.salonPerformance);
    assert.deepEqual(metrics(dashboard.salonPerformance), metrics(performance));
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
  const empty = renderToStaticMarkup(createElement(api.Section, { data: zero }));
  assert.match(empty, /No staff activity today\./);
  assert.doesNotMatch(empty, /<h3>Top Staff<\/h3>|<h3>Appointments<\/h3>/);
  const staffOnly = renderToStaticMarkup(createElement(api.Section, { data: { ...zero, staffSales: expected.staffSales } }));
  assert.match(staffOnly, /<h3>Top Staff<\/h3>/);
  assert.doesNotMatch(staffOnly, /<h3>Appointments<\/h3>/);
  assert.doesNotMatch(staffOnly, /No staff activity|View this month/);
  const appointmentsOnly = renderToStaticMarkup(createElement(api.Section, { data: { ...expected, staffSales: [] } }));
  assert.doesNotMatch(appointmentsOnly, /Top Staff/);
  assert.match(appointmentsOnly, /<dt>Active appointments<\/dt><dd>3<\/dd>/);
  assert.doesNotMatch(appointmentsOnly, /No staff activity|View this month/);
  for (const label of ["Completed", "Cancelled", "No-show", "Repeat customers"]) assert.match(appointmentsOnly, new RegExp(`<dt>${label}</dt><dd>1</dd>`));
});

test("Zero attribution with an appointment and real Unassigned activity are meaningful", () => {
  for (const row of [{ id: "s1", name: "Alice", appointments: 1, amount: 0 }, { id: "unassigned", name: "Unassigned", appointments: 1, amount: 0 }]) {
    const html = renderToStaticMarkup(createElement(api.Section, { data: { ...expected, staffSales: [row], totalAppointments: 0, repeatCustomers: 0, statusRows: [] } }));
    assert.match(html, /<h3>Top Staff<\/h3>/);
    assert.ok(html.includes(row.name));
    assert.match(html, /RM0\.00/);
    assert.doesNotMatch(html, /No staff activity|View this month/);
  }
});

const ownerAccess = { granted: true, businessId: "business", source: "DIRECT_BUSINESS", effectiveBusinessRole: "BUSINESS_OWNER", branchId: "a", permissions: [] };
test("Dashboard exposes complete quantity-ranked canonical services without changing finance or Products", async () => {
  const result = await api.model({ ...input, salonAccess: { access: ownerAccess, requestedBranchId: "a" } });
  assert.deepEqual(result.canonicalTopServices, [{ serviceId: "service", name: "Service", quantity: 4, salesAmount: "65.00" }]);
  assert.deepEqual(result.topServices, [{ serviceId: "service", name: "Service", quantity: 4, sales: "65.00" }]);
  assert.equal(result.sales.netSalesCents, 6500); assert.deepEqual(result.topProducts, []);
  const invalid = await api.model({ ...input, selectedBranchId: "tampered", salonAccess: { access: ownerAccess, requestedBranchId: "tampered" } });
  assert.deepEqual(invalid.canonicalTopServices, []); assert.deepEqual(invalid.topServices, []);
  assert.deepEqual((await api.model(input)).canonicalTopServices, []);
});
test("Salon Top Services excludes explicit Package/Product and retains covered Service by identity", async () => {
  const facts = invoice("mixed-kind", 650, "s1", { items: [
    { kind: "SERVICE", serviceId: "service-a", name: "A", quantity: 2, lineTotal: 200 },
    { kind: "PACKAGE_PURCHASE", serviceId: "service-a", name: "Package A", quantity: 1, lineTotal: 300 },
    { kind: "PRODUCT", productId: "product", name: "Product", quantity: 1, lineTotal: 50 },
    { kind: "SERVICE", serviceId: "service-b", customerPackageId: "package", name: "B", quantity: 1, lineTotal: 100 },
  ] });
  invoices.push(facts);
  try {
    const report = await api.report({ businessId: "business", branchId: "a", fromDate, toDateExclusive,
      salonAccess: { access: ownerAccess, requestedBranchId: "a" } });
    assert.deepEqual(report.serviceSales, [
      { serviceId: "service", name: "Service", quantity: 4, amount: 65 },
      { serviceId: "service-a", name: "A", quantity: 2, amount: 200 },
      { serviceId: "service-b", name: "B", quantity: 1, amount: 100 },
    ]);
  } finally { invoices.pop(); }
});
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
  test(`${scenario.name}: both consumers resolve the same history without changing financial scope`, async () => {
    state.historical = true;
    const salonAccess = { access: scenario.access, requestedBranchId: scenario.branch };
    const dashboard = await api.model({ ...input, salonAccess });
    const report = await api.report({ businessId: "business", branchId: "a", fromDate, toDateExclusive, salonAccess });
    assert.ok(dashboard.salonPerformance);
    assert.equal(dashboard.salonPerformance.staffSales.reduce((sum, row) => sum + row.amount, 0), scenario.amount);
    assert.equal(dashboard.salonPerformance.totalAppointments, scenario.count);
    assert.equal(dashboard.sales.netSalesCents, 6500);
    const quantity = scenario.count === 9 ? 7 : scenario.count === 6 ? 4 : scenario.count === 1 ? 1 : 0;
    const amount = scenario.amount + (scenario.count === 9 || scenario.count === 6 ? 5 : 0);
    const rows = quantity ? [{ serviceId: "service", name: "Service", quantity, salesAmount: amount.toFixed(2) }] : [];
    assert.deepEqual(report.canonicalTopServices, rows);
    assert.deepEqual(dashboard.canonicalTopServices, rows);
    assert.deepEqual(report.serviceSales, rows.map(row => ({ serviceId: row.serviceId, name: row.name, quantity: row.quantity, amount: Number(row.salesAmount) })));
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
    const first = await api.performance({ businessId: "business", branchFilter: { branchId: "a" }, ...period });
    state.reversed = true;
    const second = await api.performance({ businessId: "business", branchFilter: { branchId: "a" }, ...period });
    assert.deepEqual(first.staffSales.map(row => row.id), ["s1", "s2", "s3"]);
    assert.deepEqual(first.staffSales, second.staffSales);
  } finally { appointments.splice(-added.length); }
});
