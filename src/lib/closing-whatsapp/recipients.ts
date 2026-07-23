import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ClosingWhatsAppRecipientInput } from "./types";

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export async function getClosingWhatsAppAutomationConfig(
  input: {
    businessId: string;
    branchId: string;
  },
  client: PrismaLike = prisma,
) {
  const [businessSetting, branchSetting] = await Promise.all([
    client.closingWhatsAppSetting.findUnique({
      where: { businessId: input.businessId },
    }),
    client.closingWhatsAppBranchSetting.findUnique({
      where: {
        businessId_branchId: {
          branchId: input.branchId,
          businessId: input.businessId,
        },
      },
    }),
  ]);

  return {
    businessSetting,
    branchSetting,
    enabled: businessSetting?.enabled ?? false,
    sendClosingReport: businessSetting?.sendClosingReport ?? true,
    sendUnclosedReminder: businessSetting?.sendUnclosedReminder ?? true,
    deadlineTime:
      branchSetting?.deadlineTimeOverride ??
      businessSetting?.deadlineTime ??
      "22:00",
    useBusinessRecipients: branchSetting?.useBusinessRecipients ?? true,
  };
}

export async function resolveClosingWhatsAppRecipients(
  input: {
    businessId: string;
    branchId: string;
  },
  client: PrismaLike = prisma,
): Promise<ClosingWhatsAppRecipientInput[]> {
  const config = await getClosingWhatsAppAutomationConfig(input, client);

  if (!config.enabled) {
    return [];
  }

  const where = config.useBusinessRecipients
    ? {
        businessId: input.businessId,
        isActive: true,
        scope: "BUSINESS" as const,
        scopeKey: "BUSINESS",
      }
    : {
        businessId: input.businessId,
        branchId: input.branchId,
        isActive: true,
        scope: "BRANCH" as const,
        scopeKey: input.branchId,
      };

  const recipients = await client.closingWhatsAppRecipient.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      label: true,
      normalizedPhone: true,
      phone: true,
    },
  });

  const unique = new Map<string, ClosingWhatsAppRecipientInput>();

  for (const recipient of recipients) {
    if (!unique.has(recipient.normalizedPhone)) {
      unique.set(recipient.normalizedPhone, recipient);
    }
  }

  return Array.from(unique.values());
}

export function buildClosingReportDedupeKey(input: {
  recipientId: string;
  snapshotId: string;
}) {
  return `closing-report:${input.snapshotId}:${input.recipientId}`;
}

export function buildUnclosedReminderDedupeKey(input: {
  branchId: string;
  businessDate: string;
  businessId: string;
  recipientId: string;
}) {
  return `closing-unclosed:${input.businessId}:${input.branchId}:${input.businessDate}:${input.recipientId}`;
}
