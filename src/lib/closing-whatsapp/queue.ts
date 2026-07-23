import {
  NotificationQueuePriority,
  Prisma,
  type NotificationQueueStatus,
  type PrismaClient,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  buildClosingReportDedupeKey,
  buildUnclosedReminderDedupeKey,
  getClosingWhatsAppAutomationConfig,
  resolveClosingWhatsAppRecipients,
} from "./recipients";
import { buildUnclosedClosingReminderText } from "./templates";
import {
  CLOSING_REPORT_MESSAGE_TYPE,
  type ClosingWhatsAppQueueResult,
  type ClosingWhatsAppRecipientInput,
  UNCLOSED_REMINDER_MESSAGE_TYPE,
} from "./types";

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export async function enqueueClosingReportForSnapshot(
  snapshotId: string,
  client: PrismaLike = prisma,
): Promise<ClosingWhatsAppQueueResult> {
  const snapshot = await client.dailyClosingSnapshot.findUnique({
    where: { id: snapshotId },
    select: {
      id: true,
      branchId: true,
      businessDate: true,
      businessId: true,
      whatsappText: true,
    },
  });

  if (!snapshot?.branchId) {
    return emptyResult();
  }

  const config = await getClosingWhatsAppAutomationConfig(
    { branchId: snapshot.branchId, businessId: snapshot.businessId },
    client,
  );

  if (!config.enabled || !config.sendClosingReport) {
    return emptyResult();
  }

  const recipients = await resolveClosingWhatsAppRecipients(
    { branchId: snapshot.branchId, businessId: snapshot.businessId },
    client,
  );

  let created = 0;
  let skipped = 0;

  for (const recipient of recipients) {
    if (!recipient.id) {
      skipped += 1;
      continue;
    }

    const dedupeKey = buildClosingReportDedupeKey({
      recipientId: recipient.id,
      snapshotId: snapshot.id,
    });
    const didCreate = await createClosingQueueItem(
      {
        branchId: snapshot.branchId,
        businessId: snapshot.businessId,
        dailyClosingSnapshotId: snapshot.id,
        dedupeKey,
        message: snapshot.whatsappText,
        messageType: CLOSING_REPORT_MESSAGE_TYPE,
        recipient,
        sendType: "CLOSING_REPORT",
        trigger: "AUTO_CLOSING",
      },
      client,
    );

    if (didCreate) {
      created += 1;
    } else {
      skipped += 1;
    }
  }

  return { created, skipped, recipients };
}

export async function enqueueUnclosedClosingReminders(
  input: {
    branchId: string;
    businessDate: string;
    businessId: string;
    now?: Date;
  },
  client: PrismaLike = prisma,
): Promise<ClosingWhatsAppQueueResult> {
  const config = await getClosingWhatsAppAutomationConfig(input, client);

  if (!config.enabled || !config.sendUnclosedReminder) {
    return emptyResult();
  }

  const snapshot = await client.dailyClosingSnapshot.findUnique({
    where: {
      businessId_branchId_businessDate: {
        branchId: input.branchId,
        businessDate: normalizeBusinessDate(input.businessDate),
        businessId: input.businessId,
      },
    },
    select: { id: true },
  });

  if (snapshot) {
    return emptyResult();
  }

  const [business, branch, recipients] = await Promise.all([
    client.business.findUniqueOrThrow({
      where: { id: input.businessId },
      select: { language: true, name: true },
    }),
    client.branch.findFirstOrThrow({
      where: { businessId: input.businessId, id: input.branchId },
      select: { name: true },
    }),
    resolveClosingWhatsAppRecipients(input, client),
  ]);

  const message = buildUnclosedClosingReminderText({
    branchName: branch.name,
    businessDate: input.businessDate,
    businessName: business.name,
    deadlineTime: config.deadlineTime,
    language: business.language,
  });
  let created = 0;
  let skipped = 0;

  for (const recipient of recipients) {
    if (!recipient.id) {
      skipped += 1;
      continue;
    }

    const dedupeKey = buildUnclosedReminderDedupeKey({
      branchId: input.branchId,
      businessDate: input.businessDate,
      businessId: input.businessId,
      recipientId: recipient.id,
    });
    const didCreate = await createClosingQueueItem(
      {
        branchId: input.branchId,
        businessId: input.businessId,
        dedupeKey,
        message,
        messageType: UNCLOSED_REMINDER_MESSAGE_TYPE,
        recipient,
        sendType: "UNCLOSED_REMINDER",
        trigger: "AUTO_REMINDER",
      },
      client,
    );

    if (didCreate) {
      created += 1;
    } else {
      skipped += 1;
    }
  }

  return { created, skipped, recipients };
}

async function createClosingQueueItem(
  input: {
    branchId: string;
    businessId: string;
    dailyClosingSnapshotId?: string | null;
    dedupeKey: string;
    message: string;
    messageType: typeof CLOSING_REPORT_MESSAGE_TYPE | typeof UNCLOSED_REMINDER_MESSAGE_TYPE;
    recipient: ClosingWhatsAppRecipientInput;
    sendType: "CLOSING_REPORT" | "UNCLOSED_REMINDER";
    trigger: "AUTO_CLOSING" | "AUTO_REMINDER" | "MANUAL_RETRY" | "MANUAL_RESEND";
  },
  client: PrismaLike,
) {
  try {
    if (hasTransaction(client)) {
      return await client.$transaction((tx) => createClosingQueueItemInTx(input, tx));
    }

    return await createClosingQueueItemInTx(input, client);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return false;
    }

    throw error;
  }
}

