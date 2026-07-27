import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { getBusinessDayRangeForBusiness } from "../../src/lib/business-day";

const prisma = new PrismaClient();

test("Business stores canonical timezone and cutoff without creating operating data", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const baseline = await readOperatingDataCounts();
  let businessId: string | null = null;

  try {
    const business = await prisma.business.create({
      data: {
        name: `Stage3B0 Time ${suffix}`,
        slug: `stage3b0-time-${suffix}`,
        industryType: "SALON_BEAUTY",
        timezone: "Asia/Tokyo",
        businessDayCutoffTime: "04:00",
      },
      select: {
        id: true,
        timezone: true,
        businessDayCutoffTime: true,
      },
    });
    businessId = business.id;

    const range = getBusinessDayRangeForBusiness(business, {
      fromDateValue: "2026-07-01",
      toDateValue: "2026-07-07",
    });
    assert.equal(range.fromDate.toISOString(), "2026-06-30T19:00:00.000Z");
    assert.equal(
      range.toDateExclusive.toISOString(),
      "2026-07-07T19:00:00.000Z",
    );

    await prisma.closingWhatsAppSetting.create({
      data: {
        businessId: business.id,
        businessDayCutoffTime: business.businessDayCutoffTime,
      },
    });
    const legacySetting =
      await prisma.closingWhatsAppSetting.findUniqueOrThrow({
        where: { businessId: business.id },
        select: { businessDayCutoffTime: true },
      });
    assert.equal(legacySetting.businessDayCutoffTime, "04:00");
    assert.deepEqual(await readOperatingDataCounts(), baseline);
  } finally {
    if (businessId) {
      await prisma.closingWhatsAppSetting.deleteMany({
        where: { businessId },
      });
      await prisma.business.deleteMany({ where: { id: businessId } });
    }
    await prisma.$disconnect();
  }
});

test("Business database defaults are canonical and cutoff constraint is enforced", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const business = await prisma.business.create({
    data: {
      name: `Stage3B0 Default ${suffix}`,
      slug: `stage3b0-default-${suffix}`,
      industryType: "AUTO_DETAILING",
    },
    select: {
      id: true,
      timezone: true,
      businessDayCutoffTime: true,
    },
  });

  try {
    assert.equal(business.timezone, "Asia/Kuching");
    assert.equal(business.businessDayCutoffTime, "02:00");
    await assert.rejects(
      prisma.$executeRawUnsafe(
        `UPDATE "businesses" SET "business_day_cutoff_time" = '24:00' WHERE "id" = '${business.id}'`,
      ),
    );
  } finally {
    await prisma.business.delete({ where: { id: business.id } });
    await prisma.$disconnect();
  }
});

async function readOperatingDataCounts() {
  const [appointments, workOrders, invoices, payments, refunds, snapshots] =
    await Promise.all([
      prisma.appointment.count(),
      prisma.workOrder.count(),
      prisma.invoice.count(),
      prisma.payment.count(),
      prisma.paymentRefund.count(),
      prisma.dailyClosingSnapshot.count(),
    ]);

  return { appointments, workOrders, invoices, payments, refunds, snapshots };
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for integration tests.");
  }
  const hostname = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1"].includes(hostname)) {
    throw new Error("Integration tests are restricted to the local database.");
  }
}
