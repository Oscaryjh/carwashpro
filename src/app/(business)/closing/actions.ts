"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission, hasStaffPermission } from "@/lib/auth/staff-permissions";
import { resolveOperationalBranchId } from "@/lib/branches";
import { readCashierShiftSettings } from "@/lib/cashier/shift-settings";
import { CashierShiftsDisabledError } from "@/lib/cashier/activity-context";
import { getCurrentBusinessDateValue } from "@/lib/business-day";
import { prisma } from "@/lib/prisma";
import { fromCents, toCents } from "@/lib/validation/pos";
import {
  acquireDailyClosingScopeLock,
  acquireCashierOpenShiftLock,
  assertShiftActivityWithinBusinessDate,
  calculateShiftExpectedCashCents,
  CrossBusinessDayShiftReviewRequiredError,
  getCashierShiftBusinessDate,
  runClosingSerializableTransaction,
} from "@/lib/closing/shift-control";
import { closingMoneySchema } from "@/lib/closing/money-validation";

const startShiftSchema = z.object({
  branchId: z.string().optional(),
  openingFloat: closingMoneySchema,
  returnTo: z.string().optional(),
});

const endShiftSchema = z.object({
  closingCash: closingMoneySchema,
  notes: z.string().trim().max(1000, "Difference reason is too long.").optional(),
  shiftId: z.string().uuid("Shift is required."),
});

const resolveStaleShiftSchema = z.object({
  countedCash: closingMoneySchema,
  reason: z.string().trim().min(1, "Reason is required.").max(1000, "Reason is too long."),
  shiftId: z.string().uuid("Shift is required."),
});

export type CloseDailySnapshotState = {
  message: string;
  snapshotId?: string;
  status: "idle" | "error" | "success";
};

export async function startShiftAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser("RUN_CLOSING");
  assertStaffPermission(user, "CLOSING");
  const auditRequest = await getAuditRequestContext();
  const input = startShiftSchema.parse({
    branchId: formData.get("branchId")?.toString(),
    openingFloat: formData.get("openingFloat"),
    returnTo: formData.get("returnTo")?.toString(),
  });
  const returnTo = normalizeCashierReturnTo(input.returnTo);
  const branchId = await resolveOperationalBranchId(
    businessId,
    user,
    input.branchId ?? null,
  );

  try {
    await runClosingSerializableTransaction(prisma, async (tx) => {
      const shiftSettings = await readCashierShiftSettings(tx, businessId);
      if (!shiftSettings.cashierShiftsEnabled) throw new CashierShiftsDisabledError();
      await acquireCashierOpenShiftLock(tx, {
        businessId,
        cashierId: user.userId,
      });
      const businessTimeSettings = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { businessDayCutoffTime: true, timezone: true },
      });
      const startedAt = new Date();
      const businessDate = getCurrentBusinessDateValue(
        startedAt,
        businessTimeSettings.timezone,
        businessTimeSettings.businessDayCutoffTime,
      );

      if (branchId) {
        await acquireDailyClosingScopeLock(tx, { branchId, businessDate, businessId });
      }

      const existingOpenShift = await tx.cashierShift.findFirst({
        where: { businessId, cashierId: user.userId, status: "OPEN" },
        select: { id: true },
      });
      if (existingOpenShift) throw new CashierAlreadyHasOpenShiftError();

      const shift = await tx.cashierShift.create({
        data: {
          businessId,
          branchId,
          cashierId: user.userId,
          openingFloat: fromCents(Math.round(input.openingFloat * 100)),
          startedAt,
          status: "OPEN",
        },
      });
      await writeAuditLog({
        businessId,
        branchId,
        actor: user,
        action: "SHIFT_STARTED",
        entityType: "CashierShift",
        entityId: shift.id,
        summary: `Started shift with RM${Number(shift.openingFloat).toFixed(2)} float`,
        after: { status: shift.status, openingFloat: shift.openingFloat, startedAt: shift.startedAt },
        request: auditRequest,
      }, tx);
    });
  } catch (error) {
    const message = error instanceof CashierShiftsDisabledError
      ? error.message
      : error instanceof CashierAlreadyHasOpenShiftError
        ? "You already have an open shift."
        : null;
    if (message) {
      redirect(returnTo
        ? withStatusMessage(returnTo, "error", message)
        : `/closing?type=error&message=${encodeURIComponent(message)}`);
    }
    throw error;
  }

  revalidatePath("/closing");
  redirect(
    returnTo
      ? withStatusMessage(returnTo, "success", "Shift started.")
      : `/closing?type=success&message=${encodeURIComponent("Shift started.")}`,
  );
}

