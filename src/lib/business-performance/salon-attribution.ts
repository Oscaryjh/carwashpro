import type { Prisma } from "@prisma/client";

export type StaffPerformanceSubject = { type: "staff"; userId: string } | { type: "unassigned" };
export const isStaffUserId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function salonInvoiceWhere({ businessId, branchFilter, fromDate, toDateExclusive }: {
  businessId: string;
  branchFilter: { branchId?: string | { in: string[] } };
  fromDate: Date;
  toDateExclusive: Date;
}): Prisma.InvoiceWhereInput {
  return {
    businessId, ...branchFilter,
    OR: [{ appointmentId: { not: null } }, { workOrderId: { not: null } }],
    status: { not: "VOID" },
    issuedAt: { gte: fromDate, lt: toDateExclusive },
  };
}

// Attribution is only the directly linked appointment; never follow workOrder.
export function salonInvoiceSubjectWhere(subject: StaffPerformanceSubject): Prisma.InvoiceWhereInput {
  return subject.type === "staff"
    ? { appointment: { is: { assignedStaffId: subject.userId } } }
    : { OR: [{ appointment: null }, { appointment: { is: { assignedStaffId: null } } }] };
}

export function attributedLineTotal(items: readonly { lineTotal: unknown }[], initial = 0): number {
  return items.reduce((total, item) => total + Number(item.lineTotal), initial);
}
