import {
  WhatsAppWorkerCommandStatus,
  WhatsAppWorkerCommandType,
  type WhatsAppWorkerCommand,
} from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import {
  disconnectWhatsAppSession,
  sendWhatsAppDocumentMessage,
  sendWhatsAppTextMessage,
  startWhatsAppSession,
} from "../src/lib/whatsapp/connector";

const pollIntervalMs = 1000;
const maxAttempts = 3;
let shuttingDown = false;

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((error) => {
  console.error("[whatsapp-worker] Fatal error", error);
  process.exit(1);
});

async function main() {
  console.log("[whatsapp-worker] Started");
  await restoreActiveSessions();

  while (!shuttingDown) {
    const processed = await processNextCommand();
    if (!processed) {
      await sleep(pollIntervalMs);
    }
  }
}

async function restoreActiveSessions() {
  const staleLoginCutoff = new Date(Date.now() - 2 * 60 * 1000);
  const staleQrConnections = await prisma.whatsAppConnection.updateMany({
    where: {
      status: "QR_REQUIRED",
      OR: [
        { lastSeenAt: null },
        { lastSeenAt: { lt: staleLoginCutoff } },
      ],
    },
    data: {
      status: "DISCONNECTED",
      qrCodeText: null,
      pairingPhone: null,
      pairingCodeText: null,
      pairingRequestedAt: null,
      errorMessage: "WhatsApp login code expired. Generate a new code.",
      lastSeenAt: new Date(),
    },
  });

  if (staleQrConnections.count) {
    console.log(
      `[whatsapp-worker] Cleared ${staleQrConnections.count} stale QR session(s)`,
    );
  }

  const connections = await prisma.whatsAppConnection.findMany({
    where: {
      status: "CONNECTED",
    },
    select: {
      businessId: true,
      status: true,
    },
  });

  for (const connection of connections) {
    try {
      console.log(
        `[whatsapp-worker] Restoring ${connection.status.toLowerCase()} session ${connection.businessId}`,
      );
      await startWhatsAppSession(connection.businessId);
    } catch (error) {
      console.error(
        `[whatsapp-worker] Unable to restore session ${connection.businessId}`,
        getErrorMessage(error),
      );
    }
  }
}

async function processNextCommand() {
  const command = await prisma.whatsAppWorkerCommand.findFirst({
    where: { status: WhatsAppWorkerCommandStatus.PENDING },
    orderBy: { createdAt: "asc" },
  });

  if (!command) {
    return false;
  }

  const claimed = await prisma.whatsAppWorkerCommand.updateMany({
    where: {
      id: command.id,
      status: WhatsAppWorkerCommandStatus.PENDING,
    },
    data: {
      status: WhatsAppWorkerCommandStatus.RUNNING,
      attempts: { increment: 1 },
      errorMessage: null,
    },
  });

  if (!claimed.count) {
    return true;
  }

  try {
    await runCommand(command);
    await prisma.whatsAppWorkerCommand.update({
      where: { id: command.id },
      data: {
        status: WhatsAppWorkerCommandStatus.DONE,
        processedAt: new Date(),
        errorMessage: null,
      },
    });
  } catch (error) {
    const attemptNumber = command.attempts + 1;
    const retry = attemptNumber < maxAttempts;
    const message = getErrorMessage(error) || "WhatsApp worker command failed.";

    await prisma.whatsAppWorkerCommand.update({
      where: { id: command.id },
      data: {
        status: retry
          ? WhatsAppWorkerCommandStatus.PENDING
          : WhatsAppWorkerCommandStatus.FAILED,
        errorMessage: message,
        processedAt: retry ? null : new Date(),
      },
    });

    console.error(
      `[whatsapp-worker] Command ${command.id} failed${
        retry ? ", retrying" : ""
      }: ${message}`,
    );
  }

  return true;
}

