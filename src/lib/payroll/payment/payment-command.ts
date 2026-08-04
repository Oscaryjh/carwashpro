import { createHash } from "node:crypto";
import {
  Prisma,
  type PayrollPaymentCommandType,
  type PrismaClient,
} from "@prisma/client";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";
import { prisma } from "@/lib/prisma";
import {
  PayrollPaymentError,
  type PayrollPaymentCommandResult,
  type PayrollPaymentContext,
} from "./types";

type ExecutePaymentCommandInput<TResult extends PayrollPaymentCommandResult> = {
  capability: BusinessCapability;
  command: Record<string, unknown> & { commandId: string };
  commandType: PayrollPaymentCommandType;
  context: PayrollPaymentContext;
  run: (transaction: Prisma.TransactionClient) => Promise<TResult>;
};

export async function executePayrollPaymentCommand<
  TResult extends PayrollPaymentCommandResult,
>(
  input: ExecutePaymentCommandInput<TResult>,
  database: PrismaClient = prisma,
): Promise<TResult> {
  validateCommandId(input.command.commandId);
  const requestFingerprint = paymentCommandFingerprint({
    command: input.command,
    commandType: input.commandType,
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await database.$transaction(
        async (transaction) => {
          await assertPaymentAuthorization(
            input.context,
            input.capability,
            transaction,
          );
          const existing = await transaction.payrollPaymentCommandRecord.findUnique({
            where: {
              businessId_actorId_commandId: {
                actorId: input.context.actor.userId,
                businessId: input.context.businessId,
                commandId: input.command.commandId,
              },
            },
          });
          if (existing) {
            if (
              existing.requestFingerprint !== requestFingerprint ||
              existing.commandType !== input.commandType
            ) {
              throw new PayrollPaymentError(
                "DUPLICATE_COMMAND",
                "This payment command ID was already used with different input.",
              );
            }
            return {
              ...(existing.resultSafe as TResult),
              commandReplay: true,
            };
          }

          const result = await input.run(transaction);
          await transaction.payrollPaymentCommandRecord.create({
            data: {
              actorId: input.context.actor.userId,
              businessId: input.context.businessId,
              commandId: input.command.commandId,
              commandType: input.commandType,
              requestFingerprint,
              resultSafe: result as Prisma.InputJsonValue,
            },
          });
          return result;
        },
        { isolationLevel: "Serializable", maxWait: 5_000, timeout: 30_000 },
      );
    } catch (error) {
      if (isSerializableConflict(error) && attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt));
        continue;
      }
      if (isUniqueConflict(error)) {
        const replay = await database.payrollPaymentCommandRecord.findUnique({
          where: {
            businessId_actorId_commandId: {
              actorId: input.context.actor.userId,
              businessId: input.context.businessId,
              commandId: input.command.commandId,
            },
          },
        });
        if (
          replay?.requestFingerprint === requestFingerprint &&
          replay.commandType === input.commandType
        ) {
          return {
            ...(replay.resultSafe as TResult),
            commandReplay: true,
          };
        }
      }
      throw normalizePaymentError(error);
    }
  }
  throw new PayrollPaymentError(
    "CONFLICT",
    "The payment record changed concurrently. Reload and try again.",
  );
}

export async function assertPaymentAuthorization(
  context: PayrollPaymentContext,
  capability: BusinessCapability,
  transaction: Prisma.TransactionClient,
) {
  if (
    !context.access.granted ||
    context.access.businessId !== context.businessId
  ) {
    throw new PayrollPaymentError("ACCESS_DENIED", "Payment access is denied.");
  }
  if (!hasBusinessCapability(context.access, capability)) {
    throw new PayrollPaymentError("ACCESS_DENIED", "Payment access is denied.");
  }
  const activeBranches = await transaction.branch.findMany({
    where: { businessId: context.businessId, status: "ACTIVE" },
    select: { id: true },
  });
  const allowedBranchIds = new Set(context.allowedBranchIds);
  const wholeBusiness =
    allowedBranchIds.size === activeBranches.length &&
    activeBranches.every((branch) => allowedBranchIds.has(branch.id)) &&
    !(
      context.access.granted &&
      context.access.effectiveBusinessRole === "STAFF" &&
      !context.access.permissions.includes("ALL_BRANCHES")
    );
  if (!wholeBusiness) {
    throw new PayrollPaymentError(
      "ACCESS_DENIED",
      "Payroll payment requires whole-business access.",
    );
  }
}

export function paymentCommandFingerprint(input: unknown) {
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function validateCommandId(value: string) {
  if (!value.trim() || value.length > 128) {
    throw new PayrollPaymentError("VALIDATION_ERROR", "Command ID is invalid.");
  }
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isSerializableConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2034" || error.message.includes("could not serialize"))
  );
}

function normalizePaymentError(error: unknown) {
  if (error instanceof PayrollPaymentError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return new PayrollPaymentError("CONFLICT", "A conflicting payment record already exists.");
  }
  return error;
}
