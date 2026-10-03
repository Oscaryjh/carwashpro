import type {Prisma, PrismaClient} from "@prisma/client";
import {prisma} from "@/lib/prisma";
import type {ClosingWhatsAppQueueResult} from "./types";
type PrismaLike = PrismaClient | Prisma.TransactionClient;

// Compatibility entry points for stale callers. Historical rows remain readable.
export async function enqueueClosingReportForSnapshot(
  _snapshotId: string, _client: PrismaLike = prisma,
): Promise<ClosingWhatsAppQueueResult> {
  throw new Error("DAILY_CLOSING_RETIRED");
}
export async function enqueueUnclosedClosingReminders(
  _input: {branchId:string;businessDate:string;businessId:string;now?:Date},
  _client: PrismaLike = prisma,
): Promise<ClosingWhatsAppQueueResult> {
  throw new Error("DAILY_CLOSING_RETIRED");
}
export async function enqueueManualClosingWhatsAppSend(
  _input: {attemptId:string;businessId:string;reason:string;requestedByUserId:string;trigger:"MANUAL_RETRY"|"MANUAL_RESEND"},
  _client: PrismaLike = prisma,
): Promise<never> {
  throw new Error("DAILY_CLOSING_RETIRED");
}