async function runCommand(command: WhatsAppWorkerCommand) {
  const payload = getPayload(command);

  switch (command.type) {
    case WhatsAppWorkerCommandType.START_SESSION: {
      const pairingPhone = optionalString(payload.pairingPhone);

      if (payload.reset === true) {
        await disconnectWhatsAppSession(command.businessId);
        await sleep(500);
      }
      let result = await startWhatsAppSession(command.businessId, {
        pairingPhone,
      });

      if (
        result.status === "ERROR" &&
        isWhatsAppConflictMessage(result.errorMessage)
      ) {
        console.log("[whatsapp-worker] START_SESSION conflict, retrying fresh", {
          businessId: command.businessId,
        });
        await disconnectWhatsAppSession(command.businessId);
        await sleep(1_500);
        result = await startWhatsAppSession(command.businessId, {
          pairingPhone,
        });
      }

      console.log("[whatsapp-worker] START_SESSION result", {
        businessId: command.businessId,
        status: result.status,
        hasQr: Boolean(result.qrCodeText),
        hasPairingCode: Boolean(result.pairingCodeText),
        phoneNumber: result.phoneNumber ?? null,
      });

      if (result.status === "CONNECTED" || result.qrCodeText || result.pairingCodeText) {
        return;
      }

      const message =
        result.errorMessage ??
        (pairingPhone
          ? "WhatsApp did not return a pairing code. Check the computer internet connection and try again."
          : "WhatsApp did not return a QR code. Check the computer internet connection and click Generate QR again.");

      await prisma.whatsAppConnection.updateMany({
        where: { businessId: command.businessId },
        data: {
          status: result.status === "QR_REQUIRED" ? "QR_REQUIRED" : "ERROR",
          qrCodeText: null,
          pairingCodeText: null,
          errorMessage: message,
          lastSeenAt: new Date(),
        },
      });

      throw new Error(message);
    }

    case WhatsAppWorkerCommandType.DISCONNECT: {
      await disconnectWhatsAppSession(command.businessId);
      await prisma.whatsAppConnection.upsert({
        where: { businessId: command.businessId },
        create: {
          businessId: command.businessId,
          phoneNumber: null,
          qrCodeText: null,
          pairingPhone: null,
          pairingCodeText: null,
          pairingRequestedAt: null,
          sessionName: null,
          status: "DISCONNECTED",
          disconnectedAt: new Date(),
          lastSeenAt: new Date(),
        },
        update: {
          phoneNumber: null,
          qrCodeText: null,
          pairingPhone: null,
          pairingCodeText: null,
          pairingRequestedAt: null,
          sessionName: null,
          status: "DISCONNECTED",
          disconnectedAt: new Date(),
          lastSeenAt: new Date(),
          errorMessage: null,
        },
      });
      return;
    }

    case WhatsAppWorkerCommandType.SEND_TEXT: {
      const messageLogId = optionalString(payload.messageLogId);
      try {
        const result = await sendWhatsAppTextMessage({
          businessId: command.businessId,
          conversationId: requiredString(payload, "conversationId"),
          body: requiredString(payload, "body"),
          sentByUserId: requiredString(payload, "sentByUserId"),
        });
        await markMessageLogSent(command.businessId, messageLogId, result.externalMessageId);
      } catch (error) {
        await markMessageLogFailed(command.businessId, messageLogId, getErrorMessage(error));
        throw error;
      }
      return;
    }

    case WhatsAppWorkerCommandType.SEND_DOCUMENT: {
      const messageLogId = optionalString(payload.messageLogId);
      try {
        const result = await sendWhatsAppDocumentMessage({
          businessId: command.businessId,
          conversationId: requiredString(payload, "conversationId"),
          body: requiredString(payload, "body"),
          sentByUserId: requiredString(payload, "sentByUserId"),
          document: Buffer.from(requiredString(payload, "documentBase64"), "base64"),
          fileName: requiredString(payload, "fileName"),
          mimeType: requiredString(payload, "mimeType"),
        });
        await markMessageLogSent(command.businessId, messageLogId, result.externalMessageId);
      } catch (error) {
        await markMessageLogFailed(command.businessId, messageLogId, getErrorMessage(error));
        throw error;
      }
      return;
    }
  }
}

function getPayload(command: WhatsAppWorkerCommand) {
  if (!command.payload || typeof command.payload !== "object" || Array.isArray(command.payload)) {
    return {} as Record<string, unknown>;
  }

  return command.payload as Record<string, unknown>;
}

function requiredString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing WhatsApp worker payload field: ${key}`);
  }

  return value;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

async function markMessageLogSent(
  businessId: string,
  messageLogId: string | null,
  providerMessageId: string | null | undefined,
) {
  if (!messageLogId) {
    return;
  }

  await prisma.whatsAppMessage.updateMany({
    where: {
      id: messageLogId,
      businessId,
    },
    data: {
      status: "SENT_MANUALLY",
      provider: "WHATSAPP_WEB_AUTO",
      providerMessageId: providerMessageId ?? null,
      sentAt: new Date(),
      errorMessage: null,
    },
  });
}

async function markMessageLogFailed(
  businessId: string,
  messageLogId: string | null,
  errorMessage: string,
) {
  if (!messageLogId) {
    return;
  }

  await prisma.whatsAppMessage.updateMany({
    where: {
      id: messageLogId,
      businessId,
    },
    data: {
      errorMessage,
      failedAt: new Date(),
    },
  });
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

function isWhatsAppConflictMessage(message: string | null | undefined) {
  if (!message) {
    return false;
  }

  const lowered = message.toLowerCase();

  return (
    lowered.includes("conflict") ||
    lowered.includes("replaced") ||
    lowered.includes("stream errored")
  );
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function shutdown() {
  shuttingDown = true;
  await prisma.$disconnect().catch(() => undefined);
}
