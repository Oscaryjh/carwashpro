import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { getBusinessDayRange, getCurrentBusinessDateValue } from "../../src/lib/business-day";
import type { ResolvedBusinessAccess } from "../../src/lib/business-groups/business-access";
import type { TopServiceRow } from "../../src/lib/business-performance/top-services";

type Fact = Record<string, unknown>;
type Where = Record<string, unknown>;
function matches(row: Fact, where: Where): boolean {
  return Object.entries(where).every(([key, rule]) => {
    if (key === "OR") return (rule as Where[]).some(part => matches(row, part));
    const value = row[key];
    if (rule && typeof rule === "object") {
      const filter = rule as Where;
      if ("not" in filter && value === filter.not) return false;
      if ("in" in filter && !(filter.in as unknown[]).includes(value)) return false;
      if ("gte" in filter && !(value instanceof Date && value >= (filter.gte as Date))) return false;
      if ("lt" in filter && !(value instanceof Date && value < (filter.lt as Date))) return false;
      if (!["not", "in", "gte", "lt"].some(op => op in filter)) return !!value && matches(value as Fact, filter);
      return true;
    }
    return value === rule;
  });
}
const owner: ResolvedBusinessAccess = { granted: true, businessId: "business", userId: "owner", homeBusinessId: "business", branchId: "a", identityRole: "BUSINESS_OWNER", actorRole: "BUSINESS_OWNER", effectiveBusinessRole: "BUSINESS_OWNER", permissions: [], industryType: "SALON_BEAUTY", source: "DIRECT_BUSINESS", groupId: null, groupUserId: null, capability: "VIEW_DASHBOARD" };
const state = { items: [] as Fact[], industry: "SALON_BEAUTY" };
const item = (serviceId: string, quantity: number, lineTotal: number, branchId: string | null = "a", issuedAt = new Date("2026-10-06T03:00Z"), extra: Fact = {}): Fact => ({
  businessId: "business", serviceId, productId: null, name: serviceId, kind: "SERVICE", quantity, lineTotal,
  invoice: { businessId: "business", branchId, status: "UNPAID", issuedAt, appointmentId: null, workOrderId: null }, ...extra,
});
const db = {
  business: { findUniqueOrThrow: async () => ({ id: "business", name: "Salon", industryType: state.industry, timezone: "Asia/Singapore", businessDayCutoffTime: "02:00" }) },
  branch: { findMany: async ({ where }: { where: Where }) => ["a", "b", "inactive"].map(id => ({ id, name: id, businessId: "business", status: id === "inactive" ? "INACTIVE" : "ACTIVE" })).filter(row => matches(row, where)) },
  invoiceItem: { groupBy: async (args: Where) => {
    const groups = new Map<string, Fact & { _sum: { quantity: number; lineTotal: number } }>();
    for (const row of state.items.filter(row => matches(row, args.where as Where))) {
      const fields = Object.fromEntries((args.by as string[]).map(key => [key, row[key]]));
      const key = JSON.stringify(fields); const group = groups.get(key) ?? { ...fields, _sum: { quantity: 0, lineTotal: 0 } };
      group._sum.quantity += Number(row.quantity); group._sum.lineTotal += Number(row.lineTotal); groups.set(key, group);
    }
    const rows = [...groups.values()];
    // Model the unchanged legacy Top Products query, including its amount limit.
    return args.take ? rows.sort((a, b) => b._sum.lineTotal - a._sum.lineTotal).slice(0, Number(args.take)) : rows;
  } },
  service: { findMany: async () => [] },
  invoice: { findMany: async () => [] }, appointment: { groupBy: async () => [] }, user: { findMany: async () => [] },
  payment: { findMany: async () => [] }, paymentRefund: { findMany: async () => [] },
};
type Model = { canonicalTopServices: TopServiceRow[]; topServices: { serviceId?: string; name: string; quantity: number; sales: string }[]; topProducts: { name: string; quantity: number; sales: string }[]; sales: { netSalesCents: number; collectionsCents: number; refundsCents: number } };
let api: {
  model: (input: Record<string, unknown>) => Promise<Model>;
  report: (input: Record<string, unknown>) => Promise<{ canonicalTopServices: TopServiceRow[]; serviceSales: { serviceId: string; name: string; quantity: number; amount: number }[] }>;
  periods: typeof import("../../src/lib/business-performance/read-model").resolvePerformancePeriods;
  defaults: (range: string, today: string) => { defaultFrom: string; defaultTo: string };
};
const globals = globalThis as typeof globalThis & { __topServicesEquivalence?: typeof db };
before(async () => {
  globals.__topServicesEquivalence = db;
  const source = await readFile("src/app/(business)/reports/page.tsx", "utf8");
  const reader = source.slice(source.indexOf("type SalonServiceReportRow"), source.indexOf("function SalonReportSections"));
  const defaults = source.slice(source.indexOf("function getDefaultDateRange("), source.indexOf("function isDateInput("));
  const imports = ["salon-performance", "salon-scope", "top-services"].map(name => source.match(new RegExp(`import[^\\r\\n]+from ["']@/lib/business-performance/${name}["'];`))?.[0] ?? "").join("\n");
  const stubs: Record<string, string> = {
    "@/lib/prisma": "export const prisma=globalThis.__topServicesEquivalence;",
    "@/lib/modules/entitlements": "export const loadBusinessModuleContext=async()=>({enabledModules:new Set(['POS'])});",
    "@/lib/expense/service": "export const getExpenseDashboard=()=>{throw Error('unexpected expense read')};",
    "@/lib/expense/source-integration": "export const reconcileExpenseSources=()=>{};",
    "@/lib/inventory/supplier-ap-service": "export const getAccountsPayableOverview=()=>{};export const reconcileAccountsPayable=()=>{};",
    "@/lib/inventory/service": "export const reconcileInventory=()=>{};",
    "@/lib/reports/wallet-activity": "export const readWalletActivity=async()=>undefined;",
  };
  const output = await build({ stdin: { contents: 'export {getBusinessPerformanceReadModel as model,resolvePerformancePeriods as periods} from "./src/lib/business-performance/read-model";export {getSalonReportData as report,getDefaultDateRange as defaults} from "test:reports";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", packages: "external", format: "cjs", plugins: [{ name: "real-consumers", setup(b) {
    b.onResolve({ filter: /^test:reports$/ }, () => ({ path: "reports", namespace: "report" }));
    b.onLoad({ filter: /.*/, namespace: "report" }, () => ({ contents: `import {prisma} from '@/lib/prisma';import {addDaysToDateValue,startOfBusinessMonth} from '@/lib/business-time';const branchWhere=id=>id?{branchId:id}:{};${imports}\n${reader}\n${defaults}\nexport {getSalonReportData,getDefaultDateRange};`, loader: "ts", resolveDir: process.cwd() }));
    b.onResolve({ filter: /.*/ }, a => stubs[a.path] ? { path: a.path, namespace: "stub" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: stubs[a.path], loader: "js", resolveDir: process.cwd() }));
  } }] });
  const compiled = { exports: {} };
  new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  api = compiled.exports as typeof api;
});
after(() => { delete globals.__topServicesEquivalence; });
const now = new Date("2026-10-06T17:59:59Z");
const base = { businessId: "business", allowedBranchIds: ["a", "b"], includeBusinessWide: true, now };
async function consumers(access = owner, requestedBranchId?: string, range = "custom", from = "2026-10-06", to = "2026-10-06") {
  const salonAccess = { access, requestedBranchId };
  const window = api.periods({ range, from, to, now, timezone: "Asia/Singapore", businessDayCutoffTime: "02:00" }).current;
  const dashboard = await api.model({ ...base, range, from, to, selectedBranchId: requestedBranchId, salonAccess });
  const report = await api.report({ businessId: "business", branchId: requestedBranchId, fromDate: window.fromDate, toDateExclusive: window.toDateExclusive, salonAccess });
  assert.deepEqual(dashboard.canonicalTopServices, report.canonicalTopServices);
  assert.deepEqual(dashboard.topServices, report.canonicalTopServices.slice(0, 5).map(row => ({ serviceId: row.serviceId, name: row.name, quantity: row.quantity, sales: row.salesAmount })));
  assert.deepEqual(report.serviceSales, report.canonicalTopServices.slice(0, 10).map(row => ({ serviceId: row.serviceId, name: row.name, quantity: row.quantity, amount: Number(row.salesAmount) })));
  return dashboard;
}
test("real consumers expose the full canonical DTO before distinct display limits; Products and finance stay isolated", async () => {
  state.items = [...Array.from({ length: 12 }, (_, i) => item(`service-${String(i).padStart(2, "0")}`, 12 - i, i === 11 ? 900 : i + 1)),
    ...Array.from({ length: 25 }, (_, i) => item(`package-${i}`, 100, 99999, "a", undefined, { kind: "PACKAGE_PURCHASE" })),
    item("bad-reference", 7, 100000, "a", undefined, { kind: "PRODUCT", productId: "p", name: "Product" })];
  const result = await consumers();
  assert.equal(result.canonicalTopServices.length, 12);
  assert.equal(result.canonicalTopServices[0].serviceId, "service-00");
  assert.equal(result.canonicalTopServices.at(-1)?.salesAmount, "900.00");
  assert.equal(result.topServices.length, 5);
  assert.deepEqual(result.topProducts, [{ name: "Product", quantity: 7, sales: "100000.00" }]);
  assert.equal(result.sales.netSalesCents, 0); assert.equal(result.sales.refundsCents, 0);
  state.industry = "CAR_WASH";
  try {
    const nonSalon = await api.model({ ...base, range: "custom", from: "2026-10-06", to: "2026-10-06", salonAccess: { access: owner } });
    assert.deepEqual(nonSalon.canonicalTopServices, []);
    assert.equal(nonSalon.topServices[0].name, "Product"); // Legacy serviceId heuristic intentionally unchanged outside Salon.
    assert.deepEqual(nonSalon.topProducts, result.topProducts); assert.deepEqual(nonSalon.sales, result.sales);
  } finally { state.industry = "SALON_BEAUTY"; }
});
for (const range of ["today", "month", "custom"]) {
  test(`${range}: existing Reports and Dashboard resolvers share business-day cutoff and canonical invoice boundaries`, async () => {
    const today = getCurrentBusinessDateValue(now, "Asia/Singapore", "02:00");
    const defaults = api.defaults(range === "custom" ? "today" : range, today);
    const from = range === "custom" ? "2026-10-03" : defaults.defaultFrom;
    const to = range === "custom" ? "2026-10-05" : defaults.defaultTo;
    const reportWindow = getBusinessDayRange({ fromDateValue: from, toDateValue: to, timezone: "Asia/Singapore", businessDayCutoffTime: "02:00" });
    const dashboardWindow = api.periods({ range, from, to, now, timezone: "Asia/Singapore", businessDayCutoffTime: "02:00" }).current;
    assert.equal(reportWindow.fromDate.getTime(), dashboardWindow.fromDate.getTime());
    assert.equal(reportWindow.toDateExclusive.getTime(), dashboardWindow.toDateExclusive.getTime());
    state.items = [item("inclusive", 2, 0.30, "a", reportWindow.fromDate), item("last", 1, -0.10, "a", new Date(reportWindow.toDateExclusive.getTime() - 1)), item("before", 80, 800, "a", new Date(reportWindow.fromDate.getTime() - 1)), item("exclusive", 90, 900, "a", reportWindow.toDateExclusive)];
    const result = await consumers(owner, undefined, range, from, to);
    assert.deepEqual(result.canonicalTopServices, [{ serviceId: "inclusive", name: "inclusive", quantity: 2, salesAmount: "0.30" }, { serviceId: "last", name: "last", quantity: 1, salesAmount: "-0.10" }]);
  });
}
for (const scenario of [
  { name: "Owner history including null", access: owner, branch: undefined, ids: ["a", "b", "inactive", "null"] },
  { name: "authorized Group Business", access: { ...owner, source: "GROUP_ACCESS", effectiveBusinessRole: "GROUP_MANAGER_READ_ONLY" } as ResolvedBusinessAccess, branch: undefined, ids: ["a", "b", "inactive", "null"] },
  { name: "ordinary Staff excludes null", access: { ...owner, effectiveBusinessRole: "STAFF" } as ResolvedBusinessAccess, branch: undefined, ids: ["a"] },
  { name: "ALL_BRANCHES Staff", access: { ...owner, effectiveBusinessRole: "STAFF", permissions: ["ALL_BRANCHES"] } as ResolvedBusinessAccess, branch: undefined, ids: ["a", "b", "inactive", "null"] },
  { name: "inactive explicit", access: owner, branch: "inactive", ids: ["inactive"] },
  { name: "tampered explicit must not fallback", access: owner, branch: "invalid", ids: [] },
  { name: "blank explicit must not fallback", access: owner, branch: " ", ids: [] },
  { name: "Staff other branch denied", access: { ...owner, effectiveBusinessRole: "STAFF" } as ResolvedBusinessAccess, branch: "b", ids: [] },
  { name: "wrong Business denied", access: { ...owner, businessId: "other" }, branch: undefined, ids: [] },
]) test(`both consumer DTOs: ${scenario.name}`, async () => {
  state.items = [item("a", 4, 4), item("b", 3, 3, "b"), item("inactive", 2, 2, "inactive"), item("null", 1, 1, null)];
  const result = await consumers(scenario.access, scenario.branch);
  assert.deepEqual(result.canonicalTopServices.map(row => row.serviceId), scenario.ids);
});
