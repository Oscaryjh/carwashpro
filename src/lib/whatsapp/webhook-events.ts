import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const WHATSAPP_EVENT_ID_HEADER = "x-whatsapp-event-id";
export const WHATSAPP_EVENT_TIMESTAMP_HEADER = "x-whatsapp-event-timestamp";
export const WHATSAPP_WEBHOOK_REPLAY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const WHATSAPP_WEBHOOK_FRESHNESS_MS = 5 * 60 * 1000;
const WEBHOOK_PROCESSING_STALE_MS = 2 * 60 * 1000;
const MAX_EVENT_ID_LENGTH = 256;

export class WhatsAppWebhookRequestError extends Error {
  constructor(
    readonly status: 400 | 409 | 413,
    message: string,
  ) {
    super(message);
    this.name = "WhatsAppWebhookRequestError";
  }
}

export async function readWhatsAppWebhookJson(
  request: Request,
  maxBytes: number,
) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new WhatsAppWebhookRequestError(413, "WhatsApp webhook payload is too large.");
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > maxBytes) {
    throw new WhatsAppWebhookRequestError(413, "WhatsApp webhook payload is too large.");
  }

  try {
    return {
      payload: JSON.parse(rawBody || "null") as unknown,
      payloadFingerprint: createHash("sha256").update(rawBody).digest("hex"),
    };
  } catch {
    throw new WhatsAppWebhookRequestError(400, "WhatsApp webhook payload must be valid JSON.");
  }
}

export function parseWhatsAppWebhookEventHeaders(
  headers: Pick<Headers, "get">,
  now = new Date(),
) {
  const eventKey = headers.get(WHATSAPP_EVENT_ID_HEADER)?.trim() ?? "";
  const timestampValue =
    headers.get(WHATSAPP_EVENT_TIMESTAMP_HEADER)?.trim() ?? "";

  if (!eventKey || eventKey.length > MAX_EVENT_ID_LENGTH) {
    throw new WhatsAppWebhookRequestError(400, "WhatsApp webhook event ID is required.");
  }

  const requestTimestamp = new Date(timestampValue);
  if (!timestampValue || Number.isNaN(requestTimestamp.getTime())) {
    throw new WhatsAppWebhookRequestError(
      400,
      "WhatsApp webhook request timestamp is required.",
    );
  }

  if (Math.abs(now.getTime() - requestTimestamp.getTime()) > WHATSAPP_WEBHOOK_FRESHNESS_MS) {
    throw new WhatsAppWebhookRequestError(
      409,
      "WhatsApp webhook request is outside the freshness window.",
    );
  }

  return { eventKey, requestTimestamp };
}

export async function claimWhatsAppWebhookEvent(input: {
  businessId: string;
  eventKey: string;
  eventType: string;
  instanceId?: string | null;
  payloadFingerprint: string;
  provider?: string;
  providerMessageId?: string | null;
  providerOccurredAt?: Date | null;
  receivedAt?: Date;
}) {
  const now = input.receivedAt ?? new Date();
  const provider = input.provider ?? "TETAMU_CONNECTOR";

  try {
    const event = await prisma.whatsAppWebhookEvent.create({
      data: {
        businessId: input.businessId,
        eventKey: input.eventKey,
        eventType: input.eventType,
        expiresAt: new Date(now.getTime() + WHATSAPP_WEBHOOK_REPLAY_RETENTION_MS),
        instanceId: input.instanceId?.trim() || "default",
        lastReceivedAt: now,
        outcome: "PROCESSING",
        payloadFingerprint: input.payloadFingerprint,
        provider,
        providerMessageId: input.providerMessageId ?? null,
        providerOccurredAt: input.providerOccurredAt ?? null,
        receivedAt: now,
      },
    });

    return { duplicate: false, event, shouldProcess: true } as const;
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
  }

  const existing = await prisma.whatsAppWebhookEvent.findUniqueOrThrow({
    where: {
      businessId_provider_eventKey: {
        businessId: input.businessId,
        eventKey: input.eventKey,
        provider,
      },
    },
  });

  if (existing.payloadFingerprint !== input.payloadFingerprint) {
    throw new WhatsAppWebhookRequestError(
      409,
      "WhatsApp webhook event ID was reused with a different payload.",
    );
  }

  const staleProcessing =
    existing.outcome === "PROCESSING" &&
    existing.lastReceivedAt.getTime() <= now.getTime() - WEBHOOK_PROCESSING_STALE_MS;
  const retryable = existing.outcome === "FAILED_RETRYABLE" || staleProcessing;

  if (retryable) {
    const reclaimed = await prisma.whatsAppWebhookEvent.updateMany({
      where: {
        id: existing.id,
        OR: [
          { outcome: "FAILED_RETRYABLE" },
          {
            outcome: "PROCESSING",
            lastReceivedAt: {
              lte: new Date(now.getTime() - WEBHOOK_PROCESSING_STALE_MS),
            },
          },
        ],
      },
      data: {
        duplicateCount: { increment: 1 },
        lastReceivedAt: now,
        outcome: "PROCESSING",
      },
    });

    if (reclaimed.count) {
      return {
        duplicate: true,
        event: { ...existing, lastReceivedAt: now, outcome: "PROCESSING" },
        shouldProcess: true,
      } as const;
    }
  }

  const event = await prisma.whatsAppWebhookEvent.update({
    where: { id: existing.id },
    data: {
      duplicateCount: { increment: 1 },
      lastReceivedAt: now,
    },
  });

  return { duplicate: true, event, shouldProcess: false } as const;
}

export function completeWhatsAppWebhookEvent(
  eventId: string,
  outcome: string,
  effectApplied: boolean,
) {
  return prisma.whatsAppWebhookEvent.update({
    where: { id: eventId },
    data: { effectApplied, outcome },
  });
}

export function failWhatsAppWebhookEvent(eventId: string) {
  return prisma.whatsAppWebhookEvent.updateMany({
    where: { id: eventId, outcome: "PROCESSING" },
    data: { outcome: "FAILED_RETRYABLE" },
  });
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}
