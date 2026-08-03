import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  maskAuditIdentifier,
  safeEmployeeSubmissionIdentityAuditSnapshot,
} from "@/lib/audit/payroll-sensitive";
import {
  commandIdSchema,
  detectPayrollProfileDraftImpact,
  executeCanonicalPayrollProfileCommand,
  executeCanonicalPayrollProfileCommandInTransaction,
  expectedRevisionSchema,
  normalizeOptionalIdentifier,
  parseCanonicalCommand,
  reasonFieldsSchema,
  type CanonicalMembership,
  writeCanonicalPayrollProfileAudit,
} from "./common";
import {
  PayrollProfileWriteError,
  type CanonicalCommandResult,
  type PayrollProfileWriteContext,
} from "./types";

const identifier = z
  .string()
  .trim()
  .min(3)
  .max(30)
  .regex(/^[A-Za-z0-9 /-]+$/, "Identifier contains unsupported characters.")
  .nullable();

const taxCommandSchema = z
  .object({
    commandId: commandIdSchema,
    epfMemberNumber: identifier,
    expectedRevision: expectedRevisionSchema,
    membershipId: z.string().uuid(),
    socsoMemberNumber: identifier,
    statutoryCountryCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/, "Country code must contain two letters.")
      .nullable(),
    statutoryIdentityNumber: identifier,
    statutoryIdentityType: z
      .enum(["NEW_IC", "OLD_IC", "PASSPORT", "OTHER"])
      .nullable(),
    taxIdentificationNumber: identifier,
  })
  .and(reasonFieldsSchema)
  .superRefine((value, context) => {
    if (Boolean(value.statutoryIdentityType) !== Boolean(value.statutoryIdentityNumber)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Identity type and identity number must be supplied together.",
        path: ["statutoryIdentityNumber"],
      });
    }
  });

export type UpdateEmployeeTaxProfileCommand = z.input<typeof taxCommandSchema>;

export type UpdateEmployeeTaxProfileResult = CanonicalCommandResult & {
  affectedDrafts: number;
  existingArtifactWarning: boolean;
  masked: {
    epfMemberNumber: string | null;
    socsoMemberNumber: string | null;
    statutoryIdentityNumber: string | null;
    taxIdentificationNumber: string | null;
  };
  newRevision: number;
};

export async function updateEmployeeTaxProfile(input: {
  command: UpdateEmployeeTaxProfileCommand;
  context: PayrollProfileWriteContext;
}) {
  const command = normalizeTaxCommand(input.command);
  return executeCanonicalPayrollProfileCommand(buildExecution(input.context, command));
}

export async function updateEmployeeTaxProfileInTransaction(
  input: {
    command: UpdateEmployeeTaxProfileCommand;
    context: PayrollProfileWriteContext;
  },
  transaction: Prisma.TransactionClient,
) {
  const command = normalizeTaxCommand(input.command);
  return executeCanonicalPayrollProfileCommandInTransaction(
    buildExecution(input.context, command),
    transaction,
  );
}

function normalizeTaxCommand(input: UpdateEmployeeTaxProfileCommand) {
  const normalized = {
    ...input,
    epfMemberNumber: normalizeOptionalIdentifier(input.epfMemberNumber),
    socsoMemberNumber: normalizeOptionalIdentifier(input.socsoMemberNumber),
    statutoryCountryCode:
      normalizeOptionalIdentifier(input.statutoryCountryCode)?.toUpperCase() ?? null,
    statutoryIdentityNumber: normalizeOptionalIdentifier(input.statutoryIdentityNumber),
    taxIdentificationNumber: normalizeOptionalIdentifier(input.taxIdentificationNumber),
  };
  return parseCanonicalCommand(taxCommandSchema, normalized);
}

function buildExecution(
  context: PayrollProfileWriteContext,
  command: z.output<typeof taxCommandSchema>,
) {
  return {
    capabilities: ["VIEW_TAX_PROFILE", "EDIT_TAX_PROFILE"] as const,
    command,
    context,
    domain: "TAX" as const,
    async run({ membership, sanitizedReasonNote, transaction }: {
      membership: CanonicalMembership;
      sanitizedReasonNote: string | null;
      transaction: Prisma.TransactionClient;
    }): Promise<UpdateEmployeeTaxProfileResult> {
      if (membership.taxProfileRevision !== command.expectedRevision) {
        throw new PayrollProfileWriteError(
          "CONFLICT",
          "Tax profile changed after this request was prepared. Reload and try again.",
        );
      }
      const impact = await detectPayrollProfileDraftImpact(
        context.businessId,
        membership.id,
        transaction,
      );
      const after = await transaction.employeeBusinessMembership.update({
        where: { id: membership.id },
        data: {
          epfMemberNumber: command.epfMemberNumber,
          socsoMemberNumber: command.socsoMemberNumber,
          statutoryCountryCode: command.statutoryCountryCode,
          statutoryIdentityNumber: command.statutoryIdentityNumber,
          statutoryIdentityType: command.statutoryIdentityType,
          statutoryProfileUpdatedAt: new Date(),
          taxIdentificationNumber: command.taxIdentificationNumber,
          taxProfileRevision: { increment: 1 },
        },
        select: {
          epfMemberNumber: true,
          socsoMemberNumber: true,
          statutoryCountryCode: true,
          statutoryIdentityNumber: true,
          statutoryIdentityType: true,
          taxIdentificationNumber: true,
          taxProfileRevision: true,
        },
      });
      const changedFields = [
        "statutoryIdentityType",
        "statutoryIdentityNumber",
        "statutoryCountryCode",
        "epfMemberNumber",
        "socsoMemberNumber",
        "taxIdentificationNumber",
      ].filter(
        (field) =>
          String((membership as Record<string, unknown>)[field] ?? "") !==
          String((after as Record<string, unknown>)[field] ?? ""),
      );
      await writeCanonicalPayrollProfileAudit(
        {
          action: "EMPLOYEE_TAX_PROFILE_COMMAND_APPLIED",
          actor: context.actor,
          after: safeEmployeeSubmissionIdentityAuditSnapshot(after),
          before: safeEmployeeSubmissionIdentityAuditSnapshot(membership),
          businessId: context.businessId,
          entityId: membership.id,
          entityType: "EmployeeBusinessMembership",
          metadata: {
            caller: context.caller,
            changedFields,
            commandId: command.commandId,
            draftImpact: impact,
            reasonNote: sanitizedReasonNote,
            reasonType: command.reasonType,
          },
          request: context.request,
          summary: "Employee tax profile command applied.",
        },
        transaction,
      );
      return {
        affectedDrafts: impact.draftCount,
        commandReplay: false,
        existingArtifactWarning: impact.artifactCount > 0,
        masked: {
          epfMemberNumber: maskAuditIdentifier(after.epfMemberNumber),
          socsoMemberNumber: maskAuditIdentifier(after.socsoMemberNumber),
          statutoryIdentityNumber: maskAuditIdentifier(after.statutoryIdentityNumber),
          taxIdentificationNumber: maskAuditIdentifier(after.taxIdentificationNumber),
        },
        newRevision: after.taxProfileRevision,
        status: "SUCCESS",
      };
    },
  };
}
