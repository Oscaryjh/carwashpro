import { prisma } from "@/lib/prisma";
import { normalizeMalaysiaWhatsAppPhone } from "@/lib/whatsappDeepLink";

type MergeCandidate = {
  id: string;
  instanceId: string;
  customerId: string | null;
  phone: string;
  remoteJid: string | null;
  displayName: string;
  lastMessageBody: string | null;
  lastMessageAt: Date | null;
  unreadCount: number;
  updatedAt: Date;
};

export async function mergeDuplicateWhatsAppConversations(businessId: string) {
  const conversations = await prisma.whatsAppConversation.findMany({
    where: { businessId },
    select: {
      id: true,
      instanceId: true,
      customerId: true,
      phone: true,
      remoteJid: true,
      displayName: true,
      lastMessageBody: true,
      lastMessageAt: true,
      unreadCount: true,
      updatedAt: true,
    },
  });

  const groups = collectMergeGroups(conversations);
  const processed = new Set<string>();

  for (const group of groups) {
    const activeGroup = group.filter((conversation) => !processed.has(conversation.id));

    if (activeGroup.length < 2 || !shouldMergeGroup(activeGroup)) {
      continue;
    }

    const primary = pickPrimaryConversation(activeGroup);
    const duplicates = activeGroup.filter((conversation) => conversation.id !== primary.id);

    for (const duplicate of duplicates) {
      processed.add(duplicate.id);
    }

    await mergeIntoPrimary(businessId, primary, duplicates);
  }
}

function collectMergeGroups(conversations: MergeCandidate[]) {
  const groups = new Map<string, MergeCandidate[]>();

  for (const conversation of conversations) {
    if (conversation.customerId) {
      addGroup(
        groups,
        `instance:${conversation.instanceId}:customer:${conversation.customerId}`,
        conversation,
      );
    }
  }

  return Array.from(groups.values()).filter((group) => group.length > 1);
}

function addGroup(
  groups: Map<string, MergeCandidate[]>,
  key: string,
  conversation: MergeCandidate,
) {
  const group = groups.get(key) ?? [];
  group.push(conversation);
  groups.set(key, group);
}

function shouldMergeGroup(group: MergeCandidate[]) {
  const customerIds = new Set(group.map((item) => item.customerId).filter(Boolean));

  if (customerIds.size === 1) {
    return true;
  }

  return group.some(isInternalWhatsAppIdentity);
}

function pickPrimaryConversation(group: MergeCandidate[]) {
  return [...group].sort((a, b) => scoreConversation(b) - scoreConversation(a))[0];
}

function scoreConversation(conversation: MergeCandidate) {
  const hasRealPhone = isLikelyMalaysiaPhone(conversation.phone);
  const activity = conversation.lastMessageAt ?? conversation.updatedAt;

  return (
    (conversation.customerId ? 1000 : 0) +
    (hasRealPhone ? 500 : 0) +
    (!isInternalWhatsAppIdentity(conversation) ? 100 : 0) +
    Math.floor(activity.getTime() / 1_000_000_000)
  );
}

async function mergeIntoPrimary(
  businessId: string,
  primary: MergeCandidate,
  duplicates: MergeCandidate[],
) {
  const unreadCount =
    primary.unreadCount + duplicates.reduce((sum, item) => sum + item.unreadCount, 0);
  const customerId =
    primary.customerId ?? duplicates.find((item) => item.customerId)?.customerId ?? null;
  const displayName = pickDisplayName(primary, duplicates);
  const remoteJid =
    primary.remoteJid ?? duplicates.find((item) => item.remoteJid)?.remoteJid ?? null;

  await prisma.$transaction(async (tx) => {
    for (const duplicate of duplicates) {
      await tx.whatsAppChatMessage.updateMany({
        where: {
          businessId,
          instanceId: primary.instanceId,
          conversationId: duplicate.id,
        },
        data: {
          conversationId: primary.id,
          ...(customerId ? { customerId } : {}),
        },
      });

      await tx.whatsAppConversation.delete({
        where: { id: duplicate.id },
      });
    }

    const latestMessage = await tx.whatsAppChatMessage.findFirst({
      where: {
        businessId,
        instanceId: primary.instanceId,
        conversationId: primary.id,
      },
      orderBy: { createdAt: "desc" },
      select: {
        body: true,
        createdAt: true,
      },
    });

    await tx.whatsAppConversation.update({
      where: { id: primary.id },
      data: {
        ...(customerId ? { customerId } : {}),
        displayName,
        remoteJid,
        lastMessageBody: latestMessage?.body ?? primary.lastMessageBody,
        lastMessageAt: latestMessage?.createdAt ?? primary.lastMessageAt,
        unreadCount,
      },
    });
  });
}

function pickDisplayName(primary: MergeCandidate, duplicates: MergeCandidate[]) {
  const all = [primary, ...duplicates];
  const named = all.find((conversation) => {
    const name = normalizeConversationName(conversation.displayName);
    return name && name !== normalizeConversationName(conversation.phone) && !isNumericName(name);
  });

  return named?.displayName ?? primary.displayName;
}

function isInternalWhatsAppIdentity(conversation: MergeCandidate) {
  const digits = conversation.phone.replace(/[^\d]/g, "");

  return (
    conversation.remoteJid?.endsWith("@lid") ||
    (/^\d{12,}$/.test(digits) && !isLikelyMalaysiaPhone(conversation.phone))
  );
}

function isLikelyMalaysiaPhone(phone: string) {
  const normalizedPhone = normalizeMalaysiaWhatsAppPhone(phone);
  return /^60\d{8,10}$/.test(normalizedPhone);
}

function normalizeConversationName(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

function isNumericName(value: string) {
  return /^\d+$/.test(value);
}
