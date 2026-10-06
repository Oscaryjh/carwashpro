import type { InvoiceItemKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveInvoiceItemKind } from "@/lib/invoice-item/classification";
import { financialReadSnapshot } from "@/lib/reports/financial-read-snapshot";
import { hasBroadSalonPerformanceAccess, resolveSalonPerformanceScope, type SalonAccess } from "./salon-scope";
import { attributedLineTotal, isStaffUserId, salonInvoiceSubjectWhere, salonInvoiceWhere, type StaffPerformanceSubject } from "./salon-attribution";

export const STAFF_ACTIVITY_PAGE_SIZE = 20;
export function classifyStaffPerformanceServiceItem(item: { kind: InvoiceItemKind | null; serviceId: string | null }) {
  const kind = resolveInvoiceItemKind(item);
  if (kind === "SERVICE") return "EXPLICIT_SERVICE";
  if (kind !== "UNKNOWN_LEGACY") return "EXPLICIT_NON_SERVICE";
  // Legacy serviceId fallback is compatibility only, not authoritative item identity.
  return item.serviceId !== null ? "LEGACY_SERVICE_CANDIDATE" : "LEGACY_NON_SERVICE_OR_UNKNOWN";
}
function isStaffPerformanceServiceItem(item: { kind: InvoiceItemKind | null; serviceId: string | null }) {
  const classification = classifyStaffPerformanceServiceItem(item);
  return classification === "EXPLICIT_SERVICE" || classification === "LEGACY_SERVICE_CANDIDATE";
}
type Database = Pick<Prisma.TransactionClient, "invoice" | "invoiceItem" | "appointment" | "user" | "branch" | "service">;
export type StaffServiceRow = { serviceId: string; name: string; quantity: number; amount: number };
export type StaffPerformanceDetail = {
  subject: StaffPerformanceSubject;
  name: string;
  summary: { attributedSales: number; appointments: number; completedAppointments: number; customersServed: number; servicesSold: number };
  invoiceCount: number;
  averageAttributedInvoice: number | null;
  serviceBreakdown: StaffServiceRow[];
  topService: StaffServiceRow | null;
  otherAttributedItems: number;
  activity: { id: string; invoiceNumber: string; issuedAt: Date; branchId: string | null; customerName: string; serviceNames: string[]; amount: number }[];
  page: number;
  pageCount: number;
};

