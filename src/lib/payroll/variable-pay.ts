import type {
  PayrollCorrection,
  PayrollEntryComponentType,
  PayrollVariablePay,
  PayrollVariablePayOrigin,
  PayrollVariablePayType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import type { AppSession } from "@/lib/auth/session";
import type { AuditRequestContext } from "@/lib/audit";
import { writeSensitiveAuditLog } from "@/lib/audit/payroll-sensitive";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";
import type { PayrollComponentLine } from "@/lib/payroll/component-calculation";
import { prisma } from "@/lib/prisma";

type PayrollActor = Pick<AppSession, "userId" | "name" | "email">;
export type P4CWriteContext = {
  businessId: string;
  actor: PayrollActor;
  capabilities: readonly BusinessCapability[];
  request?: AuditRequestContext;
};

type P4CAuditContext = Pick<P4CWriteContext, "businessId" | "actor" | "request">;

type VariablePayCommand = {
  membershipId: string;
  type: PayrollVariablePayType;
  name: unknown;
  amount: unknown;
  earnedPeriodStart: unknown;
  earnedPeriodEnd: unknown;
  payrollPeriod: unknown;
  origin?: PayrollVariablePayOrigin;
  sourceReference?: unknown;
  reason: unknown;
};

export async function createPayrollVariablePay(
  context: P4CWriteContext,
  command: VariablePayCommand,
  database: PrismaClient = prisma,
) {
  assertP4CEdit(context);
  const input = parseVariablePay(command);
  return database.$transaction(async (transaction) => {
    await requireMembership(transaction, context.businessId, input.membershipId);
    const record = await transaction.payrollVariablePay.create({
      data: { ...input, businessId: context.businessId, createdById: context.actor.userId },
    });
    await writeP4CAudit(transaction, context, "PAYROLL_VARIABLE_PAY_CREATED", "PayrollVariablePay", record.id, {
      category: record.type,
      origin: record.origin,
      payrollPeriod: monthKey(record.payrollPeriodStart),
      amount: "[REDACTED]",
    });
    return record;
  }, { isolationLevel: "Serializable" });
}

export async function editPayrollVariablePay(
  context: P4CWriteContext,
  command: VariablePayCommand & { variablePayId: string; expectedRevision: number },
  database: PrismaClient = prisma,
) {
  assertP4CEdit(context);
  const input = parseVariablePay(command);
  return database.$transaction(async (transaction) => {
    const current = await transaction.payrollVariablePay.findFirst({
      where: { id: command.variablePayId, businessId: context.businessId, membershipId: input.membershipId, status: "DRAFT", revision: command.expectedRevision },
    });
    if (!current) throw new Error("The editable variable pay record was not found or changed.");
    const record = await transaction.payrollVariablePay.update({
      where: { id: current.id },
      data: { ...input, revision: { increment: 1 } },
    });
    await writeP4CAudit(transaction, context, "PAYROLL_VARIABLE_PAY_EDITED", "PayrollVariablePay", record.id, {
      category: record.type,
      changed: true,
      amount: "[REDACTED]",
    });
    return record;
  }, { isolationLevel: "Serializable" });
}

export async function approvePayrollVariablePay(
  context: P4CWriteContext,
  input: { variablePayId: string; expectedRevision: number },
  database: PrismaClient = prisma,
) {
  assertP4CApprove(context);
  return database.$transaction(async (transaction) => {
    const current = await transaction.payrollVariablePay.findFirst({
      where: { id: input.variablePayId, businessId: context.businessId, status: "DRAFT", revision: input.expectedRevision },
    });
    if (!current) throw new Error("The approvable variable pay record was not found or changed.");
    if (current.createdById === context.actor.userId) throw new Error("The variable pay submitter cannot approve their own record.");
    const record = await transaction.payrollVariablePay.update({
      where: { id: current.id },
      data: { status: "APPROVED", approvedAt: new Date(), approvedById: context.actor.userId, revision: { increment: 1 } },
    });
    await writeP4CAudit(transaction, context, "PAYROLL_VARIABLE_PAY_APPROVED", "PayrollVariablePay", record.id, {
      category: record.type,
      amount: "[REDACTED]",
    });
    return record;
  }, { isolationLevel: "Serializable" });
}

export async function cancelPayrollVariablePay(
  context: P4CWriteContext,
  input: { variablePayId: string; expectedRevision: number; reason: unknown },
  database: PrismaClient = prisma,
) {
  assertP4CEdit(context);
  const reason = requiredText(input.reason, "Cancellation reason", 5, 500);
  return database.$transaction(async (transaction) => {
    const current = await transaction.payrollVariablePay.findFirst({
      where: { id: input.variablePayId, businessId: context.businessId, status: { in: ["DRAFT", "APPROVED"] }, revision: input.expectedRevision, appliedPayrollEntryId: null },
    });
    if (!current) throw new Error("The cancellable variable pay record was not found or changed.");
    const record = await transaction.payrollVariablePay.update({
      where: { id: current.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: context.actor.userId, cancellationReason: reason, revision: { increment: 1 } },
    });
    await writeP4CAudit(transaction, context, "PAYROLL_VARIABLE_PAY_CANCELLED", "PayrollVariablePay", record.id, {
      category: record.type,
      cancellationReasonRecorded: true,
      amount: "[REDACTED]",
    });
    return record;
  }, { isolationLevel: "Serializable" });
}

export async function createPayrollCorrection(
  context: P4CWriteContext,
  command: {
    originalPayrollEntryId: string;
    applyToPeriod: unknown;
    originalAmount: unknown;
    correctedAmount: unknown;
    name: unknown;
    sourceReference?: unknown;
    reason: unknown;
  },
  database: PrismaClient = prisma,
) {
  assertP4CEdit(context);
  const originalAmountCents = parseNonnegativeMoney(command.originalAmount, "Original amount");
  const correctedAmountCents = parseNonnegativeMoney(command.correctedAmount, "Corrected amount");
  if (originalAmountCents === correctedAmountCents) throw new Error("A zero-delta correction cannot be created.");
  const deltaType: PayrollEntryComponentType = correctedAmountCents > originalAmountCents ? "EARNING" : "DEDUCTION";
  const deltaAmountCents = Math.abs(correctedAmountCents - originalAmountCents);
  const applyToPeriodStart = parseMonth(command.applyToPeriod, "Apply-to payroll period");
  const reason = requiredText(command.reason, "Correction reason", 5, 500);
  const name = requiredText(command.name, "Correction description", 2, 120);
  const sourceReference = optionalText(command.sourceReference, 160);
  return database.$transaction(async (transaction) => {
    const original = await transaction.payrollEntry.findFirst({
      where: { id: command.originalPayrollEntryId, businessId: context.businessId, payrollRun: { status: "FINALIZED" } },
      select: { id: true, membershipId: true },
    });
    if (!original) throw new Error("The finalized original payroll entry was not found.");
    const record = await transaction.payrollCorrection.create({
      data: {
        businessId: context.businessId,
        membershipId: original.membershipId,
        originalPayrollEntryId: original.id,
        applyToPeriodStart,
        originalAmount: centsToMoney(originalAmountCents),
        correctedAmount: centsToMoney(correctedAmountCents),
        deltaType,
        deltaAmount: centsToMoney(deltaAmountCents),
        code: deltaType === "EARNING" ? "SALARY_ARREARS" : "PAYROLL_RECOVERY",
        name,
        sourceReference,
        reason,
        createdById: context.actor.userId,
      },
    });
    await writeP4CAudit(transaction, context, "PAYROLL_CORRECTION_CREATED", "PayrollCorrection", record.id, {
      deltaType,
      amount: "[REDACTED]",
      originalPayrollEntryId: original.id,
      applyToPeriod: monthKey(applyToPeriodStart),
    });
    return record;
  }, { isolationLevel: "Serializable" });
}

export async function approvePayrollCorrection(
  context: P4CWriteContext,
  input: { correctionId: string; expectedRevision: number },
  database: PrismaClient = prisma,
) {
  assertP4CApprove(context);
  return database.$transaction(async (transaction) => {
    const current = await transaction.payrollCorrection.findFirst({
      where: { id: input.correctionId, businessId: context.businessId, status: "DRAFT", revision: input.expectedRevision },
    });
    if (!current) throw new Error("The approvable payroll correction was not found or changed.");
    if (current.createdById === context.actor.userId) throw new Error("The correction submitter cannot approve their own record.");
    const record = await transaction.payrollCorrection.update({
      where: { id: current.id },
      data: { status: "APPROVED", approvedAt: new Date(), approvedById: context.actor.userId, revision: { increment: 1 } },
    });
    await writeP4CAudit(transaction, context, "PAYROLL_CORRECTION_APPROVED", "PayrollCorrection", record.id, {
      deltaType: record.deltaType,
      amount: "[REDACTED]",
    });
    return record;
  }, { isolationLevel: "Serializable" });
}

export async function cancelPayrollCorrection(
  context: P4CWriteContext,
  input: { correctionId: string; expectedRevision: number; reason: unknown },
  database: PrismaClient = prisma,
) {
  assertP4CEdit(context);
  const reason = requiredText(input.reason, "Cancellation reason", 5, 500);
  return database.$transaction(async (transaction) => {
    const current = await transaction.payrollCorrection.findFirst({
      where: { id: input.correctionId, businessId: context.businessId, status: { in: ["DRAFT", "APPROVED"] }, revision: input.expectedRevision, appliedPayrollEntryId: null },
    });
    if (!current) throw new Error("The cancellable payroll correction was not found or changed.");
    const record = await transaction.payrollCorrection.update({
      where: { id: current.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: context.actor.userId, cancellationReason: reason, revision: { increment: 1 } },
    });
    await writeP4CAudit(transaction, context, "PAYROLL_CORRECTION_CANCELLED", "PayrollCorrection", record.id, {
      deltaType: record.deltaType,
      cancellationReasonRecorded: true,
      amount: "[REDACTED]",
    });
    return record;
  }, { isolationLevel: "Serializable" });
}

export async function resolveP4CSourcesForPayroll(
  transaction: Prisma.TransactionClient,
  input: { businessId: string; runId: string; periodStart: Date; membershipIds: string[] },
) {
  const [variablePay, corrections] = await Promise.all([
    transaction.payrollVariablePay.findMany({
      where: {
        businessId: input.businessId,
        membershipId: { in: input.membershipIds },
        payrollPeriodStart: input.periodStart,
        OR: [
          { status: "APPROVED" },
          { status: "APPLIED", appliedPayrollEntry: { payrollRunId: input.runId } },
        ],
      },
      orderBy: [{ membershipId: "asc" }, { type: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    }),
    transaction.payrollCorrection.findMany({
      where: {
        businessId: input.businessId,
        membershipId: { in: input.membershipIds },
        applyToPeriodStart: input.periodStart,
        OR: [
          { status: "APPROVED" },
          { status: "APPLIED", appliedPayrollEntry: { payrollRunId: input.runId } },
        ],
      },
      orderBy: [{ membershipId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    }),
  ]);
  return {
    variablePayByMembership: groupByMembership(variablePay),
    correctionsByMembership: groupByMembership(corrections),
  };
}

export function buildP4CComponentLines(input: {
  variablePay: readonly PayrollVariablePay[];
  corrections: readonly PayrollCorrection[];
}): PayrollComponentLine[] {
  const variableLines = input.variablePay.map((source, index): PayrollComponentLine => ({
    lineKey: `VARIABLE:${source.id.toUpperCase()}`,
    type: variablePayComponentType(source.type),
    code: source.code,
    name: source.name,
    amountCents: moneyToCents(source.amount),
    currency: "MYR",
    sourceType: "VARIABLE_PAY",
    sourceId: source.id,
    sourceVersionId: null,
    sourceRevision: source.status === "APPLIED" ? source.revision - 1 : source.revision,
    effectiveFromMonth: source.payrollPeriodStart,
    calculationBasis: `FROZEN_${source.type}`,
    origin: "SYSTEM",
    reason: null,
    sourceReason: source.reason,
    sortOrder: 5000 + index,
  }));
  const correctionLines = input.corrections.map((source, index): PayrollComponentLine => ({
    lineKey: `CORRECTION:${source.id.toUpperCase()}`,
    type: source.deltaType,
    code: source.code,
    name: source.name,
    amountCents: moneyToCents(source.deltaAmount),
    currency: "MYR",
    sourceType: "CORRECTION",
    sourceId: source.id,
    sourceVersionId: null,
    sourceRevision: source.status === "APPLIED" ? source.revision - 1 : source.revision,
    effectiveFromMonth: source.applyToPeriodStart,
    calculationBasis: "APPROVED_DELTA",
    origin: "SYSTEM",
    reason: null,
    sourceReason: source.reason,
    sortOrder: 6000 + index,
  }));
  return [...variableLines, ...correctionLines];
}

export async function markP4CSourcesApplied(
  transaction: Prisma.TransactionClient,
  input: {
    entryId: string;
    variablePay: readonly PayrollVariablePay[];
    corrections: readonly PayrollCorrection[];
    audit: P4CAuditContext;
  },
) {
  for (const source of input.variablePay) {
    if (source.status === "APPROVED") {
      const result = await transaction.payrollVariablePay.updateMany({
        where: { id: source.id, status: "APPROVED", revision: source.revision, appliedPayrollEntryId: null },
        data: { status: "APPLIED", appliedPayrollEntryId: input.entryId, revision: { increment: 1 } },
      });
      if (result.count !== 1) throw new Error("Variable pay changed while the payroll draft was generated.");
      await writeP4CAudit(transaction, input.audit, "PAYROLL_VARIABLE_PAY_APPLIED", "PayrollVariablePay", source.id, {
        category: source.type,
        amount: "[REDACTED]",
        payrollEntryId: input.entryId,
      });
    } else if (source.appliedPayrollEntryId !== input.entryId) {
      throw new Error("Variable pay was already applied to another payroll entry.");
    }
  }
  for (const source of input.corrections) {
    if (source.status === "APPROVED") {
      const result = await transaction.payrollCorrection.updateMany({
        where: { id: source.id, status: "APPROVED", revision: source.revision, appliedPayrollEntryId: null },
        data: { status: "APPLIED", appliedPayrollEntryId: input.entryId, revision: { increment: 1 } },
      });
      if (result.count !== 1) throw new Error("Payroll correction changed while the payroll draft was generated.");
      await writeP4CAudit(transaction, input.audit, "PAYROLL_CORRECTION_APPLIED", "PayrollCorrection", source.id, {
        deltaType: source.deltaType,
        amount: "[REDACTED]",
        payrollEntryId: input.entryId,
      });
    } else if (source.appliedPayrollEntryId !== input.entryId) {
      throw new Error("Payroll correction was already applied to another payroll entry.");
    }
  }
}

function parseVariablePay(command: VariablePayCommand) {
  const name = requiredText(command.name, "Variable pay description", 2, 120);
  const reason = requiredText(command.reason, "Variable pay reason", 5, 500);
  const sourceReference = optionalText(command.sourceReference, 160);
  const earnedPeriodStart = parseDate(command.earnedPeriodStart, "Earned period start");
  const earnedPeriodEnd = parseDate(command.earnedPeriodEnd, "Earned period end");
  if (earnedPeriodStart > earnedPeriodEnd) throw new Error("Earned period start must not be after its end.");
  return {
    membershipId: command.membershipId,
    type: command.type,
    code: variablePayCode(command.type),
    name,
    amount: centsToMoney(parsePositiveMoney(command.amount, "Variable pay amount")),
    currency: "MYR",
    earnedPeriodStart,
    earnedPeriodEnd,
    payrollPeriodStart: parseMonth(command.payrollPeriod, "Payroll period"),
    origin: command.origin ?? "MANUAL",
    sourceReference,
    reason,
  };
}

function variablePayCode(type: PayrollVariablePayType) {
  return type;
}

function variablePayComponentType(type: PayrollVariablePayType): PayrollEntryComponentType {
  return type === "ONE_OFF_DEDUCTION" || type === "RECOVERY" ? "DEDUCTION" : "EARNING";
}

function assertP4CEdit(context: P4CWriteContext) {
  if (!context.capabilities.includes("VIEW_COMPENSATION") || !context.capabilities.includes("EDIT_PAYROLL_ENTRY")) {
    throw new Error("Variable pay and payroll corrections require payroll entry and compensation access.");
  }
}

function assertP4CApprove(context: P4CWriteContext) {
  if (!context.capabilities.includes("VIEW_COMPENSATION") || !context.capabilities.includes("APPROVE_PAYROLL")) {
    throw new Error("Variable pay and payroll correction approval requires payroll approval access.");
  }
}

async function requireMembership(transaction: Prisma.TransactionClient, businessId: string, membershipId: string) {
  const membership = await transaction.employeeBusinessMembership.findFirst({ where: { id: membershipId, businessId }, select: { id: true } });
  if (!membership) throw new Error("The employee membership was not found in this business.");
}

async function writeP4CAudit(
  transaction: Prisma.TransactionClient,
  context: P4CAuditContext,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  await writeSensitiveAuditLog({
    businessId: context.businessId,
    actor: context.actor,
    request: context.request,
    action,
    entityType,
    entityId,
    summary: `${entityType === "PayrollCorrection" ? "Payroll correction" : "Variable pay"} lifecycle updated.`,
    metadata: metadata as never,
  }, transaction);
}

function groupByMembership<T extends { membershipId: string }>(items: readonly T[]) {
  const result = new Map<string, T[]>();
  for (const item of items) result.set(item.membershipId, [...(result.get(item.membershipId) ?? []), item]);
  return result;
}

function requiredText(value: unknown, label: string, minimum: number, maximum: number) {
  const text = String(value ?? "").trim();
  if (text.length < minimum || text.length > maximum) throw new Error(`${label} must be ${minimum} to ${maximum} characters.`);
  return text;
}

function optionalText(value: unknown, maximum: number) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length > maximum) throw new Error(`Reference must not exceed ${maximum} characters.`);
  return text;
}

function parseMonth(value: unknown, label: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) throw new Error(`${label} must use YYYY-MM.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2020 || year > 2100 || month < 1 || month > 12) throw new Error(`${label} is outside the supported range.`);
  return new Date(Date.UTC(year, month - 1, 1));
}

function parseDate(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} must use YYYY-MM-DD.`);
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== text) throw new Error(`${label} is invalid.`);
  return date;
}

function parsePositiveMoney(value: unknown, label: string) {
  const cents = parseMoney(value, label);
  if (cents <= 0) throw new Error(`${label} must be greater than zero.`);
  return cents;
}

function parseNonnegativeMoney(value: unknown, label: string) {
  return parseMoney(value, label);
}

function parseMoney(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error(`${label} must be a non-negative MYR amount with up to two decimals.`);
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error(`${label} is outside the supported range.`);
  return cents;
}

function moneyToCents(value: { toString(): string }) {
  return parseNonnegativeMoney(value.toString(), "Payroll amount");
}

function centsToMoney(cents: number) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function monthKey(value: Date) {
  return value.toISOString().slice(0, 7);
}
