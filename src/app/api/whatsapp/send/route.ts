import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { sendConnectorTextMessage } from "@/lib/whatsapp/connector-client";
import { enqueueWhatsAppTextMessage } from "@/lib/whatsapp/worker-commands";

export const runtime = "nodejs";

const directSendSchema = z.object({
  phone: z.string().trim().min(1, "Phone is required."),
  message: z.string().trim().min(1, "Message is required."),
});

const queuedSendSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1, "Message is required."),
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

  const connection = await prisma.whatsAppConnection.findUnique({
    where: { businessId },
    select: { status: true },
  });

  if (connection?.status !== "CONNECTED") {
    return NextResponse.json(
      { message: "Connect WhatsApp before sending." },
      { status: 409 },
    );
  }

  const conversation = await prisma.whatsAppConversation.findFirst({
    where: {
      id: parsed.data.conversationId,
      businessId,
    },
    select: { id: true },
  });

  if (!conversation) {
    return NextResponse.json(
      { message: "Conversation not found." },
      { status: 404 },
    );
  }

  try {
    await enqueueWhatsAppTextMessage({
      businessId,
      conversationId: conversation.id,
      body: parsed.data.body,
      sentByUserId: user.userId,
    });

    return NextResponse.json({ ok: true, queued: true });
  } catch (error) {
    return NextResponse.json(
      { message: getErrorMessage(error) || "Unable to send WhatsApp message." },
      { status: 502 },
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
