import {
  Prisma,
  type EmployeeRecurringPayComponentType,
  type PrismaClient,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  businessPayrollMonthStart,
  commandIdSchema,
  detectPayrollProfileDraftImpact,
  executeCanonicalPayrollProfileCommand,
  expectedRevisionSchema,
  parseCanonicalCommand,
  reasonFieldsSchema,
  writeCanonicalPayrollProfileAudit,
} from "@/lib/payroll/employee-profile-write/common";
import {
  PayrollProfileWriteError,
  type CanonicalCommandResult,
  type PayrollProfileWriteContext,
} from "@/lib/payroll/employee-profile-write/types";

const componentCodePattern = /^[A-Z][A-Z0-9_]{1,63}$/;
const reservedComponentCodes = new Set([
  "BASIC_SALARY",
  "EPF",
  "SOCSO",
  "EIS",
  "PCB",
]);

const recurringPayCommandSchema = z
  .object({
    amount: z.union([z.string(), z.number(), z.instanceof(Prisma.Decimal)]),
    code: z.string().trim().toUpperCase(),
    commandId: commandIdSchema,
    componentId: z.string().uuid().nullable().optional(),
    effectiveFromMonth: z.coerce.date(),
    expectedRevision: expectedRevisionSchema,
    membershipId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    operation: z.enum(["SET", "END"]),
    source: z.enum(["MANUAL", "SYSTEM"]),
    type: z.enum(["EARNING", "DEDUCTION"]),
  })
  .and(reasonFieldsSchema);

export type ScheduleRecurringPayCommand = z.input<
  typeof recurringPayCommandSchema
>;

export type ResolvedRecurringPayComponent = {
  amount: Prisma.Decimal;
  code: string;
  componentId: string;
  currency: "MYR";
  effectiveFromMonth: Date;
  membershipId: string;
  name: string;
  revision: number;
  type: EmployeeRecurringPayComponentType;
  versionId: string;
};

export type ScheduleRecurringPayResult = CanonicalCommandResult & {
  affectedDrafts: number;
  componentId: string;
  effectiveFromMonth: string;
  message: string;
  newRevision: number;
  newVersionId: string;
};

type RecurringPayReadDatabase = Pick<
  PrismaClient,
  "employeeRecurringPayComponent"
>;

export function recurringPayMonthStart(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1),
  );
}

export async function resolveRecurringPayForEmployee(
  input: {
    businessId: string;
    membershipId: string;
    payrollPeriodStart: Date;
  },
  database: RecurringPayReadDatabase = prisma,
) {
  const resolved = await resolveRecurringPayForEmployees(
    {
      businessId: input.businessId,
      membershipIds: [input.membershipId],
      payrollPeriodStart: input.payrollPeriodStart,
    },
    database,
  );
  return resolved.get(input.membershipId) ?? [];
}

export async function resolveRecurringPayForEmployees(
  input: {
    businessId: string;
    membershipIds: string[];
    payrollPeriodStart: Date;
  },
  database: RecurringPayReadDatabase = prisma,
) {
  const membershipIds = [...new Set(input.membershipIds)].sort();
  const result = new Map<string, ResolvedRecurringPayComponent[]>(
    membershipIds.map((membershipId) => [membershipId, []]),
  );
  if (!membershipIds.length) return result;

  const effectiveMonth = recurringPayMonthStart(input.payrollPeriodStart);
  const components = await database.employeeRecurringPayComponent.findMany({
    where: {
      businessId: input.businessId,
      membershipId: { in: membershipIds },
    },
    orderBy: [{ membershipId: "asc" }, { code: "asc" }],
    select: {
      id: true,
      membershipId: true,
      type: true,
      code: true,
      versions: {
        where: {
          effectiveFromMonth: { lte: effectiveMonth },
          status: "CURRENT",
        },
        orderBy: [
          { effectiveFromMonth: "desc" },
          { revision: "desc" },
        ],
        take: 1,
        select: {
          id: true,
          revision: true,
          effectiveFromMonth: true,
          state: true,
          name: true,
          amount: true,
          currency: true,
        },
      },
    },
  });

  for (const component of components) {
    const version = component.versions[0];
    if (!version || version.state === "ENDED") continue;
    const membershipComponents = result.get(component.membershipId);
    if (!membershipComponents) continue;
    membershipComponents.push({
      amount: version.amount,
      code: component.code,
      componentId: component.id,
      currency: "MYR",
      effectiveFromMonth: version.effectiveFromMonth,
      membershipId: component.membershipId,
      name: version.name,
      revision: version.revision,
      type: component.type,
      versionId: version.id,
    });
  }
  return result;
}

