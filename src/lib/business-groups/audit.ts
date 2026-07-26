import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sanitizeAuditValue } from "@/lib/audit/sanitize";
import type { AppSession } from "@/lib/auth/session";

type GroupAuditDatabase =
  | Pick<PrismaClient, "businessGroupAuditLog">
  | Pick<Prisma.TransactionClient, "businessGroupAuditLog">;

type WriteBusinessGroupAuditLogInput = {
  groupId: string;
  businessId?: string | null;
  actor: Pick<AppSession, "userId"> | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
};

export async function writeBusinessGroupAuditLog(
  input: WriteBusinessGroupAuditLogInput,
  database: GroupAuditDatabase = prisma,
) {
  const data: Prisma.BusinessGroupAuditLogUncheckedCreateInput = {
    groupId: input.groupId,
    businessId: input.businessId ?? null,
    actorUserId: input.actor?.userId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    summary: input.summary,
  };

  const before = sanitizeAuditValue(input.before);
  const after = sanitizeAuditValue(input.after);
  const metadata = sanitizeAuditValue(input.metadata);

  if (before !== undefined) data.before = before as Prisma.InputJsonValue;
  if (after !== undefined) data.after = after as Prisma.InputJsonValue;
  if (metadata !== undefined) data.metadata = metadata as Prisma.InputJsonValue;

  return database.businessGroupAuditLog.create({ data });
}