export async function readStaffPerformance(input: {
  businessId: string; salonAccess: SalonAccess; subject: StaffPerformanceSubject;
  fromDate: Date; toDateExclusive: Date; page?: unknown;
}, database: Database = prisma): Promise<StaffPerformanceDetail | null> {
  if (input.subject.type === "staff" && !isStaffUserId(input.subject.userId)) return null;
  return financialReadSnapshot(database, async tx => {
    const { businessId, subject, fromDate, toDateExclusive } = input;
    const branchFilter = await resolveSalonPerformanceScope(businessId, input.salonAccess, tx);
    if (typeof branchFilter.branchId === "object" && !branchFilter.branchId.in.length) return null;
    const visibility: Prisma.UserWhereInput = {};
    if (!hasBroadSalonPerformanceAccess(input.salonAccess.access)) {
      const branchId = branchFilter.branchId;
      if (typeof branchId !== "string") return null;
      visibility.OR = [
        { employeeBusinessMembershipId: null, branchId, branch: { is: { businessId } } },
        { employeeBusinessMembership: { is: {
          businessId,
          branchAssignments: { some: {
            businessId, branchId, branch: { is: { businessId } },
            effectiveFrom: { lte: new Date() },
          } },
        } } },
      ];
    }
    // Historical read identity is independent of this period's facts and of
    // login/bookability. Ended assignments remain evidence; future ones do not.
    const staff = subject.type === "staff" ? await tx.user.findFirst({
      where: { businessId, id: subject.userId, ...visibility }, select: { name: true },
    }) : null;
    if (subject.type === "staff" && !staff) return null;
    const invoiceWhere: Prisma.InvoiceWhereInput = {
      ...salonInvoiceWhere({ businessId, branchFilter, fromDate, toDateExclusive }),
      AND: [salonInvoiceSubjectWhere(subject)],
    };
    const appointmentWhere: Prisma.AppointmentWhereInput = {
      businessId, ...branchFilter, assignedStaffId: subject.type === "staff" ? subject.userId : null,
      scheduledAt: { gte: fromDate, lt: toDateExclusive },
    };
    const [invoiceCount, totals, appointmentGroups, completedCustomers, serviceGroups] = await Promise.all([
      tx.invoice.count({ where: invoiceWhere }),
      tx.invoiceItem.aggregate({ where: { invoice: invoiceWhere }, _sum: { lineTotal: true } }),
      tx.appointment.groupBy({ by: ["status"], where: { ...appointmentWhere, status: { notIn: ["CANCELLED", "NO_SHOW"] } }, _count: true }),
      tx.appointment.groupBy({ by: ["customerId"], where: { ...appointmentWhere, status: "COMPLETED" }, _count: true }),
      tx.invoiceItem.groupBy({ by: ["kind", "serviceId", "name"], where: { invoice: invoiceWhere }, _sum: { quantity: true, lineTotal: true } }),
    ]);
    const appointments = appointmentGroups.reduce((sum, row) => sum + row._count, 0);
    if (!invoiceCount && !appointments) return {
      subject, name: staff?.name ?? "Unassigned",
      summary: { attributedSales: 0, appointments: 0, completedAppointments: 0, customersServed: 0, servicesSold: 0 },
      invoiceCount: 0, averageAttributedInvoice: null, serviceBreakdown: [],
      topService: null, otherAttributedItems: 0, activity: [], page: 1, pageCount: 1,
    };
    const eligibleServiceGroups = serviceGroups.filter(isStaffPerformanceServiceItem);
    const servicesSold = eligibleServiceGroups.reduce((sum, row) => sum + (row._sum.quantity ?? 0), 0);
    // SERVICE identity can survive a missing serviceId; keep its value out of Other.
    const serviceSubtotal = eligibleServiceGroups.reduce((sum, row) => sum + Number(row._sum.lineTotal ?? 0), 0);
    const serviceIds = [...new Set(eligibleServiceGroups.flatMap(row => row.serviceId ? [row.serviceId] : []))];
    const currentServices = serviceIds.length ? await tx.service.findMany({ where: { businessId, id: { in: serviceIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(currentServices.map(row => [row.id, row.name]));
    const grouped = new Map<string, StaffServiceRow>();
    for (const row of eligibleServiceGroups) {
      if (!row.serviceId) continue;
      const entry = grouped.get(row.serviceId) ?? { serviceId: row.serviceId, name: names.get(row.serviceId) ?? row.name, quantity: 0, amount: 0 };
      if (!names.has(row.serviceId) && compareText(row.name, entry.name) < 0) entry.name = row.name;
      entry.quantity += row._sum.quantity ?? 0;
      entry.amount += Number(row._sum.lineTotal ?? 0);
      grouped.set(row.serviceId, entry);
    }
    const serviceBreakdown = [...grouped.values()].sort((a, b) => b.quantity - a.quantity || compareText(a.name, b.name) || compareText(a.serviceId, b.serviceId));
    const pageCount = Math.max(1, Math.ceil(invoiceCount / STAFF_ACTIVITY_PAGE_SIZE));
    const requestedPage = Number(input.page ?? 1);
    const page = Math.min(pageCount, Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
    const activityInvoices = await tx.invoice.findMany({
      where: invoiceWhere, orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
      take: STAFF_ACTIVITY_PAGE_SIZE, skip: (page - 1) * STAFF_ACTIVITY_PAGE_SIZE,
      select: { id: true, invoiceNumber: true, issuedAt: true, branchId: true, customer: { select: { name: true } }, workOrder: { select: { customer: { select: { name: true } } } }, appointment: { select: { customer: { select: { name: true } } } }, items: { select: { kind: true, serviceId: true, name: true, lineTotal: true } } },
    });
    // Database SUM keeps the same original lineTotal contract, not payments or refund netting.
    const attributedSales = Number(totals._sum.lineTotal ?? 0);
    return {
      subject, name: staff?.name ?? "Unassigned",
      summary: { attributedSales, appointments, completedAppointments: appointmentGroups.find(row => row.status === "COMPLETED")?._count ?? 0, customersServed: completedCustomers.filter(row => row.customerId != null).length, servicesSold },
      invoiceCount, averageAttributedInvoice: invoiceCount ? attributedSales / invoiceCount : null,
      serviceBreakdown, topService: serviceBreakdown[0] ?? null,
      // Signed reconciliation: adjustments can make this negative.
      otherAttributedItems: (Math.round(attributedSales * 100) - Math.round(serviceSubtotal * 100)) / 100,
      activity: activityInvoices.map(row => ({ id: row.id, invoiceNumber: row.invoiceNumber, issuedAt: row.issuedAt, branchId: row.branchId, customerName: row.workOrder?.customer?.name ?? row.appointment?.customer?.name ?? row.customer?.name ?? "—", serviceNames: row.items.filter(item => isStaffPerformanceServiceItem(item) && item.name.trim()).map(item => item.name), amount: attributedLineTotal(row.items) })),
      page, pageCount,
    };
  });
}

function compareText(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }
