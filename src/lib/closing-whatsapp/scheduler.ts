import type { Prisma, PrismaClient } from "@prisma/client";
import {
  getBusinessTodayDateValue,
  parseBusinessDateTime,
  toBusinessTimeValue,
} from "@/lib/business-time";
import { prisma } from "@/lib/prisma";
import { enqueueUnclosedClosingReminders } from "./queue";

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type ClosingReminderSchedulerResult = {
  branchesChecked: number;
  queued: number;
  skipped: number;
};

export async function queueDueUnclosedClosingReminders(
  input: {
    businessId?: string;
    now?: Date;
  } = {},
  client: PrismaLike = prisma,
): Promise<ClosingReminderSchedulerResult> {
  const now = input.now ?? new Date();
  const businessDate = getBusinessTodayDateValue(now);
  const currentTime = toBusinessTimeValue(now);
  const branches = await client.branch.findMany({
    where: {
      status: "ACTIVE",
      business: {
        ...(input.businessId ? { id: input.businessId } : {}),
        closingWhatsAppSetting: {
          enabled: true,
          sendUnclosedReminder: true,
        },
      },
    },
    select: {
      id: true,
      businessId: true,
      closingWhatsAppSetting: {
        select: {
          deadlineTimeOverride: true,
        },
      },
      business: {
        select: {
          closingWhatsAppSetting: {
            select: {
              deadlineTime: true,
            },
          },
        },
      },
    },
  });

  let queued = 0;
  let skipped = 0;

  for (const branch of branches) {
    const deadlineTime =
      branch.closingWhatsAppSetting?.deadlineTimeOverride ??
      branch.business.closingWhatsAppSetting?.deadlineTime ??
      "22:00";

    if (!isDeadlineDue(businessDate, deadlineTime, currentTime, now)) {
      skipped += 1;
      continue;
    }

    const result = await enqueueUnclosedClosingReminders(
      {
        branchId: branch.id,
        businessDate,
        businessId: branch.businessId,
        now,
      },
      client,
    );

    queued += result.created;
    skipped += result.skipped;
  }

  return {
    branchesChecked: branches.length,
    queued,
    skipped,
  };
}

function isDeadlineDue(
  businessDate: string,
  deadlineTime: string,
  currentTime: string,
  now: Date,
) {
  if (!/^\d{2}:\d{2}$/.test(deadlineTime)) {
    return false;
  }

  if (currentTime >= deadlineTime) {
    return true;
  }

  return parseBusinessDateTime(businessDate, deadlineTime) <= now;
}
