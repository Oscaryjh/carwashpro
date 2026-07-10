"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
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

  await prisma.cashierShift.create({
    data: {
      businessId,
      branchId,
      cashierId: user.userId,
      openingFloat: fromCents(Math.round(input.openingFloat * 100)),
      status: "OPEN",
    },
  });

  revalidatePath("/closing");
  redirect(
    `/closing?type=success&message=${encodeURIComponent("Shift started.")}`,
  );
}

export async function endShiftAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser();
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

  const cashPayments = await prisma.payment.aggregate({
    where: {
      businessId,
      method: "CASH",
      shiftId: shift.id,
      status: "ACTIVE",
    },
    _sum: { amount: true },
  });
  const openingFloatCents = toCents(shift.openingFloat);
  const cashPaymentCents = toCents(cashPayments._sum.amount ?? 0);
  const closingCashCents = Math.round(input.closingCash * 100);
  const expectedCashCents = openingFloatCents + cashPaymentCents;
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

  await prisma.cashierShift.update({
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

  revalidatePath("/closing");
  redirect(
    `/closing?type=success&message=${encodeURIComponent("Shift closed.")}`,
  );
}

function moneyFromCents(cents: number) {
  return `RM${fromCents(cents)}`;
}
