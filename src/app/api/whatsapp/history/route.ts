import { NextResponse } from "next/server";
import { z } from "zod";
import { syncWhatsAppHistory } from "@/lib/whatsapp/history-sync";

export const runtime = "nodejs";

const historyPayloadSchema = z.object({
  businessId: z.string().uuid(),
  instanceId: z.string().trim().min(1),
  syncType: z.string().trim().optional().nullable(),
  contacts: z.array(z.unknown()).optional(),
  chats: z.array(z.unknown()).optional(),
  messages: z.array(z.unknown()).optional(),
});

export async function POST(request: Request) {
  const expectedSecret = process.env.WHATSAPP_WEBHOOK_SECRET?.trim();

  if (
    expectedSecret &&
    request.headers.get("x-whatsapp-webhook-secret") !== expectedSecret
  ) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = historyPayloadSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid WhatsApp history payload." },
      { status: 400 },
    );
  }

  try {
    const result = await syncWhatsAppHistory({
      businessId: parsed.data.businessId,
      instanceId: parsed.data.instanceId,
      syncType: parsed.data.syncType,
      contacts: parsed.data.contacts?.map(wrapRawJson),
      chats: parsed.data.chats?.map(wrapRawJson),
      messages: parsed.data.messages?.map(wrapRawJson),
    });

    console.info("[whatsapp] History sync completed", result);

    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    console.error("[whatsapp] History sync failed", {
      error: getErrorMessage(error),
      syncType: parsed.data.syncType,
    });

    return NextResponse.json(
      { ok: false, error: getErrorMessage(error) || "Unable to sync WhatsApp history." },
      { status: 500 },
    );
  }
}

function wrapRawJson(value: unknown) {
  return value && typeof value === "object"
    ? { ...(value as Record<string, unknown>), rawJson: value }
    : { rawJson: value };
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
    return "";
  }
}
