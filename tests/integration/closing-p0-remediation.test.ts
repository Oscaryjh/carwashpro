import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  acquireDailyClosingScopeLock,
  acquireCashierOpenShiftLock,
  assertCashierShiftAcceptsActivity,
  assertNoCrossBusinessDayShiftActivity,
  assertNoOpenShiftsForBusinessDate,
  CashierShiftBusinessDayCrossedError,
  CrossBusinessDayShiftReviewRequiredError,
  DailyClosingOpenShiftError,
  runClosingSerializableTransaction,
} from "../../src/lib/closing/shift-control";

const prisma = new PrismaClient();
const businessDate = "2026-08-27";

after(async () => prisma.$disconnect());

test("concurrent starts preserve one OPEN shift per business and cashier", async () => {
  assertLocalDatabase();
  const fixture = await createFixture("CONCURRENT-OPEN");
  const start = () => runClosingSerializableTransaction(prisma, async (tx) => {
    await acquireCashierOpenShiftLock(tx, {
      businessId: fixture.business.id,
      cashierId: fixture.user.id,
    });
    const existing = await tx.cashierShift.findFirst({
      where: { businessId: fixture.business.id, cashierId: fixture.user.id, status: "OPEN" },
      select: { id: true },
    });
    if (existing) throw new Error("You already have an open shift.");
    return tx.cashierShift.create({
      data: {
        branchId: fixture.branch.id,
        businessId: fixture.business.id,
        cashierId: fixture.user.id,
        openingFloat: 0,
        startedAt: new Date(),
        status: "OPEN",
      },
    });
  });

  const results = await Promise.allSettled([start(), start()]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(await prisma.cashierShift.count({
    where: { businessId: fixture.business.id, cashierId: fixture.user.id, status: "OPEN" },
  }), 1);
});

test("cross-cutoff activity is rejected before a payment can be created", async () => {
  assertLocalDatabase();
  const fixture = await createFixture("CUTOFF");
  const shift = await prisma.cashierShift.create({
    data: {
      branchId: fixture.branch.id,
      businessId: fixture.business.id,
      cashierId: fixture.user.id,
      startedAt: new Date("2026-08-27T01:30:00.000Z"),
    },
  });

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const activity = await assertCashierShiftAcceptsActivity(tx, {
        activityAt: new Date("2026-08-27T02:15:00.000Z"),
        businessId: fixture.business.id,
        shift,
      });
      await tx.payment.create({
        data: {
          amount: 20,
          branchId: fixture.branch.id,
          businessId: fixture.business.id,
          cashierId: fixture.user.id,
          method: "CASH",
          paidAt: activity.activityAt,
          shiftId: shift.id,
        },
      });
    }),
    (error: unknown) => error instanceof CashierShiftBusinessDayCrossedError,
  );
  assert.equal(await prisma.payment.count({ where: { shiftId: shift.id } }), 0);
  assert.equal(await prisma.dailyClosingSnapshot.count({
    where: { businessId: fixture.business.id },
  }), 0);
});

test("historical cross-business-day shifts fail closed before snapshot creation", async () => {
  assertLocalDatabase();
  const fixture = await createFixture("HISTORICAL");
  const historicalBusinessDate = "2026-08-26";
  await prisma.cashierShift.create({
    data: {
      branchId: fixture.branch.id,
      businessId: fixture.business.id,
      cashierId: fixture.user.id,
      closingCash: 0,
      endedAt: new Date("2026-08-27T02:30:00.000Z"),
      startedAt: new Date("2026-08-27T01:30:00.000Z"),
      status: "CLOSED",
    },
  });

  await assert.rejects(
    runClosingSerializableTransaction(prisma, async (tx) => {
      await acquireDailyClosingScopeLock(tx, {
        branchId: fixture.branch.id,
        businessDate: historicalBusinessDate,
        businessId: fixture.business.id,
      });
      await assertNoCrossBusinessDayShiftActivity(tx, {
        branchId: fixture.branch.id,
        businessDate: historicalBusinessDate,
        businessId: fixture.business.id,
        settings: fixture.settings,
      });
      await createSnapshot(tx, fixture);
    }),
    (error: unknown) => error instanceof CrossBusinessDayShiftReviewRequiredError,
  );
  assert.equal(await prisma.dailyClosingSnapshot.count({
    where: { businessId: fixture.business.id },
  }), 0);
});