function normalizeCashierReturnTo(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value, "http://localhost");
    if (url.origin !== "http://localhost" || url.pathname !== "/cashier") return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function withStatusMessage(
  returnTo: string,
  type: "error" | "success",
  message: string,
) {
  const url = new URL(returnTo, "http://localhost");
  url.searchParams.set("type", type);
  url.searchParams.set("message", message);
  return `${url.pathname}${url.search}`;
}

export async function endShiftAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser("RUN_CLOSING");
  assertStaffPermission(user, "CLOSING");
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
      branchId: true,
      id: true,
      openingFloat: true,
      startedAt: true,
    },
  });

  if (!shift) {
    redirect(
      `/closing?type=error&message=${encodeURIComponent(
        "Open shift not found.",
      )}`,
    );
  }

  const closingCashCents = Math.round(input.closingCash * 100);
  const notes = input.notes?.trim() || null;

  try {
    await runClosingSerializableTransaction(
      prisma,
      async (tx) => {
        const canonicalShift = await tx.cashierShift.findFirst({
          where: { businessId, cashierId: user.userId, id: shift.id, status: "OPEN" },
          select: { branchId: true, openingFloat: true, startedAt: true },
        });
        if (!canonicalShift) throw new ShiftAlreadyClosedError();
        const businessTimeSettings = await tx.business.findUniqueOrThrow({
          where: { id: businessId },
          select: { businessDayCutoffTime: true, timezone: true },
        });
        const businessDate = getCashierShiftBusinessDate(
          canonicalShift.startedAt,
          businessTimeSettings,
        );
        await acquireCashierOpenShiftLock(tx, { businessId, cashierId: user.userId });
        if (canonicalShift.branchId) {
          await acquireDailyClosingScopeLock(tx, {
            branchId: canonicalShift.branchId,
            businessDate,
            businessId,
          });
        }
        const [cashPayments, cashRefunds, expensePayouts] = await Promise.all([
          tx.payment.aggregate({ where: { businessId, method: "CASH", shiftId: shift.id, status: "ACTIVE" }, _sum: { amount: true } }),
          tx.paymentRefund.aggregate({ where: { businessId, method: "CASH", shiftId: shift.id }, _sum: { amount: true } }),
          tx.cashierShiftExpensePayout.aggregate({ where: { businessId, shiftId: shift.id }, _sum: { amount: true } }),
        ]);
        const openingFloatCents = toCents(canonicalShift.openingFloat);
        const cashPaymentCents = toCents(cashPayments._sum.amount ?? 0);
        const cashRefundCents = toCents(cashRefunds._sum.amount ?? 0);
        const expensePayoutCents = toCents(expensePayouts._sum.amount ?? 0);
        const expectedCashCents = calculateShiftExpectedCashCents({
          cashPaymentCents,
          cashRefundCents,
          expensePayoutCents,
          openingFloatCents,
        });
        const differenceCents = closingCashCents - expectedCashCents;
        if (differenceCents !== 0 && !notes) throw new ShiftCashNoteRequiredError(differenceCents);

        const closed = await tx.cashierShift.updateMany({
          where: {
            businessId,
            cashierId: user.userId,
            id: shift.id,
            status: "OPEN",
          },
          data: {
            closingCash: fromCents(closingCashCents),
            cashDifference: fromCents(differenceCents),
            endedAt: new Date(),
            expectedCash: fromCents(expectedCashCents),
            notes,
            status: "CLOSED",
          },
        });

        if (closed.count !== 1) {
          throw new ShiftAlreadyClosedError();
        }

        const updated = await tx.cashierShift.findUniqueOrThrow({
          where: { id: shift.id },
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
            before: { status: "OPEN", openingFloat: canonicalShift.openingFloat },
            after: {
              status: updated.status,
              closingCash: updated.closingCash,
              expectedCash: updated.expectedCash,
              cashPayments: fromCents(cashPaymentCents),
              cashRefunds: fromCents(cashRefundCents),
              expensePayouts: fromCents(expensePayoutCents),
              cashDifference: updated.cashDifference,
              notes: updated.notes,
              endedAt: updated.endedAt,
            },
            request: auditRequest,
          },
          tx,
        );

      },
    );
  } catch (error) {
    if (error instanceof ShiftAlreadyClosedError) {
      redirect(
        `/closing?type=error&message=${encodeURIComponent(
          "This shift has already been closed.",
        )}`,
      );
    }
    if (error instanceof ShiftCashNoteRequiredError) {
      const direction = error.differenceCents < 0 ? "short" : "over";
      redirect(`/closing?type=error&message=${encodeURIComponent(`Cash is ${direction} by ${moneyFromCents(Math.abs(error.differenceCents))}. Please add a note before ending the shift.`)}`);
    }

    console.error("[shift-closing] Unable to close shift", error);
    redirect(
      `/closing?type=error&message=${encodeURIComponent(
        "Unable to close this shift. No changes were saved.",
      )}`,
    );
  }

  revalidatePath("/closing");
  revalidatePath("/closing/history");
  redirect(
    `/closing?type=success&message=${encodeURIComponent(
      "Shift ended.",
    )}`,
  );
}

