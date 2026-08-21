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

const optionalWorkingDays = z
  .number()
  .int("Working days must be a whole number.")
  .min(1, "Working days must be at least 1.")
  .max(31, "Working days cannot exceed 31.")
  .nullable();

const workTargetCommandSchema = z
  .object({
    commandId: commandIdSchema,
    expectedRevision: expectedRevisionSchema,
    membershipId: z.string().uuid(),
    workingDaysPerMonth: optionalWorkingDays.optional(),
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
  workingDaysPerMonth: number | null;
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
          workingDaysPerMonth: command.workingDaysPerMonth,
          normalWorkMinutesPerDay: command.normalWorkMinutesPerDay,
          targetBreakMinutes: command.targetBreakMinutes,
          workTargetRevision: { increment: 1 },
        },
        select: {
          workingDaysPerMonth: true,
          normalWorkMinutesPerDay: true,
          targetBreakMinutes: true,
          workTargetRevision: true,
        },
      });
      const changedFields = [
        ...(membership.workingDaysPerMonth === updated.workingDaysPerMonth
          ? []
          : ["workingDaysPerMonth"]),
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
            workingDaysPerMonth: updated.workingDaysPerMonth,
            normalWorkMinutesPerDay: updated.normalWorkMinutesPerDay,
            targetBreakMinutes: updated.targetBreakMinutes,
          },
          before: {
            workingDaysPerMonth: membership.workingDaysPerMonth,
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
        updated.workingDaysPerMonth === null ||
        updated.normalWorkMinutesPerDay === null ||
        updated.targetBreakMinutes === null;
      return {
        affectedDrafts: impact.draftCount,
        commandReplay: false,
        message: cleared
          ? "Employee work rules updated. Blank values use the company defaults."
          : "Employee work rules updated.",
        newRevision: updated.workTargetRevision,
        workingDaysPerMonth: updated.workingDaysPerMonth,
        normalWorkMinutesPerDay: updated.normalWorkMinutesPerDay,
        status: "SUCCESS",
        targetBreakMinutes: updated.targetBreakMinutes,
      };
    },
  };
}
