import { createHash } from "node:crypto";
import {
  FinancialOperationType,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const financialOperationKeySchema = z
  .string()
  .trim()
  .min(16, "Operation ID is too short.")
  .max(128, "Operation ID is too long.")
  .regex(/^[A-Za-z0-9._:-]+$/, "Operation ID contains unsupported characters.");

export class FinancialIdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD";

  constructor() {
    super("This operation ID was already used with different transaction details.");
  }
}

export type FinancialOperationResult<T> = {
  replayed: boolean;
  result: T;
};

type JsonObject = Record<string, unknown>;

type RunFinancialOperationInput<T extends JsonObject> = {
  actorUserId: string;
  branchId: string | null;
  businessId: string;
  execute: (transaction: Prisma.TransactionClient) => Promise<T>;
  operationKey: string;
  operationType: FinancialOperationType;
  payload: JsonObject;
};

const transactionOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 30_000,
} as const;
const MAX_SERIALIZABLE_ATTEMPTS = 5;

export function fingerprintFinancialRequest(payload: JsonObject) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)))
    .digest("hex");
}

export async function runFinancialOperation<T extends JsonObject>(
  input: RunFinancialOperationInput<T>,
  database: PrismaClient = prisma,
): Promise<FinancialOperationResult<T>> {
  const operationKey = financialOperationKeySchema.parse(input.operationKey);
  const requestFingerprint = fingerprintFinancialRequest(input.payload);
  const identity = {
    businessId: input.businessId,
    operationType: input.operationType,
    operationKey,
  };

  const replay = await resolveReplay<T>(database, identity, requestFingerprint);
  if (replay) return replay;

  for (let attempt = 0; attempt < MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await database.$transaction(async (transaction) => {
        const existing = await transaction.financialOperation.findUnique({
          where: { businessId_operationType_operationKey: identity },
        });
        if (existing) {
          return replayRecord<T>(existing, requestFingerprint);
        }

        const operation = await transaction.financialOperation.create({
          data: {
            actorUserId: input.actorUserId,
            branchId: input.branchId,
            businessId: input.businessId,
            operationKey,
            operationType: input.operationType,
            requestFingerprint,
          },
          select: { id: true },
        });
        const result = await input.execute(transaction);

        await transaction.financialOperation.update({
          where: { id: operation.id },
          data: {
            completedAt: new Date(),
            resultJson: result as Prisma.InputJsonValue,
            state: "COMPLETED",
          },
        });

        return { replayed: false, result };
      }, transactionOptions);
    } catch (error) {
      if (!isRetryableConcurrencyError(error)) throw error;

      const concurrentReplay = await resolveReplay<T>(
        database,
        identity,
        requestFingerprint,
      );
      if (concurrentReplay) return concurrentReplay;
      if (attempt === MAX_SERIALIZABLE_ATTEMPTS - 1) throw error;
      await retryBackoff(attempt);
    }
  }

  throw new Error("Financial operation retry limit exceeded.");
}

async function resolveReplay<T extends JsonObject>(
  database: PrismaClient,
  identity: {
    businessId: string;
    operationType: FinancialOperationType;
    operationKey: string;
  },
  requestFingerprint: string,
) {
  const existing = await database.financialOperation.findUnique({
    where: { businessId_operationType_operationKey: identity },
  });
  return existing ? replayRecord<T>(existing, requestFingerprint) : null;
}

function replayRecord<T extends JsonObject>(
  record: {
    requestFingerprint: string;
    state: string;
    resultJson: Prisma.JsonValue | null;
  },
  requestFingerprint: string,
): FinancialOperationResult<T> {
  if (record.requestFingerprint !== requestFingerprint) {
    throw new FinancialIdempotencyConflictError();
  }
  if (record.state !== "COMPLETED" || record.resultJson === null) {
    throw new Error("This financial operation is still processing. Please retry shortly.");
  }
  return { replayed: true, result: record.resultJson as T };
}

function isRetryableConcurrencyError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === "P2002" || error.code === "P2034");
}

async function retryBackoff(attempt: number) {
  const delayMs = Math.min(160, 10 * 2 ** attempt) + Math.floor(Math.random() * 10);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as JsonObject)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}
