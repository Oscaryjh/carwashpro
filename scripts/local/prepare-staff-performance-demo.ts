import { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadEnvConfig } from "@next/env";
import { assertLocalDatabaseTarget, runtimeEnvironment } from "../../src/lib/release/environment";
import { businessWallClockToUtc } from "../../src/lib/business-day";

export const MARKER = "STAFF_PERF_DEMO_20261006_V1";
const APPROVED_NAMES = ["Louis stylist", "OSCAR", "Real Device UAT Employee", "Real Device UAT Manager", "test"];
const LOCAL_DATABASE = "tetamu_canonical_local_20260829";
const idFor = (key: string) => {
  const hex = createHash("sha256").update(`${MARKER}:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

type PlanInput = { businessId: string; branchId: string; timezone: string; staff: { id: string; name: string }[]; services: { id: string; name: string; price: Prisma.Decimal }[]; now: Date };
type Plan = { customers: Prisma.CustomerCreateManyInput[]; appointments: Prisma.AppointmentCreateManyInput[]; invoices: Prisma.InvoiceCreateManyInput[]; items: Prisma.InvoiceItemCreateManyInput[]; summary: { name: string; invoices: number; appointments: number; completed: number; customersServed: number; servicesSold: number; attributedSales: number; topService: string }[] };
export function assertDemoEnvironment(url: string, env: Readonly<Record<string, string | undefined>>) {
  try {
    assertLocalDatabaseTarget(url, "Staff Performance demo");
    const target = new URL(url);
    const environmentValues = [env.APP_ENVIRONMENT, env.RAILWAY_ENVIRONMENT_NAME, env.NODE_ENV];
    if (runtimeEnvironment(env) !== "development" || environmentValues.some(value => value && !["development", "local"].includes(value.toLowerCase())) ||
      env.RAILWAY_PROJECT_ID || env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_SERVICE_ID ||
      target.protocol !== "postgresql:" || [...target.searchParams].some(([key, value]) => key !== "schema" || value !== "public") || target.hash ||
      (target.port && target.port !== "5432") || decodeURIComponent(target.pathname.slice(1)) !== LOCAL_DATABASE) throw new Error("Non-local target");
  } catch {
    // Never echo the URL or an underlying connection error containing credentials.
    throw new Error("STAFF_PERFORMANCE_DEMO_FIXTURE_BLOCKED_ENVIRONMENT_UNCERTAIN");
  }
}

export function buildDemoPlan(input: PlanInput): Plan {
  const { businessId, branchId, timezone, staff, services, now } = input;
  if (staff.length !== 5 || new Set(staff.map(row => row.id)).size !== 5 || staff.some((row, index) => row.name !== APPROVED_NAMES[index])) throw new Error("STAFF_PERFORMANCE_DEMO_FIXTURE_STAFF_SET_AMBIGUOUS");
  if (services.length < 2 || services.length > 5) throw new Error("INSUFFICIENT_EXISTING_SERVICES_FOR_DEMO");
  const plan: Plan = { customers: [], appointments: [], invoices: [], items: [], summary: [] };
  const date = (index: number) => businessWallClockToUtc(`2026-10-0${index % 6 + 1}`, `03:${String(Math.floor(index / 6) * 4).padStart(2, "0")}`, timezone);
  const base = { businessId, branchId };
  const customer = (key: string) => {
    const id = idFor(`customer:${key}`);
    if (!plan.customers.some(row => row.id === id)) plan.customers.push({ ...base, id, name: `${MARKER} Customer ${key}`, phone: `${MARKER}:${key}`, email: null, notes: MARKER });
    return id;
  };
  const invoiceCounts = [24, 18, 14, 10, 7];
  const completedCounts = [24, 16, 12, 8, 6];
  const customerCounts = [15, 11, 9, 6, 5];
  const quantities = [30, 24, 18, 12, 9];
  staff.forEach((person, staffIndex) => {
    const customerIds = Array.from({ length: customerCounts[staffIndex] }, (_, index) => customer(index === 0 ? "shared" : `${staffIndex + 1}-${String(index).padStart(2, "0")}`));
    let total = new Prisma.Decimal(0);
    const serviceQuantities = new Map<string, number>();
    for (let index = 0; index < invoiceCounts[staffIndex] + 3; index++) {
      const scheduledAt = date(index);
      const completedAt = new Date(scheduledAt.getTime() + 15 * 60_000);
      if (completedAt > now) throw new Error("DEMO_FUTURE_DATE_REJECTED");
      const key = `${staffIndex + 1}-${String(index + 1).padStart(2, "0")}`;
      const appointmentId = idFor(`appointment:${key}`);
      const customerId = customerIds[index % customerIds.length];
      const hasInvoice = index < invoiceCounts[staffIndex];
      const status = index < completedCounts[staffIndex] ? "COMPLETED" : index === invoiceCounts[staffIndex] + 1 ? "CANCELLED" : index === invoiceCounts[staffIndex] + 2 ? "NO_SHOW" : index % 2 ? "CONFIRMED" : "SCHEDULED";
      const primary = staffIndex % services.length;
      const alternate = primary === services.length - 1 ? primary - 1 : primary + 1;
      const service = services[index % 5 === 4 ? alternate : primary];
      plan.appointments.push({ ...base, id: appointmentId, customerId, assignedStaffId: person.id, serviceId: service.id, serviceIds: [service.id], scheduledAt, status, notes: `${MARKER}:${key}`, durationMinutes: 15, completedAt: status === "COMPLETED" ? completedAt : null });
      if (!hasInvoice) continue;
      const quantity = index < quantities[staffIndex] - invoiceCounts[staffIndex] ? 2 : 1;
      const amount = service.price.mul(quantity);
      const invoiceId = idFor(`invoice:${key}`);
      plan.items.push({ businessId, kind: "SERVICE", id: idFor(`item:${key}:service`), invoiceId, serviceId: service.id, name: service.name, quantity, unitPrice: service.price, lineTotal: amount });
      const other = staffIndex < 2 && index === 0 ? new Prisma.Decimal(5) : new Prisma.Decimal(0);
      if (!other.isZero()) plan.items.push({ businessId, kind: "OTHER", id: idFor(`item:${key}:other`), invoiceId, serviceId: null, name: `${MARKER} Demo non-service item`, quantity: 1, unitPrice: other, lineTotal: other });
      const invoiceTotal = amount.add(other);
      plan.invoices.push({ ...base, id: invoiceId, appointmentId, customerId, invoiceNumber: `${MARKER}-${key}`, issuedAt: scheduledAt, subtotal: invoiceTotal, total: invoiceTotal, balance: invoiceTotal, paidAmount: new Prisma.Decimal(0), status: "UNPAID" });
      total = total.add(invoiceTotal);
      serviceQuantities.set(service.name, (serviceQuantities.get(service.name) ?? 0) + quantity);
    }
    plan.summary.push({ name: person.name, invoices: invoiceCounts[staffIndex], appointments: invoiceCounts[staffIndex] + 1, completed: completedCounts[staffIndex], customersServed: customerCounts[staffIndex], servicesSold: quantities[staffIndex], attributedSales: total.toNumber(), topService: [...serviceQuantities].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0] });
  });
  if (plan.summary.some((row, index) => index > 0 && row.attributedSales >= plan.summary[index - 1].attributedSales)) throw new Error("DEMO_RANKING_REQUIRES_REVIEW");
  return plan;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function classifyFixture(actual: object[], expected: object[]): "ABSENT" | "COMPLETE" {
  if (!actual.length) return "ABSENT";
  const normalize = (rows: object[], templates: object[]) => rows.map(row => {
    const data = row as Record<string, unknown>;
    const template = templates.find(item => (item as Record<string, unknown>).id === data.id);
    if (!template) return { unexpected: data.id };
    return Object.fromEntries(Object.keys(template).sort().map(key => [key, data[key]]));
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (actual.length !== expected.length || fingerprint(normalize(actual, expected)) !== fingerprint(normalize(expected, expected))) throw new Error("STAFF_PERFORMANCE_DEMO_FIXTURE_PARTIAL_STATE: run --cleanup before --apply");
  return "COMPLETE";
}

export function assertCleanupOwnership(actual: (string | undefined)[], allowed: (string | undefined)[], external: number) {
  if (actual.some(id => !id || !allowed.includes(id))) throw new Error("DEMO_CLEANUP_OWNERSHIP_REJECTED");
  if (external !== 0) throw new Error("DEMO_CLEANUP_EXTERNAL_DEPENDENCY_REJECTED");
}

export function planDisplayNameRefinement(actual: Prisma.InvoiceItemCreateManyInput[], expected: Prisma.InvoiceItemCreateManyInput[]) {
  const updates: { id: string; invoiceId: string; name: string; previousName: string }[] = [];
  const normalized = actual.map(row => {
    const target = expected.find(item => item.id === row.id);
    if (!target || !target.serviceId || row.name === target.name) return row;
    if (row.name !== `${MARKER} ${target.name}` || !row.id) throw new Error("DEMO_DISPLAY_NAME_REJECTED");
    updates.push({ id: row.id, invoiceId: row.invoiceId, name: target.name, previousName: row.name });
    return { ...row, name: target.name };
  });
  if (classifyFixture(normalized, expected) !== "COMPLETE") throw new Error("STAFF_PERFORMANCE_DEMO_FIXTURE_PARTIAL_STATE");
  return updates;
}

type Database = Prisma.TransactionClient;
async function readOwned(db: Database, businessId: string) {
  const invoices = await db.invoice.findMany({ where: { businessId, invoiceNumber: { startsWith: `${MARKER}-` } }, orderBy: { id: "asc" } });
  const customers = await db.customer.findMany({ where: { businessId, name: { startsWith: `${MARKER} ` } }, orderBy: { id: "asc" } });
  const appointments = await db.appointment.findMany({ where: { businessId, notes: { startsWith: `${MARKER}:` } }, orderBy: { id: "asc" } });
  const items = await db.invoiceItem.findMany({ where: { businessId, OR: [{ name: { startsWith: `${MARKER} ` } }, { invoiceId: { in: invoices.map(row => row.id) } }] }, orderBy: { id: "asc" } });
  return { customers, appointments, invoices, items };
}

async function verifyCleanup(db: Database, businessId: string, plan: Plan, owned: Awaited<ReturnType<typeof readOwned>>) {
  for (const key of ["customers", "appointments", "invoices", "items"] as const) assertCleanupOwnership(owned[key].map(row => row.id), plan[key].map(row => row.id), 0);
  const invoiceIds = owned.invoices.map(row => row.id);
  const appointmentIds = owned.appointments.map(row => row.id);
  const customerIds = owned.customers.map(row => row.id);
  // Refuse external business use of fixture records. Never cascade into payments,
  // wallets, packages, notifications, inventory, commissions or performance facts.
  const invoices = await db.invoice.findMany({ where: { businessId, id: { in: invoiceIds } }, include: { _count: true } });
  const appointments = await db.appointment.findMany({ where: { businessId, id: { in: appointmentIds } }, include: { _count: true } });
  const customers = await db.customer.findMany({ where: { businessId, id: { in: customerIds } }, include: { _count: true, membership: true } });
  const items = await db.invoiceItem.findMany({ where: { businessId, id: { in: owned.items.map(row => row.id) } }, include: { _count: true } });
  let external = invoices.reduce((count, row) => count + Object.entries(row._count).filter(([key]) => key !== "items").reduce((sum, [, value]) => sum + value, 0) + Number(Boolean(row.workOrderId || row.customerPackageId)), 0);
  external += appointments.reduce((count, row) => count + Object.values(row._count).reduce((sum, value) => sum + value, 0) + Number(Boolean(row.workOrderId)), 0);
  external += customers.reduce((count, row) => count + Object.entries(row._count).filter(([key]) => !["appointments", "invoices"].includes(key)).reduce((sum, [, value]) => sum + value, 0) + Number(Boolean(row.membership)), 0);
  external += items.reduce((count, row) => count + Object.values(row._count).reduce((sum, value) => sum + value, 0), 0);
  external += await db.invoice.count({ where: { customerId: { in: customerIds }, id: { notIn: invoiceIds } } });
  external += await db.invoice.count({ where: { appointmentId: { in: appointmentIds }, id: { notIn: invoiceIds } } });
  external += await db.appointment.count({ where: { customerId: { in: customerIds }, id: { notIn: appointmentIds } } });
  assertCleanupOwnership([], [], external);
  if (owned.items.some(row => !invoiceIds.includes(row.invoiceId)) || owned.invoices.some(row => !row.appointmentId || !appointmentIds.includes(row.appointmentId) || !row.customerId || !customerIds.includes(row.customerId)) || owned.appointments.some(row => !customerIds.includes(row.customerId))) throw new Error("DEMO_CLEANUP_OWNERSHIP_REJECTED");
}

async function protectedSnapshot(db: Database, businessId: string) {
  const ordered = { businessId, orderBy: { id: "asc" as const } };
  const tables = {
    users: await db.user.findMany({ where: { businessId }, orderBy: ordered.orderBy }),
    services: await db.service.findMany({ where: { businessId }, orderBy: ordered.orderBy }),
    serviceAssignments: await db.serviceStaffAssignment.findMany({ where: { businessId }, orderBy: ordered.orderBy }),
    products: await db.product.findMany({ where: { businessId }, orderBy: ordered.orderBy }),
    business: await db.business.findUniqueOrThrow({ where: { id: businessId } }),
    branches: await db.branch.findMany({ where: { businessId }, orderBy: ordered.orderBy }),
    customers: await db.customer.findMany({ where: { businessId, NOT: { name: { startsWith: `${MARKER} ` } } }, orderBy: ordered.orderBy }),
    appointments: await db.appointment.findMany({ where: { businessId, OR: [{ notes: null }, { NOT: { notes: { startsWith: `${MARKER}:` } } }] }, orderBy: ordered.orderBy }),
    invoices: await db.invoice.findMany({ where: { businessId, NOT: { invoiceNumber: { startsWith: `${MARKER}-` } } }, orderBy: ordered.orderBy }),
    items: await db.invoiceItem.findMany({ where: { businessId, invoice: { NOT: { invoiceNumber: { startsWith: `${MARKER}-` } } } }, orderBy: ordered.orderBy }),
    notifications: await db.notificationQueue.findMany({ where: { businessId }, orderBy: ordered.orderBy }),
    whatsapp: await db.whatsAppMessage.findMany({ where: { businessId }, orderBy: ordered.orderBy }),
    payments: await db.payment.findMany({ where: { businessId }, orderBy: ordered.orderBy }),
    financialOperations: await db.financialOperation.findMany({ where: { businessId }, orderBy: ordered.orderBy }),
    walletTransactions: await db.walletTransaction.findMany({ where: { businessId }, orderBy: ordered.orderBy }),
    loyaltyTransactions: await db.loyaltyTransaction.findMany({ where: { businessId }, orderBy: ordered.orderBy }),
  };
  return Object.fromEntries(Object.entries(tables).map(([key, rows]) => [key, { count: Array.isArray(rows) ? rows.length : 1, hash: fingerprint(rows) }]));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--dry-run", "--apply", "--cleanup", "--refine-display-names"].includes(arg)) || args.includes("--apply") && (args.includes("--cleanup") || args.includes("--dry-run") || args.includes("--refine-display-names")) || args.includes("--cleanup") && args.includes("--refine-display-names") || !args.length) throw new Error("Use --dry-run, --apply, --cleanup, or --refine-display-names (with optional --dry-run)");
  loadEnvConfig(process.cwd(), true);
  // Import constants only: do not invoke embedded DB startup/provision/migration helpers.
  const embeddedPath = new URL("../embedded-postgres-utils.mjs", import.meta.url).href;
  const embedded: unknown = await import(embeddedPath);
  if (!embedded || typeof embedded !== "object" || !("DATABASE_URL" in embedded) || typeof embedded.DATABASE_URL !== "string") throw new Error("LOCAL_DATABASE_CONFIGURATION_UNAVAILABLE");
  const url = process.env.DATABASE_URL ?? embedded.DATABASE_URL;
  assertDemoEnvironment(url, process.env);
  const target = new URL(url);
  console.log(JSON.stringify({ environment: "development", hostname: target.hostname, database: target.pathname.slice(1), marker: MARKER }));
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const businesses = await db.business.findMany({ where: { name: "Royal Salon Local" } });
    if (businesses.length !== 1 || businesses[0].industryType !== "SALON_BEAUTY" || businesses[0].status !== "active") throw new Error("DEMO_TARGET_BUSINESS_REJECTED");
    const business = businesses[0];
    const { loadBusinessModuleContext } = await import("../../src/lib/modules/entitlements");
    if (!(await loadBusinessModuleContext(business.id, { database: db })).enabledModules.has("POS")) throw new Error("DEMO_POS_NOT_ENABLED");
    const branches = await db.branch.findMany({ where: { businessId: business.id, status: "ACTIVE" } });
    if (branches.length !== 1) throw new Error("DEMO_BRANCH_AMBIGUOUS");
    const branch = branches[0];
    const people = await db.user.findMany({ where: { businessId: business.id, role: "STAFF", status: "active", appointmentBookable: true, branchId: branch.id, name: { in: APPROVED_NAMES } } });
    const staff = APPROVED_NAMES.map(name => {
      const matches = people.filter(person => person.name === name);
      if (matches.length !== 1) throw new Error("STAFF_PERFORMANCE_DEMO_FIXTURE_STAFF_SET_AMBIGUOUS");
      return matches[0];
    });
    const services = (await db.service.findMany({ where: { businessId: business.id, branchId: branch.id, status: "ACTIVE" }, include: { staffAssignments: true }, orderBy: [{ price: "desc" }, { name: "asc" }, { id: "asc" }] })).filter(service => staff.every(person => service.staffAssignments.some(assignment => assignment.userId === person.id && assignment.businessId === business.id))).slice(0, 5);
    const plan = buildDemoPlan({ businessId: business.id, branchId: branch.id, timezone: business.timezone, staff, services, now: new Date() });
    console.log(JSON.stringify({ business: business.name, branch: branch.name, timezone: business.timezone, cutoff: business.businessDayCutoffTime, services: services.map(service => ({ name: service.name, price: service.price })), planned: { customers: plan.customers.length, appointments: plan.appointments.length, invoices: plan.invoices.length, items: plan.items.length }, summary: plan.summary, cleanup: "Only deterministic marker-owned Customer/Appointment/Invoice/InvoiceItem; never User/Staff/Service/Product" }, null, 2));
    if (business.businessDayCutoffTime !== "02:00") throw new Error("DEMO_DATE_CONTRACT_REQUIRES_REVIEW");
    const before = await protectedSnapshot(db, business.id);
    const result = await db.$transaction(async tx => {
      // Serialize this fixture without creating lock/manifest tables.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${MARKER}))`;
      const owned = await readOwned(tx, business.id);
      const counts = Object.fromEntries(Object.entries(owned).map(([key, rows]) => [key, rows.length]));
      if (args.includes("--refine-display-names")) {
        for (const key of ["customers", "appointments", "invoices"] as const) if (classifyFixture(owned[key], plan[key]) !== "COMPLETE") throw new Error("STAFF_PERFORMANCE_DEMO_FIXTURE_PARTIAL_STATE");
        await verifyCleanup(tx, business.id, plan, owned);
        const updates = planDisplayNameRefinement(owned.items, plan.items);
        console.log(JSON.stringify({ displayNameUpdates: updates.length, ownership: "PASS", externalDependencies: 0 }));
        if (args.includes("--dry-run")) return "DISPLAY_NAMES_DRY_RUN_PASS";
        for (const row of updates) {
          const changed = await tx.invoiceItem.updateMany({ where: { businessId: business.id, id: row.id, invoiceId: row.invoiceId, name: row.previousName, invoice: { invoiceNumber: { startsWith: `${MARKER}-` } } }, data: { name: row.name } });
          if (changed.count !== 1) throw new Error("DEMO_DISPLAY_NAME_UPDATE_REJECTED");
        }
        const refined = await readOwned(tx, business.id);
        if (classifyFixture(refined.items, plan.items) !== "COMPLETE") throw new Error("DEMO_DISPLAY_NAME_POST_VERIFY_FAILED");
        await verifyCleanup(tx, business.id, plan, refined);
        if (fingerprint(before) !== fingerprint(await protectedSnapshot(tx, business.id))) throw new Error("DEMO_PROTECTED_RECORD_CHANGED");
        return updates.length ? "DISPLAY_NAMES_REFINED" : "NO_OP_COMPLETE";
      }
      if (args.includes("--cleanup")) {
        await verifyCleanup(tx, business.id, plan, owned);
        console.log(JSON.stringify({ cleanupCounts: counts, ownership: "PASS", externalDependencies: 0 }));
        if (args.includes("--dry-run")) return "CLEANUP_DRY_RUN_PASS";
        await tx.invoiceItem.deleteMany({ where: { businessId: business.id, id: { in: owned.items.map(row => row.id) } } });
        await tx.invoice.deleteMany({ where: { businessId: business.id, id: { in: owned.invoices.map(row => row.id) } } });
        await tx.appointment.deleteMany({ where: { businessId: business.id, id: { in: owned.appointments.map(row => row.id) } } });
        await tx.customer.deleteMany({ where: { businessId: business.id, id: { in: owned.customers.map(row => row.id) } } });
        return "CLEANED_MARKER_ONLY";
      }
      const states = (["customers", "appointments", "invoices", "items"] as const).map(key => classifyFixture(owned[key], plan[key]));
      if (states.every(state => state === "COMPLETE")) { await verifyCleanup(tx, business.id, plan, owned); return "NO_OP_COMPLETE"; }
      if (states.some(state => state !== "ABSENT")) throw new Error("STAFF_PERFORMANCE_DEMO_FIXTURE_PARTIAL_STATE: run --cleanup before --apply");
      if (args.includes("--dry-run")) return "DRY_RUN_PASS";
      await tx.customer.createMany({ data: plan.customers });
      await tx.appointment.createMany({ data: plan.appointments });
      await tx.invoice.createMany({ data: plan.invoices });
      await tx.invoiceItem.createMany({ data: plan.items });
      const created = await readOwned(tx, business.id);
      for (const key of ["customers", "appointments", "invoices", "items"] as const) if (classifyFixture(created[key], plan[key]) !== "COMPLETE") throw new Error("DEMO_POST_APPLY_FAILED");
      await verifyCleanup(tx, business.id, plan, created);
      if (fingerprint(before) !== fingerprint(await protectedSnapshot(tx, business.id))) throw new Error("DEMO_PROTECTED_RECORD_CHANGED");
      return "APPLIED";
    }, { timeout: 60_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const after = await protectedSnapshot(db, business.id);
    if (fingerprint(before) !== fingerprint(after)) throw new Error("DEMO_PROTECTED_RECORD_CHANGED");
    console.log(JSON.stringify({ result, protectedRecordsUnchanged: before, outboundCreated: 0, paymentCreated: 0, walletCreated: 0, financialOperationCreated: 0 }, null, 2));
    if (result === "APPLIED" || result === "NO_OP_COMPLETE" || result === "DISPLAY_NAMES_REFINED") {
      const owner = await db.user.findFirstOrThrow({ where: { businessId: business.id, role: "BUSINESS_OWNER", status: "active" } });
      const access = { granted: true as const, userId: owner.id, homeBusinessId: business.id, businessId: business.id, branchId: branch.id, identityRole: owner.role, actorRole: owner.role, effectiveBusinessRole: "BUSINESS_OWNER" as const, permissions: [], industryType: business.industryType, source: "DIRECT_BUSINESS" as const, groupId: null, groupUserId: null, capability: null };
      const { readStaffPerformance } = await import("../../src/lib/business-performance/staff-performance");
      for (const person of staff) {
        const input = { businessId: business.id, salonAccess: { access, requestedBranchId: branch.id }, subject: { type: "staff" as const, userId: person.id }, fromDate: businessWallClockToUtc("2026-10-01", business.businessDayCutoffTime, business.timezone), toDateExclusive: businessWallClockToUtc("2026-11-01", business.businessDayCutoffTime, business.timezone) };
        const detail = await readStaffPerformance(input, db);
        if (!detail) throw new Error("DEMO_READ_MODEL_MISSING");
        // Independent row-level reconciliation, including any pre-existing Local
        // facts. Do not mistake existing history for a fixture-created delta.
        const period = { gte: input.fromDate, lt: input.toDateExclusive };
        const invoices = await db.invoice.findMany({ where: { businessId: business.id, branchId: branch.id, status: { not: "VOID" }, issuedAt: period, appointment: { assignedStaffId: person.id } }, include: { items: true } });
        const appointments = await db.appointment.findMany({ where: { businessId: business.id, branchId: branch.id, assignedStaffId: person.id, scheduledAt: period, status: { notIn: ["CANCELLED", "NO_SHOW"] } } });
        const completed = appointments.filter(row => row.status === "COMPLETED");
        const lines = invoices.flatMap(row => row.items);
        const sum = (rows: typeof lines) => rows.reduce((amount, row) => amount.add(row.lineTotal), new Prisma.Decimal(0)).toNumber();
        const expected = { attributedSales: sum(lines), appointments: appointments.length, completedAppointments: completed.length, customersServed: new Set(completed.map(row => row.customerId)).size, servicesSold: lines.filter(row => row.serviceId).reduce((quantity, row) => quantity + row.quantity, 0) };
        if (fingerprint(expected) !== fingerprint(detail.summary) || detail.invoiceCount !== invoices.length || detail.otherAttributedItems !== sum(lines.filter(row => !row.serviceId)) || detail.averageAttributedInvoice !== expected.attributedSales / invoices.length) throw new Error("DEMO_READ_MODEL_RECONCILIATION_FAILED");
        console.log(JSON.stringify({ readModelReconciliation: "PASS", name: person.name }));
        console.log(JSON.stringify({ name: person.name, ...detail.summary, invoices: detail.invoiceCount, averageAttributedInvoice: detail.averageAttributedInvoice, topService: detail.topService, otherAttributedItems: detail.otherAttributedItems, activityPage1: detail.activity.length, pageCount: detail.pageCount }));
        if (person.id === staff[0].id) {
          const page2 = await readStaffPerformance({ ...input, page: 2 }, db);
          if (!page2 || fingerprint(detail.summary) !== fingerprint(page2.summary) || detail.activity.length !== 20 || page2.activity.length !== detail.invoiceCount - 20) throw new Error("DEMO_PAGINATION_FAILED");
          console.log(JSON.stringify({ pagination: "PASS", page1: 20, page2: page2.activity.length, summaryUnchanged: true }));
        }
      }
    }
  } finally { await db.$disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  // Prisma error details can include connection secrets; report safe code only.
  console.error(error instanceof Error && !error.name.startsWith("Prisma") ? error.message : "STAFF_PERFORMANCE_DEMO_FIXTURE_DATABASE_OPERATION_FAILED");
  process.exitCode = 1;
});
