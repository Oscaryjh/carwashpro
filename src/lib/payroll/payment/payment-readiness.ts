import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertPaymentAuthorization } from "./payment-command";
import { PayrollPaymentError, type PayrollPaymentContext } from "./types";

export type PaymentReadinessDto = {
  blockedCount: number;
  blockerCounts: Partial<Record<string, number>>;
  calculationDigest: string;
  entryCount: number;
  excludedCount: number;
  readyCount: number;
  runId: string;
  totalReadyAmount: string;
};

export type PaymentReadinessInstructionInput = {
  bankAccountVersion: BankVersionForPayment | null;
  blockerCode: string | null;
  employeeCode: string;
  employeeMembershipId: string;
  employeeName: string;
  netPay: Prisma.Decimal;
  payrollEntryId: string;
  status: "BLOCKED" | "READY" | "EXCLUDED";
};

type BankVersionForPayment = {
  accountHolderName: string;
  accountNumberAuthTag: Uint8Array;
  accountNumberCiphertext: Uint8Array;
  accountNumberFingerprintHmac: string;
  accountNumberIv: Uint8Array;
  accountNumberLast4: string;
  bankCode: string;
  bankNameSnapshot: string;
  businessId: string;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  employeeMembershipId: string;
  encryptionKeyVersion: string;
  id: string;
  status: string;
  verificationStatus: string;
};

export type InternalPaymentReadiness = PaymentReadinessDto & {
  instructions: PaymentReadinessInstructionInput[];
  paymentDate: Date;
};

export async function evaluatePayrollPaymentReadiness(
  context: PayrollPaymentContext,
  runId: string,
  database: PrismaClient = prisma,
): Promise<PaymentReadinessDto> {
  return database.$transaction(async (transaction) => {
    await assertPaymentAuthorization(context, "VIEW_PAYMENT_BATCH", transaction);
    const result = await evaluatePayrollPaymentReadinessInTransaction(
      { businessId: context.businessId, runId },
      transaction,
    );
    return {
      blockedCount: result.blockedCount,
      blockerCounts: result.blockerCounts,
      calculationDigest: result.calculationDigest,
      entryCount: result.entryCount,
      excludedCount: result.excludedCount,
      readyCount: result.readyCount,
      runId: result.runId,
      totalReadyAmount: result.totalReadyAmount,
    };
  });
}