test("manual daily close rejects an open shift before snapshot, audit, or notification", async () => {
  assertLocalDatabase();
  const fixture = await createFixture("OPEN");
  await prisma.cashierShift.create({
    data: {
      branchId: fixture.branch.id,
      businessId: fixture.business.id,
      cashierId: fixture.user.id,
      startedAt: new Date("2026-08-27T10:00:00.000Z"),
    },
  });
  const before = await sideEffectCounts(fixture.business.id);

  await assert.rejects(
    runClosingSerializableTransaction(prisma, async (tx) => {
      await acquireDailyClosingScopeLock(tx, {
        branchId: fixture.branch.id,
        businessDate,
        businessId: fixture.business.id,
      });
      await assertNoOpenShiftsForBusinessDate(tx, {
        branchId: fixture.branch.id,
        businessDate,
        businessId: fixture.business.id,
        settings: fixture.settings,
      });
      await createSnapshot(tx, fixture);
    }),
    (error: unknown) => error instanceof DailyClosingOpenShiftError,
  );
  assert.deepEqual(await sideEffectCounts(fixture.business.id), before);
});

test("concurrent shift start and manual close resolve to snapshot XOR open shift", async () => {
  assertLocalDatabase();
  const fixture = await createFixture("RACE");
  const start = runClosingSerializableTransaction(prisma, async (tx) => {
    await acquireDailyClosingScopeLock(tx, {
      branchId: fixture.branch.id,
      businessDate,
      businessId: fixture.business.id,
    });
    const snapshot = await tx.dailyClosingSnapshot.findFirst({
      where: { branchId: fixture.branch.id, businessId: fixture.business.id },
    });
    if (snapshot) throw new Error("DAILY_CLOSING_ALREADY_COMPLETED");
    return tx.cashierShift.create({
      data: {
        branchId: fixture.branch.id,
        businessId: fixture.business.id,
        cashierId: fixture.user.id,
        startedAt: new Date("2026-08-27T10:00:00.000Z"),
      },
    });
  });
  const close = runClosingSerializableTransaction(prisma, async (tx) => {
    await acquireDailyClosingScopeLock(tx, {
      branchId: fixture.branch.id,
      businessDate,
      businessId: fixture.business.id,
    });
    await assertNoOpenShiftsForBusinessDate(tx, {
      branchId: fixture.branch.id,
      businessDate,
      businessId: fixture.business.id,
      settings: fixture.settings,
    });
    return createSnapshot(tx, fixture);
  });

  await Promise.allSettled([start, close]);
  const [openShifts, snapshots] = await Promise.all([
    prisma.cashierShift.count({ where: { businessId: fixture.business.id, status: "OPEN" } }),
    prisma.dailyClosingSnapshot.count({ where: { businessId: fixture.business.id } }),
  ]);
  assert.equal(openShifts + snapshots, 1);
  assert.ok((openShifts === 1 && snapshots === 0) || (openShifts === 0 && snapshots === 1));
});

test("only the final one of two shifts creates one daily snapshot", async () => {
  assertLocalDatabase();
  const fixture = await createFixture("FINAL");
  const shifts = await Promise.all(["A", "B"].map((label) =>
    prisma.cashierShift.create({
      data: {
        branchId: fixture.branch.id,
        businessId: fixture.business.id,
        cashierId: fixture.user.id,
        notes: label,
        startedAt: new Date("2026-08-27T10:00:00.000Z"),
      },
    })));

  const closeShift = (id: string) => runClosingSerializableTransaction(prisma, async (tx) => {
    await acquireDailyClosingScopeLock(tx, {
      branchId: fixture.branch.id,
      businessDate,
      businessId: fixture.business.id,
    });
    await tx.cashierShift.update({
      where: { id },
      data: { closingCash: 0, endedAt: new Date("2026-08-27T11:00:00.000Z"), status: "CLOSED" },
    });
    const open = await tx.cashierShift.count({
      where: { branchId: fixture.branch.id, businessId: fixture.business.id, status: "OPEN" },
    });
    if (open === 0) await createSnapshot(tx, fixture);
  });

  await closeShift(shifts[0].id);
  assert.equal(await prisma.dailyClosingSnapshot.count({ where: { businessId: fixture.business.id } }), 0);
  await closeShift(shifts[1].id);
  assert.equal(await prisma.dailyClosingSnapshot.count({ where: { businessId: fixture.business.id } }), 1);
});

