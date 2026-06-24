"use server";

import { revalidatePath } from "next/cache";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";

export async function markWhatsAppMessageSentAction(formData: FormData) {
  const { businessId } = await requireBusinessUser();
  const messageId = formData.get("messageId")?.toString();

  if (!messageId) {
    throw new Error("Message id is required.");
  }

  const message = await prisma.whatsAppMessage.findFirstOrThrow({
    where: {
      id: messageId,
      businessId,
    },
  });

  await prisma.whatsAppMessage.update({
    where: { id: message.id },
    data: {
      status: "SENT",
      sentAt: new Date(),
    },
  });

  revalidatePath("/whatsapp");
  revalidatePath(`/whatsapp/${message.id}`);
}
