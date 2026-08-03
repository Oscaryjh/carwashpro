import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  safeStatutoryContributionAuditSnapshot,
} from "@/lib/audit/payroll-sensitive";
import {
  commandIdSchema,
  detectPayrollProfileDraftImpact,
  executeCanonicalPayrollProfileCommand,
  executeCanonicalPayrollProfileCommandInTransaction,
  expectedRevisionSchema,
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

const statutoryCommandSchema = z
  .object({
    commandId: commandIdSchema,
    eisEnabled: z.boolean(),
    eisPreviouslyContributed: z.boolean(),
    epfEnabled: z.boolean(),
    epfMemberBeforeAug1998: z.boolean(),
    expectedRevision: expectedRevisionSchema,
    lindung24OptIn: z.boolean(),
    membershipId: z.string().uuid(),
    socsoCategory: z.enum(["FIRST", "SECOND"]).nullable(),
    socsoEnabled: z.boolean(),
    statutoryNationality: z
      .enum(["MALAYSIAN", "PERMANENT_RESIDENT", "NON_MALAYSIAN"])
      .nullable(),
  })
  .and(reasonFieldsSchema)
  .superRefine((value, context) => {
    if (!value.epfEnabled && value.epfMemberBeforeAug1998) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "EPF eligibility flags require EPF enrollment.",
        path: ["epfMemberBeforeAug1998"],
      });
    }
    if (!value.socsoEnabled && (value.socsoCategory || value.lindung24OptIn)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "SOCSO category and LINDUNG 24 require SOCSO enrollment.",
        path: ["socsoEnabled"],
      });
    }
    if (value.socsoEnabled && !value.socsoCategory) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "SOCSO category is required when SOCSO is enabled.",
        path: ["socsoCategory"],
      });
    }
    if (!value.eisEnabled && value.eisPreviouslyContributed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "EIS eligibility flags require EIS enrollment.",
        path: ["eisPreviouslyContributed"],
      });
    }
    if (
      (value.epfEnabled || value.socsoEnabled || value.eisEnabled) &&
      !value.statutoryNationality
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Statutory nationality is required for enabled contributions.",
        path: ["statutoryNationality"],
      });
    }
  });

export type UpdateEmployeeStatutoryProfileCommand = z.input<
  typeof statutoryCommandSchema
>;

export type UpdateEmployeeStatutoryProfileResult = CanonicalCommandResult & {
  affectedDrafts: number;
  changedFields: string[];
  existingArtifactWarning: boolean;
  newRevision: number;
};

export async function updateEmployeeStatutoryProfile(input: {
  command: UpdateEmployeeStatutoryProfileCommand;
  context: PayrollProfileWriteContext;
}) {
  const command = parseCanonicalCommand(statutoryCommandSchema, input.command);
  return executeCanonicalPayrollProfileCommand(buildExecution(input.context, command));
}

export async function updateEmployeeStatutoryProfileInTransaction(
  input: {
    command: UpdateEmployeeStatutoryProfileCommand;
    context: PayrollProfileWriteContext;
  },
  transaction: Prisma.TransactionClient,
) {
  const command = parseCanonicalCommand(statutoryCommandSchema, input.command);
  return executeCanonicalPayrollProfileCommandInTransaction(
    buildExecution(input.context, command),
    transaction,
  );
}

function buildExecution(
  context: PayrollProfileWriteContext,
  command: z.output<typeof statutoryCommandSchema>,
) {
  return {
    capabilities: ["VIEW_STATUTORY_PROFILE", "EDIT_STATUTORY_PROFILE"] as const,
    command,
    context,
    domain: "STATUTORY" as const,
    async run({ membership, sanitizedReasonNote, transaction }: {
      membership: CanonicalMembership;
      sanitizedReasonNote: string | null;
      transaction: Prisma.TransactionClient;
    }): Promise<UpdateEmployeeStatutoryProfileResult> {
      if (membership.statutoryProfileRevision !== command.expectedRevision) {
        throw new PayrollProfileWriteError(
          "CONFLICT",
          "Statutory profile changed after this request was prepared. Reload and try again.",
        );
      }
      if (
        (command.epfEnabled || command.socsoEnabled || command.eisEnabled) &&
        !membership.dateOfBirth
      ) {
        throw new PayrollProfileWriteError(
          "VALIDATION_ERROR",
          "Date of birth must be maintained in Personal before statutory contributions are enabled.",
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
          eisEnabled: command.eisEnabled,
          eisPreviouslyContributed: command.eisPreviouslyContributed,
          epfEnabled: command.epfEnabled,
          epfMemberBeforeAug1998: command.epfMemberBeforeAug1998,
          lindung24OptIn: command.lindung24OptIn,
          socsoCategory: command.socsoCategory,
          socsoEnabled: command.socsoEnabled,
          statutoryNationality: command.statutoryNationality,
          statutoryProfileRevision: { increment: 1 },
          statutoryProfileUpdatedAt: new Date(),
        },
        select: {
          dateOfBirth: true,
          eisEnabled: true,
          eisPreviouslyContributed: true,
          epfEnabled: true,
          epfMemberBeforeAug1998: true,
          lindung24OptIn: true,
          socsoCategory: true,
          socsoEnabled: true,
          statutoryNationality: true,
          statutoryProfileRevision: true,
        },
      });
      const fields = [
        "statutoryNationality",
        "epfEnabled",
        "epfMemberBeforeAug1998",
        "socsoEnabled",
        "socsoCategory",
        "eisEnabled",
        "eisPreviouslyContributed",
        "lindung24OptIn",
      ] as const;
      const changedFields = fields.filter(
        (field) => String(membership[field] ?? "") !== String(after[field] ?? ""),
      );
      await writeCanonicalPayrollProfileAudit(
        {
          action: "EMPLOYEE_STATUTORY_PROFILE_COMMAND_APPLIED",
          actor: context.actor,
          after: safeStatutoryContributionAuditSnapshot(after),
          before: safeStatutoryContributionAuditSnapshot(membership),
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
          summary: "Employee statutory profile command applied.",
        },
        transaction,
      );
      return {
        affectedDrafts: impact.draftCount,
        changedFields,
        commandReplay: false,
        existingArtifactWarning: impact.artifactCount > 0,
        newRevision: after.statutoryProfileRevision,
        status: "SUCCESS",
      };
    },
  };
}