test("final shift end and manual close cannot create duplicate snapshots", async () => {
  assertLocalDatabase();
  const fixture = await createFixture("END-CLOSE-RACE");
  const shift = await prisma.cashierShift.create({
    data: {
      branchId: fixture.branch.id,
      businessId: fixture.business.id,
      cashierId: fixture.user.id,
      startedAt: new Date("2026-08-27T10:00:00.000Z"),
    },
  });

  const endShift = runClosingSerializableTransaction(prisma, async (tx) => {
    await acquireDailyClosingScopeLock(tx, {
      branchId: fixture.branch.id,
      businessDate,
      businessId: fixture.business.id,
    });
    await tx.cashierShift.update({
      where: { id: shift.id },
      data: {
        closingCash: 0,
        endedAt: new Date("2026-08-27T11:00:00.000Z"),
        status: "CLOSED",
      },
    });
    const open = await tx.cashierShift.count({
      where: {
        branchId: fixture.branch.id,
        businessId: fixture.business.id,
        status: "OPEN",
      },
    });
    if (open === 0) await createSnapshotIfMissing(tx, fixture);
  });
  const manualClose = runClosingSerializableTransaction(prisma, async (tx) => {
    await acquireDailyClosingScopeLock(tx, {
      branchId: fixture.branch.id,
      businessDate,
      businessId: fixture.business.id,
    });
    await assertNoOpenShiftsForBusinessDate(tx, {
      branchId: fixture.branch.id,
      businessDate,
      businessId: fixture.business.id,
      settings: fixture.settings,
    });
    await createSnapshotIfMissing(tx, fixture);
  });

  await Promise.allSettled([endShift, manualClose]);
  assert.equal(await prisma.dailyClosingSnapshot.count({
    where: { businessId: fixture.business.id },
  }), 1);
  assert.equal(await prisma.cashierShift.count({
    where: { businessId: fixture.business.id, status: "OPEN" },
  }), 0);
});

async function createFixture(label: string) {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  const settings = { businessDayCutoffTime: "02:00", timezone: "UTC" };
  const business = await prisma.business.create({
    data: {
      ...settings,
      industryType: "SALON_BEAUTY",
      name: `Closing P0 ${suffix}`,
      slug: `closing-p0-${suffix.toLowerCase()}`,
    },
  });
  const branch = await prisma.branch.create({ data: { businessId: business.id, name: `Branch ${suffix}` } });
  const user = await prisma.user.create({
    data: { branchId: branch.id, businessId: business.id, name: `Owner ${suffix}`, role: "BUSINESS_OWNER" },
  });
  return { branch, business, settings, user };
}

async function createSnapshot(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  return tx.dailyClosingSnapshot.create({
    data: {
      actualCashCents: 0,
      branchId: fixture.branch.id,
      businessDate: new Date(`${businessDate}T00:00:00.000Z`),
      businessId: fixture.business.id,
      businessType: "SALON_BEAUTY",
      cashDifferenceCents: 0,
      closedByUserId: fixture.user.id,
      expectedCashCents: 0,
      reportDataJson: {},
      timezone: "UTC",
      whatsappText: "Closing test",
    },
  });
}

async function createSnapshotIfMissing(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  const existing = await tx.dailyClosingSnapshot.findFirst({
    where: {
      branchId: fixture.branch.id,
      businessId: fixture.business.id,
      businessDate: new Date(`${businessDate}T00:00:00.000Z`),
    },
  });
  return existing ?? createSnapshot(tx, fixture);
}

async function sideEffectCounts(businessId: string) {
  const [snapshots, audits, notifications] = await Promise.all([
    prisma.dailyClosingSnapshot.count({ where: { businessId } }),
    prisma.auditLog.count({ where: { businessId } }),
    prisma.notificationQueue.count({ where: { businessId } }),
  ]);
  return { audits, notifications, snapshots };
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for closing integration tests.");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(hostname), "Closing integration tests must use a local database.");
}
