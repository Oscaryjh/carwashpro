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
import { pcbProfileDataSchema, pcbProfileToJson } from "../pcb-profile";

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
    epfMemberNumber: identifier.optional(),
    expectedRevision: expectedRevisionSchema,
    membershipId: z.string().uuid(),
    socsoMemberNumber: identifier.optional(),
    statutoryCountryCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/, "Country code must contain two letters.")
      .nullable()
      .optional(),
    statutoryIdentityNumber: identifier.optional(),
    statutoryIdentityType: z
      .enum(["NEW_IC", "OLD_IC", "PASSPORT", "OTHER"])
      .nullable()
      .optional(),
    taxIdentificationNumber: identifier.optional(),
    pcbProfile: pcbProfileDataSchema.nullable().optional(),
  })
  .and(reasonFieldsSchema);

export type UpdateEmployeeTaxProfileCommand = z.input<typeof taxCommandSchema>;

export type UpdateEmployeeTaxProfileResult = CanonicalCommandResult & {
  affectedDrafts: number;
  artifactCount: number;
  changedFields: string[];
  existingArtifactWarning: boolean;
  finalizedCount: number;
  masked: {
    epfMemberNumber: string | null;
    socsoMemberNumber: string | null;
    statutoryIdentityNumber: string | null;
    taxIdentificationNumber: string | null;
  };
  newRevision: number;
  reviewCount: number;
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
  const countryCode = normalizeOptionalIdentifierUpdate(
    input.statutoryCountryCode,
  );
  const normalized = {
    ...input,
    epfMemberNumber: normalizeOptionalIdentifierUpdate(input.epfMemberNumber),
    socsoMemberNumber: normalizeOptionalIdentifierUpdate(input.socsoMemberNumber),
    statutoryCountryCode:
      countryCode === undefined ? undefined : countryCode?.toUpperCase() ?? null,
    statutoryIdentityNumber: normalizeOptionalIdentifierUpdate(
      input.statutoryIdentityNumber,
    ),
    taxIdentificationNumber: normalizeOptionalIdentifierUpdate(
      input.taxIdentificationNumber,
    ),
  };
  return parseCanonicalCommand(taxCommandSchema, normalized);
}

function normalizeOptionalIdentifierUpdate(
  value: string | null | undefined,
) {
  return value === undefined ? undefined : normalizeOptionalIdentifier(value);
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
      const desired = {
        epfMemberNumber:
          command.epfMemberNumber === undefined
            ? membership.epfMemberNumber
            : command.epfMemberNumber,
        socsoMemberNumber:
          command.socsoMemberNumber === undefined
            ? membership.socsoMemberNumber
            : command.socsoMemberNumber,
        statutoryCountryCode:
          command.statutoryCountryCode === undefined
            ? membership.statutoryCountryCode
            : command.statutoryCountryCode,
        statutoryIdentityNumber:
          command.statutoryIdentityNumber === undefined
            ? membership.statutoryIdentityNumber
            : command.statutoryIdentityNumber,
        statutoryIdentityType:
          command.statutoryIdentityType === undefined
            ? membership.statutoryIdentityType
            : command.statutoryIdentityType,
        taxIdentificationNumber:
          command.taxIdentificationNumber === undefined
            ? membership.taxIdentificationNumber
            : command.taxIdentificationNumber,
        pcbProfile:
          command.pcbProfile === undefined
            ? membership.pcbProfile
            : command.pcbProfile === null
              ? null
              : pcbProfileToJson(command.pcbProfile),
      };
      if (
        Boolean(desired.statutoryIdentityType) !==
        Boolean(desired.statutoryIdentityNumber)
      ) {
        throw new PayrollProfileWriteError(
          "VALIDATION_ERROR",
          "Identity type and identity number must be supplied together.",
        );
      }
      const after = await transaction.employeeBusinessMembership.update({
        where: { id: membership.id },
        data: {
          epfMemberNumber: desired.epfMemberNumber,
          socsoMemberNumber: desired.socsoMemberNumber,
          statutoryCountryCode: desired.statutoryCountryCode,
          statutoryIdentityNumber: desired.statutoryIdentityNumber,
          statutoryIdentityType: desired.statutoryIdentityType,
          statutoryProfileUpdatedAt: new Date(),
          taxIdentificationNumber: desired.taxIdentificationNumber,
          pcbProfile:
            desired.pcbProfile === null
              ? Prisma.JsonNull
              : desired.pcbProfile,
          taxProfileRevision: { increment: 1 },
        },
        select: {
          epfMemberNumber: true,
          socsoMemberNumber: true,
          statutoryCountryCode: true,
          statutoryIdentityNumber: true,
          statutoryIdentityType: true,
          taxIdentificationNumber: true,
          pcbProfile: true,
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
        "pcbProfile",
      ].filter(
        (field) =>
          comparableProfileValue(
            (membership as Record<string, unknown>)[field],
          ) !==
          comparableProfileValue((after as Record<string, unknown>)[field]),
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
        artifactCount: impact.artifactCount,
        changedFields,
        commandReplay: false,
        existingArtifactWarning: impact.artifactCount > 0,
        finalizedCount: impact.finalizedCount,
        masked: {
          epfMemberNumber: maskAuditIdentifier(after.epfMemberNumber),
          socsoMemberNumber: maskAuditIdentifier(after.socsoMemberNumber),
          statutoryIdentityNumber: maskAuditIdentifier(after.statutoryIdentityNumber),
          taxIdentificationNumber: maskAuditIdentifier(after.taxIdentificationNumber),
        },
        newRevision: after.taxProfileRevision,
        reviewCount: impact.reviewCount,
        status: "SUCCESS",
      };
    },
  };
}

function comparableProfileValue(value: unknown) {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
