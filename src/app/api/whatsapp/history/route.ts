import { NextResponse } from "next/server";
import { z } from "zod";
import { syncWhatsAppHistory } from "@/lib/whatsapp/history-sync";
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

const historyPayloadSchema = z.object({
  businessId: z.string().uuid(),
  instanceId: z.string().trim().min(1),
  syncType: z.string().trim().optional().nullable(),
  contacts: z.array(z.unknown()).optional(),
  chats: z.array(z.unknown()).optional(),
  messages: z.array(z.unknown()).optional(),
});

const HISTORY_BODY_LIMIT_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request) {
  const authorization = authorizeWhatsAppWebhook(request.headers);
  if (!authorization.ok) {
    console.warn("[whatsapp-security] History webhook authentication rejected", {
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
    const body = await readWhatsAppWebhookJson(request, HISTORY_BODY_LIMIT_BYTES);
    const parsed = historyPayloadSchema.safeParse(body.payload);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid WhatsApp history payload." },
        { status: 400 },
      );
    }

    const claim = await claimWhatsAppWebhookEvent({
      businessId: parsed.data.businessId,
      eventKey: eventHeaders.eventKey,
      eventType: "HISTORY_SYNC",
      instanceId: parsed.data.instanceId,
      payloadFingerprint: body.payloadFingerprint,
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

    const result = await syncWhatsAppHistory({
      businessId: parsed.data.businessId,
      instanceId: parsed.data.instanceId,
      syncType: parsed.data.syncType,
      contacts: parsed.data.contacts?.map(wrapRawJson),
      chats: parsed.data.chats?.map(wrapRawJson),
      messages: parsed.data.messages?.map(wrapRawJson),
    });
    await completeWhatsAppWebhookEvent(claim.event.id, "APPLIED", true);

    console.info("[whatsapp] History sync completed", result);

    return NextResponse.json({
      ok: true,
      data: { ...result, duplicate: claim.duplicate },
    });
  } catch (error) {
    if (claimedEventId) {
      await failWhatsAppWebhookEvent(claimedEventId).catch(() => undefined);
    }
    if (error instanceof WhatsAppWebhookRequestError) {
      console.warn("[whatsapp-security] History webhook rejected", {
        reason: error.message,
        status: error.status,
      });
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status },
      );
    }
    console.error("[whatsapp] History sync failed", {
      errorCategory: error instanceof Error ? error.name : "UnknownError",
    });

    return NextResponse.json(
      { ok: false, error: "Unable to sync WhatsApp history." },
      { status: 500 },
    );
  }
}

function wrapRawJson(value: unknown) {
  return value && typeof value === "object"
    ? { ...(value as Record<string, unknown>), rawJson: value }
    : { rawJson: value };
}