export function sumRecurringPay(
  components: ResolvedRecurringPayComponent[],
  type: EmployeeRecurringPayComponentType,
) {
  return components
    .filter((component) => component.type === type)
    .reduce(
      (total, component) => total.plus(component.amount),
      new Prisma.Decimal(0),
    );
}

export async function scheduleRecurringPayComponent(input: {
  command: ScheduleRecurringPayCommand;
  context: PayrollProfileWriteContext;
}, database: PrismaClient = prisma) {
  const command = parseRecurringPayCommand(input.command);
  return executeCanonicalPayrollProfileCommand(
    {
      capabilities: ["VIEW_COMPENSATION", "EDIT_COMPENSATION"],
      command,
      context: input.context,
      domain: "RECURRING_PAY",
      async run({ membership, sanitizedReasonNote, transaction }) {
        if (membership.recurringPayRevision !== command.expectedRevision) {
          throw new PayrollProfileWriteError(
            "CONFLICT",
            "Recurring pay changed after this request was prepared. Reload and try again.",
          );
        }
        const currentMonth = await businessPayrollMonthStart(
          input.context.businessId,
          transaction,
        );
        if (command.effectiveFromMonth < currentMonth) {
          throw new PayrollProfileWriteError(
            "IMMUTABLE_HISTORY",
            "Backdated recurring pay changes are not supported in this release.",
          );
        }

        let component = command.componentId
          ? await transaction.employeeRecurringPayComponent.findFirst({
              where: {
                businessId: input.context.businessId,
                id: command.componentId,
                membershipId: command.membershipId,
              },
            })
          : null;
        if (command.componentId && !component) {
          throw new PayrollProfileWriteError(
            "NOT_FOUND",
            "Recurring pay component was not found in this business.",
          );
        }
        if (!component && command.operation === "END") {
          throw new PayrollProfileWriteError(
            "NOT_FOUND",
            "A recurring pay component is required before it can be ended.",
          );
        }
        if (component &&
          (component.code !== command.code || component.type !== command.type)) {
          throw new PayrollProfileWriteError(
            "VALIDATION_ERROR",
            "Recurring component code and type are stable; create a new component instead.",
          );
        }
        if (!component) {
          component = await transaction.employeeRecurringPayComponent.create({
            data: {
              businessId: input.context.businessId,
              membershipId: command.membershipId,
              type: command.type,
              code: command.code,
              createdById: input.context.actor.userId,
            },
          });
        }

        const [sameMonth, latestRevision, applicable] = await Promise.all([
          transaction.employeeRecurringPayComponentVersion.findFirst({
            where: {
              componentId: component.id,
              effectiveFromMonth: command.effectiveFromMonth,
              status: "CURRENT",
            },
          }),
          transaction.employeeRecurringPayComponentVersion.aggregate({
            where: { componentId: component.id },
            _max: { revision: true },
          }),
          transaction.employeeRecurringPayComponentVersion.findFirst({
            where: {
              componentId: component.id,
              effectiveFromMonth: { lte: command.effectiveFromMonth },
              status: "CURRENT",
            },
            orderBy: [{ effectiveFromMonth: "desc" }, { revision: "desc" }],
          }),
        ]);
        if (command.operation === "END" && applicable?.state !== "ACTIVE") {
          throw new PayrollProfileWriteError(
            "VALIDATION_ERROR",
            "Only an active recurring pay component can be ended.",
          );
        }
        if (sameMonth) {
          await transaction.employeeRecurringPayComponentVersion.update({
            where: { id: sameMonth.id },
            data: {
              status: "SUPERSEDED",
              supersededAt: new Date(),
              supersededById: input.context.actor.userId,
            },
          });
        }

        const version = await transaction.employeeRecurringPayComponentVersion.create({
          data: {
            amount: command.operation === "END" ? new Prisma.Decimal(0) : command.amount,
            businessId: input.context.businessId,
            componentId: component.id,
            createdById: input.context.actor.userId,
            currency: "MYR",
            effectiveFromMonth: command.effectiveFromMonth,
            membershipId: command.membershipId,
            name: command.name,
            reasonNote: sanitizedReasonNote,
            reasonType: command.reasonType,
            revision: (latestRevision._max.revision ?? 0) + 1,
            source: command.source,
            state: command.operation === "END" ? "ENDED" : "ACTIVE",
            supersedesVersionId: sameMonth?.id,
          },
        });
        const revisionUpdate = await transaction.employeeBusinessMembership.updateMany({
          where: {
            businessId: input.context.businessId,
            id: command.membershipId,
            recurringPayRevision: command.expectedRevision,
          },
          data: { recurringPayRevision: { increment: 1 } },
        });
        if (revisionUpdate.count !== 1) {
          throw new PayrollProfileWriteError(
            "CONFLICT",
            "Recurring pay changed concurrently. Reload and try again.",
          );
        }
        const impact = await detectPayrollProfileDraftImpact(
          input.context.businessId,
          command.membershipId,
          transaction,
        );
        await writeCanonicalPayrollProfileAudit(
          {
            action: command.operation === "END"
              ? "EMPLOYEE_RECURRING_PAY_ENDED"
              : sameMonth
                ? "EMPLOYEE_RECURRING_PAY_CORRECTED"
                : "EMPLOYEE_RECURRING_PAY_SCHEDULED",
            actor: input.context.actor,
            after: {
              amount: "[REDACTED]",
              code: component.code,
              state: command.operation === "END" ? "ENDED" : "ACTIVE",
              versionId: version.id,
            },
            before: applicable
              ? {
                  amount: "[REDACTED]",
                  state: applicable.state,
                  versionId: applicable.id,
                }
              : null,
            businessId: input.context.businessId,
            entityId: component.id,
            entityType: "EmployeeRecurringPayComponent",
            metadata: {
              caller: input.context.caller,
              commandId: command.commandId,
              draftImpact: impact,
              effectiveMonth: command.effectiveFromMonth.toISOString().slice(0, 7),
              membershipId: command.membershipId,
              reasonNote: sanitizedReasonNote,
              reasonType: command.reasonType,
              revision: version.revision,
              source: command.source,
              type: component.type,
            },
            request: input.context.request,
            summary: command.operation === "END"
              ? "Employee recurring pay component ended."
              : "Employee recurring pay component scheduled.",
          },
          transaction,
        );
        return {
          affectedDrafts: impact.draftCount,
          commandReplay: false,
          componentId: component.id,
          effectiveFromMonth: command.effectiveFromMonth.toISOString().slice(0, 7),
          message: command.operation === "END"
            ? "Recurring pay ending scheduled. Existing Payroll Runs were not changed."
            : "Recurring pay change scheduled. Existing Payroll Runs were not changed.",
          newRevision: command.expectedRevision + 1,
          newVersionId: version.id,
          status: "SUCCESS",
        } satisfies ScheduleRecurringPayResult;
      },
    },
    database,
  );
}

