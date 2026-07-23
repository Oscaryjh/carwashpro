import { prisma } from "../src/lib/prisma";
import {
  findQueued,
  getQueueDocumentAttachment,
  markFailed,
  markSending,
  markSentToServer,
} from "../src/lib/notification-queue/repository";
import { queueDueUnclosedClosingReminders } from "../src/lib/closing-whatsapp/scheduler";
import {
  getWhatsAppSendModeRuntimeConfig,
  isConnectorNotConnected,
  sendWhatsAppQueueItem,
} from "../src/lib/notification-queue/worker-send";

const pollIntervalMs = 1000;
const batchSize = 10;
const queuedAfter = parseQueuedAfter(process.argv);
let shuttingDown = false;
let lastClosingReminderSweepAt = 0;

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch(async (error) => {
  console.error("[notification-queue-worker] Fatal error", getErrorMessage(error));
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
      const message = getErrorMessage(error);
      const failedQueueItem = await markFailed({
        id: sendingItem.id,
        errorMessage: isConnectorNotConnected(error)
          ? "WHATSAPP_NOT_CONNECTED"
          : message,
      });
      console.error("[notification-queue-worker] Send failed", {
        id: sendingItem.id,
        status: failedQueueItem.status,
        retryCount: failedQueueItem.retryCount,
        nextAttemptAt: failedQueueItem.nextAttemptAt,
        errorMessage: message,
      });
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
