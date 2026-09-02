"use server";

import {
  ClosingWhatsAppSendTrigger,
  FinancialOperationType,
  Prisma,
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission, hasStaffPermission } from "@/lib/auth/staff-permissions";
import { resolveOperationalBranchId } from "@/lib/branches";
import { getCurrentBusinessDateValue } from "@/lib/business-day";
import {
  isValidDateValue,
} from "@/lib/business-time";
import { getDailyClosingReport } from "@/lib/daily-closing/query";
import { getDailyClosingRange } from "@/lib/daily-closing/range";
import {
  buildDailyClosingSnapshotPayload,
  buildFrozenDailyClosingWhatsAppText,
  getExpectedCashCents,
  normalizeBusinessDate,
} from "@/lib/daily-closing/snapshot";
import {
  enqueueClosingReportForSnapshot,
  enqueueManualClosingWhatsAppSend,
} from "@/lib/closing-whatsapp/queue";
import { prisma } from "@/lib/prisma";
import { fromCents, toCents } from "@/lib/validation/pos";
import {
  financialOperationKeySchema,
  runFinancialOperation,
} from "@/lib/financial-idempotency";
import {
  acquireDailyClosingScopeLock,
  acquireCashierOpenShiftLock,
  assertNoCrossBusinessDayShiftActivity,
  assertNoOpenShiftsForBusinessDate,
  assertShiftActivityWithinBusinessDate,
  calculateShiftExpectedCashCents,
  CrossBusinessDayShiftReviewRequiredError,
  DAILY_CLOSING_OPEN_SHIFT_MESSAGE,
  DailyClosingOpenShiftError,
  getCashierShiftBusinessDate,
  runClosingSerializableTransaction,
} from "@/lib/closing/shift-control";
import {
  closingMoneySchema,
  DailyClosingDifferenceReasonError,
  requireDailyClosingDifferenceReason,
} from "@/lib/closing/money-validation";

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

const closeDailySnapshotSchema = z.object({
  operationId: financialOperationKeySchema,
  actualCash: closingMoneySchema,
  branchId: z.string().uuid("Branch is required."),
  businessDate: z
    .string()
    .refine(isValidDateValue, "Business date is invalid."),
  closingNote: z.string().trim().max(1000, "Closing note is too long.").optional(),
});

const resolveStaleShiftSchema = z.object({
  countedCash: closingMoneySchema,
  reason: z.string().trim().min(1, "Reason is required.").max(1000, "Reason is too long."),
  shiftId: z.string().uuid("Shift is required."),
});

