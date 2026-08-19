import type { PrismaClient } from "@prisma/client";
import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import {
  getPayrollPeriodReadiness,
  type PayrollReadinessSeverity,
  type PayrollReadinessStatus,
} from "@/lib/payroll/readiness";
import { prisma } from "@/lib/prisma";

type Input = {
  access: ResolvedBusinessAccess;
  allowedBranchIds: readonly string[];
  businessId: string;
  membershipId: string;
};

export type EmployeePayrollSummaryResult =
  | { status: "HIDDEN" | "ACCESS_DENIED" }
  | {
      status: "READY";
      data: {
        currentMonth: string;
        readiness: PayrollReadinessStatus;
        issues: Array<{ severity: PayrollReadinessSeverity; message: string }>;
        recentRuns: Array<{
          id: string;
          periodStart: Date;
          status: "DRAFT" | "REVIEW" | "FINALIZED";
          grossPay: number;
          netPay: number;
          variablePay: number;
          corrections: number;
        }>;
      };
    };

export async function loadEmployeePayrollSummary(
  input: Input,
  database: PrismaClient = prisma,
): Promise<EmployeePayrollSummaryResult> {
  if (!hasBusinessCapability(input.access, "VIEW_PAYROLL_RUN")) {
    return { status: "HIDDEN" };
  }
  if (!input.access.granted) return { status: "ACCESS_DENIED" };
  const activeBranchCount = await database.branch.count({
    where: { businessId: input.businessId, status: "ACTIVE" },
  });
  if (
    input.allowedBranchIds.length !== activeBranchCount ||
    (input.access.effectiveBusinessRole === "STAFF" &&
      !input.access.permissions.includes("ALL_BRANCHES"))
  ) {
    return { status: "ACCESS_DENIED" };
  }
  const business = await database.business.findUnique({
    where: { id: input.businessId },
    select: { timezone: true },
  });
  if (!business) return { status: "ACCESS_DENIED" };
  const currentMonth = payrollMonthInTimezone(business.timezone || "Asia/Kuala_Lumpur");
  const [entries, readiness] = await Promise.all([
    database.payrollEntry.findMany({
      where: { businessId: input.businessId, membershipId: input.membershipId },
      orderBy: { payrollRun: { periodStart: "desc" } },
      take: 6,
      select: {
        id: true,
        grossPay: true,
        netPay: true,
        payrollRun: { select: { id: true, periodStart: true, status: true } },
        components: {
          where: { sourceType: { in: ["VARIABLE_PAY", "CORRECTION"] } },
          select: { amount: true, sourceType: true, type: true },
        },
      },
    }),
    getPayrollPeriodReadiness(
      { businessId: input.businessId, month: currentMonth },
      database,
    ),
  ]);
  const employeeReadiness = readiness.employees.find(
    (employee) => employee.membershipId === input.membershipId,
  );
  return {
    status: "READY",
    data: {
      currentMonth,
      readiness: employeeReadiness?.status ?? "BLOCKED",
      issues: employeeReadiness?.issues.map((issue) => ({
        severity: issue.severity,
        message: issue.message,
      })) ?? [{ severity: "BLOCKING", message: "Employee is not eligible for this payroll period." }],
      recentRuns: entries.map((entry) => ({
        id: entry.payrollRun.id,
        periodStart: entry.payrollRun.periodStart,
        status: entry.payrollRun.status,
        grossPay: Number(entry.grossPay),
        netPay: Number(entry.netPay),
        variablePay: signedComponentTotal(entry.components, "VARIABLE_PAY"),
        corrections: signedComponentTotal(entry.components, "CORRECTION"),
      })),
    },
  };
}

function signedComponentTotal(
  components: Array<{ amount: { toString(): string }; sourceType: string; type: string }>,
  sourceType: string,
) {
  return components.reduce((total, component) =>
    component.sourceType === sourceType
      ? total + Number(component.amount.toString()) * (component.type === "EARNING" ? 1 : -1)
      : total,
  0);
}

function payrollMonthInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}
