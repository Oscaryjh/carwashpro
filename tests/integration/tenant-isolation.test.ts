import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { writeSensitiveAuditLog } from "../../src/lib/audit/payroll-sensitive";
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

test("WhatsApp conversations, contacts, media, and message IDs stay isolated by business", async () => {
  assertLocalDatabase();

  const suffix = randomUUID().slice(0, 8);
  const businessIds: string[] = [];
  const conversationIds: string[] = [];

  try {
    const businessA = await prisma.business.create({
      data: { name: `WhatsApp Isolation A ${suffix}`, slug: `wa-a-${suffix}` },
    });
    const businessB = await prisma.business.create({
      data: { name: `WhatsApp Isolation B ${suffix}`, slug: `wa-b-${suffix}` },
    });
    businessIds.push(businessA.id, businessB.id);

    const sharedPhone = `6011${suffix.replace(/[^0-9]/g, "").padEnd(8, "7")}`;
    const sharedInstanceId = "601122233344";
    const sharedExternalMessageId = `shared-message-${suffix}`;

    const [contactA, contactB] = await Promise.all([
      prisma.whatsAppContact.create({
        data: {
          businessId: businessA.id,
          instanceId: sharedInstanceId,
          phone: sharedPhone,
          displayName: "Customer A",
          rawJson: { business: "A" },
        },
      }),
      prisma.whatsAppContact.create({
        data: {
          businessId: businessB.id,
          instanceId: sharedInstanceId,
          phone: sharedPhone,
          displayName: "Customer B",
          rawJson: { business: "B" },
        },
      }),
    ]);

    const [conversationA, conversationB] = await Promise.all([
      prisma.whatsAppConversation.create({
        data: {
          businessId: businessA.id,
          instanceId: sharedInstanceId,
          phone: sharedPhone,
          displayName: contactA.displayName,
          lastMessageBody: "Image from A",
        },
      }),
      prisma.whatsAppConversation.create({
        data: {
          businessId: businessB.id,
          instanceId: sharedInstanceId,
          phone: sharedPhone,
          displayName: contactB.displayName,
          lastMessageBody: "PDF from B",
        },
      }),
    ]);
    conversationIds.push(conversationA.id, conversationB.id);

    await prisma.whatsAppChatMessage.createMany({
      data: [
        {
          businessId: businessA.id,
          instanceId: sharedInstanceId,
          conversationId: conversationA.id,
          direction: "INBOUND",
          messageType: "IMAGE",
          body: "Image from A",
          mediaUrl: "/uploads/whatsapp-images/a.jpg",
          mediaMimeType: "image/jpeg",
          externalMessageId: sharedExternalMessageId,
          rawMessageJson: { business: "A", media: "image" },
        },
        {
          businessId: businessB.id,
          instanceId: sharedInstanceId,
          conversationId: conversationB.id,
          direction: "INBOUND",
          messageType: "DOCUMENT",
          body: "PDF from B",
          mediaUrl: "/uploads/whatsapp-documents/b.pdf",
          mediaMimeType: "application/pdf",
          externalMessageId: sharedExternalMessageId,
          rawMessageJson: { business: "B", media: "pdf" },
        },
      ],
    });

    const businessAMessages = await prisma.whatsAppChatMessage.findMany({
      where: { businessId: businessA.id },
    });
    const businessBMessages = await prisma.whatsAppChatMessage.findMany({
      where: { businessId: businessB.id },
    });

    assert.deepEqual(businessAMessages.map((message) => message.messageType), ["IMAGE"]);
    assert.deepEqual(businessBMessages.map((message) => message.messageType), ["DOCUMENT"]);
    assert.deepEqual(businessAMessages[0]?.rawMessageJson, { business: "A", media: "image" });
    assert.deepEqual(businessBMessages[0]?.rawMessageJson, { business: "B", media: "pdf" });
    assert.equal(
      await prisma.whatsAppChatMessage.count({
        where: { businessId: businessA.id, externalMessageId: sharedExternalMessageId },
      }),
      1,
    );
    assert.equal(
      await prisma.whatsAppChatMessage.count({
        where: { businessId: businessB.id, externalMessageId: sharedExternalMessageId },
      }),
      1,
    );
  } finally {
    if (conversationIds.length) {
      await prisma.whatsAppChatMessage.deleteMany({
        where: { conversationId: { in: conversationIds } },
      });
      await prisma.whatsAppConversation.deleteMany({
        where: { id: { in: conversationIds } },
      });
    }
    if (businessIds.length) {
      await prisma.whatsAppContact.deleteMany({
        where: { businessId: { in: businessIds } },
      });
      await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    }

    await prisma.$disconnect();
  }
});

test("a sensitive business mutation rolls back when its audit write fails", async () => {
  assertLocalDatabase();

  const suffix = randomUUID().slice(0, 8);
  const originalName = `Audit atomicity ${suffix}`;
  const business = await prisma.business.create({
    data: { name: originalName, slug: `audit-atomicity-${suffix}` },
  });

  try {
    await assert.rejects(
      prisma.$transaction(async (transaction) => {
        await transaction.business.update({
          where: { id: business.id },
          data: { name: "This update must roll back" },
        });
        await writeSensitiveAuditLog(
          {
            businessId: business.id,
            actor: {
              userId: randomUUID(),
              name: "Missing audit actor",
              email: "missing-audit-actor@example.test",
            },
            action: "SENSITIVE_WRITE_TEST",
            entityType: "Business",
            entityId: business.id,
            summary: "Sensitive write atomicity test.",
          },
          transaction,
        );
      }),
    );

    const persisted = await prisma.business.findUniqueOrThrow({
      where: { id: business.id },
      select: { name: true },
    });
    assert.equal(persisted.name, originalName);
    assert.equal(
      await prisma.auditLog.count({
        where: { businessId: business.id, action: "SENSITIVE_WRITE_TEST" },
      }),
      0,
    );
  } finally {
    await prisma.auditLog.deleteMany({ where: { businessId: business.id } });
    await prisma.business.delete({ where: { id: business.id } });
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
