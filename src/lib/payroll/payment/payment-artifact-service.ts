import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertPaymentAuthorization } from "./payment-command";
import {
  decryptPaymentArtifact,
  encryptPaymentArtifact,
} from "./payment-artifact-crypto";
import { safePaymentReason, writePayrollPaymentAudit } from "./payment-audit";
import { PayrollPaymentError, type PayrollPaymentContext } from "./types";
import { consumePayrollHighRiskAuthorization } from "@/lib/payroll/high-risk-mfa";

// P0 has no bank adapter and no download route. This function exists only for
// integrity tests using fixed internal bytes; production bank formats belong to P3.
export async function createInternalTestPaymentArtifact(
  context: PayrollPaymentContext,
  input: {
    allowInternalTestArtifact: true;
    bytes: Buffer;
    filename: string;
    paymentBatchId: string;
    reason: string;
    recordCount: number;
  },
  database: PrismaClient = prisma,
) {
  if (!input.allowInternalTestArtifact || process.env.NODE_ENV !== "test") {
    throw new PayrollPaymentError("ACCESS_DENIED", "Internal payment artifacts are test-only.");
  }
  const reasonSafe = safePaymentReason(input.reason);
  if (!reasonSafe || input.reason.trim().length < 5 || input.reason.length > 500) {
    throw new PayrollPaymentError("VALIDATION_ERROR", "Enter an export audit reason of 5 to 500 characters.");
  }
  return database.$transaction(async (transaction) => {
    await assertPaymentAuthorization(context, "EXPORT_PAYMENT_FILE", transaction);
    const batch = await transaction.payrollPaymentBatch.findFirst({
      where: { businessId: context.businessId, id: input.paymentBatchId },
    });
    if (!batch) throw new PayrollPaymentError("NOT_FOUND", "Payment batch was not found.");
    if (batch.status !== "APPROVED" || batch.currentArtifactId) {
      throw new PayrollPaymentError("IMMUTABLE_HISTORY", "Only an approved batch without an artifact can create the internal test artifact.");
    }
    const stepUpAudit = await consumePayrollHighRiskAuthorization(
      {
        actionKey: "PAYMENT_FILE_EXPORT",
        businessId: context.businessId,
        resourceId: batch.id,
        stepUp: context.stepUp,
        userId: context.actor.userId,
      },
      transaction,
    );
    const artifactId = randomUUID();
    const encrypted = encryptPaymentArtifact(input.bytes, {
      artifactId,
      businessId: context.businessId,
      formatVersion: "P0-INTERNAL-v1",
      paymentBatchId: batch.id,
      providerKey: "INTERNAL_TEST",
      revision: 1,
    });
    const artifact = await transaction.payrollPaymentArtifact.create({
      data: {
        ...encrypted,
        businessId: context.businessId,
        createdById: context.actor.userId,
        filename: input.filename,
        formatVersion: "P0-INTERNAL-v1",
        id: artifactId,
        paymentBatchId: batch.id,
        providerKey: "INTERNAL_TEST",
        recordCount: input.recordCount,
        revision: 1,
      },
    });
    await transaction.payrollPaymentBatch.update({
      where: { id: batch.id },
      data: { currentArtifactId: artifact.id, status: "INSTRUCTION_READY" },
    });
    await writePayrollPaymentAudit(
      {
        action: "PAYROLL_PAYMENT_INTERNAL_TEST_ARTIFACT_CREATED",
        context,
        entityId: artifact.id,
        entityType: "PayrollPaymentArtifact",
        metadata: {
          batchId: batch.id,
          byteLength: artifact.byteLength,
          formatVersion: artifact.formatVersion,
          providerKey: artifact.providerKey,
          recordCount: artifact.recordCount,
          reason: reasonSafe,
          revision: artifact.revision,
          sha256: artifact.sha256,
          ...stepUpAudit,
        },
        summary: "Internal Payment P0 integrity-test artifact created.",
      },
      transaction,
    );
    return {
      artifactId: artifact.id,
      byteLength: artifact.byteLength,
      recordCount: artifact.recordCount,
      sha256: artifact.sha256,
    };
  });
}

export async function decryptInternalTestPaymentArtifact(
  artifact: Parameters<typeof decryptPaymentArtifact>[0],
  environment: NodeJS.ProcessEnv,
) {
  return decryptPaymentArtifact(artifact, environment);
}
