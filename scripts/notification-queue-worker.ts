import { prisma } from "../src/lib/prisma";
import {
  findQueued,
  markFailed,
  markSending,
  markSent,
} from "../src/lib/notification-queue/repository";

const pollIntervalMs = 1000;
const batchSize = 10;
let shuttingDown = false;

type ConnectorSendResponse =
  | {
      ok: true;
      data: {
        messageId: string | null;
        to: string;
      };
    }
  | {
      ok: false;
      error:
        | string
        | {
            code?: string;
            message?: string;
          };
    };

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch(async (error) => {
  console.error("[notification-queue-worker] Fatal error", getErrorMessage(error));
  await prisma.$disconnect();
  process.exit(1);
});

async function main() {
  console.log("[notification-queue-worker] Started");

  while (!shuttingDown) {
    const processed = await processQueuedBatch();

    if (!processed) {
      await sleep(pollIntervalMs);
    }
  }

  await prisma.$disconnect();
  console.log("[notification-queue-worker] Stopped");
}

async function processQueuedBatch() {
  const queueItems = await findQueued({ limit: batchSize });

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
      const result = await sendToConnector({
        phone: sendingItem.phone,
        message: sendingItem.message,
      });

      if (!result.messageId) {
        throw new Error("WhatsApp connector did not return a messageId.");
      }

      await markSent({
        id: sendingItem.id,
        providerMessageId: result.messageId,
      });
      console.log("[notification-queue-worker] Sent", {
        id: sendingItem.id,
        providerMessageId: result.messageId,
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

async function sendToConnector(input: { phone: string; message: string }) {
  const response = await fetch(`${getConnectorUrl()}/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const body = (await readJson(response)) as ConnectorSendResponse;

  if (!response.ok || !body?.ok) {
    throw new ConnectorSendError(
      response.status,
      getConnectorErrorMessage(body) || "WhatsApp connector send failed.",
    );
  }

  return body.data;
}

function getConnectorUrl() {
  const connectorUrl = process.env.WHATSAPP_CONNECTOR_URL?.trim();

  if (!connectorUrl) {
    throw new Error("WHATSAPP_CONNECTOR_URL is not configured.");
  }

  return connectorUrl.replace(/\/+$/, "");
}

async function readJson(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text };
  }
}

function getConnectorErrorMessage(body: unknown) {
  if (!body || typeof body !== "object" || !("error" in body)) {
    return "";
  }

  if (typeof body.error === "string") {
    return body.error;
  }

  if (
    body.error &&
    typeof body.error === "object" &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return body.error.message;
  }

  return "";
}

function isConnectorNotConnected(error: unknown) {
  return error instanceof ConnectorSendError && error.status === 409;
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

class ConnectorSendError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
