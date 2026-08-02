import type { PayrollRunStatus, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type RunsDatabase = Pick<PrismaClient, "payrollRun" | "payrollEntry">;

export const PAYROLL_RUNS_PAGE_SIZE = 12;
export const PAYROLL_ENTRIES_PAGE_SIZE = 20;
export const PAYROLL_ENTRY_SEARCH_LIMIT = 80;

export type PayrollRunListItem = {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  status: PayrollRunStatus;
  employeeCount: number;
  grossPayroll: number;
  netPayroll: number;
  updatedAt: Date;
};

export type PayrollRunsListData = {
  runs: PayrollRunListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type PayrollRunEntryRow = {
  id: string;
  membershipId: string;
  employeeCode: string;
  fullName: string;
  payBasis: string;
  attendanceDays: number;
  regularMinutes: number;
  overtimeMinutes: number;
  publicHolidayMinutes: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  grossPay: number;
  netPay: number;
};

export type PayrollRunDetailData = {
  run: {
    id: string;
    periodStart: Date;
    periodEnd: Date;
    status: PayrollRunStatus;
    workingDaysPerMonth: number;
    normalWorkMinutesPerDay: number;
    breakMinutesPerDay: number;
    employeeCount: number;
    grossPayroll: number;
    netPayroll: number;
    submittedAt: Date | null;
    finalizedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  entries: PayrollRunEntryRow[];
  query: string;
  page: number;
  pageSize: number;
  totalEntries: number;
  totalPages: number;
};

export async function loadPayrollRunsList(
  businessId: string,
  requestedPage: number,
  database: RunsDatabase = prisma,
): Promise<PayrollRunsListData> {
  const total = await database.payrollRun.count({ where: { businessId } });
  const totalPages = pageCount(total, PAYROLL_RUNS_PAGE_SIZE);
  const page = clampPage(requestedPage, totalPages);
  const runs = await database.payrollRun.findMany({
    where: { businessId },
    orderBy: [{ periodStart: "desc" }, { updatedAt: "desc" }],
    skip: (page - 1) * PAYROLL_RUNS_PAGE_SIZE,
    take: PAYROLL_RUNS_PAGE_SIZE,
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      updatedAt: true,
      entries: { select: { grossPay: true, netPay: true } },
    },
  });

  return {
    runs: runs.map((run) => ({
      id: run.id,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      status: run.status,
      employeeCount: run.entries.length,
      grossPayroll: sumMoney(run.entries, "grossPay"),
      netPayroll: sumMoney(run.entries, "netPay"),
      updatedAt: run.updatedAt,
    })),
    page,
    pageSize: PAYROLL_RUNS_PAGE_SIZE,
    total,
    totalPages,
  };
}

export async function loadPayrollRunDetail(
  businessId: string,
  runId: string,
  rawQuery: string | undefined,
  requestedPage: number,
  database: RunsDatabase = prisma,
): Promise<PayrollRunDetailData | null> {
  const run = await database.payrollRun.findFirst({
    where: { id: runId, businessId },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      workingDaysPerMonthSnapshot: true,
      normalWorkMinutesPerDaySnapshot: true,
      breakMinutesPerDaySnapshot: true,
      submittedAt: true,
      finalizedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!run) return null;

  const query = normalizePayrollEntrySearch(rawQuery);
  const entryWhere = {
    businessId,
    payrollRunId: runId,
    ...(query
      ? {
          OR: [
            { fullNameSnapshot: { contains: query, mode: "insensitive" as const } },
            { employeeCodeSnapshot: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [allTotals, totalEntries] = await Promise.all([
    database.payrollEntry.aggregate({
      where: { businessId, payrollRunId: runId },
      _count: { _all: true },
      _sum: { grossPay: true, netPay: true },
    }),
    database.payrollEntry.count({ where: entryWhere }),
  ]);
  const totalPages = pageCount(totalEntries, PAYROLL_ENTRIES_PAGE_SIZE);
  const page = clampPage(requestedPage, totalPages);
  const entries = await database.payrollEntry.findMany({
    where: entryWhere,
    orderBy: [{ fullNameSnapshot: "asc" }, { employeeCodeSnapshot: "asc" }],
    skip: (page - 1) * PAYROLL_ENTRIES_PAGE_SIZE,
    take: PAYROLL_ENTRIES_PAGE_SIZE,
    select: {
      id: true,
      membershipId: true,
      employeeCodeSnapshot: true,
      fullNameSnapshot: true,
      payBasisSnapshot: true,
      attendanceDays: true,
      regularMinutes: true,
      overtimeMinutes: true,
      publicHolidayMinutes: true,
      paidLeaveDays: true,
      unpaidLeaveDays: true,
      grossPay: true,
      netPay: true,
    },
  });

  return {
    run: {
      id: run.id,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      status: run.status,
      workingDaysPerMonth: run.workingDaysPerMonthSnapshot,
      normalWorkMinutesPerDay: run.normalWorkMinutesPerDaySnapshot,
      breakMinutesPerDay: run.breakMinutesPerDaySnapshot,
      employeeCount: allTotals._count._all,
      grossPayroll: money(allTotals._sum.grossPay),
      netPayroll: money(allTotals._sum.netPay),
      submittedAt: run.submittedAt,
      finalizedAt: run.finalizedAt,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    },
    entries: entries.map((entry) => ({
      id: entry.id,
      membershipId: entry.membershipId,
      employeeCode: entry.employeeCodeSnapshot,
      fullName: entry.fullNameSnapshot,
      payBasis: entry.payBasisSnapshot,
      attendanceDays: entry.attendanceDays,
      regularMinutes: entry.regularMinutes,
      overtimeMinutes: entry.overtimeMinutes,
      publicHolidayMinutes: entry.publicHolidayMinutes,
      paidLeaveDays: money(entry.paidLeaveDays),
      unpaidLeaveDays: money(entry.unpaidLeaveDays),
      grossPay: money(entry.grossPay),
      netPay: money(entry.netPay),
    })),
    query,
    page,
    pageSize: PAYROLL_ENTRIES_PAGE_SIZE,
    totalEntries,
    totalPages,
  };
}

export function parsePayrollPage(value?: string) {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function normalizePayrollEntrySearch(value?: string) {
  return (value ?? "").trim().replace(/\s+/g, " ").slice(0, PAYROLL_ENTRY_SEARCH_LIMIT);
}

function pageCount(total: number, size: number) {
  return Math.max(1, Math.ceil(total / size));
}

function clampPage(page: number, totalPages: number) {
  return Math.min(Math.max(1, page), totalPages);
}

function money(value: { toString(): string } | null | undefined) {
  return value ? Number(value.toString()) : 0;
}

function sumMoney(
  entries: Array<{ grossPay: { toString(): string }; netPay: { toString(): string } }>,
  field: "grossPay" | "netPay",
) {
  return entries.reduce((total, entry) => total + money(entry[field]), 0);
}