function parseRecurringPayCommand(input: ScheduleRecurringPayCommand) {
  const command = parseCanonicalCommand(recurringPayCommandSchema, input);
  const effectiveFromMonth = recurringPayMonthStart(command.effectiveFromMonth);
  if (effectiveFromMonth.getTime() !== command.effectiveFromMonth.getTime()) {
    throw new PayrollProfileWriteError(
      "VALIDATION_ERROR",
      "Recurring pay must take effect on the first day of a month.",
    );
  }
  if (
    !componentCodePattern.test(command.code) ||
    reservedComponentCodes.has(command.code) ||
    command.code.startsWith("COMMISSION")
  ) {
    throw new PayrollProfileWriteError(
      "VALIDATION_ERROR",
      "Use a stable uppercase component code; salary, statutory, and commission codes are reserved.",
    );
  }
  const amount = new Prisma.Decimal(command.amount);
  if (
    !amount.isFinite() ||
    amount.decimalPlaces() > 2 ||
    amount.lte(0) ||
    amount.gte("10000000000")
  ) {
    throw new PayrollProfileWriteError(
      "VALIDATION_ERROR",
      "Recurring pay amount must be a positive MYR amount with up to 2 decimals.",
    );
  }
  return { ...command, amount, effectiveFromMonth };
}
