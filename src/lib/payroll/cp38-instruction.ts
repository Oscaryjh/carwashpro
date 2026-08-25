import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

export const CP38_BLOCKERS = {
  AMBIGUOUS_ACTIVE_REVISION: "CP38_ACTIVE_INSTRUCTION_AMBIGUOUS",
  INVALID_AMOUNT: "CP38_INSTRUCTION_AMOUNT_INVALID",
} as const;

export const cp38InstructionInputSchema = z.object({
  businessId: z.string().uuid(),
  membershipId: z.string().uuid(),
  instructionReference: z.string().trim().min(1).max(120),
  effectiveFromMonth: z.coerce.date(),
  effectiveToMonth: z.coerce.date().nullable().optional().default(null),
  monthlyAmountCents: z.number().int().positive(),
  evidenceReference: z.string().trim().min(1).max(500),
  revision: z.number().int().positive(),
  recordedById: z.string().uuid(),
});

export type Cp38InstructionRecord = {
  id: string;
  instructionReference: string;
  effectiveFromMonth: Date;
  effectiveToMonth: Date | null;
  monthlyAmount: { toString(): string };
  status: "ACTIVE" | "PAUSED" | "COMPLETED";
  revision: number;
  evidenceReference: string;
  sourceDigest: string;
};

export function resolveCp38ForPeriod(
  records: readonly Cp38InstructionRecord[],
  payrollMonth: Date,
):
  | { status: "CLEAR"; amountCents: 0; instructions: [] }
  | {
      status: "APPLICABLE";
      amountCents: number;
      instructions: Array<{
        id: string;
        instructionReference: string;
        revision: number;
        amountCents: number;
        evidenceReference: string;
        sourceDigest: string;
      }>;
    }
  | { status: "BLOCKED"; blocker: string } {
  const period = Date.UTC(
    payrollMonth.getUTCFullYear(),
    payrollMonth.getUTCMonth(),
    1,
  );
  const active = records.filter((record) =>
    record.status === "ACTIVE" &&
    record.effectiveFromMonth.getTime() <= period &&
    (!record.effectiveToMonth || record.effectiveToMonth.getTime() >= period)
  );
  const references = new Map<string, Cp38InstructionRecord[]>();
  for (const record of active) {
    const group = references.get(record.instructionReference) ?? [];
    group.push(record);
    references.set(record.instructionReference, group);
  }
  if ([...references.values()].some((group) => group.length > 1)) {
    return { status: "BLOCKED", blocker: CP38_BLOCKERS.AMBIGUOUS_ACTIVE_REVISION };
  }
  const instructions = active.map((record) => {
    const amountCents = moneyToCents(record.monthlyAmount);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new Error(CP38_BLOCKERS.INVALID_AMOUNT);
    }
    return {
      id: record.id,
      instructionReference: record.instructionReference,
      revision: record.revision,
      amountCents,
      evidenceReference: record.evidenceReference,
      sourceDigest: record.sourceDigest,
    };
  });
  if (instructions.length === 0) {
    return { status: "CLEAR", amountCents: 0, instructions: [] };
  }
  return {
    status: "APPLICABLE",
    amountCents: instructions.reduce((total, item) => total + item.amountCents, 0),
    instructions,
  };
}

export function cp38InstructionSourceDigest(
  input: z.infer<typeof cp38InstructionInputSchema>,
) {
  return createHash("sha256")
    .update(JSON.stringify({
      businessId: input.businessId,
      membershipId: input.membershipId,
      instructionReference: input.instructionReference,
      effectiveFromMonth: monthKey(input.effectiveFromMonth),
      effectiveToMonth: input.effectiveToMonth
        ? monthKey(input.effectiveToMonth)
        : null,
      monthlyAmountCents: input.monthlyAmountCents,
      evidenceReference: input.evidenceReference,
      revision: input.revision,
    }))
    .digest("hex");
}

type Cp38WriteDatabase = {
  employeeCp38Instruction: {
    findFirst(args: unknown): Promise<{ id: string; revision: number } | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
    create(args: unknown): Promise<unknown>;
  };
};

export async function recordCp38Instruction(
  database: Cp38WriteDatabase,
  rawInput: z.input<typeof cp38InstructionInputSchema>,
) {
  const input = cp38InstructionInputSchema.parse(rawInput);
  const from = firstOfMonth(input.effectiveFromMonth);
  const to = input.effectiveToMonth
    ? firstOfMonth(input.effectiveToMonth)
    : null;
  if (to && to < from) throw new Error("CP38_ENDS_BEFORE_START");
  const previous = await database.employeeCp38Instruction.findFirst({
    where: {
      businessId: input.businessId,
      membershipId: input.membershipId,
      instructionReference: input.instructionReference,
    },
    orderBy: { revision: "desc" },
    select: { id: true, revision: true },
  });
  const expectedRevision = (previous?.revision ?? 0) + 1;
  if (input.revision !== expectedRevision) {
    throw new Error("CP38_REVISION_CONFLICT");
  }
  await database.employeeCp38Instruction.updateMany({
    where: {
      businessId: input.businessId,
      membershipId: input.membershipId,
      instructionReference: input.instructionReference,
      status: "ACTIVE",
    },
    data: { status: "COMPLETED" },
  });
  const canonicalInput = { ...input, effectiveFromMonth: from, effectiveToMonth: to };
  return database.employeeCp38Instruction.create({
    data: {
      businessId: input.businessId,
      membershipId: input.membershipId,
      instructionReference: input.instructionReference,
      effectiveFromMonth: from,
      effectiveToMonth: to,
      monthlyAmount: (input.monthlyAmountCents / 100).toFixed(2),
      status: "ACTIVE",
      evidenceReference: input.evidenceReference,
      revision: input.revision,
      recordedById: input.recordedById,
      sourceDigest: cp38InstructionSourceDigest(canonicalInput),
    } satisfies Prisma.EmployeeCp38InstructionUncheckedCreateInput,
  });
}

function moneyToCents(value: { toString(): string }) {
  return Math.round(Number(value.toString()) * 100);
}

function monthKey(value: Date) {
  return value.toISOString().slice(0, 7);
}

function firstOfMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}
