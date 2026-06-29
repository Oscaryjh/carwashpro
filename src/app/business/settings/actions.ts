"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { normalizeMalaysiaWhatsAppPhone } from "@/lib/whatsappDeepLink";

const profileSchema = z.object({
  whatsappPhone: z.string().trim().optional(),
});

export async function updateOwnerProfileAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser();
  const input = profileSchema.parse({
    whatsappPhone: formData.get("whatsappPhone"),
  });
  const whatsappPhone = input.whatsappPhone
    ? normalizeMalaysiaWhatsAppPhone(input.whatsappPhone)
    : null;

  await prisma.user.updateMany({
    where: {
      id: user.userId,
      businessId,
    },
    data: {
      whatsappPhone,
    },
  });

  revalidatePath("/business/settings");
  redirect("/business/settings?saved=profile");
}
