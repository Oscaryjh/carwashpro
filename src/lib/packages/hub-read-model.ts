import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolvePackageHubScope } from "./hub-scope";
import { eventTypeSchema } from "./activity-types";
import type { PackageHubContext, PackageHubWindow, PackageHubActivityInput, PackageHubCurrentInput, PackageHubPage } from "./hub-types";

const periodSchema = z.object({ fromDate: z.date(), toDateExclusive: z.date() }).refine(p => p.fromDate < p.toDateExclusive, "Invalid Package period.");
const filtersSchema = z.object({ cursor: z.string().max(2048).nullish(), search: z.string().trim().max(160).default(""),
  packageId: z.string().uuid().optional(), packageSearch: z.string().trim().max(160).default("") });
const statusSchema = z.enum(["ACTIVE", "USED_UP", "PENDING_PAYMENT", "CANCELLED"]);
const cursorSchema = z.object({ id: z.string().uuid(), date: z.string().datetime() }).strict();
function cursor(value: string | null | undefined) { return value ? cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8"))) : null; }
function page<T>(rows: T[], key: (row: T) => { id: string; date: Date }): PackageHubPage<T> {
  const visible = rows.slice(0, 20), last = visible.at(-1);
  return { rows: visible, pageSize: 20, nextCursor: rows.length > 20 && last
    ? Buffer.from(JSON.stringify({ ...key(last), date: key(last).date.toISOString() })).toString("base64url") : null };
}
function snapshot<T>(db: PrismaClient, read: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(async tx => { await tx.$executeRaw`SET TRANSACTION READ ONLY`; return read(tx); }, { isolationLevel: "RepeatableRead" });
}
function cpWhere(businessId: string, filters: z.infer<typeof filtersSchema>): Prisma.CustomerPackageWhereInput {
  return { businessId, customer: { businessId, ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" as const } } : {}) },
    package: { businessId, ...(filters.packageSearch ? { name: { contains: filters.packageSearch, mode: "insensitive" as const } } : {}) },
    ...(filters.packageId ? { packageId: filters.packageId } : {}) };
}
const cpInclude = {
  customer: { select: { name: true } }, package: { select: { name: true } }, branch: { select: { name: true } },
  serviceBalances: { include: { service: { select: { name: true } } }, orderBy: { id: "asc" } },
  packageActivities: { orderBy: { sequence: "desc" }, take: 1 },
} satisfies Prisma.CustomerPackageInclude;
type PackageRow = Prisma.CustomerPackageGetPayload<{ include: typeof cpInclude }>;

/** Batch evidence, never inferred from purchasedAt. An incomplete chain or any
 * disagreement with current state remains explicitly incomplete. */
async function history(tx: Prisma.TransactionClient, businessId: string, rows: PackageRow[]) {
  if (!rows.length) return new Map<string, boolean>();
  const ids = rows.map(row => row.id), where = { businessId, customerPackageId: { in: ids } };
  const starts = await tx.customerPackageActivity.findMany({ where: { ...where, eventType: "PURCHASED", sequence: 1, remainingBefore: 0, statusBefore: "PENDING_PAYMENT" } });
  const aggregates = await tx.customerPackageActivity.groupBy({ by: ["customerPackageId"], where, _count: { _all: true }, _sum: { usesDelta: true }, _max: { sequence: true } });
  const startMap = new Map(starts.map(row => [row.customerPackageId, row]));
  const aggregateMap = new Map(aggregates.map(row => [row.customerPackageId, row]));
  // Sum(delta) can hide two offsetting unrecorded mutations. Compare every
  // adjacent persisted state, not just the sum and final balance. Batch all
  // entitlements on this page; do not load unbounded histories into Node.
  const gaps = await tx.$queryRaw<{ customer_package_id: string }[]>(Prisma.sql`
    WITH chain AS (
      SELECT customer_package_id, sequence, remaining_before, status_before, total_uses_snapshot,
        lag(remaining_after) OVER w AS previous_remaining,
        lag(status_after) OVER w AS previous_status,
        lag(total_uses_snapshot) OVER w AS previous_total
      FROM customer_package_activities
      WHERE business_id = ${businessId}::uuid
        AND customer_package_id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})
      WINDOW w AS (PARTITION BY customer_package_id ORDER BY sequence)
    )
    SELECT DISTINCT customer_package_id FROM chain
    WHERE sequence > 1 AND (remaining_before IS DISTINCT FROM previous_remaining
      OR status_before IS DISTINCT FROM previous_status
      OR total_uses_snapshot IS DISTINCT FROM previous_total)
  `);
  const incomplete = new Set(gaps.map(row => row.customer_package_id));
  return new Map(rows.map(row => {
    const start = startMap.get(row.id), aggregate = aggregateMap.get(row.id), last = row.packageActivities[0];
    const complete = !incomplete.has(row.id) && start && aggregate && last && start.totalUsesSnapshot === row.totalUses
      && aggregate._count._all === aggregate._max.sequence && aggregate._sum.usesDelta === row.remainingUses
      && last.remainingAfter === row.remainingUses && last.statusAfter === row.status;
    return [row.id, !complete];
  }));
}

export async function readPackageHubOverview(ctx: PackageHubContext, input: PackageHubWindow, db: PrismaClient = prisma) {
  const window = periodSchema.parse(input);
  return snapshot(db, async tx => {
    const scope = await resolvePackageHubScope(ctx, tx);
    const entitlement = { ...cpWhere(scope.businessId, filtersSchema.parse({})), ...(scope.branchId ? { branchId: scope.branchId } : {}) };
    const current = await tx.customerPackage.groupBy({ by: ["status"],
      where: { ...entitlement, status: { in: ["ACTIVE", "USED_UP"] } },
      _count: { _all: true }, _sum: { remainingUses: true }, _min: { remainingUses: true } });
    // Validate the minimum too: a positive aggregate must not hide a corrupt
    // negative entitlement. Only the two DB-aggregated status rows are summed.
    const remainingUses = z.number().int().nonnegative("Invalid current package remaining uses.");
    const usesLeft = remainingUses.parse(current.reduce((sum, row) => {
      remainingUses.parse(row._min.remainingUses ?? 0);
      return sum + remainingUses.parse(row._sum.remainingUses ?? 0);
    }, 0));
    const activity: Prisma.CustomerPackageActivityWhereInput = { businessId: scope.businessId,
      customerPackage: cpWhere(scope.businessId, filtersSchema.parse({})),
      ...(scope.branchId ? { branchId: scope.branchId } : {}), occurredAt: { gte: window.fromDate, lt: window.toDateExclusive } };
    // PURCHASED has a canonical unique entitlement constraint: counting its rows
    // equals distinct sold entitlements, never invoice or payment cardinality.
    const sold = await tx.customerPackageActivity.count({ where: { ...activity, eventType: "PURCHASED" } });
    const used = await tx.customerPackageActivity.aggregate({ where: { ...activity, eventType: "USED" }, _sum: { usesDelta: true } });
    const restored = await tx.customerPackageActivity.aggregate({ where: { ...activity, eventType: "RESTORED", usesDelta: { gt: 0 } }, _sum: { usesDelta: true } });
    return { current: { activePackages: current.find(row => row.status === "ACTIVE")?._count._all ?? 0, usesLeft,
      currentlyUsedUp: current.find(row => row.status === "USED_UP")?._count._all ?? 0 },
      period: { packagesSold: sold, packageUses: -(used._sum.usesDelta ?? 0) || 0, restoredUses: restored._sum.usesDelta ?? 0 }, ...window };
  });
}

const activityInclude = { customerPackage: { include: cpInclude }, actor: { select: { name: true } },
  assignedStaff: { select: { name: true } }, service: { select: { name: true } }, branch: { select: { name: true } } } satisfies Prisma.CustomerPackageActivityInclude;
async function readEvents(ctx: PackageHubContext, input: PackageHubActivityInput, sales: boolean, db: PrismaClient) {
  const period = periodSchema.parse(input), filters = filtersSchema.parse(input), after = cursor(filters.cursor);
  const eventType = sales ? "PURCHASED" as const : input.eventType ? eventTypeSchema.parse(input.eventType) : undefined;
  return snapshot(db, async tx => {
    const scope = await resolvePackageHubScope(ctx, tx);
    const rows = await tx.customerPackageActivity.findMany({ where: { businessId: scope.businessId,
      customerPackage: cpWhere(scope.businessId, filters), ...(scope.branchId ? { branchId: scope.branchId } : {}),
      ...(eventType ? { eventType } : {}), occurredAt: { gte: period.fromDate, lt: period.toDateExclusive },
      ...(after ? { OR: [{ occurredAt: { lt: new Date(after.date) } }, { occurredAt: new Date(after.date), id: { lt: after.id } }] } : {}),
    }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 21, include: activityInclude });
    const flags = await history(tx, scope.businessId, [...new Map(rows.map(row => [row.customerPackageId, row.customerPackage])).values()]);
    return page(rows.map(row => ({
      activityId: row.id, occurredAt: row.occurredAt, eventType: row.eventType, customerPackageId: row.customerPackageId,
      packageId: row.customerPackage.packageId, packageName: row.customerPackage.package.name,
      customerId: row.customerPackage.customerId, customerName: row.customerPackage.customer.name,
      serviceId: row.serviceId, serviceName: row.service?.name ?? null, usesChanged: row.usesDelta,
      remainingBefore: row.remainingBefore, remainingAfter: row.remainingAfter, requestedUses: row.requestedUses,
      statusBefore: row.statusBefore, statusAfter: row.statusAfter, serviceChanges: row.serviceChanges,
      branchId: row.branchId, branchName: row.branch?.name ?? null, actorUserId: row.actorUserId, actorName: row.actor.name,
      assignedStaffId: row.assignedStaffId, assignedStaffName: row.assignedStaff?.name ?? null,
      invoiceId: row.invoiceId, invoiceItemId: row.invoiceItemId, paymentId: row.paymentId, paymentRefundId: row.paymentRefundId,
      originalUseActivityId: row.originalUseActivityId, additionalSourceRefs: row.additionalSourceRefs,
      reason: row.reason, historyMayBeIncomplete: flags.get(row.customerPackageId) ?? true,
      purchasePrice: row.customerPackage.purchasePrice.toFixed(2), initialTotalUses: row.totalUsesSnapshot,
      status: row.customerPackage.status, remainingUses: row.customerPackage.remainingUses,
    })), row => ({ id: row.activityId, date: row.occurredAt }));
  });
}
export function readPackageHubActivity(ctx: PackageHubContext, input: PackageHubActivityInput, db: PrismaClient = prisma) { return readEvents(ctx, input, false, db); }
export function readPackageHubSales(ctx: PackageHubContext, input: PackageHubActivityInput, db: PrismaClient = prisma) { return readEvents(ctx, input, true, db); }

export async function readPackageHubCustomerPackages(ctx: PackageHubContext, input: PackageHubCurrentInput, db: PrismaClient = prisma) {
  const filters = filtersSchema.parse(input), after = cursor(filters.cursor), status = input.status ? statusSchema.parse(input.status) : undefined;
  return snapshot(db, async tx => {
    const scope = await resolvePackageHubScope(ctx, tx);
    // CRM keeps pending and cancelled entitlements. Period never filters current state.
    const rows = await tx.customerPackage.findMany({ where: { ...cpWhere(scope.businessId, filters),
      ...(scope.branchId ? { branchId: scope.branchId } : {}), ...(status ? { status } : {}),
      ...(after ? { OR: [{ purchasedAt: { lt: new Date(after.date) } }, { purchasedAt: new Date(after.date), id: { lt: after.id } }] } : {}),
    }, orderBy: [{ purchasedAt: "desc" }, { id: "desc" }], take: 21, include: cpInclude });
    const flags = await history(tx, scope.businessId, rows);
    return page(rows.map(row => ({ customerPackageId: row.id, customerId: row.customerId, customerName: row.customer.name,
      packageId: row.packageId, packageName: row.package.name, remainingUses: row.remainingUses, totalUses: row.totalUses,
      status: row.status, purchasedAt: row.purchasedAt, branchId: row.branchId, branchName: row.branch?.name ?? null,
      serviceBalances: row.serviceBalances.filter(balance => balance.businessId === scope.businessId).map(balance => ({
        balanceId: balance.id, serviceId: balance.serviceId, serviceName: balance.service.name, remainingUses: balance.remainingUses, totalUses: balance.totalUses,
      })), lastActivityAt: row.packageActivities[0]?.occurredAt ?? null, historyMayBeIncomplete: flags.get(row.id) ?? true,
    })), row => ({ id: row.customerPackageId, date: row.purchasedAt }));
  });
}
