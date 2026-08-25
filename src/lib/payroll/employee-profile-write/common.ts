import { createHash } from "node:crypto";
import {
  Prisma,
  type PayrollProfileCommandDomain,
  type PrismaClient,
} from "@prisma/client";
import { z } from "zod";
import { sanitizeAuditReason } from "@/lib/audit/sanitize";
import { writeSensitiveAuditLog } from "@/lib/audit/payroll-sensitive";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";
import { prisma } from "@/lib/prisma";
import {
  PayrollProfileWriteError,
  type CanonicalCommandResult,
  type PayrollProfileDraftImpact,
  type PayrollProfileWriteContext,
} from "./types";

export const commandIdSchema = z
  .string()
  .trim()
  .min(1, "Command ID is required.")
  .max(128, "Command ID is invalid.");

export const expectedRevisionSchema = z.coerce
  .number()
  .int("Expected revision is invalid.")
  .min(0, "Expected revision is invalid.");

export const payrollProfileReasonTypeSchema = z.enum([
  "PROMOTION",
  "ANNUAL_INCREMENT",
  "SALARY_CORRECTION",
  "ROLE_CHANGE",
  "MARKET_ADJUSTMENT",
  "PAYROLL_POLICY_CHANGE",
  "STATUTORY_CORRECTION",
  "TAX_INFORMATION_UPDATE",
  "EMPLOYEE_PROVIDED_CORRECTION",
  "DATA_MIGRATION",
  "OTHER",
]);

export const reasonFieldsSchema = z
  .object({
    reasonType: payrollProfileReasonTypeSchema,
    reasonNote: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((value, context) => {
    if (
      value.reasonType === "OTHER" &&
      (value.reasonNote?.trim().length ?? 0) < 5
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A reason of 5 to 500 characters is required for Other.",
        path: ["reasonNote"],
      });
    }
  });

export const canonicalMembershipSelect = {
  id: true,
  businessId: true,
  compensationRevision: true,
  recurringPayRevision: true,
  workTargetRevision: true,
  statutoryProfileRevision: true,
  taxProfileRevision: true,
  workingDaysPerMonth: true,
  normalWorkMinutesPerDay: true,
  targetBreakMinutes: true,
  dateOfBirth: true,
  statutoryNationality: true,
  epfEnabled: true,
  epfMemberBeforeAug1998: true,
  socsoEnabled: true,
  socsoCategory: true,
  eisEnabled: true,
  eisPreviouslyContributed: true,
  lindung24OptIn: true,
  statutoryIdentityType: true,
  statutoryIdentityNumber: true,
  statutoryCountryCode: true,
  epfMemberNumber: true,
  socsoMemberNumber: true,
  taxIdentificationNumber: true,
  pcbProfile: true,
} satisfies Prisma.EmployeeBusinessMembershipSelect;

export type CanonicalMembership = Prisma.EmployeeBusinessMembershipGetPayload<{
  select: typeof canonicalMembershipSelect;
}>;

type ExecuteInput<TResult extends CanonicalCommandResult> = {
  capabilities: readonly [BusinessCapability, BusinessCapability];
  command: Record<string, unknown> & {
    commandId: string;
    membershipId: string;
  };
  context: PayrollProfileWriteContext;
  domain: PayrollProfileCommandDomain;
  run: (input: {
    membership: CanonicalMembership;
    sanitizedReasonNote: string | null;
    transaction: Prisma.TransactionClient;
  }) => Promise<TResult>;
};

export async function executeCanonicalPayrollProfileCommand<
  TResult extends CanonicalCommandResult,
