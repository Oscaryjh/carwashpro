import { NextResponse } from "next/server";
import { z } from "zod";
import { recordIncomingWhatsAppMessage } from "@/lib/whatsapp/incoming";
import { authorizeWhatsAppWebhook } from "@/lib/whatsapp/webhook-auth";
import {
  claimWhatsAppWebhookEvent,
  completeWhatsAppWebhookEvent,
  failWhatsAppWebhookEvent,
  parseWhatsAppWebhookEventHeaders,
  readWhatsAppWebhookJson,
  WhatsAppWebhookRequestError,
} from "@/lib/whatsapp/webhook-events";

export const runtime = "nodejs";

const incomingMessageSchema = z.object({
  businessId: z.string().uuid(),
  direction: z.enum(["INBOUND", "OUTBOUND"]).optional(),
  instanceId: z.string().trim().optional().nullable(),
  body: z.string().trim().min(1),
  from: z.string().trim().min(1),
  messageId: z.string().trim().min(1),
  messageType: z.enum(["audio", "document", "image", "text"]),
  mediaBase64: z.string().trim().optional().nullable(),
  mediaFileName: z.string().trim().optional().nullable(),
  mediaMimeType: z.string().trim().optional().nullable(),
  pushName: z.string().trim().optional().nullable(),
  remoteJid: z.string().trim().optional().nullable(),
  rawMessageJson: z.unknown().optional().nullable(),
  timestamp: z.string().datetime({ offset: true }).optional().nullable(),
});

const INCOMING_BODY_LIMIT_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request) {
  const authorization = authorizeWhatsAppWebhook(request.headers);
  if (!authorization.ok) {
    console.warn("[whatsapp-security] Incoming webhook authentication rejected", {
      status: authorization.status,
    });
    return NextResponse.json(
      { ok: false, error: authorization.error },
      { status: authorization.status },
    );
  }

  let claimedEventId: string | null = null;
  try {
    const eventHeaders = parseWhatsAppWebhookEventHeaders(request.headers);
    const body = await readWhatsAppWebhookJson(request, INCOMING_BODY_LIMIT_BYTES);
    const parsed = incomingMessageSchema.safeParse(body.payload);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid incoming WhatsApp payload." },
        { status: 400 },
      );
    }

    const claim = await claimWhatsAppWebhookEvent({
      businessId: parsed.data.businessId,
      eventKey: eventHeaders.eventKey,
      eventType: "INCOMING_MESSAGE",
      instanceId: parsed.data.instanceId,
      payloadFingerprint: body.payloadFingerprint,
      providerMessageId: parsed.data.messageId,
      providerOccurredAt: parsed.data.timestamp
        ? new Date(parsed.data.timestamp)
        : null,
    });
    claimedEventId = claim.event.id;
    if (!claim.shouldProcess) {
      return NextResponse.json({
        ok: true,
        data: {
          duplicate: true,
          effectApplied: claim.event.effectApplied,
        },
      });
    }

    const result = await recordIncomingWhatsAppMessage(parsed.data);
    await completeWhatsAppWebhookEvent(claim.event.id, "APPLIED", true);

    return NextResponse.json({
      ok: true,
      data: { ...result, duplicate: claim.duplicate },
    });
  } catch (error) {
    if (claimedEventId) {
      await failWhatsAppWebhookEvent(claimedEventId).catch(() => undefined);
    }
    if (error instanceof WhatsAppWebhookRequestError) {
      console.warn("[whatsapp-security] Incoming webhook rejected", {
        reason: error.message,
        status: error.status,
      });
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status },
      );
    }
    console.error("[whatsapp] Incoming message failed", {
      errorCategory: error instanceof Error ? error.name : "UnknownError",
    });

    return NextResponse.json(
      {
        ok: false,
        error: "Unable to record incoming WhatsApp message.",
      },
      { status: 500 },
    );
  }
}