export async function closeDailySnapshotAction(
  _previousState: CloseDailySnapshotState,
  formData: FormData,
): Promise<CloseDailySnapshotState> {
  const { user } = await requireBusinessUser("RUN_CLOSING");
  if (!hasStaffPermission(user, "CONFIRM_DAILY_CLOSING")) {
    return {
      message: "You do not have permission to confirm branch Daily Closing.",
      status: "error",
    };
  }

  return {
    message: "Daily closing has been retired. View historical closing records.",
    status: "error",
  };
}

export async function resolveStaleShiftAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser("RUN_CLOSING");
  assertStaffPermission(user, "CONFIRM_DAILY_CLOSING");
  const auditRequest = await getAuditRequestContext();
  const input = resolveStaleShiftSchema.parse({
    countedCash: formData.get("countedCash"),
    reason: formData.get("reason"),
    shiftId: formData.get("shiftId"),
  });
  const source = await prisma.cashierShift.findFirst({
    where: { businessId, id: input.shiftId, status: "OPEN" },
    select: { branchId: true, cashierId: true },
  });
  if (!source?.branchId) {
    redirect(`/closing?type=error&message=${encodeURIComponent("Stale open shift not found.")}`);
  }
  const branchId = await resolveOperationalBranchId(businessId, user, source.branchId);
  if (!branchId) {
    redirect(`/closing?type=error&message=${encodeURIComponent("This shift is outside your branch scope.")}`);
  }

  try {
    await runClosingSerializableTransaction(prisma, async (tx) => {
      await acquireCashierOpenShiftLock(tx, { businessId, cashierId: source.cashierId });
      const [shift, settings] = await Promise.all([
        tx.cashierShift.findFirst({
          where: { branchId, businessId, id: input.shiftId, status: "OPEN" },
          select: {
            branchId: true,
            cashierId: true,
            openingFloat: true,
            startedAt: true,
          },
        }),
        tx.business.findUniqueOrThrow({
          where: { id: businessId },
          select: { businessDayCutoffTime: true, timezone: true },
        }),
      ]);
      if (!shift) throw new ShiftAlreadyClosedError();
      const businessDate = getCashierShiftBusinessDate(shift.startedAt, settings);
      const currentBusinessDate = getCurrentBusinessDateValue(
        new Date(),
        settings.timezone,
        settings.businessDayCutoffTime,
      );
      if (businessDate >= currentBusinessDate) {
        throw new Error("Only a previous business-day OPEN shift can be resolved here.");
      }
      await acquireDailyClosingScopeLock(tx, { branchId, businessDate, businessId });
      await assertShiftActivityWithinBusinessDate(tx, {
        businessDate,
        businessId,
        settings,
        shiftId: input.shiftId,
      });
      const [cashPayments, cashRefunds, expensePayouts] = await Promise.all([
        tx.payment.aggregate({ where: { businessId, method: "CASH", shiftId: input.shiftId, status: "ACTIVE" }, _sum: { amount: true } }),
        tx.paymentRefund.aggregate({ where: { businessId, method: "CASH", shiftId: input.shiftId }, _sum: { amount: true } }),
        tx.cashierShiftExpensePayout.aggregate({ where: { businessId, shiftId: input.shiftId }, _sum: { amount: true } }),
      ]);
      const expectedCashCents = calculateShiftExpectedCashCents({
        cashPaymentCents: toCents(cashPayments._sum.amount ?? 0),
        cashRefundCents: toCents(cashRefunds._sum.amount ?? 0),
        expensePayoutCents: toCents(expensePayouts._sum.amount ?? 0),
        openingFloatCents: toCents(shift.openingFloat),
      });
      const countedCashCents = Math.round(input.countedCash * 100);
      const differenceCents = countedCashCents - expectedCashCents;
      const closed = await tx.cashierShift.updateMany({
        where: { businessId, id: input.shiftId, status: "OPEN" },
        data: {
          cashDifference: fromCents(differenceCents),
          closingCash: fromCents(countedCashCents),
          endedAt: new Date(),
          expectedCash: fromCents(expectedCashCents),
          notes: input.reason,
          status: "CLOSED",
        },
      });
      if (closed.count !== 1) throw new ShiftAlreadyClosedError();
      await writeAuditLog({
        action: "STALE_SHIFT_RESOLVED",
        actor: user,
        after: {
          businessDate,
          countedCashCents,
          differenceCents,
          expectedCashCents,
          originalCashierId: shift.cashierId,
          reason: input.reason,
          resolvedByUserId: user.userId,
        },
        branchId,
        businessId,
        entityId: input.shiftId,
        entityType: "CashierShift",
        request: auditRequest,
        summary: `Supervisor resolved stale shift with ${moneyFromCents(differenceCents)} difference`,
      }, tx);
    });
  } catch (error) {
    const message = error instanceof CrossBusinessDayShiftReviewRequiredError
      ? "This shift contains activity across a business-day boundary and requires separate review."
      : error instanceof ShiftAlreadyClosedError
        ? "This shift is no longer open."
        : error instanceof Error
          ? error.message
          : "Unable to resolve this stale shift.";
    redirect(`/closing?type=error&message=${encodeURIComponent(message)}`);
  }

  revalidatePath("/closing");
  redirect(`/closing?type=success&message=${encodeURIComponent("Stale shift resolved.")}`);
}

export async function manualClosingWhatsAppSendAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser("RUN_CLOSING");
  assertStaffPermission(user, "CONFIRM_DAILY_CLOSING");

  throw new Error("Daily closing has been retired. View historical closing records.");
}

class CashierAlreadyHasOpenShiftError extends Error {}

function moneyFromCents(cents: number) {
  return `RM${fromCents(cents)}`;
}

class ShiftAlreadyClosedError extends Error {
  constructor() {
    super("Shift has already been closed.");
  }
}

class ShiftCashNoteRequiredError extends Error {
  constructor(readonly differenceCents: number) {
    super("A cash difference note is required.");
  }
}
