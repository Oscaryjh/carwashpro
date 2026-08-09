"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { normalizeMalaysiaWhatsAppPhone } from "@/lib/whatsappDeepLink";

const profileSchema = z.object({
  whatsappPhone: z.string().trim().optional(),
});

export async function updateOwnerProfileAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser(
    "MODIFY_BUSINESS_SETTINGS",
  );
  const auditRequest = await getAuditRequestContext();
  const input = profileSchema.parse({
    whatsappPhone: formData.get("whatsappPhone"),
  });
  const whatsappPhone = input.whatsappPhone
    ? normalizeMalaysiaWhatsAppPhone(input.whatsappPhone)
    : null;

  const current = await prisma.user.findFirstOrThrow({
    where: {
      id: user.userId,
      businessId,
    },
    select: { id: true, branchId: true, whatsappPhone: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: current.id },
      data: { whatsappPhone },
    });

    await writeAuditLog(
      {
        businessId,
        branchId: current.branchId,
        actor: user,
        action: "OWNER_PROFILE_UPDATED",
        entityType: "User",
        entityId: current.id,
        summary: "Updated owner profile",
        before: { whatsappPhone: current.whatsappPhone },
        after: { whatsappPhone },
        request: auditRequest,
      },
      tx,
    );
  });

  revalidatePath("/business/settings");
  redirect("/business/settings?saved=profile");
}
