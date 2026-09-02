import { prisma } from "../src/lib/prisma";
import {
  findQueued,
  getQueueDocumentAttachment,
  markFailed,
  markSending,
  markSentToServer,
  recoverExpiredSending,
} from "../src/lib/notification-queue/repository";
import { queueDueUnclosedClosingReminders } from "../src/lib/closing-whatsapp/scheduler";
import {
  getWhatsAppSendModeRuntimeConfig,
  classifyWhatsAppSendFailure,
  sendWhatsAppQueueItem,
} from "../src/lib/notification-queue/worker-send";
import { emitScheduledJobFailure } from "../src/lib/ops/alerting";

const pollIntervalMs = 1000;
const batchSize = 10;
const queuedAfter = parseQueuedAfter(process.argv);
let shuttingDown = false;
let lastClosingReminderSweepAt = 0;

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch(async (error) => {
  console.error("[notification-queue-worker] Fatal error", getErrorMessage(error));
  await emitScheduledJobFailure({
    job: "notification-queue-worker",
    code: "NOTIFICATION_WORKER_FATAL",
    message: getErrorMessage(error),
    severity: "CRITICAL",
  }).catch(() => undefined);
  await prisma.$disconnect();
  process.exit(1);
});

async function main() {
  const sendModeConfig = getWhatsAppSendModeRuntimeConfig();

  console.log("[notification-queue-worker] Started", {
    connectorCallsEnabled: sendModeConfig.connectorCallsEnabled,
    queuedAfter: queuedAfter?.toISOString() ?? null,
    sendMode: sendModeConfig.mode,
  });

  while (!shuttingDown) {
    const processed = await processQueuedBatch();

    if (!processed) {
      await sleep(pollIntervalMs);
    }
  }

  await prisma.$disconnect();
  console.log("[notification-queue-worker] Stopped");
}

function parseQueuedAfter(args: string[]) {
  const value = args
    .find((argument) => argument.startsWith("--queued-after="))
    ?.slice("--queued-after=".length);

  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid --queued-after value: ${value}`);
  }

  return parsed;
}

async function processQueuedBatch() {
  await queueClosingReminderSweep();
  const recovery = await recoverExpiredSending();
  if (recovery.recovered || recovery.exhausted) {
    console.warn("[notification-queue-worker] Recovered expired send leases", recovery);
  }
  const queueItems = await findQueued({
    limit: batchSize,
    queuedAfter,
  });

  if (!queueItems.length) {
    return false;
  }

  for (const queueItem of queueItems) {
    if (shuttingDown) {
      break;
    }

    const sendingItem = await markSending(queueItem.id);

    if (!sendingItem) {
      continue;
    }
    if (!sendingItem.claimToken) {
      throw new Error("Claimed WhatsApp queue item is missing its lease token.");
    }

    try {
      const attachment = await getQueueDocumentAttachment(sendingItem.id);
      const result = await sendWhatsAppQueueItem({
        businessId: sendingItem.businessId,
        queueId: sendingItem.id,
        phone: sendingItem.phone,
        message: sendingItem.message,
        documentBase64: attachment.documentBase64,
        documentMimeType: attachment.documentMimeType,
        documentFileName: attachment.documentFileName,
      });

      await markSentToServer({
        claimToken: sendingItem.claimToken,
        id: sendingItem.id,
        providerMessageId: result.messageId,
      });
      console.log("[notification-queue-worker] Sent to server", {
        connectorCallsEnabled: result.connectorCallsEnabled,
        id: sendingItem.id,
        providerMessageId: result.messageId,
        sendMode: result.mode,
        simulated: result.simulated,
      });
    } catch (error) {
      const classification = classifyWhatsAppSendFailure(error);
      const failedQueueItem = await markFailed({
        claimToken: sendingItem.claimToken,
        errorCategory: classification.category,
        id: sendingItem.id,
        errorMessage: classification.safeMessage,
        retryable: classification.retryable,
      });
      console.error("[notification-queue-worker] Send failed", {
        errorCategory: classification.category,
        id: sendingItem.id,
        status: failedQueueItem.status,
        retryCount: failedQueueItem.retryCount,
        nextAttemptAt: failedQueueItem.nextAttemptAt,
        retryable: classification.retryable,
      });
      if (failedQueueItem.status === "FAILED") {
        await emitScheduledJobFailure({
          job: "notification-queue-delivery",
          attempt: failedQueueItem.retryCount,
          code: "NOTIFICATION_DELIVERY_EXHAUSTED",
          message: classification.safeMessage,
        }).catch(() => undefined);
      }
    }
  }

  return true;
}

async function queueClosingReminderSweep() {
  const now = Date.now();

  if (now - lastClosingReminderSweepAt < 60_000) {
    return;
  }

  lastClosingReminderSweepAt = now;

  try {
    const result = await queueDueUnclosedClosingReminders({ now: new Date(now) });

    if (result.queued) {
      console.log("[notification-queue-worker] Queued closing reminders", {
        branches: result.branchesChecked,
        created: result.queued,
      });
    }
  } catch (error) {
    console.error(
      "[notification-queue-worker] Closing reminder sweep failed",
      getErrorMessage(error),
    );
    await emitScheduledJobFailure({
      job: "closing-reminder-sweep",
      code: "CLOSING_REMINDER_SWEEP_FAILED",
      message: getErrorMessage(error),
    }).catch(() => undefined);
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function shutdown() {
  shuttingDown = true;
}