const manualClosingWhatsAppSendSchema = z.object({
  attemptId: z.string().uuid("Send record is required."),
  reason: z.string().trim().max(500, "Reason is too long.").optional(),
  trigger: z.nativeEnum(ClosingWhatsAppSendTrigger).refine(
    (value) => value === "MANUAL_RETRY" || value === "MANUAL_RESEND",
    "Manual send action is invalid.",
  ),
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
        const completedDailyClosing = await tx.dailyClosingSnapshot.findUnique({
          where: {
            businessId_branchId_businessDate: {
              businessDate: normalizeBusinessDate(businessDate),
              branchId,
              businessId,
            },
          },
          select: { id: true },
        });
        if (completedDailyClosing) throw new DailyClosingAlreadyCompletedForShiftError();
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
    const message = error instanceof DailyClosingAlreadyCompletedForShiftError
      ? "Daily closing is already completed for this branch today. A new shift cannot be started."
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

  let dailyClosingCompleted = false;
  let dailyClosingReviewRequired = false;

  try {
    const result = await runClosingSerializableTransaction(
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

        if (!updated.branchId) {
          return { dailyClosingCompleted: false, dailyClosingReviewRequired: false };
        }

        const otherOpenShift = await tx.cashierShift.findFirst({
          where: {
            branchId: updated.branchId,
            businessId,
            status: "OPEN",
          },
          select: { id: true },
        });

        if (otherOpenShift) {
          return { dailyClosingCompleted: false, dailyClosingReviewRequired: false };
        }
        const normalizedBusinessDate = normalizeBusinessDate(businessDate);
        const existingSnapshot = await tx.dailyClosingSnapshot.findUnique({
          where: {
            businessId_branchId_businessDate: {
              branchId: updated.branchId,
              businessDate: normalizedBusinessDate,
              businessId,
            },
          },
          select: { id: true },
        });

        if (existingSnapshot) {
          return { dailyClosingCompleted: false, dailyClosingReviewRequired: false };
        }

        const { fromDate, toDateExclusive } = getDailyClosingRange(
          undefined,
          businessDate,
          businessTimeSettings,
        );
        const closedShifts = await tx.cashierShift.findMany({
          where: {
            branchId: updated.branchId,
            businessId,
            closingCash: { not: null },
            startedAt: { gte: fromDate, lt: toDateExclusive },
            status: "CLOSED",
          },
          select: {
            closingCash: true,
            endedAt: true,
            id: true,
            openingFloat: true,
          },
        });
        try {
          await assertNoCrossBusinessDayShiftActivity(tx, {
            branchId: updated.branchId,
            businessDate,
            businessId,
            settings: businessTimeSettings,
          });
        } catch (error) {
          if (!(error instanceof CrossBusinessDayShiftReviewRequiredError)) throw error;
          console.error(`[${error.code}] Daily closing snapshot blocked`, {
            branchId: updated.branchId,
            businessDate,
            businessId,
            shiftIds: error.shiftIds,
          });
          return { dailyClosingCompleted: false, dailyClosingReviewRequired: true };
        }
        const actualCashCents = closedShifts.reduce(
          (total, closedShift) =>
            total +
            toCents(closedShift.closingCash ?? 0) -
            toCents(closedShift.openingFloat),
          0,
        );

        await createDailyClosingSnapshotInTransaction({
          actualCashCents,
          auditRequest,
          branchId: updated.branchId,
          businessDate,
          businessId,
          closingNote: notes,
          tx,
          user,
        });

        return { dailyClosingCompleted: true, dailyClosingReviewRequired: false };
      },
    );
    dailyClosingCompleted = result.dailyClosingCompleted;
    dailyClosingReviewRequired = result.dailyClosingReviewRequired;
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
      dailyClosingCompleted
        ? "Shift ended and daily closing completed."
        : dailyClosingReviewRequired
          ? "Shift ended. Daily closing is blocked because this shift crossed the business-day cutoff and requires review."
        : "Shift ended. Daily closing will complete after the final open shift ends.",
    )}`,
  );
}

export async function closeDailySnapshotAction(
  _previousState: CloseDailySnapshotState,
  formData: FormData,
): Promise<CloseDailySnapshotState> {
  const { businessId, industryType, user } = await requireBusinessUser("RUN_CLOSING");
  if (!hasStaffPermission(user, "CONFIRM_DAILY_CLOSING")) {
    return {
      message: "You do not have permission to confirm branch Daily Closing.",
      status: "error",
    };
  }

  const parsed = closeDailySnapshotSchema.safeParse({
    operationId: formData.get("operationId"),
    actualCash: formData.get("actualCash"),
    branchId: formData.get("branchId"),
    businessDate: formData.get("businessDate"),
    closingNote: formData.get("closingNote"),
  });

  if (!parsed.success) {
    return {
      message: parsed.error.issues[0]?.message ?? "Unable to close this business day.",
      status: "error",
    };
  }

  if (!["AUTO_DETAILING", "SALON_BEAUTY"].includes(industryType ?? "")) {
    return {
      message: "Daily closing is not available for this industry.",
      status: "error",
    };
  }

  const businessTimeSettings = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: {
      businessDayCutoffTime: true,
      timezone: true,
    },
  });
  const currentBusinessDate = getCurrentBusinessDateValue(
    new Date(),
    businessTimeSettings.timezone,
    businessTimeSettings.businessDayCutoffTime,
  );

  if (parsed.data.businessDate > currentBusinessDate) {
    return {
      message: "A future business date cannot be closed.",
      status: "error",
    };
  }

  const branchId = await resolveOperationalBranchId(
    businessId,
    user,
    parsed.data.branchId,
  );
  if (!branchId) {
    return {
      message: "Select an active branch before confirming daily closing.",
      status: "error",
    };
  }
  const auditRequest = await getAuditRequestContext();

  try {
    const { operationId, ...financialPayload } = parsed.data;
    const { result } = await runFinancialOperation({
      actorUserId: user.userId,
      branchId,
      businessId,
      operationKey: operationId,
      operationType: FinancialOperationType.DAILY_CLOSING,
      payload: { ...financialPayload, branchId },
      execute: async (tx) => {
        await acquireDailyClosingScopeLock(tx, {
          branchId,
          businessDate: parsed.data.businessDate,
          businessId,
        });
        const existing = await tx.dailyClosingSnapshot.findUnique({
          where: {
            businessId_branchId_businessDate: {
              branchId,
              businessDate: normalizeBusinessDate(parsed.data.businessDate),
              businessId,
            },
          },
          select: { id: true },
        });

        if (existing) {
          throw new DailyClosingAlreadyExistsError(existing.id);
        }

        await assertNoOpenShiftsForBusinessDate(tx, {
          branchId,
          businessDate: parsed.data.businessDate,
          businessId,
          settings: businessTimeSettings,
        });
        await assertNoCrossBusinessDayShiftActivity(tx, {
          branchId,
          businessDate: parsed.data.businessDate,
          businessId,
          settings: businessTimeSettings,
        });

        const closingReport = await getDailyClosingReport(
          {
            branchId,
            businessId,
            dateValue: parsed.data.businessDate,
            industryType,
          },
          tx,
        );
        const actualCashCents = Math.round(parsed.data.actualCash * 100);
        const closingNote = requireDailyClosingDifferenceReason({
          actualCashCents,
          expectedCashCents: getExpectedCashCents(closingReport.report),
          reason: parsed.data.closingNote,
        });

        const snapshot = await createDailyClosingSnapshotInTransaction({
          actualCashCents,
          auditRequest,
          branchId,
          businessDate: parsed.data.businessDate,
          businessId,
          closingNote,
          tx,
          user,
        });
        return { snapshotId: snapshot.id };
      },
    });

    revalidatePath("/closing");
    revalidatePath("/closing/history");

    return {
      message: "Daily closing confirmed and frozen.",
      snapshotId: result.snapshotId,
      status: "success",
    };
  } catch (error) {
    if (
      error instanceof DailyClosingAlreadyExistsError ||
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002")
    ) {
      return {
        message: "This branch and business date have already been closed.",
        status: "error",
      };
    }
    if (error instanceof DailyClosingOpenShiftError) {
      return { message: DAILY_CLOSING_OPEN_SHIFT_MESSAGE, status: "error" };
    }
    if (error instanceof CrossBusinessDayShiftReviewRequiredError) {
      console.error(`[${error.code}] Manual daily closing blocked`, {
        branchId,
        businessDate: parsed.data.businessDate,
        businessId,
        shiftIds: error.shiftIds,
      });
      return {
        message: "Daily closing is blocked because a cashier shift crosses the business-day boundary and requires review.",
        status: "error",
      };
    }
    if (error instanceof DailyClosingDifferenceReasonError) {
      return { message: error.message, status: "error" };
    }

    console.error("[daily-closing] Unable to create snapshot", error);
    return {
      message: "Unable to confirm daily closing. No snapshot was created.",
      status: "error",
    };
  }
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
  redirect(`/closing?type=success&message=${encodeURIComponent("Stale shift resolved. Daily Closing can now be reviewed.")}`);
}

export async function manualClosingWhatsAppSendAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser("RUN_CLOSING");
  assertStaffPermission(user, "CONFIRM_DAILY_CLOSING");

  const input = manualClosingWhatsAppSendSchema.parse({
    attemptId: formData.get("attemptId"),
    reason: formData.get("reason"),
    trigger: formData.get("trigger"),
  });
  const source = await prisma.closingWhatsAppSendAttempt.findFirst({
    where: { businessId, id: input.attemptId },
    select: {
      branchId: true,
      id: true,
      sendType: true,
      status: true,
    },
  });

  if (!source) {
    throw new Error("Closing WhatsApp send record not found.");
  }

  if (source.branchId) {
    await resolveOperationalBranchId(businessId, user, source.branchId);
  }

  const auditRequest = await getAuditRequestContext();
  await prisma.$transaction(async (tx) => {
    await enqueueManualClosingWhatsAppSend(
      {
        attemptId: source.id,
        businessId,
        reason:
          input.reason ||
          (input.trigger === "MANUAL_RETRY" ? "Manual retry" : "Manual resend"),
        requestedByUserId: user.userId,
        trigger: input.trigger,
      },
      tx,
    );

    await writeAuditLog(
      {
        action:
          input.trigger === "MANUAL_RETRY"
            ? "CLOSING_WHATSAPP_MANUAL_RETRY"
            : "CLOSING_WHATSAPP_MANUAL_RESEND",
        actor: user,
        after: {
          reason: input.reason ?? null,
          sendType: source.sendType,
          sourceStatus: source.status,
          trigger: input.trigger,
        },
        branchId: source.branchId,
        businessId,
        entityId: source.id,
        entityType: "ClosingWhatsAppSendAttempt",
        request: auditRequest,
        summary:
          input.trigger === "MANUAL_RETRY"
            ? "Queued manual retry for closing WhatsApp"
            : "Queued manual resend for closing WhatsApp",
      },
      tx,
    );
  });

  revalidatePath("/closing");
  revalidatePath("/closing/history");
}

class DailyClosingAlreadyExistsError extends Error {
  constructor(readonly snapshotId: string) {
    super("Daily closing snapshot already exists.");
  }
}

class DailyClosingAlreadyCompletedForShiftError extends Error {}

class CashierAlreadyHasOpenShiftError extends Error {}

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

type BusinessUserContext = Awaited<ReturnType<typeof requireBusinessUser>>;
type AuditRequestContext = Awaited<ReturnType<typeof getAuditRequestContext>>;

async function createDailyClosingSnapshotInTransaction({
  actualCashCents,
  auditRequest,
  branchId,
  businessDate,
  businessId,
  closingNote,
  tx,
  user,
}: {
  actualCashCents: number;
  auditRequest: AuditRequestContext;
  branchId: string;
  businessDate: string;
  businessId: string;
  closingNote: string | null;
  tx: Prisma.TransactionClient;
  user: BusinessUserContext["user"];
}) {
  const [branch, business] = await Promise.all([
    tx.branch.findFirstOrThrow({
      where: { businessId, id: branchId },
      select: { id: true, name: true },
    }),
    tx.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { id: true, industryType: true, name: true },
    }),
  ]);
  const generatedAt = new Date();
  const closingReport = await getDailyClosingReport(
    {
      branchId,
      businessId,
      dateValue: businessDate,
      industryType: business.industryType,
      now: generatedAt,
    },
    tx,
  );
  const expectedCashCents = getExpectedCashCents(closingReport.report);
  const closedAt = new Date();
  const payload = buildDailyClosingSnapshotPayload({
    actualCashCents,
    branch,
    business,
    businessDate,
    businessDayCutoffTime: closingReport.businessDayCutoffTime,
    businessType: business.industryType,
    closedAt,
    closedBy: { id: user.userId, name: user.name },
    closingNote,
    expectedCashCents,
    generatedAt,
    report: closingReport.report,
    timezone: closingReport.timeZone,
  });
  const whatsappText = buildFrozenDailyClosingWhatsAppText({
    baseText: closingReport.preview,
    payload,
  });

  const created = await tx.dailyClosingSnapshot.create({
    data: {
      actualCashCents,
      branchId,
      businessDate: normalizeBusinessDate(businessDate),
      businessId,
      businessType: business.industryType,
      cashDifferenceCents: payload.cash.differenceCents,
      closedAt,
      closedByUserId: user.userId,
      closingNote,
      expectedCashCents,
      reportDataJson: payload as unknown as Prisma.InputJsonValue,
      reportVersion: payload.version,
      timezone: payload.timezone,
      whatsappText,
    },
  });

  await writeAuditLog(
    {
      action: "DAILY_CLOSING_CONFIRMED",
      actor: user,
      after: {
        actualCashCents,
        businessDate,
        cashDifferenceCents: payload.cash.differenceCents,
        expectedCashCents,
        reportVersion: payload.version,
        status: created.status,
      },
      branchId,
      businessId,
      entityId: created.id,
      entityType: "DailyClosingSnapshot",
      request: auditRequest,
      summary: `Closed ${businessDate} for ${branch.name}`,
    },
    tx,
  );

  await enqueueClosingReportForSnapshot(created.id, tx);

  return created;
}

function moneyFromCents(cents: number) {
  return `RM${fromCents(cents)}`;
}
