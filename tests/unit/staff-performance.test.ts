import assert from "node:assert/strict";
import test, { before, beforeEach } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import type { InvoiceItemKind, Prisma } from "@prisma/client";
import { resolveInvoiceItemKind } from "../../src/lib/invoice-item/classification";
import type { SalonAccess } from "../../src/lib/business-performance/salon-scope";

const require = createRequire(import.meta.url);
const staffId = "11111111-1111-4111-8111-111111111111";
const otherStaff = "22222222-2222-4222-8222-222222222222";
const fromDate = new Date("2026-10-01T18:00:00Z");
const toDateExclusive = new Date("2026-11-01T18:00:00Z");
const when = new Date("2026-10-02T00:00:00Z");
type Row = Record<string, unknown>;
type Item = { kind: InvoiceItemKind | null; serviceId: string | null; name: string; quantity: number; lineTotal: number; customerPackageId?: string; productId?: string };
type Invoice = Row & { id: string; items: Item[]; issuedAt: Date };
const item = (serviceId: string | null, name: string, quantity: number, lineTotal: number, kind: InvoiceItemKind | null = null): Item => ({ kind, serviceId, name, quantity, lineTotal });
const inv = (id: string, items: Item[], extra: Row = {}): Invoice => ({ id, invoiceNumber: id, businessId: "biz", branchId: "a", status: "PAID", issuedAt: when, appointmentId: "ap", workOrderId: null, appointment: { assignedStaffId: staffId }, customer: { name: "Customer" }, items, ...extra });
const ap = (id: string, extra: Row = {}): Row => ({ id, businessId: "biz", branchId: "a", assignedStaffId: staffId, customerId: "c1", scheduledAt: when, completedAt: toDateExclusive, status: "COMPLETED", ...extra });
let invoices: Invoice[];
let appointments: Row[];
let services: Row[];
let users: Row[];
let calls: { table: string; method: string; args: Row }[];
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, rule]) => {
    if (key === "AND") return (Array.isArray(rule) ? rule : [rule]).every(part => matches(row, part as Row));
    if (key === "OR") return (rule as Row[]).some(part => matches(row, part));
    const value = row[key];
    if (rule && typeof rule === "object" && !(rule instanceof Date)) {
      const filter = rule as Row;
      if ("is" in filter) return value != null && matches(value as Row, filter.is as Row);
      if ("some" in filter) return Array.isArray(value) && value.some(part => matches(part as Row, filter.some as Row));
      if ("lte" in filter) return value instanceof Date && value <= (filter.lte as Date);
      if ("in" in filter) return (filter.in as unknown[]).includes(value);
      if ("notIn" in filter) return !(filter.notIn as unknown[]).includes(value);
      if ("not" in filter) return value !== filter.not;
      if ("gte" in filter || "lt" in filter) return value instanceof Date && (!("gte" in filter) || value >= (filter.gte as Date)) && (!("lt" in filter) || value < (filter.lt as Date));
      return value != null && matches(value as Row, filter);
    }
    return value === rule;
  });
}
function table(name: string, rows: () => Row[]) {
  const filtered = (method: string, args: Row) => {
    calls.push({ table: name, method, args });
    return rows().filter(row => matches(row, args.where as Row));
  };
  return {
    count: async (args: Row) => filtered("count", args).length,
    findFirst: async (args: Row) => filtered("findFirst", args)[0] ?? null,
    findMany: async (args: Row) => {
      let selected = filtered("findMany", args);
      if (args.orderBy) selected = selected.sort((a, b) => Number(b.issuedAt) - Number(a.issuedAt) || String(b.id).localeCompare(String(a.id)));
      return selected.slice(Number(args.skip ?? 0), args.take === undefined ? undefined : Number(args.skip ?? 0) + Number(args.take));
    },
    aggregate: async (args: Row) => ({ _sum: { lineTotal: filtered("aggregate", args).reduce((sum, row) => sum + Number(row.lineTotal), 0).toFixed(2) } }),
    groupBy: async (args: Row) => {
      const groups = new Map<string, Row[]>();
      const by = args.by as string[];
      for (const row of filtered("groupBy", args)) {
        const key = JSON.stringify(by.map(field => row[field]));
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      return [...groups.values()].map(group => ({ ...Object.fromEntries(by.map(field => [field, group[0][field]])), _count: group.length, _sum: { quantity: group.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0), lineTotal: group.reduce((sum, row) => sum + Number(row.lineTotal ?? 0), 0) } }));
    },
  };
}
const db = {
  invoice: table("invoice", () => invoices),
  invoiceItem: table("invoiceItem", () => invoices.flatMap(invoice => invoice.items.map(row => ({ ...row, businessId: invoice.businessId, invoice })))),
  appointment: table("appointment", () => appointments),
  service: table("service", () => services),
  user: table("user", () => users),
  branch: table("branch", () => ["a", "inactive"].map(id => ({ id, businessId: "biz" }))),
};
let api: typeof import("../../src/lib/business-performance/staff-performance") & typeof import("../../src/lib/business-performance/salon-performance");
before(async () => {
  const result = await build({ stdin: { contents: 'export * from "./src/lib/business-performance/staff-performance";export * from "./src/lib/business-performance/salon-performance";', resolveDir: process.cwd() }, bundle: true, platform: "node", packages: "external", format: "cjs", write: false, plugins: [{ name: "prisma-boundary", setup(b) {
    b.onResolve({ filter: /^@\/lib\/prisma$/ }, () => ({ path: "prisma", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const prisma={};" }));
  } }] });
  const exports = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, exports, exports.exports);
  api = exports.exports as typeof api;
});
beforeEach(() => {
  invoices = [inv("i1", [item("s1", "Old name", 2, 20), item(null, "Product", 1, 5), item(null, "Package", 1, 7)]), inv("i2", [item("s1", "Renamed", 1, 10)])];
  appointments = [ap("a1"), ap("a2"), ap("a3"), ap("b1", { assignedStaffId: otherStaff }), ap("scheduled", { status: "CONFIRMED" }), ap("cancel", { status: "CANCELLED" }), ap("noshow", { status: "NO_SHOW" })];
  services = [{ id: "s1", businessId: "biz", name: "Haircut", status: "INACTIVE" }];
  users = [staffId, otherStaff].map((id, index) => ({ id, businessId: "biz", name: index ? "Bob" : "Alice", branchId: "a", branch: { id: "a", businessId: "biz" }, employeeBusinessMembershipId: null, employeeBusinessMembership: null, status: "active", loginEnabled: true, appointmentBookable: true }));
  calls = [];
});
function read(overrides: Row = {}, accessOverrides: Row = {}) {
  const access: SalonAccess["access"] = { granted: true, userId: staffId, homeBusinessId: "biz", businessId: "biz", branchId: "a", identityRole: "BUSINESS_OWNER", actorRole: "BUSINESS_OWNER", source: "DIRECT_BUSINESS", effectiveBusinessRole: "BUSINESS_OWNER", permissions: [], industryType: "SALON_BEAUTY", groupId: null, groupUserId: null, capability: "VIEW_DASHBOARD", ...accessOverrides };
  return api.readStaffPerformance({ businessId: "biz", salonAccess: { access }, subject: { type: "staff", userId: staffId }, fromDate, toDateExclusive, ...overrides }, db as unknown as Pick<Prisma.TransactionClient, "invoice" | "invoiceItem" | "appointment" | "user" | "branch" | "service">);
}
test("whole-period KPI uses existing attribution, distinct completed customers and invoice average", async () => {
  const result = await read(); assert.ok(result);
  assert.deepEqual(result.summary, { attributedSales: 42, appointments: 4, completedAppointments: 3, customersServed: 1, servicesSold: 3 });
  assert.equal(result.invoiceCount, 2); assert.equal(result.averageAttributedInvoice, 21);
  assert.deepEqual(result.serviceBreakdown, [{ serviceId: "s1", name: "Haircut", quantity: 3, amount: 30 }]);
  assert.equal(result.otherAttributedItems, 12);
  const bob = await read({ subject: { type: "staff", userId: otherStaff } });
  assert.equal(bob?.summary.customersServed, 1); assert.equal(bob?.averageAttributedInvoice, null);
});

test("persisted package/product/other identity overrides service references in the mixed attributed invoice", async () => {
  invoices = [inv("mixed", [item("s1", "Service A", 2, 200, "SERVICE"), item("s1", "Package purchase", 1, 300, "PACKAGE_PURCHASE"), item(null, "Product", 1, 50, "PRODUCT")])];
  const result = await read(); assert.ok(result);
  assert.equal(result.summary.attributedSales, 550);
  assert.equal(result.summary.servicesSold, 2);
  assert.equal(result.invoiceCount, 1);
  assert.equal(result.averageAttributedInvoice, 550);
  assert.deepEqual(result.serviceBreakdown, [{ serviceId: "s1", name: "Haircut", quantity: 2, amount: 200 }]);
  assert.equal(result.topService?.serviceId, "s1");
  assert.equal(result.otherAttributedItems, 350);
  assert.deepEqual(result.activity[0].serviceNames, ["Service A"]);
  assert.equal(result.activity[0].amount, 550);
  for (const kind of ["PACKAGE_PURCHASE", "PRODUCT", "OTHER"] as const) {
    invoices = [inv("non-service", [item("s1", "Not a service", 99, 100, kind)])];
    const nonService = await read(); assert.ok(nonService);
    assert.equal(nonService.summary.servicesSold, 0);
    assert.deepEqual(nonService.serviceBreakdown, []);
    assert.equal(nonService.topService, null);
    assert.equal(nonService.otherAttributedItems, 100);
    assert.deepEqual(nonService.activity[0].serviceNames, []);
    assert.equal(nonService.activity.length, 1);
  }
});

test("explicit SERVICE with package/product references stays service; ranking remains quantity then name and ID", async () => {
  invoices = [inv("covered", [{ ...item("s1", "Covered service", 1, 100, "SERVICE"), customerPackageId: "entitlement", productId: "contradictory-reference" }, item("s2", "Same name", 2, 10, "SERVICE"), item("s3", "Same name", 2, 5, "SERVICE")])];
  services = [{ id: "s1", businessId: "biz", name: "Haircut" }];
  const result = await read(); assert.ok(result);
  assert.equal(result.summary.servicesSold, 5);
  assert.equal(result.summary.attributedSales, 115);
  assert.equal(result.otherAttributedItems, 0);
  assert.deepEqual(result.serviceBreakdown.map(row => row.serviceId), ["s2", "s3", "s1"]);
  assert.equal(result.topService?.serviceId, "s2");
  assert.deepEqual(result.activity[0].serviceNames, ["Covered service", "Same name", "Same name"]);
});

test("explicit SERVICE without serviceId counts quantity/subtotal but never infers ranking identity from its name", async () => {
  invoices = [inv("missing-reference", [item(null, "Historical Service", 2, 100, "SERVICE"), item(null, "", 1, 0.10, "SERVICE"), item(null, "Adjustment", 1, -0.20, "OTHER")])];
  const result = await read(); assert.ok(result);
  assert.equal(result.summary.servicesSold, 3);
  assert.equal(result.summary.attributedSales.toFixed(2), "99.90");
  assert.deepEqual(result.serviceBreakdown, []);
  assert.equal(result.topService, null);
  assert.equal(result.otherAttributedItems, -0.20);
  assert.deepEqual(result.activity[0].serviceNames, ["Historical Service"]);
  invoices[0].items.pop();
  assert.equal((await read())?.otherAttributedItems, 0);
});

test("null-kind service references remain legacy compatibility candidates without changing canonical identity", async () => {
  // serviceId fallback preserves historical behavior only; it is not authoritative identity.
  const legacyService = item("s1", "Legacy service", 2, 200);
  invoices = [inv("legacy", [legacyService, item(null, "Legacy unknown", 1, 20)])];
  const result = await read(); assert.ok(result);
  assert.equal(resolveInvoiceItemKind(legacyService), "UNKNOWN_LEGACY");
  assert.equal(api.classifyStaffPerformanceServiceItem(legacyService), "LEGACY_SERVICE_CANDIDATE");
  assert.equal(api.classifyStaffPerformanceServiceItem(item(null, "Unknown", 1, 0)), "LEGACY_NON_SERVICE_OR_UNKNOWN");
  assert.equal(api.classifyStaffPerformanceServiceItem(item(null, "Known service", 1, 0, "SERVICE")), "EXPLICIT_SERVICE");
  assert.equal(api.classifyStaffPerformanceServiceItem(item("s1", "Package", 1, 0, "PACKAGE_PURCHASE")), "EXPLICIT_NON_SERVICE");
  assert.equal(result.summary.servicesSold, 2);
  assert.deepEqual(result.serviceBreakdown, [{ serviceId: "s1", name: "Haircut", quantity: 2, amount: 200 }]);
  assert.equal(result.otherAttributedItems, 20);
  assert.equal(result.topService?.serviceId, "s1");
  assert.deepEqual(result.activity[0].serviceNames, ["Legacy service"]);
});
test("VOID/direct/out-of-period/other business excluded; refund/unpaid do not reduce original facts", async () => {
  invoices[0].status = "REFUNDED"; invoices[1].status = "UNPAID";
  for (const extra of [{ status: "VOID" }, { appointmentId: null, workOrderId: null }, { businessId: "other" }, { issuedAt: toDateExclusive }, { issuedAt: new Date(fromDate.getTime() - 1) }]) invoices.push(inv("excluded", [item("s1", "bad", 99, 999)], extra));
  appointments.push(ap("outside", { scheduledAt: toDateExclusive, completedAt: when }));
  assert.equal((await read())?.summary.attributedSales, 42);
  assert.equal((await read())?.summary.servicesSold, 3);
  assert.equal((await read())?.summary.completedAppointments, 3);
});
test("negative non-service remainder stays negative; service identity and deterministic fallback are retained", async () => {
  invoices = [inv("a", [item("s1", "old", 1, 10), item("s1", "new", 1, 10), item("s2", "Haircut", 2, 8), item("s3", "Zebra", 1, 3), item("s3", "Alpha", 1, 3), item(null, "Adjustment", 1, -9)])];
  const result = await read(); assert.ok(result);
  assert.equal(result.otherAttributedItems, -9);
  assert.equal(result.serviceBreakdown.length, 3);
  assert.deepEqual(result.serviceBreakdown.map(row => [row.serviceId, row.name]), [["s3", "Alpha"], ["s1", "Haircut"], ["s2", "Haircut"]]);
  assert.equal(result.topService?.serviceId, "s3");
  invoices[0].items.reverse();
  assert.deepEqual((await read())?.serviceBreakdown, result.serviceBreakdown);
});
test("Unassigned includes workOrder-only without staff fallback and completed unassigned customers", async () => {
  invoices.push(inv("work", [item("s1", "Service", 1, 11)], { appointmentId: null, appointment: null, workOrderId: "w", workOrder: { appointment: { assignedStaffId: staffId } } }));
  invoices.push(inv("no-staff", [item(null, "Product", 1, 2)], { appointment: { assignedStaffId: null } }));
  appointments.push(ap("unassigned", { assignedStaffId: null }));
  const result = await read({ subject: { type: "unassigned" } });
  assert.equal(result?.name, "Unassigned"); assert.equal(result?.summary.attributedSales, 13); assert.equal(result?.summary.customersServed, 1);
});
test("stable 20-row page and clamping do not change whole-period KPI or issue N+1 queries", async () => {
  invoices = Array.from({ length: 21 }, (_, i) => inv(`i${String(i).padStart(2, "0")}`, [item("s1", "Service", 1, 0.25)]));
  const first = await read(); const second = await read({ page: 2 }); assert.ok(first && second);
  assert.equal(first.activity.length, 20); assert.equal(second.activity.length, 1);
  assert.equal(first.activity[0].id, "i20"); assert.equal(second.activity[0].id, "i00");
  assert.deepEqual(first.summary, second.summary); assert.equal(first.summary.attributedSales, 5.25);
  assert.equal(new Set([...first.activity, ...second.activity].map(row => row.id)).size, 21);
  for (const page of [0, -1, 1.2, "bad", Number.POSITIVE_INFINITY]) assert.equal((await read({ page }))?.page, 1);
  assert.equal((await read({ page: 999 }))?.page, 2);
  assert.ok(calls.filter(c => c.table === "invoice" && c.method === "findMany").every(c => c.args.take === 20 && JSON.stringify(c.args.orderBy) === JSON.stringify([{ issuedAt: "desc" }, { id: "desc" }])));
  assert.equal(calls.filter(c => c.table === "service" && c.method === "findMany").length, 8);
});
test("historical authorization includes inactive/null for broad roles, own branch only otherwise", async () => {
  invoices.push(inv("old", [item(null, "Other", 1, 11)], { branchId: "inactive" }), inv("null", [item(null, "Other", 1, 13)], { branchId: null }));
  for (const access of [{}, { source: "GROUP_ACCESS", effectiveBusinessRole: "GROUP_MANAGER_READ_ONLY" }, { effectiveBusinessRole: "STAFF", permissions: ["ALL_BRANCHES"] }]) assert.equal((await read({}, access))?.summary.attributedSales, 66);
  assert.equal((await read({}, { effectiveBusinessRole: "STAFF" }))?.summary.attributedSales, 42);
});
test("invalid subject, foreign business or unauthorized branch fails closed without leaking a name", async () => {
  assert.equal(await read({ subject: { type: "staff", userId: "not-a-uuid" } }), null);
  assert.equal(calls.length, 0);
  assert.equal(await read({ subject: { type: "staff", userId: "33333333-3333-4333-8333-333333333333" } }), null);
  for (const branch of ["foreign", "", "bad-uuid"]) {
    const access = { granted: true, businessId: "biz", effectiveBusinessRole: "BUSINESS_OWNER", source: "DIRECT_BUSINESS", permissions: [] } as unknown as SalonAccess["access"];
    assert.equal(await read({ salonAccess: { access, requestedBranchId: branch } }), null);
  }
  assert.equal(await read({}, { businessId: "other" }), null);
});

const zeroSummary = { attributedSales: 0, appointments: 0, completedAppointments: 0, customersServed: 0, servicesSold: 0 };
function assertEmpty(result: Awaited<ReturnType<typeof read>>, name = "Alice") {
  assert.ok(result);
  assert.equal(result.name, name);
  assert.deepEqual(result.summary, zeroSummary);
  assert.equal(result.invoiceCount, 0);
  assert.equal(result.averageAttributedInvoice, null);
  assert.equal(result.topService, null);
  assert.deepEqual(result.serviceBreakdown, []);
  assert.equal(result.otherAttributedItems, 0);
  assert.deepEqual(result.activity, []);
  assert.equal(result.page, 1);
  assert.equal(result.pageCount, 1);
}
test("authorized empty periods return a complete zero DTO for all broad roles without a historical scan", async () => {
  invoices = []; appointments = [];
  Object.assign(users[0], { status: "inactive", loginEnabled: false, appointmentBookable: false, branchId: null, branch: null });
  for (const access of [{}, { source: "GROUP_ACCESS", effectiveBusinessRole: "GROUP_MANAGER_READ_ONLY" }, { effectiveBusinessRole: "STAFF", permissions: ["ALL_BRANCHES"] }]) {
    calls = [];
    assertEmpty(await read({ page: 99 }, access));
    assert.equal(calls.filter(c => c.table === "user").length, 1);
    assert.equal(calls.filter(c => c.table === "invoice" && c.method === "findMany").length, 0);
    assert.ok(calls.filter(c => c.table === "appointment").every(c => "scheduledAt" in (c.args.where as Row)));
  }
});
test("authorized explicit inactive branch permits an empty period without broad fallback", async () => {
  invoices = []; appointments = [];
  const access = { granted: true, businessId: "biz", effectiveBusinessRole: "BUSINESS_OWNER", source: "DIRECT_BUSINESS", permissions: [] } as unknown as SalonAccess["access"];
  assertEmpty(await read({ salonAccess: { access, requestedBranchId: "inactive" } }));
  assert.ok(calls.filter(c => c.table === "invoice" && c.method === "count").every(c => (c.args.where as Row).branchId === "inactive"));
});
test("ordinary Staff can read a same-branch new employee's empty period, not just self", async () => {
  invoices = []; appointments = [];
  assertEmpty(await read({ subject: { type: "staff", userId: otherStaff } }, { effectiveBusinessRole: "STAFF" }), "Bob");
  assert.equal(calls.filter(c => c.table === "user").length, 1);
});
test("ordinary Staff cannot read a different branch subject even when scoped period facts exist", async () => {
  Object.assign(users[0], { branchId: "b", branch: { id: "b", businessId: "biz" } });
  assert.equal(await read({}, { effectiveBusinessRole: "STAFF" }), null);
  assert.ok(calls.every(c => c.table === "user" || c.table === "branch"));
});
const assignment = (extra: Row = {}): Row => ({ businessId: "biz", branchId: "a", branch: { id: "a", businessId: "biz" }, effectiveFrom: new Date("2025-01-01"), effectiveUntil: new Date("2025-10-01"), status: "INACTIVE", ...extra });
test("real started historical membership assignment permits empty detail after a transfer", async () => {
  invoices = []; appointments = [];
  Object.assign(users[0], { status: "inactive", branchId: "b", branch: { id: "b", businessId: "biz" }, employeeBusinessMembership: { businessId: "biz", status: "TERMINATED", branchAssignments: [assignment()] } });
  assertEmpty(await read({}, { effectiveBusinessRole: "STAFF" }));
  assert.equal(calls.filter(c => c.table === "user").length, 1);
});

test("a linked future primary assignment cannot authorize via the already synchronized current branch", async () => {
  invoices = []; appointments = [];
  Object.assign(users[0], { employeeBusinessMembershipId: "membership", employeeBusinessMembership: {
    businessId: "biz", branchAssignments: [assignment({ status: "ACTIVE", isPrimary: true, effectiveFrom: new Date("2999-01-01"), effectiveUntil: null })],
  } });
  assert.equal(await read({}, { effectiveBusinessRole: "STAFF" }), null);
  assert.ok(calls.every(c => c.table === "user" || c.table === "branch"));
  Object.assign(users[0], { employeeBusinessMembership: { businessId: "biz", branchAssignments: [assignment()] } });
  assertEmpty(await read({}, { effectiveBusinessRole: "STAFF" }));
});
test("future, foreign membership/assignment or unverified branch cannot authorize an empty subject", async () => {
  invoices = []; appointments = [];
  for (const membership of [
    { businessId: "biz", branchAssignments: [assignment({ effectiveFrom: new Date("2999-01-01") })] },
    { businessId: "other", branchAssignments: [assignment()] },
    { businessId: "biz", branchAssignments: [assignment({ businessId: "other" })] },
    { businessId: "biz", branchAssignments: [assignment({ branch: { id: "a", businessId: "other" } })] },
    null,
  ]) {
    Object.assign(users[0], { branchId: "b", branch: { id: "b", businessId: "biz" }, employeeBusinessMembership: membership });
    assert.equal(await read({}, { effectiveBusinessRole: "STAFF" }), null);
  }
  Object.assign(users[0], { branchId: "a", branch: { id: "a", businessId: "other" } });
  assert.equal(await read({}, { effectiveBusinessRole: "STAFF" }), null);
});
test("an existing cross-business UUID is rejected before period reads without a name leak", async () => {
  users[0].businessId = "other";
  assert.equal(await read(), null);
  assert.ok(calls.every(c => c.table === "user" || c.table === "branch"));
});
test("Unassigned empty detail needs no User lookup and denied scopes still reject it", async () => {
  invoices = []; appointments = [];
  assertEmpty(await read({ subject: { type: "unassigned" } }, { effectiveBusinessRole: "STAFF" }), "Unassigned");
  assert.equal(calls.filter(c => c.table === "user").length, 0);
  assert.equal(await read({ subject: { type: "unassigned" } }, { granted: false }), null);
});
test("a zero-value valid appointment remains non-empty; cancelled/no-show alone return zero detail", async () => {
  invoices = []; appointments = [ap("scheduled", { status: "CONFIRMED" })];
  const result = await read(); assert.ok(result);
  assert.equal(result.summary.attributedSales, 0);
  assert.equal(result.summary.appointments, 1);
  appointments = [ap("cancel", { status: "CANCELLED" }), ap("no-show", { status: "NO_SHOW" })];
  assertEmpty(await read());
});

test("decimal-only services produce exactly zero other items; Activity retains existing linked customer fallback", async () => {
  invoices = [inv("decimal", [item("s1", "A", 1, 0.10), item("s2", "B", 1, 0.20)], { customer: null, workOrder: { customer: { name: "Work order customer" } } })];
  const result = await read(); assert.ok(result);
  assert.equal(result.otherAttributedItems, 0);
  assert.equal(result.activity[0].customerName, "Work order customer");
  invoices[0].workOrder = null;
  invoices[0].appointment = { assignedStaffId: staffId, customer: { name: "Appointment customer" } };
  assert.equal((await read())?.activity[0].customerName, "Appointment customer");
});

test("detail and original Salon list agree for the same scope, including monetary decimals", async () => {
  invoices.push(inv("fraction", [item("s1", "Haircut", 1, 0.1), item(null, "Adjustment", 1, -0.2)]));
  const detail = await read(); assert.ok(detail);
  const original = await api.readSalonPerformance({ businessId: "biz", branchFilter: {}, fromDate, toDateExclusive }, db as unknown as Pick<Prisma.TransactionClient, "invoice" | "appointment" | "user">);
  const staff = original.staffSales.find(row => row.id === staffId); assert.ok(staff);
  assert.equal(detail.summary.attributedSales.toFixed(2), staff.amount.toFixed(2));
  assert.equal(detail.summary.appointments, staff.appointments);
});

test("explicit authorized inactive branch works; staff unauthorized inactive branch remains denied", async () => {
  invoices.push(inv("old", [item("s1", "Service", 1, 11)], { branchId: "inactive" }));
  const access: SalonAccess["access"] = { granted: true, userId: staffId, homeBusinessId: "biz", businessId: "biz", branchId: "a", identityRole: "BUSINESS_OWNER", actorRole: "BUSINESS_OWNER", source: "DIRECT_BUSINESS", effectiveBusinessRole: "BUSINESS_OWNER", permissions: [], industryType: "SALON_BEAUTY", groupId: null, groupUserId: null, capability: "VIEW_DASHBOARD" };
  assert.equal((await read({ salonAccess: { access, requestedBranchId: "inactive" } }))?.summary.attributedSales, 11);
  assert.equal(await read({ salonAccess: { access: { ...access, identityRole: "STAFF", effectiveBusinessRole: "STAFF" }, requestedBranchId: "inactive" } }), null);
});
