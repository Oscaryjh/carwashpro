import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Existing Salon Reports contract. Callers supply their already-authorized scope
// and resolved period. This is not receipt/contribution-based Team Performance.
export type SalonPerformance = Omit<Awaited<ReturnType<typeof readSalonPerformance>>, "sourceInvoices">;

export async function readSalonPerformance({
  businessId,
  branchFilter,
  fromDate,
  toDateExclusive,
}: {
  businessId: string;
  branchFilter: { branchId?: string | { in: string[] } };
  fromDate: Date;
  toDateExclusive: Date;
}, database: Pick<Prisma.TransactionClient, "appointment" | "invoice" | "user"> = prisma) {
  const appointmentWhere: Prisma.AppointmentWhereInput = {
    businessId,
    ...branchFilter,
    scheduledAt: { gte: fromDate, lt: toDateExclusive },
  };
  const validAppointmentWhere: Prisma.AppointmentWhereInput = {
    ...appointmentWhere,
    status: { notIn: ["CANCELLED", "NO_SHOW"] },
  };
  const salonInvoiceLink = {
    OR: [
      { appointmentId: { not: null } },
      { workOrderId: { not: null } },
    ],
  } satisfies Prisma.InvoiceWhereInput;

  const [
    appointmentsByStatus,
    repeatCustomerGroups,
    invoices,
    staffAppointmentGroups,
  ] = await Promise.all([
    database.appointment.groupBy({
      by: ["status"],
      where: appointmentWhere,
      _count: true,
      orderBy: { _count: { status: "desc" } },
    }),
    database.appointment.groupBy({
      by: ["customerId"],
      where: validAppointmentWhere,
      _count: true,
    }),
    database.invoice.findMany({
      where: {
        businessId,
        ...branchFilter,
        ...salonInvoiceLink,
        status: { not: "VOID" },
        issuedAt: { gte: fromDate, lt: toDateExclusive },
      },
      select: {
        items: {
          select: { name: true, quantity: true, lineTotal: true },
        },
        appointment: {
          select: {
            assignedStaffId: true,
            assignedStaff: { select: { id: true, name: true } },
          },
        },
      },
    }),
    database.appointment.groupBy({
      by: ["assignedStaffId"],
      where: validAppointmentWhere,
      _count: true,
    }),
  ]);

  const assignedStaffIds = staffAppointmentGroups
    .map((row) => row.assignedStaffId)
    .filter((id): id is string => Boolean(id));
  const staffUsers = assignedStaffIds.length
    ? await database.user.findMany({
        where: { businessId, id: { in: assignedStaffIds } },
        select: { id: true, name: true },
      })
    : [];
  const staffNames = new Map(staffUsers.map((staff) => [staff.id, staff.name]));

  const staffAmountMap = new Map<string, { name: string; amount: number }>();
  for (const invoice of invoices) {
    const staffId = invoice.appointment?.assignedStaffId ?? "unassigned";
    const staffName =
      invoice.appointment?.assignedStaff?.name ?? staffNames.get(staffId) ?? "Unassigned";
    const staffEntry = staffAmountMap.get(staffId) ?? { name: staffName, amount: 0 };

    for (const item of invoice.items) {
      staffEntry.amount += Number(item.lineTotal);
    }

    staffAmountMap.set(staffId, staffEntry);
  }

  const staffSales = Array.from(
    new Set([
      ...staffAppointmentGroups.map((row) => row.assignedStaffId ?? "unassigned"),
      ...staffAmountMap.keys(),
    ]),
  )
    .map((id) => {
      const appointmentGroup = staffAppointmentGroups.find(
        (row) => (row.assignedStaffId ?? "unassigned") === id,
      );
      const amount = staffAmountMap.get(id);
      return {
        id,
        name:
          amount?.name ??
          (id === "unassigned" ? "Unassigned" : staffNames.get(id) ?? "Staff"),
        appointments: appointmentGroup?._count ?? 0,
        amount: amount?.amount ?? 0,
      };
    })
    .sort((left, right) => right.amount - left.amount ||
      compareText(left.name, right.name) || compareText(left.id, right.id));

  const statusCountMap = new Map<string, number>();
  for (const row of appointmentsByStatus) {
    const status = ["CONFIRMED", "ARRIVED", "IN_SERVICE"].includes(row.status)
      ? "SCHEDULED"
      : row.status;
    statusCountMap.set(status, (statusCountMap.get(status) ?? 0) + row._count);
  }
  const statusRows = Array.from(statusCountMap.entries())
    .map(([status, appointments]) => ({ status, appointments }))
    .sort((left, right) => right.appointments - left.appointments);
  const countForStatus = (status: string) =>
    statusRows.find((row) => row.status === status)?.appointments ?? 0;
  const totalAppointments = statusRows.reduce((total, row) => total + row.appointments, 0);
  return {
    totalAppointments,
    completedAppointments: countForStatus("COMPLETED"),
    cancelledAppointments: countForStatus("CANCELLED"),
    noShowAppointments: countForStatus("NO_SHOW"),
    repeatCustomers: repeatCustomerGroups.filter((row) => row._count > 1).length,
    sourceInvoices: invoices,
    staffSales,
    statusRows,
  };
}

// Code-point order is deterministic across server locales and database ordering.
function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
