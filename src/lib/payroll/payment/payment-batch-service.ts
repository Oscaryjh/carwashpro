import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  decryptBankAccountNumber,
  encryptPaymentInstructionAccountSnapshot,
} from "./bank-account-crypto";
import { executePayrollPaymentCommand } from "./payment-command";
import {
  safePaymentBatchAuditMetadata,
  safePaymentReason,
  writePayrollPaymentAudit,
} from "./payment-audit";
import {
  evaluatePayrollPaymentReadinessInTransaction,
  type InternalPaymentReadiness,
} from "./payment-readiness";
import { PayrollPaymentError, type PayrollPaymentContext } from "./types";

type BatchCommandBase = {
  commandId: string;
  expectedRevision: number;
  reason: string;
  reasonType: string;
};

export async function createPayrollPaymentBatch(
  context: PayrollPaymentContext,
  command: BatchCommandBase & { payrollRunId: string },
  database: PrismaClient = prisma,
) {
  validateReason(command.reason, command.reasonType);
  return executePayrollPaymentCommand(
    {
      capability: "CREATE_PAYMENT_BATCH",
      command,
      commandType: "CREATE_BATCH",
      context,
      run: async (transaction) => {
        if (command.expectedRevision !== 0) {
          throw new PayrollPaymentError("CONFLICT", "A new original payment batch must start at revision zero.");
        }
        return createBatchInTransaction(
          context,
          {
            batchType: "ORIGINAL",
            payrollRunId: command.payrollRunId,
            reason: command.reason,
            reasonType: command.reasonType,
            supersedesBatchId: null,
          },
          transaction,
        );
      },
    },
    database,
  );
}

export async function submitPayrollPaymentBatch(
  context: PayrollPaymentContext,
  command: BatchCommandBase & { paymentBatchId: string },
  database: PrismaClient = prisma,
) {
  validateReason(command.reason, command.reasonType);
  return executePayrollPaymentCommand(
    {
      capability: "SUBMIT_PAYMENT_BATCH",
      command,
      commandType: "SUBMIT_BATCH",
      context,
      run: async (transaction) => {
        const batch = await getBatch(context.businessId, command.paymentBatchId, transaction);
        assertBatchRevision(batch, command.expectedRevision);
        if (batch.status !== "DRAFT") {
          throw new PayrollPaymentError("CONFLICT", "Only a draft payment batch can be submitted.");
        }
        if (batch.blockedCount > 0 || batch.readyCount <= 0) {
          throw new PayrollPaymentError("BLOCKED", "Resolve every payment blocker before submitting this batch.");
        }
        const readiness = await evaluatePayrollPaymentReadinessInTransaction(
          { businessId: context.businessId, excludeBatchId: batch.id, runId: batch.payrollRunId },
          transaction,
        );
        assertReadinessMatchesBatch(batch, readiness);
        await assertInstructionBankVersionsCurrent(batch.id, readiness, transaction);
        const updated = await transaction.payrollPaymentBatch.update({
          where: { id: batch.id },
          data: {
            status: "AWAITING_APPROVAL",
            submittedAt: new Date(),
            submittedById: context.actor.userId,
          },
        });
        const reasonSafe = safePaymentReason(command.reason);
        await transaction.payrollPaymentEvent.create({
          data: {
            action: "BATCH_SUBMITTED_FOR_APPROVAL",
            actorId: context.actor.userId,
            batchId: batch.id,
            businessId: context.businessId,
            metadataSafe: safeBatchEventMetadata(updated),
            reasonSafe,
            reasonType: command.reasonType,
          },
        });
        await writeBatchAudit(context, updated, "PAYROLL_PAYMENT_BATCH_SUBMITTED", "Payroll payment batch submitted for approval.", transaction);
        return safeBatchResult(updated);
      },
    },
    database,
  );
}

export async function approvePayrollPaymentBatch(
  context: PayrollPaymentContext,
  command: BatchCommandBase & { paymentBatchId: string },
  database: PrismaClient = prisma,
) {
  validateReason(command.reason, command.reasonType);
  return executePayrollPaymentCommand(
    {
      capability: "APPROVE_PAYMENT_BATCH",
      command,
      commandType: "APPROVE_BATCH",
      context,
      run: async (transaction) => {
        const batch = await getBatch(context.businessId, command.paymentBatchId, transaction);
        assertBatchRevision(batch, command.expectedRevision);
        if (batch.status !== "AWAITING_APPROVAL") {
          throw new PayrollPaymentError("CONFLICT", "Only a submitted payment batch can be approved.");
        }
        if (batch.createdById === context.actor.userId) {
          throw new PayrollPaymentError("ACCESS_DENIED", "The payment batch creator cannot approve the same batch.");
        }
        const readiness = await evaluatePayrollPaymentReadinessInTransaction(
          { businessId: context.businessId, excludeBatchId: batch.id, runId: batch.payrollRunId },
          transaction,
        );
        assertReadinessMatchesBatch(batch, readiness);
        await assertInstructionBankVersionsCurrent(batch.id, readiness, transaction);
        const updated = await transaction.payrollPaymentBatch.update({
          where: { id: batch.id },
          data: {
            approvedAt: new Date(),
            approvedById: context.actor.userId,
            status: "APPROVED",
          },
        });
        const reasonSafe = safePaymentReason(command.reason);
        await transaction.payrollPaymentEvent.create({
          data: {
            action: "BATCH_APPROVED",
            actorId: context.actor.userId,
            batchId: batch.id,
            businessId: context.businessId,
            metadataSafe: safeBatchEventMetadata(updated),
            reasonSafe,
            reasonType: command.reasonType,
          },
        });
        await writeBatchAudit(context, updated, "PAYROLL_PAYMENT_BATCH_APPROVED", "Payroll payment batch approved.", transaction);
        return safeBatchResult(updated);
      },
    },
    database,
  );
}

export async function cancelPayrollPaymentBatch(
  context: PayrollPaymentContext,
  command: BatchCommandBase & { paymentBatchId: string },
  database: PrismaClient = prisma,
) {
  validateReason(command.reason, command.reasonType);
  return executePayrollPaymentCommand(
    {
      capability: "CANCEL_PAYMENT_BATCH",
      command,
      commandType: "CANCEL_BATCH",
      context,
      run: async (transaction) => {
        const batch = await getBatch(context.businessId, command.paymentBatchId, transaction);
        assertBatchRevision(batch, command.expectedRevision);
        if (!(["DRAFT", "AWAITING_APPROVAL"] as string[]).includes(batch.status)) {
          throw new PayrollPaymentError("IMMUTABLE_HISTORY", "Approved payment instructions cannot be cancelled through the standard workflow.");
        }
        if (batch.currentArtifactId) {
          throw new PayrollPaymentError("IMMUTABLE_HISTORY", "A payment batch with an artifact cannot be cancelled.");
        }
        const updated = await transaction.payrollPaymentBatch.update({
          where: { id: batch.id },
          data: {
            cancelledAt: new Date(),
            cancelledById: context.actor.userId,
            status: "CANCELLED",
          },
        });
        const reasonSafe = safePaymentReason(command.reason);
        await transaction.payrollPaymentEvent.create({
          data: {
            action: "BATCH_CANCELLED",
            actorId: context.actor.userId,
            batchId: batch.id,
            businessId: context.businessId,
            metadataSafe: safeBatchEventMetadata(updated),
            reasonSafe,
            reasonType: command.reasonType,
          },
        });
        await writeBatchAudit(context, updated, "PAYROLL_PAYMENT_BATCH_CANCELLED", "Payroll payment batch cancelled.", transaction);
        return safeBatchResult(updated);
      },
    },
    database,
  );
}

export async function createCorrectionPaymentBatch(
  context: PayrollPaymentContext,
  command: BatchCommandBase & { supersedesBatchId: string },
  database: PrismaClient = prisma,
) {
  validateReason(command.reason, command.reasonType);
  return executePayrollPaymentCommand(
    {
      capability: "CREATE_PAYMENT_BATCH",
      command,
      commandType: "CREATE_CORRECTION_BATCH",
      context,
      run: async (transaction) => {
        const original = await getBatch(context.businessId, command.supersedesBatchId, transaction);
        assertBatchRevision(original, command.expectedRevision);
        if (original.status !== "CANCELLED") {
          throw new PayrollPaymentError("VALIDATION_ERROR", "A correction batch requires a cancelled source batch.");
        }
        if (original.supersededById) {
          throw new PayrollPaymentError("CONFLICT", "This payment batch already has a correction.");
        }
        const created = await createBatchInTransaction(
          context,
          {
            batchType: "CORRECTION",
            payrollRunId: original.payrollRunId,
            reason: command.reason,
            reasonType: command.reasonType,
            supersedesBatchId: original.id,
          },
          transaction,
        );
        await transaction.payrollPaymentBatch.update({
          where: { id: original.id },
          data: { supersededById: created.paymentBatchId },
        });
        return created;
      },
    },
    database,
  );
}

async function createBatchInTransaction(
  context: PayrollPaymentContext,
  input: {
    batchType: "ORIGINAL" | "CORRECTION";
    payrollRunId: string;
    reason: string;
    reasonType: string;
    supersedesBatchId: string | null;
  },
  transaction: Prisma.TransactionClient,
) {
  const readiness = await evaluatePayrollPaymentReadinessInTransaction(
    { businessId: context.businessId, runId: input.payrollRunId },
    transaction,
  );
  const priorRevision = await transaction.payrollPaymentBatch.aggregate({
    where: { payrollRunId: input.payrollRunId },
    _max: { revision: true },
  });
  const revision = (priorRevision._max.revision ?? 0) + 1;
  const run = await transaction.payrollRun.findFirstOrThrow({
    where: { businessId: context.businessId, id: input.payrollRunId },
    select: { periodStart: true },
  });
  const batch = await transaction.payrollPaymentBatch.create({
    data: {
      batchNumber: `PAY-${run.periodStart.toISOString().slice(0, 7).replace("-", "")}-${String(revision).padStart(2, "0")}`,
      batchType: input.batchType,
      blockedCount: readiness.blockedCount,
      businessId: context.businessId,
      createdById: context.actor.userId,
      excludedCount: readiness.excludedCount,
      instructionCount: readiness.entryCount,
      payrollCalculationDigest: readiness.calculationDigest,
      payrollRunId: input.payrollRunId,
      readyCount: readiness.readyCount,
      reasonSafe: safePaymentReason(input.reason),
      reasonType: input.reasonType,
      revision,
      supersedesBatchId: input.supersedesBatchId,
      totalReadyAmount: readiness.totalReadyAmount,
    },
  });

  for (const item of readiness.instructions) {
    const instructionId = randomUUID();
    const bank = item.bankAccountVersion;
    let encryptedSnapshot: ReturnType<typeof encryptPaymentInstructionAccountSnapshot> | null = null;
    if (bank) {
      const accountNumber = decryptBankAccountNumber({
        accountNumberAuthTag: bank.accountNumberAuthTag,
        accountNumberCiphertext: bank.accountNumberCiphertext,
        accountNumberIv: bank.accountNumberIv,
        bankAccountVersionId: bank.id,
        businessId: bank.businessId,
        employeeMembershipId: bank.employeeMembershipId,
        encryptionKeyVersion: bank.encryptionKeyVersion,
      });
      encryptedSnapshot = encryptPaymentInstructionAccountSnapshot(accountNumber, {
        bankAccountVersionId: bank.id,
        businessId: context.businessId,
        paymentBatchId: batch.id,
        paymentInstructionId: instructionId,
      });
    }
    const instruction = await transaction.payrollPaymentInstruction.create({
      data: {
        accountFingerprintSnapshot: bank?.accountNumberFingerprintHmac ?? null,
        accountHolderNameSnapshot: bank?.accountHolderName ?? null,
        accountNumberAuthTagSnapshot: encryptedSnapshot?.authTag ?? null,
        accountNumberCiphertextSnapshot: encryptedSnapshot?.ciphertext ?? null,
        accountNumberIvSnapshot: encryptedSnapshot?.iv ?? null,
        accountNumberLast4Snapshot: bank?.accountNumberLast4 ?? null,
        bankAccountVersionId: bank?.id ?? null,
        bankCodeSnapshot: bank?.bankCode ?? null,
        bankNameSnapshot: bank?.bankNameSnapshot ?? null,
        blockerCode: item.blockerCode as never,
        businessId: context.businessId,
        employeeCodeSnapshot: item.employeeCode,
        employeeMembershipId: item.employeeMembershipId,
        employeeNameSnapshot: item.employeeName,
        encryptionKeyVersionSnapshot: encryptedSnapshot?.encryptionKeyVersion ?? null,
        id: instructionId,
        netPaySnapshot: item.netPay,
        paymentBatchId: batch.id,
        payrollEntryId: item.payrollEntryId,
        reference: `${batch.batchNumber}-${item.employeeCode}`.slice(0, 140),
        status: item.status,
      },
    });
    await transaction.payrollPaymentEvent.create({
      data: {
        action:
          item.status === "READY"
            ? "INSTRUCTION_READY"
            : item.status === "EXCLUDED"
              ? "INSTRUCTION_EXCLUDED"
              : "INSTRUCTION_BLOCKED",
        actorId: context.actor.userId,
        batchId: batch.id,
        businessId: context.businessId,
        instructionId: instruction.id,
        metadataSafe: item.blockerCode ? { blockerCode: item.blockerCode } : { status: item.status },
        reasonSafe: safePaymentReason(input.reason),
        reasonType: input.reasonType,
      },
    });
  }

  await transaction.payrollPaymentEvent.create({
    data: {
      action: input.batchType === "CORRECTION" ? "CORRECTION_BATCH_CREATED" : "BATCH_CREATED",
      actorId: context.actor.userId,
      batchId: batch.id,
      businessId: context.businessId,
      metadataSafe: safeBatchEventMetadata(batch),
      reasonSafe: safePaymentReason(input.reason),
      reasonType: input.reasonType,
    },
  });
  await writeBatchAudit(
    context,
    batch,
    input.batchType === "CORRECTION" ? "PAYROLL_PAYMENT_CORRECTION_BATCH_CREATED" : "PAYROLL_PAYMENT_BATCH_CREATED",
    input.batchType === "CORRECTION" ? "Payroll payment correction batch created." : "Payroll payment batch created.",
    transaction,
  );
  return safeBatchResult(batch);
}

async function getBatch(
  businessId: string,
  paymentBatchId: string,
  transaction: Prisma.TransactionClient,
) {
  const batch = await transaction.payrollPaymentBatch.findFirst({
    where: { businessId, id: paymentBatchId },
  });
  if (!batch) throw new PayrollPaymentError("NOT_FOUND", "Payroll payment batch was not found.");
  return batch;
}

function assertBatchRevision(batch: { revision: number }, expectedRevision: number) {
  if (batch.revision !== expectedRevision) {
    throw new PayrollPaymentError("CONFLICT", "The payment batch changed concurrently. Reload and try again.");
  }
}

function assertReadinessMatchesBatch(
  batch: {
    blockedCount: number;
    excludedCount: number;
    payrollCalculationDigest: string;
    readyCount: number;
  },
  readiness: InternalPaymentReadiness,
) {
  if (
    batch.payrollCalculationDigest !== readiness.calculationDigest ||
    batch.blockedCount !== readiness.blockedCount ||
    batch.readyCount !== readiness.readyCount ||
    batch.excludedCount !== readiness.excludedCount
  ) {
    throw new PayrollPaymentError("CONFLICT", "Payroll or payment readiness changed. Cancel and rebuild the draft batch.");
  }
}

async function assertInstructionBankVersionsCurrent(
  batchId: string,
  readiness: InternalPaymentReadiness,
  transaction: Prisma.TransactionClient,
) {
  const stored = await transaction.payrollPaymentInstruction.findMany({
    where: { paymentBatchId: batchId },
    select: { bankAccountVersionId: true, payrollEntryId: true },
  });
  const currentByEntry = new Map(
    readiness.instructions.map((item) => [item.payrollEntryId, item.bankAccountVersion?.id ?? null]),
  );
  if (stored.some((item) => item.bankAccountVersionId !== currentByEntry.get(item.payrollEntryId))) {
    throw new PayrollPaymentError("CONFLICT", "An employee bank account changed. Cancel and rebuild the draft batch.");
  }
}

function safeBatchResult(batch: {
  blockedCount: number;
  excludedCount: number;
  id: string;
  instructionCount: number;
  payrollCalculationDigest: string;
  payrollRunId: string;
  readyCount: number;
  revision: number;
  status: string;
  totalReadyAmount: { toString(): string };
}) {
  return {
    blockedCount: batch.blockedCount,
    commandReplay: false,
    excludedCount: batch.excludedCount,
    instructionCount: batch.instructionCount,
    paymentBatchId: batch.id,
    readyCount: batch.readyCount,
    revision: batch.revision,
    runId: batch.payrollRunId,
    status: "SUCCESS" as const,
    totalReadyAmount: batch.totalReadyAmount.toString(),
    workflowStatus: batch.status,
  };
}

function safeBatchEventMetadata(batch: {
  blockedCount: number;
  excludedCount: number;
  id: string;
  instructionCount: number;
  payrollCalculationDigest: string;
  payrollRunId: string;
  readyCount: number;
  revision: number;
  status: string;
}) {
  return safePaymentBatchAuditMetadata({
    batchId: batch.id,
    blockedCount: batch.blockedCount,
    calculationDigest: batch.payrollCalculationDigest,
    excludedCount: batch.excludedCount,
    instructionCount: batch.instructionCount,
    readyCount: batch.readyCount,
    revision: batch.revision,
    runId: batch.payrollRunId,
    status: batch.status,
  });
}

async function writeBatchAudit(
  context: PayrollPaymentContext,
  batch: Parameters<typeof safeBatchResult>[0],
  action: string,
  summary: string,
  transaction: Prisma.TransactionClient,
) {
  await writePayrollPaymentAudit(
    {
      action,
      context,
      entityId: batch.id,
      entityType: "PayrollPaymentBatch",
      metadata: safePaymentBatchAuditMetadata({
        batchId: batch.id,
        blockedCount: batch.blockedCount,
        calculationDigest: batch.payrollCalculationDigest,
        excludedCount: batch.excludedCount,
        instructionCount: batch.instructionCount,
        readyCount: batch.readyCount,
        revision: batch.revision,
        runId: batch.payrollRunId,
        status: batch.status,
      }),
      summary,
    },
    transaction,
  );
}

function validateReason(reason: string, reasonType: string) {
  if (!reasonType.trim() || reasonType.length > 64 || reason.trim().length < 5 || reason.length > 500) {
    throw new PayrollPaymentError("VALIDATION_ERROR", "Enter a valid payment reason and reason type.");
  }
}
