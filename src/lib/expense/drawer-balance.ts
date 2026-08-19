import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ExpenseDrawerShiftBalance = {
  availableCash: string;
  branchId: string;
  cashierId: string;
  cashierName: string;
  id: string;
  startedAt: Date;
};

export async function listOpenExpenseDrawerShifts(input: {
  branchIds: string[];
  businessId: string;
}): Promise<ExpenseDrawerShiftBalance[]> {
  const branchIds = [...new Set(input.branchIds)];
  if (!branchIds.length) return [];

  const shifts = await prisma.cashierShift.findMany({
    where: { branchId: { in: branchIds }, businessId: input.businessId, status: "OPEN" },
    orderBy: { startedAt: "desc" },
    select: { branchId: true, cashierId: true, cashier: { select: { name: true } }, id: true, openingFloat: true, startedAt: true },
  });
  if (!shifts.length) return [];

  const shiftIds = shifts.map((shift) => shift.id);
  const [payments, refunds, payouts] = await Promise.all([
    prisma.payment.groupBy({ by: ["shiftId"], where: { businessId: input.businessId, method: "CASH", shiftId: { in: shiftIds }, status: "ACTIVE" }, _sum: { amount: true } }),
    prisma.paymentRefund.groupBy({ by: ["shiftId"], where: { businessId: input.businessId, method: "CASH", shiftId: { in: shiftIds } }, _sum: { amount: true } }),
    prisma.cashierShiftExpensePayout.groupBy({ by: ["shiftId"], where: { businessId: input.businessId, shiftId: { in: shiftIds } }, _sum: { amount: true } }),
  ]);

  const paymentByShift = new Map(payments.flatMap((row) => row.shiftId ? [[row.shiftId, row._sum.amount ?? new Prisma.Decimal(0)] as const] : []));
  const refundByShift = new Map(refunds.flatMap((row) => row.shiftId ? [[row.shiftId, row._sum.amount ?? new Prisma.Decimal(0)] as const] : []));
  const payoutByShift = new Map(payouts.map((row) => [row.shiftId, row._sum.amount ?? new Prisma.Decimal(0)] as const));

  return shifts.flatMap((shift) => shift.branchId ? [{
    availableCash: new Prisma.Decimal(shift.openingFloat).add(paymentByShift.get(shift.id) ?? 0).sub(refundByShift.get(shift.id) ?? 0).sub(payoutByShift.get(shift.id) ?? 0).toFixed(2),
    branchId: shift.branchId,
    cashierId: shift.cashierId,
    cashierName: shift.cashier.name,
    id: shift.id,
    startedAt: shift.startedAt,
  }] : []);
}
