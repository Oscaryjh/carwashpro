import { Prisma, type PrismaClient } from "@prisma/client";
import { getCurrentBusinessDateValue } from "@/lib/business-day";
import { getDailyClosingRange } from "@/lib/daily-closing/range";

export type BusinessTimeSettings = Readonly<{
  businessDayCutoffTime: string;
  timezone: string;
}>;

export const CASHIER_SHIFT_CUTOFF_MESSAGE =
  "Your previous shift has crossed the business-day cutoff. Close the shift before continuing.";
export const DAILY_CLOSING_OPEN_SHIFT_MESSAGE =
  "Daily Closing cannot be confirmed while cashier shifts are still open. Close all shifts for this branch first.";
export const CROSS_BUSINESS_DAY_SHIFT_REVIEW_REQUIRED =
  "CROSS_BUSINESS_DAY_SHIFT_REVIEW_REQUIRED";

export class CashierShiftBusinessDayCrossedError extends Error {
  readonly code = "CASHIER_SHIFT_BUSINESS_DAY_CROSSED";

  constructor() {
    super(CASHIER_SHIFT_CUTOFF_MESSAGE);
    this.name = "CashierShiftBusinessDayCrossedError";
  }
}

export class DailyClosingOpenShiftError extends Error {
  readonly code = "DAILY_CLOSING_OPEN_SHIFT";

  constructor(readonly openShiftCount: number) {
    super(DAILY_CLOSING_OPEN_SHIFT_MESSAGE);
    this.name = "DailyClosingOpenShiftError";
  }
}

export class CrossBusinessDayShiftReviewRequiredError extends Error {
  readonly code = CROSS_BUSINESS_DAY_SHIFT_REVIEW_REQUIRED;

  constructor(readonly shiftIds: string[]) {
    super("Daily closing is blocked because a cashier shift crosses the business-day boundary and requires review.");
    this.name = "CrossBusinessDayShiftReviewRequiredError";
  }
}

export function getCashierShiftBusinessDate(
  startedAt: Date,
  settings: BusinessTimeSettings,
) {
  return getCurrentBusinessDateValue(
    startedAt,
    settings.timezone,
    settings.businessDayCutoffTime,
  );
}

export function calculateShiftExpectedCashCents(input: {
  cashPaymentCents: number;
  cashRefundCents: number;
  expensePayoutCents: number;
  openingFloatCents: number;
}) {
  return input.openingFloatCents + input.cashPaymentCents -
    input.cashRefundCents - input.expensePayoutCents;
}

export async function acquireDailyClosingScopeLock(
  tx: Prisma.TransactionClient,
  input: { branchId: string; businessDate: string; businessId: string },
) {
  const lockKey = `daily-closing:${input.businessId}:${input.branchId}:${input.businessDate}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
}

/**
 * Serialises the canonical one-OPEN-shift invariant for a cashier inside a
 * business. The database advisory lock closes the SELECT-then-INSERT race
 * without changing the established business + cashier scope.
 */
export async function acquireCashierOpenShiftLock(
  tx: Prisma.TransactionClient,
  input: { businessId: string; cashierId: string },
) {
  const lockKey = `cashier-open-shift:${input.businessId}:${input.cashierId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
}

export async function runClosingSerializableTransaction<T>(
  database: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await database.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 30_000,
      });
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";
      if (!retryable || attempt === 4) throw error;
    }
  }
  throw new Error("Closing transaction retry limit exceeded.");
}

export async function assertCashierShiftAcceptsActivity(
  tx: Prisma.TransactionClient,
  input: {
    activityAt?: Date;
    businessId: string;
    shift: { id: string; startedAt: Date };
  },
) {
  const settings = await tx.business.findUniqueOrThrow({
    where: { id: input.businessId },
    select: { businessDayCutoffTime: true, timezone: true },
  });
  const activityAt = input.activityAt ?? new Date();
  const shiftBusinessDate = getCashierShiftBusinessDate(input.shift.startedAt, settings);
  const activityBusinessDate = getCurrentBusinessDateValue(
    activityAt,
    settings.timezone,
    settings.businessDayCutoffTime,
  );

  if (shiftBusinessDate !== activityBusinessDate) {
    throw new CashierShiftBusinessDayCrossedError();
  }

  return { activityAt, activityBusinessDate, shiftBusinessDate };
}

