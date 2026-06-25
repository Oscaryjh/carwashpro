import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type ProviderStatus = "sent" | "delivered" | "read" | "failed";

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.WHATSAPP_WEBHOOK_SECRET;
  const requestSecret = request.headers.get("x-whatsapp-webhook-secret");

  if (configuredSecret && requestSecret !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    businessId?: string;
    messageId?: string;
    provider?: string;
    providerMessageId?: string;
    status?: ProviderStatus;
    errorMessage?: string;
  };

  if (!body.businessId || !body.status) {
    return NextResponse.json(
      { error: "businessId and status are required" },
      { status: 400 },
    );
  }

  if (!body.messageId && !body.providerMessageId) {
    return NextResponse.json(
      { error: "messageId or providerMessageId is required" },
      { status: 400 },
    );
  }

  const provider = body.provider?.trim() || undefined;
  const message = await prisma.whatsAppMessage.findFirst({
    where: {
      businessId: body.businessId,
      ...(body.messageId
        ? { id: body.messageId }
        : {
            providerMessageId: body.providerMessageId,
            ...(provider ? { provider } : {}),
          }),
    },
  });

  if (!message) {
    return NextResponse.json({ updated: 0 }, { status: 404 });
  }

  const now = new Date();
  await prisma.whatsAppMessage.update({
    where: { id: message.id },
    data: statusUpdate({
      status: body.status,
      now,
      errorMessage: body.errorMessage,
      currentSentAt: message.sentAt,
      currentDeliveredAt: message.deliveredAt,
    }),
  });

  return NextResponse.json({ updated: 1 });
}

function statusUpdate({
  status,
  now,
  errorMessage,
  currentSentAt,
  currentDeliveredAt,
}: {
  status: ProviderStatus;
  now: Date;
  errorMessage?: string;
  currentSentAt: Date | null;
  currentDeliveredAt: Date | null;
}) {
  if (status === "sent") {
    return {
      status: "SENT" as const,
      sentAt: currentSentAt ?? now,
      errorMessage: null,
      failedAt: null,
    };
  }

  if (status === "delivered") {
    return {
      status: "DELIVERED" as const,
      sentAt: currentSentAt ?? now,
      deliveredAt: now,
      errorMessage: null,
      failedAt: null,
    };
  }

  if (status === "read") {
    return {
      status: "READ" as const,
      sentAt: currentSentAt ?? now,
      deliveredAt: currentDeliveredAt ?? now,
      readAt: now,
      errorMessage: null,
      failedAt: null,
    };
  }

  return {
    status: "FAILED" as const,
    failedAt: now,
    errorMessage: errorMessage || "Provider reported failed delivery.",
  };
}
