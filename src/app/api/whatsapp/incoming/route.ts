import { NextResponse } from "next/server";
import { z } from "zod";
import { recordIncomingWhatsAppMessage } from "@/lib/whatsapp/incoming";

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
  timestamp: z.string().trim().optional().nullable(),
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
  const parsed = incomingMessageSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid incoming WhatsApp payload." },
      { status: 400 },
    );
  }

  try {
    const result = await recordIncomingWhatsAppMessage(parsed.data);

    return NextResponse.json({
      ok: true,
      data: result,
    });
  } catch (error) {
    console.error("[whatsapp] Incoming message failed", {
      error: getErrorMessage(error),
      messageId: parsed.data.messageId,
      from: parsed.data.from,
    });

    return NextResponse.json(
      {
        ok: false,
        error: getErrorMessage(error) || "Unable to record incoming WhatsApp message.",
      },
      { status: 500 },
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
    return "";
  }
}
