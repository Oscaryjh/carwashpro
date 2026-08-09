import type { PrismaClient } from "@prisma/client";
import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { DEFAULT_PAYROLL_SETTING } from "@/lib/payroll/service";
import { prisma } from "@/lib/prisma";

type EmployeeCompensationReadInput = {
  access: ResolvedBusinessAccess;
  allowedBranchIds: readonly string[];
  businessId: string;
  membershipId: string;
};

export type EmployeeCompensationSectionResult =
  | {
      status: "ACCESS_DENIED";
      reason: "CAPABILITY" | "WHOLE_BUSINESS_SCOPE";
    }
  | {
      status: "NOT_FOUND";
    }
  | {
      status: "READY";
      data: {
        id: string;
        canEdit: boolean;
        compensationRevision: number;
        recurringPayRevision: number;
        workTargetRevision: number;
        currentPayrollMonth: string;
        effectiveFromMonth: string | null;
        affectedDrafts: number;
        payBasis: "MONTHLY" | "DAILY" | "HOURLY";
        baseRate: string | null;
        nextScheduledCompensation: {
          baseRate: string;
          effectiveFromMonth: string;
          payBasis: "MONTHLY" | "DAILY" | "HOURLY";
        } | null;
        compensationHistory: Array<{
          baseRate: string;
          effectiveFromMonth: string;
          payBasis: "MONTHLY" | "DAILY" | "HOURLY";
          source: string;
          reasonType: string;
        }>;
        recurringPayComponents: Array<{
          amount: string | null;
          code: string;
          effectiveFromMonth: string;
          id: string;
          name: string;
          nextChange: {
            amount: string | null;
            effectiveFromMonth: string;
            name: string;
            state: "ACTIVE" | "ENDED";
          } | null;
          state: "ACTIVE" | "ENDED" | "SCHEDULED";
          type: "EARNING" | "DEDUCTION";
        }>;
        workingDaysPerMonth: number;
        normalWorkMinutesPerDay: number;
        normalWorkPolicySource:
          | "Employee profile"
          | "Company payroll settings"
          | "System default";
        targetBreakMinutes: number;
        targetBreakPolicySource:
          | "Employee profile"
          | "Company payroll settings"
          | "System default";
      };
    };

