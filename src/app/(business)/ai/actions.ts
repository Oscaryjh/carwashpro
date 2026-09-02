"use server";

import { revalidatePath } from "next/cache";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function archiveAiConversationAction(formData: FormData) {
  const context = await requireBusinessUserForModule("AI", "VIEW_AI_ANALYSIS");
  if (context.access.source === "DIRECT_BUSINESS") assertStaffPermission(context.user, "AI_ANALYSIS_VIEW");

  const conversationId = String(formData.get("conversationId") ?? "").trim();
  if (!UUID_PATTERN.test(conversationId)) throw new Error("AI_CONVERSATION_INVALID");

  const result = await prisma.aiConversation.updateMany({
    where: {
      id: conversationId,
      createdById: context.user.userId,
      businessId: context.businessId,
      groupId: null,
      archivedAt: null,
    },
    data: { archivedAt: new Date() },
  });

  if (result.count !== 1) throw new Error("AI_CONVERSATION_NOT_FOUND");
  revalidatePath("/ai");
}

export async function restoreAiConversationAction(formData: FormData) {
  const context = await requireBusinessUserForModule("AI", "VIEW_AI_ANALYSIS");
  if (context.access.source === "DIRECT_BUSINESS") assertStaffPermission(context.user, "AI_ANALYSIS_VIEW");

  const conversationId = String(formData.get("conversationId") ?? "").trim();
  if (!UUID_PATTERN.test(conversationId)) throw new Error("AI_CONVERSATION_INVALID");

  const result = await prisma.aiConversation.updateMany({
    where: {
      id: conversationId,
      createdById: context.user.userId,
      businessId: context.businessId,
      groupId: null,
      archivedAt: { not: null },
    },
    data: { archivedAt: null },
  });

  if (result.count !== 1) throw new Error("AI_CONVERSATION_NOT_FOUND");
  revalidatePath("/ai");
}
