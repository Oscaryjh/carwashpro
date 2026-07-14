import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  cancelAppointmentReminder,
  scheduleAppointmentReminder,
} from "../../src/lib/whatsapp/appointment-reminders";

const prisma = new PrismaClient();

test("appointment reminders are tenant scoped, deduplicated and rescheduled safely", async () => {
  assertLocalDatabase();

  const suffix = randomUUID().slice(0, 8);
  const digits = randomUUID().replace(/\D/g, "").padEnd(8, "1").slice(0, 8);
  const businessIds: string[] = [];

  try {
    const businessA = await prisma.business.create({
      data: {
        name: `Reminder A ${suffix}`,
        slug: `reminder-a-${suffix}`,
        phone: `6011${digits}`,
      },
    });
    const businessB = await prisma.business.create({
      data: {
        name: `Reminder B ${suffix}`,
        slug: `reminder-b-${suffix}`,
      },
    });
    businessIds.push(businessA.id, businessB.id);

    const owner = await prisma.user.create({
      data: {
        businessId: businessA.id,
        name: "Reminder Owner",
        email: `reminder-${suffix}@example.test`,
        passwordHash: "not-a-real-password",
        role: "BUSINESS_OWNER",
      },
    });
    const customer = await prisma.customer.create({
      data: {
        businessId: businessA.id,
        name: "Reminder Customer",
        phone: `6012${digits}`,
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        businessId: businessA.id,
        customerId: customer.id,
        plateNumber: `REM${digits.slice(0, 4)}`,
        brand: "Perodua",
        model: "Myvi",
      },
    });
    const initialScheduledAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const appointment = await prisma.appointment.create({
      data: {
        businessId: businessA.id,
        customerId: customer.id,
        vehicleId: vehicle.id,
        createdById: owner.id,
        scheduledAt: initialScheduledAt,
      },
    });

    const crossTenantResult = await scheduleAppointmentReminder({
      appointmentId: appointment.id,
      businessId: businessB.id,
      sentByUserId: owner.id,
    });
    assert.equal(crossTenantResult.status, "NOT_FOUND");

    const firstResult = await scheduleAppointmentReminder({
      appointmentId: appointment.id,
      businessId: businessA.id,
      sentByUserId: owner.id,
    });
    assert.equal(firstResult.status, "SCHEDULED");

    const firstQueue = await prisma.notificationQueue.findFirstOrThrow({
      where: { appointmentId: appointment.id, businessId: businessA.id },
      include: { messageLog: true },
    });
    assert.equal(firstQueue.status, "QUEUED");
    assert.equal(firstQueue.messageType, "APPOINTMENT_REMINDER");
    assert.equal(firstQueue.messageLog?.appointmentId, appointment.id);
    assert.equal(firstQueue.messageLog?.businessId, businessA.id);
    assert.equal(
      await prisma.notificationQueue.count({ where: { businessId: businessB.id } }),
      0,
    );

    const duplicateResult = await scheduleAppointmentReminder({
      appointmentId: appointment.id,
      businessId: businessA.id,
      sentByUserId: owner.id,
    });
    assert.equal(duplicateResult.status, "ALREADY_SCHEDULED");
    assert.equal(
      await prisma.notificationQueue.count({
        where: { appointmentId: appointment.id },
      }),
      1,
    );

    const rescheduledAt = new Date(initialScheduledAt.getTime() + 60 * 60 * 1000);
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { scheduledAt: rescheduledAt },
    });
    const rescheduledResult = await scheduleAppointmentReminder({
      appointmentId: appointment.id,
      businessId: businessA.id,
      sentByUserId: owner.id,
    });
    assert.equal(rescheduledResult.status, "SCHEDULED");

    const rescheduledQueues = await prisma.notificationQueue.findMany({
      where: { appointmentId: appointment.id },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(
      rescheduledQueues.map((queueItem) => queueItem.status),
      ["CANCELLED", "QUEUED"],
    );

    const cancelledResult = await cancelAppointmentReminder({
      appointmentId: appointment.id,
      businessId: businessA.id,
      reason: "Integration test cleanup.",
    });
    assert.equal(cancelledResult.cancelled, 1);
    assert.equal(
      await prisma.notificationQueue.count({
        where: { appointmentId: appointment.id, status: "QUEUED" },
      }),
      0,
    );
  } finally {
    if (businessIds.length) {
      await prisma.notificationQueue.deleteMany({
        where: { businessId: { in: businessIds } },
      });
      await prisma.whatsAppMessage.deleteMany({
        where: { businessId: { in: businessIds } },
      });
      await prisma.whatsAppConversation.deleteMany({
        where: { businessId: { in: businessIds } },
      });
      await prisma.appointment.deleteMany({
        where: { businessId: { in: businessIds } },
      });
      await prisma.vehicle.deleteMany({
        where: { businessId: { in: businessIds } },
      });
      await prisma.customer.deleteMany({
        where: { businessId: { in: businessIds } },
      });
      await prisma.user.deleteMany({
        where: { businessId: { in: businessIds } },
      });
      await prisma.business.deleteMany({
        where: { id: { in: businessIds } },
      });
    }

    await prisma.$disconnect();
  }
});

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
