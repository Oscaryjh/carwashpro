import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { assertDemoEnvironment, buildDemoPlan, classifyFixture, assertCleanupOwnership, planDisplayNameRefinement } from "../../scripts/local/prepare-staff-performance-demo";

const staff = ["Louis stylist", "OSCAR", "Real Device UAT Employee", "Real Device UAT Manager", "test"].map((name, index) => ({ id: `staff-${index}`, name }));
const services = [250, 180, 120, 90, 80].map((price, index) => ({ id: `service-${index}`, name: `Service ${index}`, price: new Prisma.Decimal(price) }));
const input = { businessId: "business", branchId: "branch", timezone: "Asia/Kuching", staff, services, now: new Date("2026-10-06T12:00:00Z") };

test("Local guard rejects remote hosts, forwarded databases and conflicting environment markers", () => {
  assert.doesNotThrow(() => assertDemoEnvironment("postgresql://u:p@localhost:5432/tetamu_canonical_local_20260829", { NODE_ENV: "development" }));
  assert.doesNotThrow(() => assertDemoEnvironment("postgresql://u:p@localhost:5432/tetamu_canonical_local_20260829?schema=public", { NODE_ENV: "development" }));
  for (const url of ["postgresql://u:p@railway.internal/db", "postgresql://u:p@localhost:5432/production", "postgresql://u:p@localhost:6543/tetamu_canonical_local_20260829"]) {
    assert.throws(() => assertDemoEnvironment(url, { NODE_ENV: "development" }), /ENVIRONMENT_UNCERTAIN/);
  }
  for (const env of [{ APP_ENVIRONMENT: "development", NODE_ENV: "production" }, { RAILWAY_ENVIRONMENT_NAME: "testing" }, { RAILWAY_PROJECT_ID: "project" }]) {
    assert.throws(() => assertDemoEnvironment("postgresql://u:p@localhost:5432/tetamu_canonical_local_20260829", env), /ENVIRONMENT_UNCERTAIN/);
  }
});

test("Planner uses exact existing five, precise prices, repeated customers and descending performance", () => {
  const plan = buildDemoPlan(input);
  assert.equal(plan.customers.length, 42);
  assert.equal(plan.invoices.length, 73);
  assert.equal(plan.appointments.length, 88);
  assert.equal(plan.items.length, 75);
  assert.deepEqual(plan.summary.map(row => row.invoices), [24, 18, 14, 10, 7]);
  assert.deepEqual(plan.summary.map(row => row.completed), [24, 16, 12, 8, 6]);
  assert.deepEqual(plan.summary.map(row => row.customersServed), [15, 11, 9, 6, 5]);
  assert.deepEqual(plan.summary.map(row => row.servicesSold), [30, 24, 18, 12, 9]);
  assert.ok(plan.summary.every((row, index) => index === 0 || row.attributedSales < plan.summary[index - 1].attributedSales));
  assert.equal(new Set(plan.summary.map(row => row.topService)).size, 5);
  assert.ok(plan.invoices.every(row => row.status === "UNPAID" && new Prisma.Decimal(String(row.paidAmount)).isZero() && row.appointmentId));
  assert.ok(plan.items.every(row => new Prisma.Decimal(String(row.unitPrice)).mul(row.quantity ?? 1).equals(String(row.lineTotal))));
  assert.ok(plan.customers.every(row => row.email === null && row.phone.startsWith("STAFF_PERF_DEMO_20261006_V1:")));
  assert.deepEqual(buildDemoPlan(input), plan);
});

test("New marker-owned demo writes carry service and explicit other identity without changing demo amounts", () => {
  const plan = buildDemoPlan(input);
  assert.equal(plan.items.filter(row => row.serviceId).length, 73);
  assert.equal(plan.items.filter(row => !row.serviceId).length, 2);
  for (const row of plan.items) {
    assert.equal((row as typeof row & { kind?: string }).kind, row.serviceId ? "SERVICE" : "OTHER");
  }
  assert.deepEqual(plan.summary.map(row => row.servicesSold), [30, 24, 18, 12, 9]);
  assert.ok(plan.items.every(row => new Prisma.Decimal(String(row.unitPrice)).mul(row.quantity ?? 1).equals(String(row.lineTotal))));
});

