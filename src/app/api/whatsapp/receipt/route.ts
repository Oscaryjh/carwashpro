import { NextResponse } from "next/server";
import { z } from "zod";
import { markDeliveryStatus } from "@/lib/notification-queue/repository";
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

const receiptSchema = z.object({
  businessId: z.string().uuid(),
  instanceId: z.string().trim().optional().nullable(),
  messageId: z.string().trim().min(1),
  remoteJid: z.string().trim().optional().nullable(),
  status: z.enum(["DELIVERED", "READ", "FAILED"]),
  errorMessage: z.string().trim().optional().nullable(),
  timestamp: z.string().datetime({ offset: true }).optional().nullable(),
});

const RECEIPT_BODY_LIMIT_BYTES = 256 * 1024;

export async function POST(request: Request) {
  const authorization = authorizeWhatsAppWebhook(request.headers);
  if (!authorization.ok) {
    console.warn("[whatsapp-security] Receipt webhook authentication rejected", {
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
    const body = await readWhatsAppWebhookJson(request, RECEIPT_BODY_LIMIT_BYTES);
    const parsed = receiptSchema.safeParse(body.payload);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid WhatsApp receipt payload." },
        { status: 400 },
      );
    }

    const providerOccurredAt = parsed.data.timestamp
      ? new Date(parsed.data.timestamp)
      : null;
    const claim = await claimWhatsAppWebhookEvent({
      businessId: parsed.data.businessId,
      eventKey: eventHeaders.eventKey,
      eventType: `RECEIPT_${parsed.data.status}`,
      instanceId: parsed.data.instanceId,
      payloadFingerprint: body.payloadFingerprint,
      providerMessageId: parsed.data.messageId,
      providerOccurredAt,
    });
    claimedEventId = claim.event.id;
    if (!claim.shouldProcess) {
      return NextResponse.json({
        ok: true,
        data: {
          duplicate: true,
          effectApplied: claim.event.effectApplied,
          updated: 0,
        },
      });
    }

    const result = await markDeliveryStatus({
      businessId: parsed.data.businessId,
      instanceId: parsed.data.instanceId,
      providerMessageId: parsed.data.messageId,
      status: parsed.data.status,
      errorMessage: parsed.data.errorMessage,
      timestamp: providerOccurredAt ?? undefined,
    });
    const outcome = result.updated
      ? "APPLIED"
      : !result.matched
        ? "NO_MATCH"
        : result.ignoredDowngrades
          ? "IGNORED_DOWNGRADE"
          : "DUPLICATE_STATUS";
    await completeWhatsAppWebhookEvent(claim.event.id, outcome, result.updated > 0);

    return NextResponse.json({
      ok: true,
      data: { ...result, duplicate: claim.duplicate },
    });
  } catch (error) {
    if (claimedEventId) {
      await failWhatsAppWebhookEvent(claimedEventId).catch(() => undefined);
    }
    if (error instanceof WhatsAppWebhookRequestError) {
      console.warn("[whatsapp-security] Receipt webhook rejected", {
        reason: error.message,
        status: error.status,
      });
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status },
      );
    }
    console.error("[whatsapp] Receipt webhook processing failed", {
      errorCategory: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { ok: false, error: "Unable to process WhatsApp receipt." },
      { status: 500 },
    );
  }
}
