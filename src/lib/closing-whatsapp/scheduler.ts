import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
type PrismaLike = PrismaClient | Prisma.TransactionClient;
export type ClosingReminderSchedulerResult = {branchesChecked:number;queued:number;skipped:number};
export async function queueDueUnclosedClosingReminders(
  _input: {businessId?:string;now?:Date} = {},
  _client: PrismaLike = prisma,
): Promise<ClosingReminderSchedulerResult> {
  // Retired: do not read branches, produce work, or alter historical queue rows.
  return {branchesChecked:0,queued:0,skipped:0};
}
