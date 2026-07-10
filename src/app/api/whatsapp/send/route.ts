import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBusinessUser } from "@/lib/auth/business-user";
import {
  getConnectorStatus,
  sendConnectorTextMessage,
} from "@/lib/whatsapp/connector-client";
import { enqueueInboxReply } from "@/lib/whatsapp/inbox-reply";

export const runtime = "nodejs";

const directSendSchema = z.object({
  phone: z.string().trim().min(1, "Phone is required."),
  message: z.string().trim().min(1, "Message is required."),
});

const queuedSendSchema = z.object({
  audioBase64: z.string().trim().min(1).nullable().optional(),
  audioFileName: z.string().trim().min(1).nullable().optional(),
  audioMimeType: z.string().trim().min(1).nullable().optional(),
  documentBase64: z.string().trim().min(1).nullable().optional(),
  documentFileName: z.string().trim().min(1).nullable().optional(),
  documentMimeType: z.string().trim().nullable().optional(),
  conversationId: z.string().uuid(),
  body: z.string().trim().optional(),
}).refine((input) => Boolean(input.body || input.audioBase64 || input.documentBase64), {
  message: "Message, voice recording, or file is required.",
});

export async function POST(request: Request) {
  const { user, businessId } = await requireBusinessUser();
  const payload = await request.json().catch(() => null);
  const directParsed = directSendSchema.safeParse(payload);

  if (directParsed.success) {
    try {
      const result = await sendConnectorTextMessage(directParsed.data);

      return NextResponse.json({
        ok: true,
        messageId: result.messageId,
        to: result.to,
      });
    } catch (error) {
      console.error("[whatsapp] Connector send failed", {
        route: "/api/whatsapp/send",
        businessId,
        userId: user.userId,
        phone: directParsed.data.phone,
        messageLength: directParsed.data.message.length,
        error: getErrorMessage(error),
      });

      return NextResponse.json(
        { message: getErrorMessage(error) || "Unable to send WhatsApp message." },
        { status: 502 },
      );
    }
  }

  const parsed = queuedSendSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ message: "Phone and message are required." }, { status: 400 });
  }

  const connectorStatus = await readConnectorStatus();

  if (connectorStatus !== "connected") {
    return NextResponse.json(
      { message: getConnectionRequiredMessage(connectorStatus) },
      { status: 409 },
    );
  }

  try {
    const result = await enqueueInboxReply({
      businessId,
      conversationId: parsed.data.conversationId,
      body: parsed.data.body || "Voice message",
      audioBase64: parsed.data.audioBase64 ?? null,
      audioFileName: parsed.data.audioFileName ?? null,
      audioMimeType: parsed.data.audioMimeType ?? null,
      documentBase64: parsed.data.documentBase64 ?? null,
      documentFileName: parsed.data.documentFileName ?? null,
      documentMimeType: parsed.data.documentMimeType ?? null,
      sentByUserId: user.userId,
    });

    return NextResponse.json({
      ok: true,
      messageLogId: result.log.id,
      queueId: result.queueItem.id,
      queued: true,
    });
  } catch (error) {
    return NextResponse.json(
      { message: getErrorMessage(error) || "Unable to send WhatsApp message." },
      { status: 502 },
    );
  }
}

async function readConnectorStatus() {
  try {
    return (await getConnectorStatus()).status;
  } catch {
    return "disconnected";
  }
}

function getConnectionRequiredMessage(
  status: Awaited<ReturnType<typeof readConnectorStatus>>,
) {
  if (status === "qr") {
    return "Scan QR before sending WhatsApp messages.";
  }

  return "WhatsApp is disconnected.";
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
