import { Prisma, type EmployeePayBasis } from "@prisma/client";
import { z } from "zod";
import {
  payrollMonthStart,
  writeEmployeeCompensationVersionInTransaction,
} from "@/lib/payroll/compensation-version";
import {
  businessPayrollMonthStart,
  commandIdSchema,
  detectPayrollProfileDraftImpact,
  executeCanonicalPayrollProfileCommand,
  executeCanonicalPayrollProfileCommandInTransaction,
  expectedRevisionSchema,
  parseCanonicalCommand,
  reasonFieldsSchema,
  writeCanonicalPayrollProfileAudit,
} from "./common";
import {
  PayrollProfileWriteError,
  type CanonicalCommandResult,
  type PayrollProfileWriteContext,
} from "./types";

const compensationCommandSchema = z
  .object({
    baseRate: z.union([z.string(), z.number(), z.instanceof(Prisma.Decimal)]),
    commandId: commandIdSchema,
    effectiveFromMonth: z.coerce.date(),
    expectedRevision: expectedRevisionSchema,
    membershipId: z.string().uuid(),
    payBasis: z.enum(["MONTHLY", "DAILY", "HOURLY"]),
    source: z.enum(["MANUAL", "SYSTEM"]),
  })
  .and(reasonFieldsSchema);

export type ScheduleEmployeeCompensationChangeCommand = z.input<
  typeof compensationCommandSchema
>;

export type ScheduleEmployeeCompensationChangeResult = CanonicalCommandResult & {
  affectedDrafts: number;
  effectiveFromMonth: string;
  isCurrent: boolean;
  message: string;
  newRevision: number;
  newVersionId: string;
};

export async function scheduleEmployeeCompensationChange(input: {
  command: ScheduleEmployeeCompensationChangeCommand;
  context: PayrollProfileWriteContext;
}) {
  const command = parseCompensationCommand(input.command);
  return executeCanonicalPayrollProfileCommand(
    buildExecution(input.context, command),
  );
}

export async function scheduleEmployeeCompensationChangeInTransaction(
  input: {
    command: ScheduleEmployeeCompensationChangeCommand;
    context: PayrollProfileWriteContext;
  },
  transaction: Prisma.TransactionClient,
) {
  const command = parseCompensationCommand(input.command);
  return executeCanonicalPayrollProfileCommandInTransaction(
    buildExecution(input.context, command),
    transaction,
  );
}

function parseCompensationCommand(
  input: ScheduleEmployeeCompensationChangeCommand,
) {
  const command = parseCanonicalCommand(compensationCommandSchema, input);
  const effectiveFromMonth = payrollMonthStart(command.effectiveFromMonth);
  if (effectiveFromMonth.getTime() !== command.effectiveFromMonth.getTime()) {
    throw new PayrollProfileWriteError(
      "VALIDATION_ERROR",
      "Compensation must take effect on the first day of a month.",
    );
  }
  const baseRate = new Prisma.Decimal(command.baseRate);
  if (baseRate.isNegative()) {
    throw new PayrollProfileWriteError(
      "VALIDATION_ERROR",
      "Base rate cannot be negative.",
    );
  }
  return { ...command, baseRate, effectiveFromMonth };
}

function buildExecution(
  context: PayrollProfileWriteContext,
  command: ReturnType<typeof parseCompensationCommand>,
) {
  return {
    capabilities: ["VIEW_COMPENSATION", "EDIT_COMPENSATION"] as const,
    command,
    context,
    domain: "COMPENSATION" as const,
    async run({ membership, sanitizedReasonNote, transaction }: {
      membership: Parameters<Parameters<typeof executeCanonicalPayrollProfileCommand>[0]["run"]>[0]["membership"];
      sanitizedReasonNote: string | null;
      transaction: Prisma.TransactionClient;
    }): Promise<ScheduleEmployeeCompensationChangeResult> {
      if (membership.compensationRevision !== command.expectedRevision) {
        throw new PayrollProfileWriteError(
          "CONFLICT",
          "Compensation changed after this request was prepared. Reload and try again.",
        );
      }
      const currentMonth = await businessPayrollMonthStart(
        context.businessId,
        transaction,
      );
      if (command.effectiveFromMonth.getTime() < currentMonth.getTime()) {
        throw new PayrollProfileWriteError(
          "IMMUTABLE_HISTORY",
          "Backdated compensation changes are not supported in this release.",
        );
      }
      const previous = await transaction.employeeCompensationVersion.findFirst({
        where: {
          effectiveFromMonth: command.effectiveFromMonth,
          membershipId: command.membershipId,
          status: "ACTIVE",
        },
        select: { id: true, payBasis: true, baseRate: true },
      });
      const impact = await detectPayrollProfileDraftImpact(
        context.businessId,
        command.membershipId,
        transaction,
      );
      const version = await writeEmployeeCompensationVersionInTransaction(
        {
          actor: context.actor,
          authorization: {
            access: context.access,
            allowedBranchIds: context.allowedBranchIds,
          },
          baseRate: command.baseRate,
          businessId: context.businessId,
          effectiveFromMonth: command.effectiveFromMonth,
          membershipId: command.membershipId,
          payBasis: command.payBasis as EmployeePayBasis,
          projectionMonth: currentMonth,
          reasonNote: sanitizedReasonNote,
          reasonType: command.reasonType,
          request: context.request,
          skipAudit: true,
          source: command.source,
        },
        transaction,
      );
      const revision = await transaction.employeeBusinessMembership.update({
        where: { id: membership.id },
        data: { compensationRevision: { increment: 1 } },
        select: { compensationRevision: true },
      });
      const changedFields = [
        ...(previous?.payBasis === command.payBasis ? [] : ["payBasis"]),
        ...(previous?.baseRate.equals(command.baseRate) ? [] : ["baseRate"]),
      ];
      await writeCanonicalPayrollProfileAudit(
        {
          action: "EMPLOYEE_COMPENSATION_COMMAND_APPLIED",
          actor: context.actor,
          after: {
            baseRate: "[REDACTED]",
            payBasis: command.payBasis,
            versionId: version.id,
          },
          before: previous
            ? {
                baseRate: "[REDACTED]",
                payBasis: previous.payBasis,
                versionId: previous.id,
              }
            : null,
          businessId: context.businessId,
          entityId: membership.id,
          entityType: "EmployeeBusinessMembership",
          metadata: {
            caller: context.caller,
            changedFields,
            commandId: command.commandId,
            draftImpact: impact,
            effectiveMonth: command.effectiveFromMonth.toISOString().slice(0, 7),
            reasonNote: sanitizedReasonNote,
            reasonType: command.reasonType,
            source: command.source,
          },
          request: context.request,
          summary: "Employee compensation command applied.",
        },
        transaction,
      );
      const isCurrent = command.effectiveFromMonth.getTime() <= currentMonth.getTime();
      return {
        affectedDrafts: impact.draftCount,
        commandReplay: false,
        effectiveFromMonth: command.effectiveFromMonth.toISOString().slice(0, 7),
        isCurrent,
        message: isCurrent
          ? "Current compensation updated. Existing payroll runs were not recalculated."
          : "Future compensation scheduled. Current compensation was not changed.",
        newRevision: revision.compensationRevision,
        newVersionId: version.id,
        status: "SUCCESS",
      };
    },
  };
}
