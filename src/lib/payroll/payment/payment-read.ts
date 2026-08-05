import type {
  PayrollPaymentBatchStatus,
  PayrollPaymentBlockerCode,
  PayrollPaymentInstructionStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 12;
const INSTRUCTION_PAGE_SIZE = 20;

export const paymentInstructionStatuses = [
  "READY",
  "BLOCKED",
  "INCLUDED",
  "EXCLUDED",
] as const satisfies readonly PayrollPaymentInstructionStatus[];

export const paymentInstructionBlockers = [
  "MISSING_BANK_ACCOUNT",
  "BANK_ACCOUNT_UNVERIFIED",
  "BANK_ACCOUNT_INACTIVE",
  "BANK_ACCOUNT_NOT_EFFECTIVE",
  "NET_PAY_ZERO",
  "NET_PAY_NEGATIVE",
  "DUPLICATE_PAYMENT_ALLOCATION",
  "BUSINESS_MISMATCH",
] as const satisfies readonly PayrollPaymentBlockerCode[];

export const paymentBatchStatuses = [
  "DRAFT",
  "AWAITING_APPROVAL",
  "APPROVED",
  "INSTRUCTION_READY",
  "CANCELLED",
  "SUPERSEDED",
] as const satisfies readonly PayrollPaymentBatchStatus[];

export function parsePaymentPage(value: string | undefined) {
  const parsed = Number(value ?? "1");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function parsePaymentStatus(value: string | undefined) {
  return paymentBatchStatuses.includes(value as PayrollPaymentBatchStatus)
    ? (value as PayrollPaymentBatchStatus)
    : null;
}

export function parseInstructionSearch(value: string | undefined) {
  return value?.trim().slice(0, 80) ?? "";
}

export function parseInstructionStatus(value: string | undefined) {
  return paymentInstructionStatuses.includes(value as PayrollPaymentInstructionStatus)
    ? (value as PayrollPaymentInstructionStatus)
    : null;
}

export function parseInstructionBlocker(value: string | undefined) {
  return paymentInstructionBlockers.includes(value as PayrollPaymentBlockerCode)
    ? (value as PayrollPaymentBlockerCode)
    : null;
}

export async function loadPaymentBatches(
  businessId: string,
  page: number,
  status: PayrollPaymentBatchStatus | null,
  runId?: string,
) {
  const where = {
    businessId,
    ...(status ? { status } : {}),
    ...(runId ? { payrollRunId: runId } : {}),
  };
  const total = await prisma.payrollPaymentBatch.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const batches = await prisma.payrollPaymentBatch.findMany({
    where,
    orderBy: [
      { payrollRun: { periodStart: "desc" } },
      { revision: "desc" },
      { createdAt: "desc" },
    ],
    skip: (safePage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      approvedAt: true,
      batchNumber: true,
      batchType: true,
      blockedCount: true,
      createdAt: true,
      excludedCount: true,
      id: true,
      instructionCount: true,
      payrollRunId: true,
      readyCount: true,
      revision: true,
      status: true,
      totalReadyAmount: true,
      payrollRun: { select: { periodStart: true, status: true } },
    },
  });
  return {
    batches: batches.map((batch) => ({
      ...batch,
      totalReadyAmount: batch.totalReadyAmount.toString(),
    })),
    page: safePage,
    total,
    totalPages,
  };
}

export async function loadPaymentRun(businessId: string, runId: string) {
  return prisma.payrollRun.findFirst({
    where: { businessId, id: runId },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      _count: { select: { entries: true, paymentBatches: true } },
    },
  });
}

export async function loadPaymentBatchDetail(
  businessId: string,
  batchId: string,
  page: number,
  includeAudit: boolean,
  filters: {
    blocker: PayrollPaymentBlockerCode | null;
    query: string;
    status: PayrollPaymentInstructionStatus | null;
  } = { blocker: null, query: "", status: null },
) {
  const batch = await prisma.payrollPaymentBatch.findFirst({
    where: { businessId, id: batchId },
    select: {
      approvedAt: true,
      approvedBy: { select: { name: true } },
      batchNumber: true,
      batchType: true,
      blockedCount: true,
      cancelledAt: true,
      createdAt: true,
      createdById: true,
      createdBy: { select: { name: true } },
      currentArtifactId: true,
      excludedCount: true,
      id: true,
      instructionCount: true,
      payrollRunId: true,
      readyCount: true,
      reasonSafe: true,
      revision: true,
      status: true,
      submittedAt: true,
      submittedBy: { select: { name: true } },
      supersededById: true,
      supersedesBatchId: true,
      totalReadyAmount: true,
      payrollRun: { select: { periodStart: true, status: true } },
    },
  });
  if (!batch) return null;

  const instructionWhere: Prisma.PayrollPaymentInstructionWhereInput = {
    businessId,
    paymentBatchId: batchId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.blocker ? { blockerCode: filters.blocker } : {}),
    ...(filters.query
      ? {
          OR: [
            { employeeNameSnapshot: { contains: filters.query, mode: "insensitive" } },
            { employeeCodeSnapshot: { contains: filters.query, mode: "insensitive" } },
            { reference: { contains: filters.query, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const totalInstructions = await prisma.payrollPaymentInstruction.count({ where: instructionWhere });
  const totalPages = Math.max(1, Math.ceil(totalInstructions / INSTRUCTION_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const [instructions, events] = await Promise.all([
    prisma.payrollPaymentInstruction.findMany({
      where: instructionWhere,
      orderBy: [{ employeeCodeSnapshot: "asc" }, { id: "asc" }],
      skip: (safePage - 1) * INSTRUCTION_PAGE_SIZE,
      take: INSTRUCTION_PAGE_SIZE,
      select: {
        accountNumberLast4Snapshot: true,
        bankNameSnapshot: true,
        blockerCode: true,
        employeeCodeSnapshot: true,
        employeeMembershipId: true,
        employeeNameSnapshot: true,
        id: true,
        netPaySnapshot: true,
        reference: true,
        status: true,
      },
    }),
    includeAudit
      ? prisma.payrollPaymentEvent.findMany({
          where: { businessId, batchId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 30,
          select: {
            action: true,
            actor: { select: { name: true } },
            createdAt: true,
            id: true,
            reasonSafe: true,
          },
        })
      : Promise.resolve([]),
  ]);

  return {
    batch: { ...batch, totalReadyAmount: batch.totalReadyAmount.toString() },
    events,
    instructions: instructions.map((item) => ({
      ...item,
      netPaySnapshot: item.netPaySnapshot.toString(),
    })),
    page: safePage,
    totalInstructions,
    totalPages,
  };
}
