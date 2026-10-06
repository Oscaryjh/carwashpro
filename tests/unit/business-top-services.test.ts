import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import type { InvoiceItemKind } from "@prisma/client";
import type { ResolvedBusinessAccess } from "../../src/lib/business-groups/business-access";
import { resolveInvoiceItemKind } from "../../src/lib/invoice-item/classification";

type Where = Record<string, unknown>;
type Fact = Record<string, unknown>;
function matches(row: Fact, where: Where): boolean {
  return Object.entries(where).every(([key, rule]) => {
    if (key === "OR") return (rule as Where[]).some(part => matches(row, part));
    if (key === "AND") return (Array.isArray(rule) ? rule as Where[] : [rule as Where]).every(part => matches(row, part));
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
const fromDate = new Date("2026-10-01T18:00:00Z");
const toDateExclusive = new Date("2026-10-02T18:00:00Z");
const owner: ResolvedBusinessAccess = { granted: true, businessId: "business", userId: "owner", homeBusinessId: "business", branchId: "a", identityRole: "BUSINESS_OWNER", actorRole: "BUSINESS_OWNER", effectiveBusinessRole: "BUSINESS_OWNER", permissions: [], industryType: "SALON_BEAUTY", source: "DIRECT_BUSINESS", groupId: null, groupUserId: null, capability: "VIEW_DASHBOARD" };
const line = (serviceId: string | null, quantity: number, amount: string, kind: InvoiceItemKind | null = "SERVICE", extra: Fact = {}): Fact => ({ businessId: "business", kind, serviceId, productId: null, customerPackageId: null, name: serviceId ?? "Historical Service", quantity, lineTotal: amount, invoice: { businessId: "business", branchId: "a", status: "PAID", issuedAt: new Date("2026-10-02T03:00:00Z"), appointmentId: null, workOrderId: null }, ...extra });
function database(items: Fact[], services: Fact[] = []) {
  const calls: { groups: Where[]; services: Where[] } = { groups: [], services: [] };
  return {
    calls,
    branch: { findMany: async ({ where }: { where: Where }) => ["a", "b", "inactive"].map(id => ({ id, businessId: "business", status: id === "inactive" ? "INACTIVE" : "ACTIVE" })).filter(row => matches(row, where)) },
    invoiceItem: { groupBy: async (args: Where) => {
      calls.groups.push(args);
      const groups = new Map<string, Fact & { _sum: { quantity: number; lineTotal: number } }>();
      for (const item of items.filter(row => matches(row, args.where as Where))) {
        const fields = Object.fromEntries((args.by as string[]).map(key => [key, item[key]]));
        const key = JSON.stringify(fields);
        const group = groups.get(key) ?? { ...fields, _sum: { quantity: 0, lineTotal: 0 } };
        group._sum.quantity += Number(item.quantity); group._sum.lineTotal += Number(item.lineTotal);
        groups.set(key, group);
      }
      return [...groups.values()];
    } },
    service: { findMany: async (args: Where) => { calls.services.push(args); return services.filter(row => matches(row, args.where as Where)); } },
  };
}
type Reader = typeof import("../../src/lib/business-performance/top-services");
let api: Reader;
const globals = globalThis as typeof globalThis & { __topServicesPrisma?: object };
before(async () => {
  globals.__topServicesPrisma = {};
  const output = await build({ entryPoints: ["src/lib/business-performance/top-services.ts"], bundle: true, write: false, platform: "node", packages: "external", format: "cjs", plugins: [{ name: "db-boundary", setup(b) {
    b.onResolve({ filter: /^@\/lib\/prisma$/ }, () => ({ path: "prisma", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const prisma=globalThis.__topServicesPrisma;", loader: "js" }));
  } }] });
  const compiled = { exports: {} };
  new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  api = compiled.exports as Reader;
});
after(() => { delete globals.__topServicesPrisma; });
async function read(items: Fact[], services: Fact[] = [], access: ResolvedBusinessAccess = owner, requestedBranchId?: string) {
  const db = database(items, services);
  const rows = await api.readBusinessTopServices({ businessId: "business", salonAccess: { access, requestedBranchId }, fromDate, toDateExclusive }, db as unknown as Parameters<Reader["readBusinessTopServices"]>[1]);
  return { rows, calls: db.calls };
}

test("persisted kind excludes Package/Product/Other even with serviceId; covered SERVICE stays", async () => {
  const { rows } = await read([line("a", 2, "200"), line("a", 1, "300", "PACKAGE_PURCHASE"), line("a", 8, "50", "PRODUCT"), line("a", 7, "70", "OTHER"), line("b", 1, "100", "SERVICE", { customerPackageId: "package", productId: "malformed-reference" })]);
  assert.deepEqual(rows, [{ serviceId: "a", name: "a", quantity: 2, salesAmount: "200.00" }, { serviceId: "b", name: "b", quantity: 1, salesAmount: "100.00" }]);
});
test("legacy candidates remain UNKNOWN_LEGACY; SERVICE without identity never invents a bucket", async () => {
  const legacy = line("legacy", 2, "200", null);
  assert.equal(resolveInvoiceItemKind({ kind: null }), "UNKNOWN_LEGACY");
  assert.equal(api.classifyTopServiceItem({ kind: null, serviceId: "legacy" }), "LEGACY_SERVICE_CANDIDATE");
  assert.equal(api.classifyTopServiceItem({ kind: null, serviceId: null }), "LEGACY_NON_SERVICE_OR_UNKNOWN");
  assert.equal(api.classifyTopServiceItem({ kind: "SERVICE", serviceId: null }), "EXPLICIT_SERVICE");
  assert.equal(api.classifyTopServiceItem({ kind: "PRODUCT", serviceId: "legacy" }), "EXPLICIT_NON_SERVICE");
  const { rows } = await read([legacy, line(null, 2, "100"), line(null, 8, "800", null), line(null, 9, "900", "PRODUCT")]);
  assert.deepEqual(rows, [{ serviceId: "legacy", name: "legacy", quantity: 2, salesAmount: "200.00" }]);
});
test("invoiced quantity wins over revenue and all services survive more than 20 high-value non-service groups", async () => {
  const items = [line("many", 8, "0.30"), line("expensive", 1, "9999"), ...Array.from({ length: 25 }, (_, i) => line(`package-${i}`, 100, "99999", "PACKAGE_PURCHASE")), ...Array.from({ length: 11 }, (_, i) => line(`service-${i}`, 2, "2"))];
  const { rows, calls } = await read(items);
  assert.equal(rows.length, 13); assert.equal(rows[0].serviceId, "many"); assert.equal(rows.at(-1)?.serviceId, "expensive");
  assert.equal(calls.groups.length, 1); assert.equal(calls.services.length, 1);
  assert.equal(calls.groups[0].take, undefined); assert.equal(calls.groups[0].orderBy, undefined);
});
test("identity merges renames, keeps homonyms distinct, resolves current/inactive names and deterministic fallback", async () => {
  const items = [line("rename", 1, "0.10", "SERVICE", { name: "Old" }), line("rename", 1, "0.20", "SERVICE", { name: "Older" }), line("homonym-b", 2, "2", "SERVICE", { name: "Haircut" }), line("homonym-a", 2, "1", "SERVICE", { name: "Haircut" }), line("missing", 1, "-0.20", "SERVICE", { name: "Zed" }), line("missing", 1, "0.10", "SERVICE", { name: "Alpha" }), line("unknown", 1, "0", "SERVICE", { name: " " })];
  const services = [{ id: "rename", businessId: "business", name: "New", status: "INACTIVE" }, { id: "missing", businessId: "other", name: "Tenant leak" }];
  const first = await read(items, services); const second = await read([...items].reverse(), services);
  assert.deepEqual(first.rows, second.rows);
  assert.deepEqual(first.rows, [
    { serviceId: "missing", name: "Alpha", quantity: 2, salesAmount: "-0.10" },
    { serviceId: "homonym-a", name: "Haircut", quantity: 2, salesAmount: "1.00" },
    { serviceId: "homonym-b", name: "Haircut", quantity: 2, salesAmount: "2.00" },
    { serviceId: "rename", name: "New", quantity: 2, salesAmount: "0.30" },
    { serviceId: "unknown", name: "Unknown service", quantity: 1, salesAmount: "0.00" },
  ]);
});
test("direct, appointment and workorder sales use issuedAt/non-VOID, not payment/refund/completion", async () => {
  const statuses = ["PAID", "UNPAID", "PARTIALLY_PAID", "REFUNDED"];
  const valid = statuses.map((status, i) => line("service", 1, "10", "SERVICE", { invoice: { businessId: "business", branchId: "a", status, issuedAt: i === 0 ? fromDate : new Date("2026-10-02T03:00:00Z"), appointmentId: i === 1 ? "ap" : null, workOrderId: i === 2 ? "wo" : null, refundedAmount: 100, paidAt: new Date("2030-01-01") } }));
  const invalid = [
    line("service", 20, "200", "SERVICE", { invoice: { ...(valid[0].invoice as Fact), status: "VOID" } }),
    line("service", 20, "200", "SERVICE", { invoice: { ...(valid[0].invoice as Fact), businessId: "other" } }),
    line("service", 20, "200", "SERVICE", { businessId: "other" }),
    line("service", 20, "200", "SERVICE", { invoice: { ...(valid[0].invoice as Fact), issuedAt: toDateExclusive } }),
    line("service", 20, "200", "SERVICE", { invoice: { ...(valid[0].invoice as Fact), issuedAt: new Date(fromDate.getTime() - 1) } }),
  ];
  assert.deepEqual((await read([...valid, ...invalid])).rows, [{ serviceId: "service", name: "service", quantity: 4, salesAmount: "40.00" }]);
});
for (const scenario of [
  { name: "Owner", access: owner, want: 10 },
  { name: "Group Manager authorized Business", access: { ...owner, source: "GROUP_ACCESS", effectiveBusinessRole: "GROUP_MANAGER_READ_ONLY", actorRole: "GROUP_MANAGER" } as ResolvedBusinessAccess, want: 10 },
  { name: "ALL_BRANCHES Staff", access: { ...owner, effectiveBusinessRole: "STAFF", permissions: ["ALL_BRANCHES"] } as ResolvedBusinessAccess, want: 10 },
  { name: "ordinary own Staff", access: { ...owner, effectiveBusinessRole: "STAFF" } as ResolvedBusinessAccess, want: 1 },
  { name: "ordinary inactive own Staff", access: { ...owner, effectiveBusinessRole: "STAFF", branchId: "inactive" } as ResolvedBusinessAccess, branch: "inactive", want: 4 },
  { name: "different Staff branch denied", access: { ...owner, effectiveBusinessRole: "STAFF" } as ResolvedBusinessAccess, branch: "b", want: 0 },
  { name: "explicit inactive Owner", access: owner, branch: "inactive", want: 4 },
  { name: "invalid explicit Owner", access: owner, branch: "tampered", want: 0 },
  { name: "blank explicit Owner", access: owner, branch: " ", want: 0 },
  { name: "cross Business branch", access: owner, branch: "foreign", want: 0 },
  { name: "cross Business access", access: { ...owner, businessId: "other" } as ResolvedBusinessAccess, want: 0 },
  { name: "unverified Staff branch", access: { ...owner, effectiveBusinessRole: "STAFF", branchId: null } as ResolvedBusinessAccess, want: 0 },
  { name: "denied", access: { granted: false, userId: "x", requestedBusinessId: "business", reason: "CAPABILITY_DENIED", fallback: { kind: "NO_ACCESS" } } as ResolvedBusinessAccess, want: 0 },
]) {
  test(`${scenario.name}: authorized historical branch/null scope never falls back after explicit denial`, async () => {
    const items = [line("service", 1, "1"), ...[["b", 2], [null, 3], ["inactive", 4]].map(([branchId, quantity]) => line("service", Number(quantity), String(quantity), "SERVICE", { invoice: { ...(line("s", 1, "1").invoice as Fact), branchId } }))];
    const { rows, calls } = await read(items, [], scenario.access, scenario.branch);
    assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), scenario.want);
    if (!scenario.want) { assert.deepEqual(rows, []); assert.equal(calls.groups.length, 0); }
  });
}
