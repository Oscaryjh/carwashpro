"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { resolveOperationalBranchId } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { fromCents, toCents } from "@/lib/validation/pos";

const startShiftSchema = z.object({
  branchId: z.string().optional(),
  openingFloat: z.coerce.number().min(0, "Opening float cannot be negative."),
});

const endShiftSchema = z.object({
  closingCash: z.coerce.number().min(0, "Closing cash cannot be negative."),
  notes: z.string().trim().optional(),
  shiftId: z.string().uuid("Shift is required."),
});

export async function startShiftAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser();
  const auditRequest = await getAuditRequestContext();
  const input = startShiftSchema.parse({
    branchId: formData.get("branchId")?.toString(),
    openingFloat: formData.get("openingFloat"),
  });
  const branchId = await resolveOperationalBranchId(
    businessId,
    user,
    input.branchId ?? null,
  );

  const existingOpenShift = await prisma.cashierShift.findFirst({
    where: {
      businessId,
      cashierId: user.userId,
      status: "OPEN",
    },
    select: { id: true },
  });

  if (existingOpenShift) {
    redirect(
      `/closing?type=error&message=${encodeURIComponent(
        "You already have an open shift.",
      )}`,
    );
  }

  await prisma.$transaction(async (tx) => {
    const shift = await tx.cashierShift.create({
      data: {
        businessId,
        branchId,
        cashierId: user.userId,
        openingFloat: fromCents(Math.round(input.openingFloat * 100)),
        status: "OPEN",
      },
    });

    await writeAuditLog(
      {
        businessId,
        branchId,
        actor: user,
        action: "SHIFT_STARTED",
        entityType: "CashierShift",
        entityId: shift.id,
        summary: `Started shift with RM${Number(shift.openingFloat).toFixed(2)} float`,
        after: {
          status: shift.status,
          openingFloat: shift.openingFloat,
          startedAt: shift.startedAt,
        },
        request: auditRequest,
      },
      tx,
    );
  });

  revalidatePath("/closing");
  redirect(
    `/closing?type=success&message=${encodeURIComponent("Shift started.")}`,
  );
}

export async function endShiftAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser();
  const auditRequest = await getAuditRequestContext();
  const input = endShiftSchema.parse({
    closingCash: formData.get("closingCash"),
    notes: formData.get("notes"),
    shiftId: formData.get("shiftId"),
  });

  const shift = await prisma.cashierShift.findFirst({
    where: {
      id: input.shiftId,
      businessId,
      cashierId: user.userId,
      status: "OPEN",
    },
    select: {
      id: true,
      openingFloat: true,
    },
  });

  if (!shift) {
    redirect(
      `/closing?type=error&message=${encodeURIComponent(
        "Open shift not found.",
      )}`,
    );
  }

  const [cashPayments, cashRefunds] = await Promise.all([
    prisma.payment.aggregate({
      where: {
        businessId,
        method: "CASH",
        shiftId: shift.id,
        status: "ACTIVE",
      },
      _sum: { amount: true },
    }),
    prisma.paymentRefund.aggregate({
      where: {
        businessId,
        method: "CASH",
        shiftId: shift.id,
      },
      _sum: { amount: true },
    }),
  ]);
  const openingFloatCents = toCents(shift.openingFloat);
  const cashPaymentCents = toCents(cashPayments._sum.amount ?? 0);
  const cashRefundCents = toCents(cashRefunds._sum.amount ?? 0);
  const closingCashCents = Math.round(input.closingCash * 100);
  const expectedCashCents =
    openingFloatCents + cashPaymentCents - cashRefundCents;
  const differenceCents = closingCashCents - expectedCashCents;
  const notes = input.notes?.trim() || null;

  if (differenceCents !== 0 && !notes) {
    const direction = differenceCents < 0 ? "short" : "over";
    redirect(
      `/closing?type=error&message=${encodeURIComponent(
        `Cash is ${direction} by ${moneyFromCents(Math.abs(differenceCents))}. Please add a note before ending the shift.`,
      )}`,
    );
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.cashierShift.update({
      where: { id: shift.id },
      data: {
        closingCash: fromCents(closingCashCents),
        cashDifference: fromCents(differenceCents),
        endedAt: new Date(),
        expectedCash: fromCents(expectedCashCents),
        notes,
        status: "CLOSED",
      },
    });

    await writeAuditLog(
      {
        businessId,
        branchId: updated.branchId,
        actor: user,
        action: "SHIFT_ENDED",
        entityType: "CashierShift",
        entityId: updated.id,
        summary: `Ended shift with ${moneyFromCents(differenceCents)} difference`,
        before: { status: "OPEN", openingFloat: shift.openingFloat },
        after: {
          status: updated.status,
          closingCash: updated.closingCash,
          expectedCash: updated.expectedCash,
          cashPayments: fromCents(cashPaymentCents),
          cashRefunds: fromCents(cashRefundCents),
          cashDifference: updated.cashDifference,
          notes: updated.notes,
          endedAt: updated.endedAt,
        },
        request: auditRequest,
      },
      tx,
    );
  });

  revalidatePath("/closing");
  redirect(
    `/closing?type=success&message=${encodeURIComponent("Shift closed.")}`,
  );
}

function moneyFromCents(cents: number) {
  return `RM${fromCents(cents)}`;
}
