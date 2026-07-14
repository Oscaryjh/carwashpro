import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { buildAuditLogWhere } from "../../src/lib/audit/query";

const prisma = new PrismaClient();

test("customers and audit logs stay inside their business", async () => {
  assertLocalDatabase();

  const suffix = randomUUID().slice(0, 8);
  const businessIds: string[] = [];

  try {
    const businessA = await prisma.business.create({
      data: { name: `Isolation A ${suffix}`, slug: `isolation-a-${suffix}` },
    });
    const businessB = await prisma.business.create({
      data: { name: `Isolation B ${suffix}`, slug: `isolation-b-${suffix}` },
    });
    businessIds.push(businessA.id, businessB.id);

    const userA = await prisma.user.create({
      data: {
        businessId: businessA.id,
        name: "Owner A",
        email: `isolation-a-${suffix}@example.test`,
        passwordHash: "not-a-real-password",
        role: "BUSINESS_OWNER",
      },
    });
    const userB = await prisma.user.create({
      data: {
        businessId: businessB.id,
        name: "Owner B",
        email: `isolation-b-${suffix}@example.test`,
        passwordHash: "not-a-real-password",
        role: "BUSINESS_OWNER",
      },
    });

    const customerA = await prisma.customer.create({
      data: {
        businessId: businessA.id,
        name: "Customer A",
        phone: `6011${suffix.replace(/[^0-9]/g, "").padEnd(8, "1")}`,
      },
    });
    const customerB = await prisma.customer.create({
      data: {
        businessId: businessB.id,
        name: "Customer B",
        phone: `6012${suffix.replace(/[^0-9]/g, "").padEnd(8, "2")}`,
      },
    });

    await prisma.auditLog.createMany({
      data: [
        {
          businessId: businessA.id,
          actorUserId: userA.id,
          actorName: userA.name,
          actorEmail: userA.email,
          action: "CUSTOMER_CREATED",
          entityType: "Customer",
          entityId: customerA.id,
          summary: "Created Customer A",
        },
        {
          businessId: businessB.id,
          actorUserId: userB.id,
          actorName: userB.name,
          actorEmail: userB.email,
          action: "CUSTOMER_CREATED",
          entityType: "Customer",
          entityId: customerB.id,
          summary: "Created Customer B",
        },
      ],
    });

    const visibleCustomers = await prisma.customer.findMany({
      where: { businessId: businessA.id },
    });
    const visibleLogs = await prisma.auditLog.findMany({
      where: buildAuditLogWhere(businessA.id),
    });
    const crossBusinessCustomer = await prisma.customer.findFirst({
      where: { id: customerB.id, businessId: businessA.id },
    });
    const crossBusinessAudit = await prisma.auditLog.findFirst({
      where: {
        ...buildAuditLogWhere(businessA.id),
        entityId: customerB.id,
      },
    });

    assert.deepEqual(visibleCustomers.map((customer) => customer.id), [customerA.id]);
    assert.deepEqual(visibleLogs.map((log) => log.entityId), [customerA.id]);
    assert.equal(crossBusinessCustomer, null);
    assert.equal(crossBusinessAudit, null);
  } finally {
    if (businessIds.length) {
      await prisma.auditLog.deleteMany({ where: { businessId: { in: businessIds } } });
      await prisma.customer.deleteMany({ where: { businessId: { in: businessIds } } });
      await prisma.user.deleteMany({ where: { businessId: { in: businessIds } } });
      await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
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
