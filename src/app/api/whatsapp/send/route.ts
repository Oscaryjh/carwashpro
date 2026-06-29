import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppTextMessage } from "@/lib/whatsapp/connector";

const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1, "Message is required."),
});

export async function POST(request: Request) {
  const { user, businessId } = await requireBusinessUser();
  const parsed = sendMessageSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.errors[0]?.message ?? "Invalid message." },
      { status: 400 },
    );
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
    const result = await sendWhatsAppTextMessage({
      businessId,
      conversationId: conversation.id,
      body: parsed.data.body,
      sentByUserId: user.userId,
    });

    return NextResponse.json({ ok: true, externalMessageId: result.externalMessageId });
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