>(input: ExecuteInput<TResult>, database: PrismaClient = prisma): Promise<TResult> {
  const fingerprint = commandFingerprint({
    caller: input.context.caller,
    command: input.command,
    domain: input.domain,
  });
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await database.$transaction(
        async (transaction) => {
          await enableCanonicalPayrollProfileWrite(transaction);
          await assertCanonicalAuthorization(
            input.context,
            input.capabilities,
            transaction,
          );

          const existing = await findCommandRecord(
            input.context,
            input.command.commandId,
            transaction,
          );
          if (existing) {
            return validateCommandReplay<TResult>(
              existing,
              input,
              fingerprint,
            );
          }

          const membership = await transaction.employeeBusinessMembership.findFirst({
            where: {
              businessId: input.context.businessId,
              id: input.command.membershipId,
            },
            select: canonicalMembershipSelect,
          });
          if (!membership) {
            throw new PayrollProfileWriteError(
              "NOT_FOUND",
              "Employee membership was not found in the selected business.",
            );
          }

          const reason =
            typeof input.command.reasonNote === "string"
              ? sanitizeAuditReason(input.command.reasonNote)
              : null;
          const result = await input.run({
            membership,
            sanitizedReasonNote: reason,
            transaction,
          });

          await transaction.payrollProfileCommandRecord.create({
            data: {
              actorUserId: input.context.actor.userId,
              businessId: input.context.businessId,
              commandFingerprint: fingerprint,
              commandId: input.command.commandId,
              domain: input.domain,
              membershipId: input.command.membershipId,
              result: result as Prisma.InputJsonValue,
            },
          });
          return result;
        },
        {
          isolationLevel: "Serializable",
          maxWait: 5_000,
          timeout: 20_000,
        },
      );
    } catch (error) {
      if (isUniqueConflict(error)) {
        const duplicate = await findCommandReplay(input, fingerprint, database);
        if (duplicate) return duplicate;
      }
      if (isSerializableConflict(error) && attempt < maxAttempts - 1) {
        await waitBeforeSerializableRetry(attempt);
        continue;
      }
      throw normalizeCanonicalError(error);
    }
  }

  throw new PayrollProfileWriteError(
    "CONFLICT",
    "The payroll profile changed concurrently. Reload and try again.",
  );
}