async function createClosingQueueItemInTx(
  input: Parameters<typeof createClosingQueueItem>[0],
  client: Prisma.TransactionClient,
) {
  const existing = await client.notificationQueue.findUnique({
    where: { dedupeKey: input.dedupeKey },
    select: { id: true },
  });

  if (existing) {
    return false;
  }

  const messageLog = await client.whatsAppMessage.create({
    data: {
      branchId: input.branchId,
      businessId: input.businessId,
      dailyClosingSnapshotId: input.dailyClosingSnapshotId ?? null,
      messageBody: input.message,
      messageType: input.messageType,
      phone: input.recipient.normalizedPhone,
      queuedAt: new Date(),
      recipientPhone: input.recipient.normalizedPhone,
      status: "DRAFT",
    },
  });
  const queueItem = await client.notificationQueue.create({
    data: {
      branchId: input.branchId,
      businessId: input.businessId,
      dailyClosingSnapshotId: input.dailyClosingSnapshotId ?? null,
      dedupeKey: input.dedupeKey,
      message: input.message,
      messageLogId: messageLog.id,
      messageType: input.messageType,
      phone: input.recipient.normalizedPhone,
      priority: NotificationQueuePriority.NORMAL,
      queuedAt: new Date(),
      status: "QUEUED",
    },
  });

  await client.closingWhatsAppSendAttempt.create({
    data: {
      branchId: input.branchId,
      businessId: input.businessId,
      dailyClosingSnapshotId: input.dailyClosingSnapshotId ?? null,
      dedupeKey: input.dedupeKey,
      messageLogId: messageLog.id,
      normalizedPhone: input.recipient.normalizedPhone,
      phone: input.recipient.phone,
      queueId: queueItem.id,
      recipientId: input.recipient.id,
      sendType: input.sendType,
      status: "QUEUED" satisfies NotificationQueueStatus,
      trigger: input.trigger,
    },
  });

  return true;
}

export async function enqueueManualClosingWhatsAppSend(
  input: {
    attemptId: string;
    businessId: string;
    reason: string;
    requestedByUserId: string;
    trigger: "MANUAL_RETRY" | "MANUAL_RESEND";
  },
  client: PrismaLike = prisma,
) {
  const source = await client.closingWhatsAppSendAttempt.findFirst({
    where: { businessId: input.businessId, id: input.attemptId },
    include: {
      dailyClosingSnapshot: {
        select: { whatsappText: true },
      },
      messageLog: {
        select: { messageBody: true, messageType: true },
      },
      queue: {
        select: { message: true, messageType: true },
      },
      recipient: {
        select: {
          id: true,
          label: true,
          normalizedPhone: true,
          phone: true,
        },
      },
    },
  });

  if (!source) {
    throw new Error("Closing WhatsApp send record not found.");
  }

  const message =
    source.sendType === "CLOSING_REPORT" && source.dailyClosingSnapshot
      ? source.dailyClosingSnapshot.whatsappText
      : source.queue?.message ?? source.messageLog?.messageBody ?? "";

  if (!message) {
    throw new Error("Closing WhatsApp message content is missing.");
  }

  const messageType =
    source.sendType === "CLOSING_REPORT"
      ? CLOSING_REPORT_MESSAGE_TYPE
      : UNCLOSED_REMINDER_MESSAGE_TYPE;
  const recipient: ClosingWhatsAppRecipientInput = source.recipient
    ? {
        id: source.recipient.id,
        label: source.recipient.label,
        normalizedPhone: source.recipient.normalizedPhone,
        phone: source.recipient.phone,
      }
    : {
        id: null,
        label: source.phone,
        normalizedPhone: source.normalizedPhone,
        phone: source.phone,
      };
  const dedupeKey = `${source.dedupeKey}:${input.trigger.toLowerCase()}:${randomUUID()}`;

  if (!source.branchId) {
    throw new Error("Closing WhatsApp branch is missing.");
  }

  const created = await createClosingQueueItem(
    {
      branchId: source.branchId,
      businessId: source.businessId,
      dailyClosingSnapshotId: source.dailyClosingSnapshotId,
      dedupeKey,
      message,
      messageType,
      recipient,
      sendType: source.sendType,
      trigger: input.trigger,
    },
    client,
  );

  if (!created) {
    throw new Error("Closing WhatsApp send was already queued.");
  }

  await client.closingWhatsAppSendAttempt.update({
    where: { dedupeKey },
    data: {
      reason: input.reason,
      requestedByUserId: input.requestedByUserId,
    },
  });
}

function hasTransaction(client: PrismaLike): client is PrismaClient {
  return "$transaction" in client;
}

function normalizeBusinessDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function emptyResult(): ClosingWhatsAppQueueResult {
  return { created: 0, skipped: 0, recipients: [] };
}