export async function loadEmployeeCompensationSection(
  input: EmployeeCompensationReadInput,
  database: PrismaClient = prisma,
): Promise<EmployeeCompensationSectionResult> {
  if (!hasBusinessCapability(input.access, "VIEW_COMPENSATION")) {
    return { status: "ACCESS_DENIED", reason: "CAPABILITY" };
  }

  const activeBranchCount = await database.branch.count({
    where: { businessId: input.businessId, status: "ACTIVE" },
  });
  const hasWholeBusinessScope =
    input.allowedBranchIds.length === activeBranchCount &&
    !(
      input.access.granted &&
      input.access.effectiveBusinessRole === "STAFF" &&
      !input.access.permissions.includes("ALL_BRANCHES")
    );

  if (!hasWholeBusinessScope) {
    return { status: "ACCESS_DENIED", reason: "WHOLE_BUSINESS_SCOPE" };
  }

  const business = await database.business.findUnique({
    where: { id: input.businessId },
    select: { timezone: true },
  });
  if (!business) return { status: "NOT_FOUND" };
  const currentMonth = payrollMonthInTimezone(business.timezone || "Asia/Kuching");

  const [membership, payrollSetting, currentVersion, recurringComponents, nextVersion, affectedDrafts, compensationHistory] = await Promise.all([
    database.employeeBusinessMembership.findFirst({
      where: {
        businessId: input.businessId,
        id: input.membershipId,
      },
      select: {
        id: true,
        compensationRevision: true,
        recurringPayRevision: true,
        workTargetRevision: true,
        payBasis: true,
        baseSalary: true,
        normalWorkMinutesPerDay: true,
        targetBreakMinutes: true,
      },
    }),
    database.payrollSetting.findUnique({
      where: { businessId: input.businessId },
      select: {
        workingDaysPerMonth: true,
        normalWorkMinutesPerDay: true,
        breakMinutesPerDay: true,
      },
    }),
    database.employeeCompensationVersion.findFirst({
      where: {
        businessId: input.businessId,
        membershipId: input.membershipId,
        status: "ACTIVE",
        effectiveFromMonth: { lte: currentMonth },
      },
      orderBy: [{ effectiveFromMonth: "desc" }, { createdAt: "desc" }],
      select: { baseRate: true, effectiveFromMonth: true, payBasis: true },
    }),
    database.employeeRecurringPayComponent.findMany({
      where: {
        businessId: input.businessId,
        membershipId: input.membershipId,
      },
      orderBy: [{ type: "asc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        type: true,
        versions: {
          where: { status: "CURRENT" },
          orderBy: [{ effectiveFromMonth: "asc" }, { revision: "asc" }],
          select: {
            amount: true,
            effectiveFromMonth: true,
            name: true,
            state: true,
          },
        },
      },
    }),
    database.employeeCompensationVersion.findFirst({
      where: {
        businessId: input.businessId,
        membershipId: input.membershipId,
        status: "ACTIVE",
        effectiveFromMonth: { gt: currentMonth },
      },
      orderBy: [{ effectiveFromMonth: "asc" }, { createdAt: "desc" }],
      select: { baseRate: true, effectiveFromMonth: true, payBasis: true },
    }),
    database.payrollRun.count({
      where: {
        businessId: input.businessId,
        status: "DRAFT",
        entries: { some: { membershipId: input.membershipId } },
      },
    }),
    typeof database.employeeCompensationVersion.findMany === "function"
      ? database.employeeCompensationVersion.findMany({
      where: {
        businessId: input.businessId,
        membershipId: input.membershipId,
        effectiveFromMonth: { lt: currentMonth },
      },
      orderBy: [{ effectiveFromMonth: "desc" }, { createdAt: "desc" }],
      take: 12,
      select: {
        baseRate: true,
        effectiveFromMonth: true,
        payBasis: true,
        reasonType: true,
        source: true,
      },
        })
      : Promise.resolve([]),
  ]);

  if (!membership) {
    return { status: "NOT_FOUND" };
  }

  const normalWorkPolicySource = membership.normalWorkMinutesPerDay !== null
    ? "Employee profile"
    : payrollSetting
      ? "Company payroll settings"
      : "System default";
  const targetBreakPolicySource = membership.targetBreakMinutes !== null
    ? "Employee profile"
    : payrollSetting
      ? "Company payroll settings"
      : "System default";

  return {
    status: "READY",
    data: {
      id: membership.id,
      canEdit: hasBusinessCapability(input.access, "EDIT_COMPENSATION"),
      compensationRevision: membership.compensationRevision,
      recurringPayRevision: membership.recurringPayRevision,
      workTargetRevision: membership.workTargetRevision,
      currentPayrollMonth: formatMonth(currentMonth),
      effectiveFromMonth: currentVersion
        ? formatMonth(currentVersion.effectiveFromMonth)
        : null,
      affectedDrafts,
      payBasis: currentVersion?.payBasis ?? membership.payBasis,
      baseRate: currentVersion?.baseRate.toString() ?? membership.baseSalary?.toString() ?? null,
      nextScheduledCompensation: nextVersion
        ? {
            baseRate: nextVersion.baseRate.toString(),
            effectiveFromMonth: formatMonth(nextVersion.effectiveFromMonth),
            payBasis: nextVersion.payBasis,
          }
        : null,
      compensationHistory: compensationHistory.map((version) => ({
        baseRate: version.baseRate.toString(),
        effectiveFromMonth: formatMonth(version.effectiveFromMonth),
        payBasis: version.payBasis,
        reasonType: version.reasonType,
        source: version.source,
      })),
      recurringPayComponents: recurringComponents.flatMap((component) => {
        const current = [...component.versions]
          .reverse()
          .find((version) => version.effectiveFromMonth <= currentMonth);
        const next = component.versions.find(
          (version) => version.effectiveFromMonth > currentMonth,
        );
        const displayed = current ?? next;
        if (!displayed) return [];
        return [{
          amount: displayed.state === "ACTIVE" ? displayed.amount.toString() : null,
          code: component.code,
          effectiveFromMonth: formatMonth(displayed.effectiveFromMonth),
          id: component.id,
          name: displayed.name,
          nextChange: current && next
            ? {
                amount: next.state === "ACTIVE" ? next.amount.toString() : null,
                effectiveFromMonth: formatMonth(next.effectiveFromMonth),
                name: next.name,
                state: next.state,
              }
            : null,
          state: current ? current.state : "SCHEDULED",
          type: component.type,
        }];
      }),
      workingDaysPerMonth:
        payrollSetting?.workingDaysPerMonth ??
        DEFAULT_PAYROLL_SETTING.workingDaysPerMonth,
      normalWorkMinutesPerDay:
        membership.normalWorkMinutesPerDay ??
        payrollSetting?.normalWorkMinutesPerDay ??
        DEFAULT_PAYROLL_SETTING.normalWorkMinutesPerDay,
      normalWorkPolicySource,
      targetBreakMinutes:
        membership.targetBreakMinutes ??
        payrollSetting?.breakMinutesPerDay ??
        DEFAULT_PAYROLL_SETTING.breakMinutesPerDay,
      targetBreakPolicySource,
    },
  };
}

function payrollMonthInTimezone(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return new Date(Date.UTC(year, month - 1, 1));
}

function formatMonth(value: Date) {
  return value.toISOString().slice(0, 7);
}