export async function evaluatePayrollPaymentReadinessInTransaction(
  input: { businessId: string; runId: string; excludeBatchId?: string },
  transaction: Prisma.TransactionClient,
): Promise<InternalPaymentReadiness> {
  const run = await transaction.payrollRun.findFirst({
    where: { businessId: input.businessId, id: input.runId },
    select: {
      finalizedAt: true,
      id: true,
      periodEnd: true,
      periodStart: true,
      status: true,
      entries: {
        orderBy: [{ employeeCodeSnapshot: "asc" }, { id: "asc" }],
        select: {
          businessId: true,
          employeeCodeSnapshot: true,
          fullNameSnapshot: true,
          id: true,
          membershipId: true,
          netPay: true,
        },
      },
    },
  });
  if (!run) throw new PayrollPaymentError("NOT_FOUND", "Payroll run was not found.");
  if (run.status !== "FINALIZED") {
    throw new PayrollPaymentError("VALIDATION_ERROR", "Payment readiness requires a finalized payroll run.");
  }
  const paymentDate = new Date(run.periodEnd.getTime() - 1);
  const membershipIds = run.entries.map((entry) => entry.membershipId);
  const [bankVersions, existingAllocations] = await Promise.all([
    transaction.employeeBankAccountVersion.findMany({
      where: {
        businessId: input.businessId,
        employeeMembershipId: { in: membershipIds },
        isPrimary: true,
      },
      orderBy: [{ employeeMembershipId: "asc" }, { effectiveFrom: "desc" }, { revision: "desc" }],
    }),
    transaction.payrollPaymentInstruction.findMany({
      where: {
        businessId: input.businessId,
        payrollEntryId: { in: run.entries.map((entry) => entry.id) },
        paymentBatch: {
          id: input.excludeBatchId ? { not: input.excludeBatchId } : undefined,
          status: { in: ["DRAFT", "AWAITING_APPROVAL", "APPROVED", "INSTRUCTION_READY"] },
        },
      },
      select: { payrollEntryId: true },
    }),
  ]);
  const allocatedEntryIds = new Set(existingAllocations.map((item) => item.payrollEntryId));
  const instructions = run.entries.map((entry): PaymentReadinessInstructionInput => {
    const versions = bankVersions.filter(
      (version) => version.employeeMembershipId === entry.membershipId,
    );
    const applicable = versions.find(
      (version) =>
        (version.status === "ACTIVE" || version.status === "SUPERSEDED") &&
        version.effectiveFrom <= paymentDate &&
        (!version.effectiveUntil || version.effectiveUntil > paymentDate),
    ) as BankVersionForPayment | undefined;
    const netCents = moneyToCents(entry.netPay);
    const amountClassification = classifyPaymentNetAmount(netCents);
    let status: PaymentReadinessInstructionInput["status"] =
      amountClassification?.status ?? "READY";
    let blockerCode: string | null = amountClassification?.blockerCode ?? null;

    if (!amountClassification) {
      if (allocatedEntryIds.has(entry.id)) {
        status = "BLOCKED";
        blockerCode = "DUPLICATE_PAYMENT_ALLOCATION";
      } else if (!applicable) {
        status = "BLOCKED";
        blockerCode = classifyMissingBankVersion(versions, paymentDate);
      } else if (applicable.verificationStatus !== "MANUALLY_VERIFIED") {
        status = "BLOCKED";
        blockerCode = "BANK_ACCOUNT_UNVERIFIED";
      }
    }

    return {
      bankAccountVersion: applicable ?? null,
      blockerCode,
      employeeCode: entry.employeeCodeSnapshot,
      employeeMembershipId: entry.membershipId,
      employeeName: entry.fullNameSnapshot,
      netPay: entry.netPay,
      payrollEntryId: entry.id,
      status,
    };
  });
  const ready = instructions.filter((item) => item.status === "READY");
  const blocked = instructions.filter((item) => item.status === "BLOCKED");
  const excluded = instructions.filter((item) => item.status === "EXCLUDED");
  const blockerCounts: Partial<Record<string, number>> = {};
  for (const item of blocked) {
    if (item.blockerCode) blockerCounts[item.blockerCode] = (blockerCounts[item.blockerCode] ?? 0) + 1;
  }
  const calculationDigest = createHash("sha256")
    .update(
      JSON.stringify({
        finalizedAt: run.finalizedAt?.toISOString() ?? null,
        paymentDate: paymentDate.toISOString(),
        periodStart: run.periodStart.toISOString(),
        runId: run.id,
        entries: run.entries.map((entry) => ({ id: entry.id, membershipId: entry.membershipId, netPay: moneyToCents(entry.netPay) })),
      }),
    )
    .digest("hex");
  return {
    blockedCount: blocked.length,
    blockerCounts,
    calculationDigest,
    entryCount: instructions.length,
    excludedCount: excluded.length,
    instructions,
    paymentDate,
    readyCount: ready.length,
    runId: run.id,
    totalReadyAmount: centsToMoney(ready.reduce((sum, item) => sum + moneyToCents(item.netPay), 0)),
  };
}

export function classifyPaymentNetAmount(netCents: number): {
  blockerCode: "NET_PAY_NEGATIVE" | null;
  status: "BLOCKED" | "EXCLUDED";
} | null {
  if (netCents === 0) return { blockerCode: null, status: "EXCLUDED" };
  if (netCents < 0) return { blockerCode: "NET_PAY_NEGATIVE", status: "BLOCKED" };
  return null;
}

function classifyMissingBankVersion(versions: BankVersionForPayment[], paymentDate: Date) {
  if (!versions.length) return "MISSING_BANK_ACCOUNT";
  if (versions.some((version) => version.status === "ACTIVE" && version.effectiveFrom > paymentDate)) {
    return "BANK_ACCOUNT_NOT_EFFECTIVE";
  }
  return "BANK_ACCOUNT_INACTIVE";
}

function moneyToCents(value: { toString(): string }) {
  const normalized = value.toString();
  const sign = normalized.startsWith("-") ? -1 : 1;
  const [wholePart, decimalPart = ""] = normalized.replace(/^-/, "").split(".");
  return sign * (Number(wholePart) * 100 + Number(`${decimalPart}00`.slice(0, 2)));
}

function centsToMoney(cents: number) {
  return `${Math.trunc(cents / 100)}.${String(Math.abs(cents % 100)).padStart(2, "0")}`;
}
