import type { Prisma } from "@prisma/client";
import { sanitizeAuditReason, sanitizeAuditValue } from "@/lib/audit/sanitize";
import { writeSensitiveAuditLog } from "@/lib/audit/payroll-sensitive";
import type { PayrollPaymentContext } from "./types";

export function safePaymentReason(value: string | null | undefined) {
  const sanitized = value ? sanitizeAuditReason(value) : null;
  return sanitized || null;
}

export function safeBankAuditMetadata(input: {
  changedFields: readonly string[];
  last4: string;
  reasonType: string;
  revision: number;
  verificationStatus: string;
}) {
  return {
    changedFields: [...input.changedFields],
    last4: input.last4,
    reasonType: input.reasonType,
    revision: input.revision,
    verificationStatus: input.verificationStatus,
  };
}

export function safePaymentBatchAuditMetadata(input: {
  batchId: string;
  blockedCount: number;
  calculationDigest: string;
  excludedCount: number;
  instructionCount: number;
  readyCount: number;
  revision: number;
  runId: string;
  status: string;
}) {
  return { ...input };
}

export async function writePayrollPaymentAudit(
  input: {
    action: string;
    context: PayrollPaymentContext;
    entityId: string;
    entityType: string;
    metadata?: unknown;
    status?: "SUCCESS" | "FAILED";
    summary: string;
  },
  transaction: Prisma.TransactionClient,
) {
  const metadata = sanitizeAuditValue(input.metadata);
  await writeSensitiveAuditLog(
    {
      action: input.action,
      actor: input.context.actor,
      businessId: input.context.businessId,
      entityId: input.entityId,
      entityType: input.entityType,
      metadata,
      request: input.context.request,
      status: input.status,
      summary: input.summary,
    },
    transaction,
  );
}