function waitBeforeSerializableRetry(attempt: number) {
  const delayMs = 20 * 2 ** attempt;
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

export async function executeCanonicalPayrollProfileCommandInTransaction<
  TResult extends CanonicalCommandResult,
>(
  input: ExecuteInput<TResult>,
  transaction: Prisma.TransactionClient,
): Promise<TResult> {
  await enableCanonicalPayrollProfileWrite(transaction);
  await assertCanonicalAuthorization(
    input.context,
    input.capabilities,
    transaction,
  );
  const fingerprint = commandFingerprint({
    caller: input.context.caller,
    command: input.command,
    domain: input.domain,
  });
  const existing = await findCommandRecord(
    input.context,
    input.command.commandId,
    transaction,
  );
  if (existing) {
    return validateCommandReplay<TResult>(existing, input, fingerprint);
  }
  const membership = await transaction.employeeBusinessMembership.findFirst({
    where: {
      businessId: input.context.businessId,
      id: input.command.membershipId,
    },
    select: canonicalMembershipSelect,
  });
  if (!membership) {
    throw new PayrollProfileWriteError(
      "NOT_FOUND",
      "Employee membership was not found in the selected business.",
    );
  }
  const sanitizedReasonNote =
    typeof input.command.reasonNote === "string"
      ? sanitizeAuditReason(input.command.reasonNote)
      : null;
  const result = await input.run({
    membership,
    sanitizedReasonNote,
    transaction,
  });
  await transaction.payrollProfileCommandRecord.create({
    data: {
      actorUserId: input.context.actor.userId,
      businessId: input.context.businessId,
      commandFingerprint: fingerprint,
      commandId: input.command.commandId,
      domain: input.domain,
      membershipId: input.command.membershipId,
      result: result as Prisma.InputJsonValue,
    },
  });
  return result;
}

export async function enableCanonicalPayrollProfileWrite(
  transaction: Prisma.TransactionClient,
) {
  await transaction.$executeRaw`SELECT set_config('tetamu.payroll_profile_command', 'on', true)`;
}

export async function detectPayrollProfileDraftImpact(
  businessId: string,
  membershipId: string,
  transaction: Prisma.TransactionClient,
): Promise<PayrollProfileDraftImpact> {
  const runs = await transaction.payrollRun.findMany({
    where: {
      businessId,
      entries: { some: { membershipId } },
    },
    select: {
      status: true,
      _count: { select: { statutoryArtifacts: true } },
    },
  });
  return runs.reduce<PayrollProfileDraftImpact>(
    (result, run) => ({
      artifactCount: result.artifactCount + run._count.statutoryArtifacts,
      draftCount: result.draftCount + (run.status === "DRAFT" ? 1 : 0),
      finalizedCount:
        result.finalizedCount + (run.status === "FINALIZED" ? 1 : 0),
      reviewCount: result.reviewCount + (run.status === "REVIEW" ? 1 : 0),
    }),
    { artifactCount: 0, draftCount: 0, finalizedCount: 0, reviewCount: 0 },
  );
}

export async function businessPayrollMonthStart(
  businessId: string,
  transaction: Prisma.TransactionClient,
  now = new Date(),
) {
  const business = await transaction.business.findUnique({
    where: { id: businessId },
    select: { timezone: true },
  });
  if (!business) {
    throw new PayrollProfileWriteError("NOT_FOUND", "Business was not found.");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    month: "2-digit",
    timeZone: business.timezone || "Asia/Kuching",
    year: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return new Date(Date.UTC(year, month - 1, 1));
}

export function normalizeOptionalIdentifier(
  value: string | null | undefined,
) {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

export function parseCanonicalCommand<
  TSchema extends z.ZodTypeAny,
>(schema: TSchema, value: unknown): z.output<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new PayrollProfileWriteError(
      "VALIDATION_ERROR",
      result.error.issues[0]?.message ?? "Payroll profile input is invalid.",
    );
  }
  return result.data;
}

export async function writeCanonicalPayrollProfileAudit(
  input: Parameters<typeof writeSensitiveAuditLog>[0],
  transaction: Prisma.TransactionClient,
) {
  try {
    await writeSensitiveAuditLog(input, transaction);
  } catch (error) {
    if (isSerializableConflict(error)) {
      throw error;
    }
    throw new PayrollProfileWriteError(
      "AUDIT_FAILED",
      "Payroll profile audit could not be recorded. No change was saved.",
    );
  }
}

async function assertCanonicalAuthorization(
  context: PayrollProfileWriteContext,
  capabilities: readonly [BusinessCapability, BusinessCapability],
  transaction: Prisma.TransactionClient,
) {
  if (
    !capabilities.every((capability) =>
      hasBusinessCapability(context.access, capability),
    )
  ) {
    throw new PayrollProfileWriteError(
      "ACCESS_DENIED",
      "Payroll profile editing is not permitted.",
    );
  }
  if (
    !context.access.granted ||
    context.access.userId !== context.actor.userId
  ) {
    throw new PayrollProfileWriteError(
      "ACCESS_DENIED",
      "Payroll profile editing is not permitted.",
    );
  }
  if (!context.access.granted || context.access.businessId !== context.businessId) {
    throw new PayrollProfileWriteError(
      "NOT_FOUND",
      "Employee membership was not found in the selected business.",
    );
  }
  const activeBranches = await transaction.branch.findMany({
    where: { businessId: context.businessId, status: "ACTIVE" },
    select: { id: true },
  });
  const allowed = new Set(context.allowedBranchIds);
  const wholeBusiness =
    activeBranches.length === allowed.size &&
    activeBranches.every((branch) => allowed.has(branch.id)) &&
    !(
      context.access.effectiveBusinessRole === "STAFF" &&
      !context.access.permissions.includes("ALL_BRANCHES")
    );
  if (!wholeBusiness) {
    throw new PayrollProfileWriteError(
      "ACCESS_DENIED",
      "Payroll profile editing requires whole-business payroll scope.",
    );
  }
}

async function findCommandRecord(
  context: PayrollProfileWriteContext,
  commandId: string,
  database: PrismaClient | Prisma.TransactionClient,
) {
  return database.payrollProfileCommandRecord.findUnique({
    where: {
      businessId_actorUserId_commandId: {
        actorUserId: context.actor.userId,
        businessId: context.businessId,
        commandId,
      },
    },
  });
}

async function findCommandReplay<TResult extends CanonicalCommandResult>(
  input: ExecuteInput<TResult>,
  fingerprint: string,
  database: PrismaClient,
) {
  const existing = await findCommandRecord(
    input.context,
    input.command.commandId,
    database,
  );
  return existing
    ? validateCommandReplay<TResult>(existing, input, fingerprint)
    : null;
}

function validateCommandReplay<TResult extends CanonicalCommandResult>(
  existing: {
    commandFingerprint: string;
    domain: PayrollProfileCommandDomain;
    membershipId: string;
    result: Prisma.JsonValue;
  },
  input: ExecuteInput<TResult>,
  fingerprint: string,
) {
  if (
    existing.commandFingerprint !== fingerprint ||
    existing.domain !== input.domain ||
    existing.membershipId !== input.command.membershipId
  ) {
    throw new PayrollProfileWriteError(
      "DUPLICATE_COMMAND",
      "This command ID was already used for a different payroll profile change.",
    );
  }
  return {
    ...(existing.result as TResult),
    commandReplay: true,
  };
}

function commandFingerprint(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Prisma.Decimal.isDecimal(value)) return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isSerializableConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

function normalizeCanonicalError(error: unknown) {
  if (error instanceof PayrollProfileWriteError || error instanceof z.ZodError) {
    return error;
  }
  if (isSerializableConflict(error)) {
    return new PayrollProfileWriteError(
      "CONFLICT",
      "The payroll profile changed concurrently. Reload and try again.",
    );
  }
  return error;
}