export async function assertNoOpenShiftsForBusinessDate(
  tx: Prisma.TransactionClient,
  input: {
    branchId: string;
    businessDate: string;
    businessId: string;
    settings: BusinessTimeSettings;
  },
) {
  const { fromDate, toDateExclusive } = getDailyClosingRange(
    undefined,
    input.businessDate,
    input.settings,
  );
  const openShiftCount = await tx.cashierShift.count({
    where: {
      branchId: input.branchId,
      businessId: input.businessId,
      startedAt: { gte: fromDate, lt: toDateExclusive },
      status: "OPEN",
    },
  });

  if (openShiftCount > 0) {
    throw new DailyClosingOpenShiftError(openShiftCount);
  }
}

export async function assertNoCrossBusinessDayShiftActivity(
  tx: Prisma.TransactionClient,
  input: {
    branchId: string;
    businessDate: string;
    businessId: string;
    settings: BusinessTimeSettings;
  },
) {
  const { fromDate, toDateExclusive } = getDailyClosingRange(
    undefined,
    input.businessDate,
    input.settings,
  );
  const shifts = await tx.cashierShift.findMany({
    where: {
      branchId: input.branchId,
      businessId: input.businessId,
      startedAt: { gte: fromDate, lt: toDateExclusive },
      status: "CLOSED",
    },
    select: { endedAt: true, id: true },
  });
  const crossedShiftIds = shifts
    .filter((shift) => shift.endedAt && shift.endedAt > toDateExclusive)
    .map((shift) => shift.id);
  const shiftIds = shifts.map((shift) => shift.id);

  if (shiftIds.length > 0) {
    const [payment, refund, payout] = await Promise.all([
      tx.payment.findFirst({
        where: {
          businessId: input.businessId,
          OR: [{ paidAt: { lt: fromDate } }, { paidAt: { gte: toDateExclusive } }],
          shiftId: { in: shiftIds },
        },
        select: { shiftId: true },
      }),
      tx.paymentRefund.findFirst({
        where: {
          businessId: input.businessId,
          OR: [{ refundedAt: { lt: fromDate } }, { refundedAt: { gte: toDateExclusive } }],
          shiftId: { in: shiftIds },
        },
        select: { shiftId: true },
      }),
      tx.cashierShiftExpensePayout.findFirst({
        where: {
          businessId: input.businessId,
          OR: [{ occurredAt: { lt: fromDate } }, { occurredAt: { gte: toDateExclusive } }],
          shiftId: { in: shiftIds },
        },
        select: { shiftId: true },
      }),
    ]);
    for (const unsafe of [payment, refund, payout]) {
      if (unsafe?.shiftId && !crossedShiftIds.includes(unsafe.shiftId)) {
        crossedShiftIds.push(unsafe.shiftId);
      }
    }
  }

  if (crossedShiftIds.length > 0) {
    throw new CrossBusinessDayShiftReviewRequiredError(crossedShiftIds);
  }
}

export async function assertShiftActivityWithinBusinessDate(
  tx: Prisma.TransactionClient,
  input: {
    businessDate: string;
    businessId: string;
    settings: BusinessTimeSettings;
    shiftId: string;
  },
) {
  const { fromDate, toDateExclusive } = getDailyClosingRange(
    undefined,
    input.businessDate,
    input.settings,
  );
  const [payment, refund, payout] = await Promise.all([
    tx.payment.findFirst({
      where: {
        businessId: input.businessId,
        OR: [{ paidAt: { lt: fromDate } }, { paidAt: { gte: toDateExclusive } }],
        shiftId: input.shiftId,
      },
      select: { id: true },
    }),
    tx.paymentRefund.findFirst({
      where: {
        businessId: input.businessId,
        OR: [{ refundedAt: { lt: fromDate } }, { refundedAt: { gte: toDateExclusive } }],
        shiftId: input.shiftId,
      },
      select: { id: true },
    }),
    tx.cashierShiftExpensePayout.findFirst({
      where: {
        businessId: input.businessId,
        OR: [{ occurredAt: { lt: fromDate } }, { occurredAt: { gte: toDateExclusive } }],
        shiftId: input.shiftId,
      },
      select: { id: true },
    }),
  ]);

  if (payment || refund || payout) {
    throw new CrossBusinessDayShiftReviewRequiredError([input.shiftId]);
  }
}
