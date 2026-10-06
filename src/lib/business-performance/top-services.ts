import type { InvoiceItemKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveInvoiceItemKind } from "@/lib/invoice-item/classification";
import { financialReadSnapshot } from "@/lib/reports/financial-read-snapshot";
import { fromCents, toCents } from "@/lib/validation/pos";
import { resolveSalonPerformanceScope, type SalonAccess } from "./salon-scope";

export type TopServiceRow = { serviceId: string; name: string; quantity: number; salesAmount: string };
type Database = Pick<Prisma.TransactionClient, "branch" | "invoiceItem" | "service">;

export function classifyTopServiceItem(item: { kind: InvoiceItemKind | null; serviceId: string | null }) {
  const kind = resolveInvoiceItemKind(item);
  if (kind === "SERVICE") return "EXPLICIT_SERVICE";
  if (kind !== "UNKNOWN_LEGACY") return "EXPLICIT_NON_SERVICE";
  // Consumer-only compatibility, not authoritative legacy identity. The shared
  // classifier intentionally remains UNKNOWN_LEGACY for every historical null.
  return item.serviceId !== null ? "LEGACY_SERVICE_CANDIDATE" : "LEGACY_NON_SERVICE_OR_UNKNOWN";
}

/** Business service-item invoiced units, not performed services or net revenue. */
export function readBusinessTopServices(input: {
  businessId: string; salonAccess: SalonAccess; fromDate: Date; toDateExclusive: Date;
}, database: Database = prisma): Promise<TopServiceRow[]> {
  return financialReadSnapshot(database, async tx => {
    const branchFilter = await resolveSalonPerformanceScope(input.businessId, input.salonAccess, tx);
    if (typeof branchFilter.branchId === "object" && !branchFilter.branchId.in.length) return [];
    // Both consumers pass their existing resolved business-day window. Do not
    // use payment dates, require attribution links, or pre-limit item groups.
    const groups = await tx.invoiceItem.groupBy({
      by: ["kind", "serviceId", "name"],
      where: { businessId: input.businessId, serviceId: { not: null },
        OR: [{ kind: "SERVICE" }, { kind: null }],
        invoice: { businessId: input.businessId, ...branchFilter, status: { not: "VOID" },
          issuedAt: { gte: input.fromDate, lt: input.toDateExclusive } } },
      _sum: { quantity: true, lineTotal: true },
    });
    const eligible = groups.filter(row => {
      const classification = classifyTopServiceItem(row);
      return row.serviceId !== null && (classification === "EXPLICIT_SERVICE" || classification === "LEGACY_SERVICE_CANDIDATE");
    });
    const serviceIds = [...new Set(eligible.flatMap(row => row.serviceId ? [row.serviceId] : []))];
    const services = serviceIds.length ? await tx.service.findMany({
      where: { businessId: input.businessId, id: { in: serviceIds } }, select: { id: true, name: true },
    }) : [];
    const currentNames = new Map(services.map(row => [row.id, row.name]));
    const totals = new Map<string, { quantity: number; cents: number; historicalName: string | null }>();
    for (const group of eligible) {
      if (!group.serviceId) continue;
      const row = totals.get(group.serviceId) ?? { quantity: 0, cents: 0, historicalName: null };
      row.quantity += group._sum.quantity ?? 0;
      row.cents += toCents(group._sum.lineTotal ?? 0);
      if (group.name.trim() && (row.historicalName === null || compareText(group.name, row.historicalName) < 0)) row.historicalName = group.name;
      totals.set(group.serviceId, row);
    }
    return [...totals].map(([serviceId, row]) => ({
      serviceId, name: currentNames.get(serviceId)?.trim() ? currentNames.get(serviceId)! : row.historicalName ?? "Unknown service",
      quantity: row.quantity, salesAmount: fromCents(row.cents),
    })).sort((a, b) => b.quantity - a.quantity || compareText(a.name, b.name) || compareText(a.serviceId, b.serviceId));
  });
}

function compareText(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }
