import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  encryptBankAccountNumber,
  normalizeBankCode,
} from "./bank-account-crypto";
import { executePayrollPaymentCommand } from "./payment-command";
import {
  safeBankAuditMetadata,
  safePaymentReason,
  writePayrollPaymentAudit,
} from "./payment-audit";
import { PayrollPaymentError, type PayrollPaymentContext } from "./types";

type BankVersionCommandBase = {
  commandId: string;
  expectedRevision: number;
  membershipId: string;
  reason: string;
  reasonType: string;
};

export type SafeEmployeeBankVersion = {
  accountHolderName: string;
  bankCode: string;
  bankName: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  id: string;
  last4: string;
  revision: number;
  status: string;
  verificationStatus: string;
};

export async function createEmployeeBankVersion(
  context: PayrollPaymentContext,
  command: BankVersionCommandBase & {
    accountHolderName: string;
    accountNumber: string;
    bankCode: string;
    bankName: string;
    effectiveFrom: Date;
  },
  database: PrismaClient = prisma,
) {
  validateReason(command.reason, command.reasonType);
  const effectiveFrom = validDate(command.effectiveFrom);
  const accountHolderName = requiredText(command.accountHolderName, 160, "account holder name");
  const bankName = requiredText(command.bankName, 160, "bank name");
  const bankCode = normalizeBankCode(command.bankCode);

  return executePayrollPaymentCommand(
    {
      capability: "EDIT_BANK_ACCOUNT",
      command: { ...command, effectiveFrom: effectiveFrom.toISOString() },
      commandType: "CREATE_BANK_VERSION",
      highRisk: {
        actionKey: "BANK_ACCOUNT_EDIT",
        resourceId: command.membershipId,
      },
      context,
      run: async (transaction, stepUpAudit) => {
        const membership = await transaction.employeeBusinessMembership.findFirst({
          where: { businessId: context.businessId, id: command.membershipId },
          select: { id: true },
        });
        if (!membership) throw new PayrollPaymentError("NOT_FOUND", "Employee membership was not found.");

        const latest = await transaction.employeeBankAccountVersion.findFirst({
          where: {
            businessId: context.businessId,
            employeeMembershipId: command.membershipId,
            isPrimary: true,
          },
          orderBy: [{ revision: "desc" }, { createdAt: "desc" }],
        });
        if ((latest?.revision ?? 0) !== command.expectedRevision) {
          throw new PayrollPaymentError("CONFLICT", "The bank account changed concurrently. Reload and try again.");
        }
        if (latest && effectiveFrom <= latest.effectiveFrom) {
          throw new PayrollPaymentError("VALIDATION_ERROR", "A replacement bank version must start after the current version.");
        }

        const id = randomUUID();
        const encrypted = encryptBankAccountNumber(command.accountNumber, bankCode, {
          bankAccountVersionId: id,
          businessId: context.businessId,
          employeeMembershipId: command.membershipId,
        });
        const reasonSafe = safePaymentReason(command.reason);

        if (latest?.status === "ACTIVE") {
          await transaction.employeeBankAccountVersion.update({
            where: { id: latest.id },
            data: {
              effectiveUntil: effectiveFrom,
              status: "SUPERSEDED",
              supersededById: context.actor.userId,
            },
          });
        }

        const created = await transaction.employeeBankAccountVersion.create({
          data: {
            ...encrypted,
            accountNumberAuthTag: Uint8Array.from(
              encrypted.accountNumberAuthTag,
            ),
            accountNumberCiphertext: Uint8Array.from(
              encrypted.accountNumberCiphertext,
            ),
            accountNumberIv: Uint8Array.from(encrypted.accountNumberIv),
            accountHolderName,
            bankCode,
            bankNameSnapshot: bankName,
            businessId: context.businessId,
            createdById: context.actor.userId,
            effectiveFrom,
            employeeMembershipId: command.membershipId,
            id,
            isPrimary: true,
            reasonSafe,
            reasonType: command.reasonType,
            revision: (latest?.revision ?? 0) + 1,
            supersedesVersionId: latest?.id ?? null,
          },
        });
        await transaction.payrollPaymentEvent.create({
          data: {
            action: "BANK_VERSION_CREATED",
            actorId: context.actor.userId,
            bankAccountVersionId: created.id,
            businessId: context.businessId,
            metadataSafe: { last4: created.accountNumberLast4, revision: created.revision },
            reasonSafe,
            reasonType: command.reasonType,
          },
        });
        await writePayrollPaymentAudit(
          {
            action: "EMPLOYEE_BANK_VERSION_CREATED",
            context,
            entityId: created.id,
            entityType: "EmployeeBankAccountVersion",
            metadata: {
              ...safeBankAuditMetadata({
                changedFields: ["bankCode", "accountHolderName", "accountNumber", "effectiveFrom"],
                last4: created.accountNumberLast4,
                reasonType: command.reasonType,
                revision: created.revision,
                verificationStatus: created.verificationStatus,
              }),
              ...stepUpAudit,
            },
            summary: "Employee salary bank account version created.",
          },
          transaction,
        );
        return {
          bankAccountVersionId: created.id,
          commandReplay: false,
          last4: created.accountNumberLast4,
          revision: created.revision,
          status: "SUCCESS" as const,
          verificationStatus: created.verificationStatus,
        };
      },
    },
    database,
  );
}

export async function verifyEmployeeBankVersion(
  context: PayrollPaymentContext,
  command: BankVersionCommandBase & { bankAccountVersionId: string },
  database: PrismaClient = prisma,
) {
  validateReason(command.reason, command.reasonType);
  return executePayrollPaymentCommand(
    {
      capability: "VERIFY_BANK_ACCOUNT",
      command,
      commandType: "VERIFY_BANK_VERSION",
      highRisk: {
        actionKey: "BANK_ACCOUNT_EDIT",
        resourceId: command.membershipId,
      },
      context,
      run: async (transaction, stepUpAudit) => {
        const version = await transaction.employeeBankAccountVersion.findFirst({
          where: {
            businessId: context.businessId,
            employeeMembershipId: command.membershipId,
            id: command.bankAccountVersionId,
          },
        });
        if (!version) throw new PayrollPaymentError("NOT_FOUND", "Bank account version was not found.");
        if (
          version.revision !== command.expectedRevision ||
          version.status !== "ACTIVE" ||
          version.verificationStatus !== "UNVERIFIED"
        ) {
          throw new PayrollPaymentError("CONFLICT", "Only the current active bank version can be verified.");
        }
        const reasonSafe = safePaymentReason(command.reason);
        const updated = await transaction.employeeBankAccountVersion.update({
          where: { id: version.id },
          data: {
            verificationMethod: "MANUAL_REVIEW",
            verificationStatus: "MANUALLY_VERIFIED",
            verifiedAt: new Date(),
            verifiedById: context.actor.userId,
          },
        });
        await transaction.payrollPaymentEvent.create({
          data: {
            action: "BANK_VERSION_VERIFIED",
            actorId: context.actor.userId,
            bankAccountVersionId: version.id,
            businessId: context.businessId,
            metadataSafe: { last4: version.accountNumberLast4, method: "MANUAL_REVIEW" },
            reasonSafe,
            reasonType: command.reasonType,
          },
        });
        await writePayrollPaymentAudit(
          {
            action: "EMPLOYEE_BANK_VERSION_MANUALLY_VERIFIED",
            context,
            entityId: version.id,
            entityType: "EmployeeBankAccountVersion",
            metadata: {
              ...safeBankAuditMetadata({
                changedFields: ["verificationStatus"],
                last4: version.accountNumberLast4,
                reasonType: command.reasonType,
                revision: version.revision,
                verificationStatus: updated.verificationStatus,
              }),
              ...stepUpAudit,
            },
            summary: "Employee salary bank account manually verified.",
          },
          transaction,
        );
        return {
          bankAccountVersionId: version.id,
          commandReplay: false,
          revision: version.revision,
          status: "SUCCESS" as const,
          verificationStatus: updated.verificationStatus,
        };
      },
    },
    database,
  );
}

export async function deactivateEmployeeBankVersion(
  context: PayrollPaymentContext,
  command: BankVersionCommandBase & { bankAccountVersionId: string },
  database: PrismaClient = prisma,
) {
  validateReason(command.reason, command.reasonType);
  return executePayrollPaymentCommand(
    {
      capability: "EDIT_BANK_ACCOUNT",
      command,
      commandType: "DEACTIVATE_BANK_VERSION",
      highRisk: {
        actionKey: "BANK_ACCOUNT_EDIT",
        resourceId: command.membershipId,
      },
      context,
      run: async (transaction, stepUpAudit) => {
        const version = await transaction.employeeBankAccountVersion.findFirst({
          where: {
            businessId: context.businessId,
            employeeMembershipId: command.membershipId,
            id: command.bankAccountVersionId,
          },
        });
        if (!version) throw new PayrollPaymentError("NOT_FOUND", "Bank account version was not found.");
        if (version.revision !== command.expectedRevision || version.status !== "ACTIVE") {
          throw new PayrollPaymentError("CONFLICT", "Only the current active bank version can be deactivated.");
        }
        const reasonSafe = safePaymentReason(command.reason);
        const now = new Date();
        await transaction.employeeBankAccountVersion.update({
          where: { id: version.id },
          data: {
            effectiveUntil: now > version.effectiveFrom ? now : null,
            status: "INACTIVE",
            supersededById: context.actor.userId,
          },
        });
        await transaction.payrollPaymentEvent.create({
          data: {
            action: "BANK_VERSION_DEACTIVATED",
            actorId: context.actor.userId,
            bankAccountVersionId: version.id,
            businessId: context.businessId,
            metadataSafe: { last4: version.accountNumberLast4, revision: version.revision },
            reasonSafe,
            reasonType: command.reasonType,
          },
        });
        await writePayrollPaymentAudit(
          {
            action: "EMPLOYEE_BANK_VERSION_DEACTIVATED",
            context,
            entityId: version.id,
            entityType: "EmployeeBankAccountVersion",
            metadata: {
              ...safeBankAuditMetadata({
                changedFields: ["status", "effectiveUntil"],
                last4: version.accountNumberLast4,
                reasonType: command.reasonType,
                revision: version.revision,
                verificationStatus: version.verificationStatus,
              }),
              ...stepUpAudit,
            },
            summary: "Employee salary bank account deactivated.",
          },
          transaction,
        );
        return {
          bankAccountVersionId: version.id,
          commandReplay: false,
          revision: version.revision,
          status: "SUCCESS" as const,
        };
      },
    },
    database,
  );
}

export function toSafeEmployeeBankVersion(input: {
  accountHolderName: string;
  accountNumberLast4: string;
  bankCode: string;
  bankNameSnapshot: string;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  id: string;
  revision: number;
  status: string;
  verificationStatus: string;
}): SafeEmployeeBankVersion {
  return {
    accountHolderName: input.accountHolderName,
    bankCode: input.bankCode,
    bankName: input.bankNameSnapshot,
    effectiveFrom: input.effectiveFrom.toISOString(),
    effectiveUntil: input.effectiveUntil?.toISOString() ?? null,
    id: input.id,
    last4: input.accountNumberLast4,
    revision: input.revision,
    status: input.status,
    verificationStatus: input.verificationStatus,
  };
}

export async function assertEmployeeBankResource(
  businessId: string,
  membershipId: string,
  database: PrismaClient = prisma,
) {
  const exists = await database.employeeBusinessMembership.count({
    where: { businessId, id: membershipId },
  });
  if (exists !== 1) {
    throw new PayrollPaymentError("NOT_FOUND", "Employee membership was not found.");
  }
}

function validateReason(reason: string, reasonType: string) {
  if (!reasonType.trim() || reasonType.length > 64) {
    throw new PayrollPaymentError("VALIDATION_ERROR", "Payment reason type is invalid.");
  }
  if (reason.trim().length < 5 || reason.length > 500) {
    throw new PayrollPaymentError("VALIDATION_ERROR", "Enter a payment audit reason of 5 to 500 characters.");
  }
}

function validDate(value: Date) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new PayrollPaymentError("VALIDATION_ERROR", "Effective date is invalid.");
  }
  return value;
}

function requiredText(value: string, max: number, label: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new PayrollPaymentError("VALIDATION_ERROR", `Enter a valid ${label}.`);
  }
  return normalized;
}
