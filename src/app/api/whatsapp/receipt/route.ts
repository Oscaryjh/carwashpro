import { NextResponse } from "next/server";
import { z } from "zod";
import { markDeliveryStatus } from "@/lib/notification-queue/repository";

export const runtime = "nodejs";

const receiptSchema = z.object({
  instanceId: z.string().trim().optional().nullable(),
  messageId: z.string().trim().min(1),
  remoteJid: z.string().trim().optional().nullable(),
  status: z.enum(["DELIVERED", "READ", "FAILED"]),
  errorMessage: z.string().trim().optional().nullable(),
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
  const parsed = receiptSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid WhatsApp receipt payload." },
      { status: 400 },
    );
  }

  const result = await markDeliveryStatus({
    instanceId: parsed.data.instanceId,
    providerMessageId: parsed.data.messageId,
    status: parsed.data.status,
    errorMessage: parsed.data.errorMessage,
    timestamp: parseReceiptTimestamp(parsed.data.timestamp),
  });

  return NextResponse.json({
    ok: true,
    data: result,
  });
}

function parseReceiptTimestamp(timestamp: string | null | undefined) {
  if (!timestamp) {
    return undefined;
  }

  const date = new Date(timestamp);

  return Number.isNaN(date.getTime()) ? undefined : date;
}
