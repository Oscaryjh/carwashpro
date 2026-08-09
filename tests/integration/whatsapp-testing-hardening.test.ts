import assert from "node:assert/strict";
import test from "node:test";
import {
  markDeliveryStatus,
  markFailed,
  markSending,
  markSentToServer,
  recoverExpiredSending,
} from "../../src/lib/notification-queue/repository";
import { prisma } from "../../src/lib/prisma";
import { enqueueWhatsAppLogMessage } from "../../src/lib/whatsapp/notification-queue";
import { renderManagedWhatsAppTemplate } from "../../src/lib/whatsapp/templates";
import {
  claimWhatsAppWebhookEvent,
  completeWhatsAppWebhookEvent,
  WhatsAppWebhookRequestError,
} from "../../src/lib/whatsapp/webhook-events";

test("WhatsApp hardening keeps one intent, one claim, durable attempts and monotonic tenant-scoped status", { timeout: 30_000 }, async (t) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const businessA = await prisma.business.create({
    data: { name: `WhatsApp Hardening A ${suffix}`, slug: `wa-hard-a-${suffix}` },
  });
  const businessB = await prisma.business.create({
    data: { name: `WhatsApp Hardening B ${suffix}`, slug: `wa-hard-b-${suffix}` },
  });

  try {
    const dedupeKey = `READY_FOR_PICKUP:${businessA.id}:${suffix}`;
    const firstLog = await createMessageLog(businessA.id, "Frozen ready message");
    const secondLog = await createMessageLog(businessA.id, "Duplicate ready message");
    const firstIntent = await enqueueWhatsAppLogMessage({
      businessId: businessA.id,
      dedupeKey,
      message: "Frozen ready message",
      messageLogId: firstLog.id,
      messageType: "READY_FOR_PICKUP",
      phone: "+60 11-1221 2259",
    });
    const duplicateIntent = await enqueueWhatsAppLogMessage({
      businessId: businessA.id,
      dedupeKey,
      message: "Duplicate ready message",
      messageLogId: secondLog.id,
      messageType: "READY_FOR_PICKUP",
      phone: "01112212259",
    });
    assert.equal(duplicateIntent.id, firstIntent.id);
    assert.equal(
      await prisma.notificationQueue.count({ where: { dedupeKey } }),
      1,
    );
    assert.equal(
      await prisma.whatsAppMessage.count({ where: { dedupeKey } }),
      1,
    );
    assert.equal(
      await prisma.whatsAppMessage.count({ where: { id: secondLog.id } }),
      0,
    );
    t.diagnostic("deduplicated intent verified");

    const claims = await Promise.all([
      markSending(firstIntent.id),
      markSending(firstIntent.id),
    ]);
    const firstClaim = claims.find((claim) => claim !== null);
    assert.ok(firstClaim?.claimToken);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal(
      await prisma.whatsAppSendAttempt.count({ where: { queueId: firstIntent.id } }),
      1,
    );
    t.diagnostic("concurrent claim verified");

    const retry = await markFailed({
      claimToken: firstClaim.claimToken,
      errorCategory: "CONNECTOR_UNAVAILABLE",
      errorMessage: "Connector temporarily unavailable.",
      id: firstIntent.id,
      retryable: true,
    });
    assert.equal(retry.status, "QUEUED");
    await prisma.notificationQueue.update({
      where: { id: firstIntent.id },
      data: { nextAttemptAt: new Date(0) },
    });
    const secondClaim = await markSending(firstIntent.id);
    assert.ok(secondClaim?.claimToken);
    const sent = await markSentToServer({
      claimToken: secondClaim.claimToken,
      id: firstIntent.id,
      providerMessageId: `provider-${suffix}`,
    });
    assert.equal(sent?.status, "SENT_TO_SERVER");
    assert.deepEqual(
      await prisma.whatsAppSendAttempt.findMany({
        where: { queueId: firstIntent.id },
        orderBy: { attemptNumber: "asc" },
        select: { attemptNumber: true, status: true },
      }),
      [
        { attemptNumber: 1, status: "RETRY_SCHEDULED" },
        { attemptNumber: 2, status: "SENT_TO_SERVER" },
      ],
    );
    t.diagnostic("retry and success attempt history verified");

    const deliveredAt = new Date("2026-08-09T03:00:00.000Z");
    const readAt = new Date("2026-08-09T03:01:00.000Z");
    assert.equal(
      (
        await markDeliveryStatus({
          businessId: businessA.id,
          providerMessageId: `provider-${suffix}`,
          status: "DELIVERED",
          timestamp: deliveredAt,
        })
      ).updated,
      1,
    );
    assert.equal(
      (
        await markDeliveryStatus({
          businessId: businessA.id,
          providerMessageId: `provider-${suffix}`,
          status: "DELIVERED",
          timestamp: new Date("2026-08-09T03:00:30.000Z"),
        })
      ).updated,
      0,
    );
    await markDeliveryStatus({
      businessId: businessA.id,
      providerMessageId: `provider-${suffix}`,
      status: "READ",
      timestamp: readAt,
    });
    await markDeliveryStatus({
      businessId: businessA.id,
      providerMessageId: `provider-${suffix}`,
      status: "DELIVERED",
      timestamp: new Date("2026-08-09T02:59:00.000Z"),
    });
    await markDeliveryStatus({
      businessId: businessA.id,
      errorMessage: "Late failure",
      providerMessageId: `provider-${suffix}`,
      status: "FAILED",
      timestamp: new Date("2026-08-09T03:02:00.000Z"),
    });
    const finalQueue = await prisma.notificationQueue.findUniqueOrThrow({
      where: { id: firstIntent.id },
    });
    assert.equal(finalQueue.status, "READ");
    assert.equal(finalQueue.deliveredAt?.toISOString(), deliveredAt.toISOString());
    assert.equal(finalQueue.readAt?.toISOString(), readAt.toISOString());
    t.diagnostic("monotonic status verified");

    const otherTenantQueue = await prisma.notificationQueue.create({
      data: {
        businessId: businessB.id,
        message: "Other tenant",
        messageType: "READY_FOR_PICKUP",
        phone: "601112212259",
        providerMessageId: `provider-${suffix}`,
        status: "SENT_TO_SERVER",
      },
    });
    await markDeliveryStatus({
      businessId: businessA.id,
      providerMessageId: `provider-${suffix}`,
      status: "READ",
    });
    assert.equal(
      (await prisma.notificationQueue.findUniqueOrThrow({ where: { id: otherTenantQueue.id } })).status,
      "SENT_TO_SERVER",
    );

    const webhookClaim = await claimWhatsAppWebhookEvent({
      businessId: businessA.id,
      eventKey: `receipt:${suffix}`,
      eventType: "RECEIPT_READ",
      payloadFingerprint: "a".repeat(64),
      providerMessageId: `provider-${suffix}`,
    });
    assert.equal(webhookClaim.shouldProcess, true);
    await completeWhatsAppWebhookEvent(webhookClaim.event.id, "APPLIED", true);
    const replay = await claimWhatsAppWebhookEvent({
      businessId: businessA.id,
      eventKey: `receipt:${suffix}`,
      eventType: "RECEIPT_READ",
      payloadFingerprint: "a".repeat(64),
      providerMessageId: `provider-${suffix}`,
    });
    assert.equal(replay.shouldProcess, false);
    assert.equal(replay.event.duplicateCount, 1);
    await assert.rejects(
      () =>
        claimWhatsAppWebhookEvent({
          businessId: businessA.id,
          eventKey: `receipt:${suffix}`,
          eventType: "RECEIPT_READ",
          payloadFingerprint: "b".repeat(64),
        }),
      (error: unknown) =>
        error instanceof WhatsAppWebhookRequestError && error.status === 409,
    );
    assert.equal(
      (
        await claimWhatsAppWebhookEvent({
          businessId: businessB.id,
          eventKey: `receipt:${suffix}`,
          eventType: "RECEIPT_READ",
          payloadFingerprint: "a".repeat(64),
        })
      ).shouldProcess,
      true,
    );
    t.diagnostic("webhook replay and tenant scope verified");

    const stuckQueue = await prisma.notificationQueue.create({
      data: {
        businessId: businessA.id,
        message: "Stuck send",
        messageType: "INVOICE_SENT",
        phone: "601112212259",
      },
    });
    const stuckClaim = await markSending(stuckQueue.id);
    assert.ok(stuckClaim);
    await prisma.notificationQueue.update({
      where: { id: stuckQueue.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    const recovered = await recoverExpiredSending(new Date());
    assert.ok(recovered.recovered >= 1);
    assert.equal(
      (await prisma.notificationQueue.findUniqueOrThrow({ where: { id: stuckQueue.id } })).status,
      "QUEUED",
    );

    const exhaustedQueue = await prisma.notificationQueue.create({
      data: {
        attemptCount: 4,
        businessId: businessA.id,
        message: "Exhausted send",
        messageType: "INVOICE_SENT",
        phone: "601112212259",
      },
    });
    const exhaustedClaim = await markSending(exhaustedQueue.id);
    assert.ok(exhaustedClaim);
    await prisma.notificationQueue.update({
      where: { id: exhaustedQueue.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    await recoverExpiredSending(new Date());
    assert.equal(
      (await prisma.notificationQueue.findUniqueOrThrow({ where: { id: exhaustedQueue.id } })).status,
      "FAILED",
    );
    t.diagnostic("lease recovery verified");

    await prisma.whatsAppTemplate.upsert({
      where: {
        messageType_industryType: {
          industryType: "AUTO_DETAILING",
          messageType: "NEW_CUSTOMER_WELCOME",
        },
      },
      create: {
        body: "Snapshot {{customerName}}",
        industryType: "AUTO_DETAILING",
        messageType: "NEW_CUSTOMER_WELCOME",
        status: "ACTIVE",
        title: "Snapshot test",
      },
      update: { body: "Snapshot {{customerName}}", status: "ACTIVE" },
    });
    const snapshotBody = await renderManagedWhatsAppTemplate(
      "NEW_CUSTOMER_WELCOME",
      { customerName: "Before" },
      businessA.id,
    );
    const snapshotLog = await createMessageLog(businessA.id, snapshotBody);
    const snapshotQueue = await enqueueWhatsAppLogMessage({
      businessId: businessA.id,
      dedupeKey: `SNAPSHOT:${businessA.id}:${suffix}`,
      message: snapshotBody,
      messageLogId: snapshotLog.id,
      messageType: "NEW_CUSTOMER_WELCOME",
      phone: "601112212259",
    });
    await prisma.whatsAppTemplate.update({
      where: {
        messageType_industryType: {
          industryType: "AUTO_DETAILING",
          messageType: "NEW_CUSTOMER_WELCOME",
        },
      },
      data: { body: "Changed {{customerName}}" },
    });
    assert.equal(
      (await prisma.notificationQueue.findUniqueOrThrow({ where: { id: snapshotQueue.id } })).message,
      "Snapshot Before",
    );
    t.diagnostic("template snapshot verified");
  } finally {
    await prisma.whatsAppTemplate.deleteMany({
      where: {
        industryType: "AUTO_DETAILING",
        messageType: "NEW_CUSTOMER_WELCOME",
        title: "Snapshot test",
      },
    });
    await prisma.whatsAppWebhookEvent.deleteMany({
      where: { businessId: { in: [businessA.id, businessB.id] } },
    });
    await prisma.whatsAppSendAttempt.deleteMany({
      where: { queue: { businessId: { in: [businessA.id, businessB.id] } } },
    });
    await prisma.notificationQueue.deleteMany({
      where: { businessId: { in: [businessA.id, businessB.id] } },
    });
    await prisma.whatsAppMessage.deleteMany({
      where: { businessId: { in: [businessA.id, businessB.id] } },
    });
    await prisma.whatsAppConversation.deleteMany({
      where: { businessId: { in: [businessA.id, businessB.id] } },
    });
    await prisma.business.deleteMany({
      where: { id: { in: [businessA.id, businessB.id] } },
    });
  }
});

function createMessageLog(businessId: string, messageBody: string) {
  return prisma.whatsAppMessage.create({
    data: {
      businessId,
      messageBody,
      messageType: "READY_FOR_PICKUP",
      phone: "601112212259",
      recipientPhone: "601112212259",
      status: "DRAFT",
    },
  });
}