test("Planner rejects ambiguous staff, insufficient services and future demo appointments", () => {
  assert.throws(() => buildDemoPlan({ ...input, staff: staff.slice(0, 4) }), /STAFF_SET_AMBIGUOUS/);
  assert.throws(() => buildDemoPlan({ ...input, services: services.slice(0, 1) }), /INSUFFICIENT_EXISTING_SERVICES/);
  assert.throws(() => buildDemoPlan({ ...input, now: new Date("2026-10-05T12:00:00Z") }), /FUTURE/);
});

test("Idempotency checks contents, rejects partial datasets and never repairs them silently", () => {
  const expected = [{ id: "a", value: "10.00" }, { id: "b", value: "20.00" }];
  assert.equal(classifyFixture([], expected), "ABSENT");
  assert.equal(classifyFixture([...expected].reverse(), expected), "COMPLETE");
  assert.throws(() => classifyFixture(expected.slice(0, 1), expected), /PARTIAL_STATE/);
  assert.throws(() => classifyFixture([{ id: "a", value: "11.00" }, expected[1]], expected), /PARTIAL_STATE/);
});

test("Cleanup rejects non-marker IDs and external dependencies, and cannot own existing staff", () => {
  const plan = buildDemoPlan(input);
  const ids = plan.customers.map(row => row.id);
  assert.doesNotThrow(() => assertCleanupOwnership(ids, ids, 0));
  assert.throws(() => assertCleanupOwnership([...ids, staff[0].id], ids, 0), /OWNERSHIP/);
  assert.throws(() => assertCleanupOwnership(ids, ids, 1), /EXTERNAL_DEPENDENCY/);
});

test('Demo service display names use existing catalog names while deterministic parent ownership remains', () => {
  const plan = buildDemoPlan(input);
  const serviceItems = plan.items.filter(row => row.serviceId);
  assert.ok(serviceItems.every(row => row.name === services.find(service => service.id === row.serviceId)?.name));
  assert.ok(serviceItems.every(row => plan.invoices.some(invoice => invoice.id === row.invoiceId && invoice.invoiceNumber.startsWith('STAFF_PERF_DEMO_20261006_V1-'))));
  assert.doesNotThrow(() => assertCleanupOwnership(serviceItems.map(row => row.id), plan.items.map(row => row.id), 0));
  assert.ok(plan.items.filter(row => !row.serviceId).every(row => row.name.startsWith('STAFF_PERF_DEMO_20261006_V1')));
});

test('Display-name refinement accepts only complete marker-owned legacy data, is idempotent and rejects other changes', () => {
  const plan = buildDemoPlan(input);
  const legacy = plan.items.map(row => ({ ...row, name: row.serviceId ? `STAFF_PERF_DEMO_20261006_V1 ${row.name}` : row.name }));
  const updates = planDisplayNameRefinement(legacy, plan.items);
  assert.equal(updates.length, 73);
  assert.ok(updates.every(row => plan.items.some(item => item.id === row.id && item.name === row.name)));
  assert.deepEqual(planDisplayNameRefinement(plan.items, plan.items), []);
  assert.throws(() => planDisplayNameRefinement(legacy.slice(1), plan.items), /PARTIAL_STATE/);
  assert.throws(() => planDisplayNameRefinement([{ ...legacy[0], name: 'Real service renamed' }, ...legacy.slice(1)], plan.items), /DISPLAY_NAME_REJECTED/);
  assert.throws(() => planDisplayNameRefinement([{ ...legacy[0], lineTotal: new Prisma.Decimal(999) }, ...legacy.slice(1)], plan.items), /PARTIAL_STATE/);
  assert.throws(() => planDisplayNameRefinement([{ ...legacy[0], invoiceId: 'foreign-invoice' }, ...legacy.slice(1)], plan.items), /PARTIAL_STATE/);
});
