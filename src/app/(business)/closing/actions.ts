"use server";

import { ClosingWhatsAppSendTrigger, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { resolveOperationalBranchId } from "@/lib/branches";
import {
  getBusinessTodayDateValue,
  isValidDateValue,
} from "@/lib/business-time";
import { getDailyClosingReport } from "@/lib/daily-closing/query";
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

const startShiftSchema = z.object({
  branchId: z.string().optional(),
  openingFloat: z.coerce.number().min(0, "Opening float cannot be negative."),
  returnTo: z.string().optional(),
});

const endShiftSchema = z.object({
  closingCash: z.coerce.number().min(0, "Closing cash cannot be negative."),
  notes: z.string().trim().optional(),
  shiftId: z.string().uuid("Shift is required."),
});

const closeDailySnapshotSchema = z.object({
  actualCash: z.coerce
    .number()
    .finite()
    .min(0, "Actual cash cannot be negative.")
    .max(21_474_836.47, "Actual cash is too large.")
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
      "Actual cash can have at most two decimal places.",
    ),
  branchId: z.string().uuid("Branch is required."),
  businessDate: z
    .string()
    .refine(isValidDateValue, "Business date is invalid."),
  closingNote: z.string().trim().max(1000, "Closing note is too long.").optional(),
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
  const { businessId, user } = await requireBusinessUser();
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
      returnTo
        ? withStatusMessage(returnTo, "error", "You already have an open shift.")
        : `/closing?type=error&message=${encodeURIComponent(
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

export async function closeDailySnapshotAction(
  _previousState: CloseDailySnapshotState,
  formData: FormData,
): Promise<CloseDailySnapshotState> {
  const { businessId, industryType, user } = await requireBusinessUser();
  assertStaffPermission(user, "CLOSING");

  const parsed = closeDailySnapshotSchema.safeParse({
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

  if (parsed.data.businessDate > getBusinessTodayDateValue()) {
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
    const snapshot = await prisma.$transaction(
      async (tx) => {
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
            dateValue: parsed.data.businessDate,
            industryType: business.industryType,
            now: generatedAt,
          },
          tx,
        );
        const expectedCashCents = getExpectedCashCents(closingReport.report);
        const actualCashCents = Math.round(parsed.data.actualCash * 100);
        const closingNote = parsed.data.closingNote || null;
        const closedAt = new Date();
        const payload = buildDailyClosingSnapshotPayload({
          actualCashCents,
          branch,
          business,
          businessDate: parsed.data.businessDate,
          businessType: business.industryType,
          closedAt,
          closedBy: { id: user.userId, name: user.name },
          closingNote,
          expectedCashCents,
          generatedAt,
          report: closingReport.report,
        });
        const whatsappText = buildFrozenDailyClosingWhatsAppText({
          baseText: closingReport.preview,
          payload,
        });

        const created = await tx.dailyClosingSnapshot.create({
          data: {
            actualCashCents,
            branchId,
            businessDate: normalizeBusinessDate(parsed.data.businessDate),
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
              businessDate: parsed.data.businessDate,
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
            summary: `Closed ${parsed.data.businessDate} for ${branch.name}`,
          },
          tx,
        );

        await enqueueClosingReportForSnapshot(created.id, tx);

        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    revalidatePath("/closing");
    revalidatePath("/closing/history");

    return {
      message: "Daily closing confirmed and frozen.",
      snapshotId: snapshot.id,
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

    console.error("[daily-closing] Unable to create snapshot", error);
    return {
      message: "Unable to confirm daily closing. No snapshot was created.",
      status: "error",
    };
  }
}

export async function manualClosingWhatsAppSendAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser();
  assertStaffPermission(user, "CLOSING");

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

function moneyFromCents(cents: number) {
  return `RM${fromCents(cents)}`;
}
