import type { Prisma, PrismaClient } from "@prisma/client";
import { headers } from "next/headers";
import type { AppSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { sanitizeAuditValue } from "./sanitize";

type AuditDatabase = Pick<PrismaClient, "auditLog"> | Pick<Prisma.TransactionClient, "auditLog">;

export type AuditRequestContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type WriteAuditLogInput = {
  businessId: string;
  branchId?: string | null;
  actor?: Pick<AppSession, "userId" | "name" | "email"> | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  status?: "SUCCESS" | "FAILED";
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  request?: AuditRequestContext;
};

export async function getAuditRequestContext(): Promise<AuditRequestContext> {
  try {
    const requestHeaders = await headers();
    const forwardedFor = requestHeaders.get("x-forwarded-for");

    return {
      ipAddress:
        forwardedFor?.split(",")[0]?.trim() ||
        requestHeaders.get("x-real-ip") ||
        null,
      userAgent: requestHeaders.get("user-agent") || null,
    };
  } catch {
    return {};
  }
}

export async function writeAuditLog(
  input: WriteAuditLogInput,
  database: AuditDatabase = prisma,
) {
  const data: Prisma.AuditLogUncheckedCreateInput = {
    businessId: input.businessId,
    branchId: input.branchId ?? null,
    actorUserId: input.actor?.userId ?? null,
    actorName: input.actor?.name ?? null,
    actorEmail: input.actor?.email ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    summary: input.summary,
    status: input.status ?? "SUCCESS",
    ipAddress: input.request?.ipAddress ?? null,
    userAgent: input.request?.userAgent ?? null,
  };

  const before = sanitizeAuditValue(input.before);
  const after = sanitizeAuditValue(input.after);
  const metadata = sanitizeAuditValue(input.metadata);

  if (before !== undefined) {
    data.before = before as Prisma.InputJsonValue;
  }

  if (after !== undefined) {
    data.after = after as Prisma.InputJsonValue;
  }

  if (metadata !== undefined) {
    data.metadata = metadata as Prisma.InputJsonValue;
  }

  return database.auditLog.create({ data });
}

export async function tryWriteAuditLog(input: WriteAuditLogInput) {
  try {
    await writeAuditLog(input);
    return true;
  } catch (error) {
    console.error("[audit] Unable to write audit log", {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
