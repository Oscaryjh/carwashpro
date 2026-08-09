import type {
  PayrollRunStatus,
  PayrollStatutorySubmissionStatus,
  PrismaClient,
} from "@prisma/client";
import { parsePayrollMonth } from "@/lib/payroll/service";
import { prisma } from "@/lib/prisma";

type WorkspaceDatabase = Pick<PrismaClient, "payrollRun" | "payrollStatutorySubmission">;

export type PayrollWorkspaceRun = {
  id: string;
  month: string;
  periodStart: Date;
  periodEnd: Date;
  status: PayrollRunStatus;
  employeeCount: number;
  grossPayroll: number;
  netPayroll: number;
  updatedAt: Date;
};

export type PayrollWorkspaceData = {
  currentMonth: string;
  currentPeriodStart: Date;
  currentRun: PayrollWorkspaceRun | null;
  recentRuns: Array<
    Pick<
      PayrollWorkspaceRun,
      "id" | "month" | "periodStart" | "status" | "employeeCount" | "updatedAt"
    >
  >;
};

export async function loadPayrollWorkspace(
  businessId: string,
  month?: string,
  database: WorkspaceDatabase = prisma,
): Promise<PayrollWorkspaceData> {
  const period = parsePayrollMonth(month);
  const [currentRun, recentRuns] = await Promise.all([
    database.payrollRun.findUnique({
      where: {
        businessId_periodStart_periodEnd: {
          businessId,
          periodStart: period.start,
          periodEnd: period.end,
        },
      },
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        status: true,
        updatedAt: true,
        entries: {
          select: { grossPay: true, netPay: true },
        },
      },
    }),
    database.payrollRun.findMany({
      where: { businessId },
      orderBy: [{ periodStart: "desc" }, { updatedAt: "desc" }],
      take: 6,
      select: {
        id: true,
        periodStart: true,
        status: true,
        updatedAt: true,
        _count: { select: { entries: true } },
      },
    }),
  ]);

  return {
    currentMonth: period.value,
    currentPeriodStart: period.start,
    currentRun: currentRun
      ? {
          id: currentRun.id,
          month: monthValue(currentRun.periodStart),
          periodStart: currentRun.periodStart,
          periodEnd: currentRun.periodEnd,
          status: currentRun.status,
          employeeCount: currentRun.entries.length,
          grossPayroll: sumMoney(currentRun.entries, "grossPay"),
          netPayroll: sumMoney(currentRun.entries, "netPay"),
          updatedAt: currentRun.updatedAt,
        }
      : null,
    recentRuns: recentRuns.map((run) => ({
      id: run.id,
      month: monthValue(run.periodStart),
      periodStart: run.periodStart,
      status: run.status,
      employeeCount: run._count.entries,
      updatedAt: run.updatedAt,
    })),
  };
}

export async function loadPayrollWorkspaceStatutoryStatuses(
  businessId: string,
  payrollRunId: string,
  database: WorkspaceDatabase = prisma,
) {
  const submissions = await database.payrollStatutorySubmission.findMany({
    where: { businessId, payrollRunId },
    select: { integrityStatus: true, status: true },
  });
  return submissions.map((submission) =>
    submission.integrityStatus === "LEGACY_UNVERIFIED"
      ? "LEGACY_UNVERIFIED" as const
      : submission.status,
  );
}

export function payrollCalculationLabel(status?: PayrollRunStatus | null) {
  if (status === "DRAFT") return "Draft";
  if (status === "REVIEW") return "Awaiting review";
  if (status === "FINALIZED") return "Calculations locked";
  return "Not generated";
}

export function payrollCalculationDescription(status?: PayrollRunStatus | null) {
  if (status === "DRAFT") {
    return "Employee calculations are still being prepared on the existing Monthly Payroll page.";
  }
  if (status === "REVIEW") {
    return "The calculations are awaiting review. Payment and statutory submission remain separate.";
  }
  if (status === "FINALIZED") {
    return "The calculations are locked. This does not mean employees have been paid.";
  }
  return "No payroll calculation exists for this period yet.";
}

export function payrollPrimaryActionLabel(
  status: PayrollRunStatus | null | undefined,
  monthLabel: string,
  canEdit: boolean,
) {
  if (status === "DRAFT") {
    return canEdit ? `Continue ${monthLabel} draft` : `View ${monthLabel} draft`;
  }
  if (status === "REVIEW") return "View payroll awaiting review";
  if (status === "FINALIZED") return "View locked payroll";
  return canEdit ? `Open ${monthLabel} payroll setup` : `View ${monthLabel} payroll`;
}

export function payrollPayslipLabel(
  status: PayrollRunStatus | null | undefined,
  canViewPayslip: boolean,
  publishedCount = 0,
  employeeCount = 0,
) {
  if (!canViewPayslip) return "Restricted";
  if (status !== "FINALIZED") return "Not available";
  return publishedCount > 0
    ? `${publishedCount} of ${employeeCount} published`
    : "Ready to publish";
}

export function payrollStatutoryLabel(
  runStatus: PayrollRunStatus | null | undefined,
  statuses: readonly (PayrollStatutorySubmissionStatus | "LEGACY_UNVERIFIED")[] | null,
) {
  if (statuses === null) return "Restricted";
  if (runStatus !== "FINALIZED") return "Not available";
  if (!statuses.length) return "Not exported";
  if (statuses.includes("LEGACY_UNVERIFIED")) return "Legacy unverified";
  if (statuses.includes("DRAFT")) return "Correction pending";
  if (statuses.includes("REJECTED")) return "Rejected";
  if (statuses.every((status) => status === "ACCEPTED")) return "Accepted";
  if (statuses.some((status) => status === "SUBMITTED" || status === "ACCEPTED")) {
    return "Submitted";
  }
  return "Exported";
}

function monthValue(date: Date) {
  return date.toISOString().slice(0, 7);
}

function sumMoney(
  entries: Array<{ grossPay: { toString(): string }; netPay: { toString(): string } }>,
  field: "grossPay" | "netPay",
) {
  return entries.reduce((sum, entry) => sum + Number(entry[field].toString()), 0);
}
