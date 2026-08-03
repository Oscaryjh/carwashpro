import { Prisma } from "@prisma/client";
import { z } from "zod";
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

const optionalMinutes = z
  .number()
  .int("Minutes must be a whole number.")
  .min(1, "Minutes must be at least 1.")
  .max(1_440, "Minutes cannot exceed 1,440.")
  .nullable();

const workTargetCommandSchema = z
  .object({
    commandId: commandIdSchema,
    expectedRevision: expectedRevisionSchema,
    membershipId: z.string().uuid(),
    normalWorkMinutesPerDay: optionalMinutes,
    targetBreakMinutes: optionalMinutes,
  })
  .and(reasonFieldsSchema)
  .superRefine((value, context) => {
    if (
      value.normalWorkMinutesPerDay !== null &&
      value.targetBreakMinutes !== null &&
      value.targetBreakMinutes > value.normalWorkMinutesPerDay
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected break cannot exceed normal work minutes.",
        path: ["targetBreakMinutes"],
      });
    }
  });

export type UpdateEmployeePayrollWorkTargetCommand = z.input<
  typeof workTargetCommandSchema
>;

export type UpdateEmployeePayrollWorkTargetResult = CanonicalCommandResult & {
  affectedDrafts: number;
  message: string;
  newRevision: number;
  normalWorkMinutesPerDay: number | null;
  targetBreakMinutes: number | null;
};

export async function updateEmployeePayrollWorkTarget(input: {
  command: UpdateEmployeePayrollWorkTargetCommand;
  context: PayrollProfileWriteContext;
}) {
  const command = parseCanonicalCommand(workTargetCommandSchema, input.command);
  return executeCanonicalPayrollProfileCommand(buildExecution(input.context, command));
}

export async function updateEmployeePayrollWorkTargetInTransaction(
  input: {
    command: UpdateEmployeePayrollWorkTargetCommand;
    context: PayrollProfileWriteContext;
  },
  transaction: Prisma.TransactionClient,
) {
  const command = parseCanonicalCommand(workTargetCommandSchema, input.command);
  return executeCanonicalPayrollProfileCommandInTransaction(
    buildExecution(input.context, command),
    transaction,
  );
}

function buildExecution(
  context: PayrollProfileWriteContext,
  command: z.output<typeof workTargetCommandSchema>,
) {
  return {
    capabilities: ["VIEW_COMPENSATION", "EDIT_COMPENSATION"] as const,
    command,
    context,
    domain: "WORK_TARGET" as const,
    async run({ membership, sanitizedReasonNote, transaction }: {
      membership: CanonicalMembership;
      sanitizedReasonNote: string | null;
      transaction: Prisma.TransactionClient;
    }): Promise<UpdateEmployeePayrollWorkTargetResult> {
      if (membership.workTargetRevision !== command.expectedRevision) {
        throw new PayrollProfileWriteError(
          "CONFLICT",
          "Payroll work target changed after this request was prepared. Reload and try again.",
        );
      }
      const impact = await detectPayrollProfileDraftImpact(
        context.businessId,
        membership.id,
        transaction,
      );
      const updated = await transaction.employeeBusinessMembership.update({
        where: { id: membership.id },
        data: {
          normalWorkMinutesPerDay: command.normalWorkMinutesPerDay,
          targetBreakMinutes: command.targetBreakMinutes,
          workTargetRevision: { increment: 1 },
        },
        select: {
          normalWorkMinutesPerDay: true,
          targetBreakMinutes: true,
          workTargetRevision: true,
        },
      });
      const changedFields = [
        ...(membership.normalWorkMinutesPerDay === updated.normalWorkMinutesPerDay
          ? []
          : ["normalWorkMinutesPerDay"]),
        ...(membership.targetBreakMinutes === updated.targetBreakMinutes
          ? []
          : ["targetBreakMinutes"]),
      ];
      await writeCanonicalPayrollProfileAudit(
        {
          action: "EMPLOYEE_PAYROLL_WORK_TARGET_COMMAND_APPLIED",
          actor: context.actor,
          after: {
            normalWorkMinutesPerDay: updated.normalWorkMinutesPerDay,
            targetBreakMinutes: updated.targetBreakMinutes,
          },
          before: {
            normalWorkMinutesPerDay: membership.normalWorkMinutesPerDay,
            targetBreakMinutes: membership.targetBreakMinutes,
          },
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
          summary: "Employee payroll work target command applied.",
        },
        transaction,
      );
      const cleared =
        updated.normalWorkMinutesPerDay === null ||
        updated.targetBreakMinutes === null;
      return {
        affectedDrafts: impact.draftCount,
        commandReplay: false,
        message: cleared
          ? "Employee override updated. Cleared values use the existing company or attendance fallback; existing records were not changed."
          : "Employee payroll work target updated. Existing attendance and payroll runs were not changed.",
        newRevision: updated.workTargetRevision,
        normalWorkMinutesPerDay: updated.normalWorkMinutesPerDay,
        status: "SUCCESS",
        targetBreakMinutes: updated.targetBreakMinutes,
      };
    },
  };
}
