import {
  Prisma,
  type EmployeeCompensationReasonType,
  type EmployeeCompensationSource,
  type EmployeePayBasis,
  type PrismaClient,
} from "@prisma/client";
import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import type { AuditRequestContext, WriteAuditLogInput } from "@/lib/audit";
import { sanitizeAuditReason } from "@/lib/audit/sanitize";
import { writeSensitiveAuditLog } from "@/lib/audit/payroll-sensitive";
import { prisma } from "@/lib/prisma";

type CompensationDatabase = PrismaClient | Prisma.TransactionClient;
type CompensationActor = NonNullable<WriteAuditLogInput["actor"]>;

export type ResolvedCompensationVersion = {
  versionId: string;
  effectiveFromMonth: Date;
  payBasis: EmployeePayBasis;
  baseRate: Prisma.Decimal;
  source: EmployeeCompensationSource;
};

export type CompensationWriteAuthorization = {
  access: ResolvedBusinessAccess;
  allowedBranchIds: readonly string[];
};

type CompensationWriteInput = {
  actor: CompensationActor;
  authorization: CompensationWriteAuthorization;
  baseRate: Prisma.Decimal | number | string;
  businessId: string;
  effectiveFromMonth: Date;
  membershipId: string;
  payBasis: EmployeePayBasis;
  reasonNote?: string | null;
  reasonType: EmployeeCompensationReasonType;
  request?: AuditRequestContext;
  source: EmployeeCompensationSource;
  projectionMonth?: Date;
  skipAudit?: boolean;
};

export function payrollMonthStart(value: Date) {
  if (Number.isNaN(value.getTime())) {
    throw new Error("Compensation effective month is invalid.");
  }
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

export function currentPayrollMonthStart(now = new Date()) {
  return payrollMonthStart(now);
}

export async function resolveEmployeeCompensationVersion(
  input: {
    businessId: string;
    membershipId: string;
    payrollPeriodStart: Date;
  },
  database: CompensationDatabase = prisma,
): Promise<ResolvedCompensationVersion> {
  const periodMonth = payrollMonthStart(input.payrollPeriodStart);
  const version = await database.employeeCompensationVersion.findFirst({
    where: {
      businessId: input.businessId,
      effectiveFromMonth: { lte: periodMonth },
      membershipId: input.membershipId,
      status: "ACTIVE",
    },
    orderBy: [
      { effectiveFromMonth: "desc" },
      { createdAt: "desc" },
      { id: "desc" },
    ],
    select: {
      baseRate: true,
      effectiveFromMonth: true,
      id: true,
      payBasis: true,
      source: true,
    },
  });

  if (!version) {
    throw new Error(
      "No verified compensation version exists for this payroll period.",
    );
  }

  return {
    baseRate: version.baseRate,
    effectiveFromMonth: version.effectiveFromMonth,
    payBasis: version.payBasis,
    source: version.source,
    versionId: version.id,
  };
}

export async function writeEmployeeCompensationVersionInTransaction(
  input: CompensationWriteInput,
  transaction: Prisma.TransactionClient,
) {
  await assertCompensationWriteAuthorization(input, transaction);
  const effectiveFromMonth = payrollMonthStart(input.effectiveFromMonth);
  if (effectiveFromMonth.getTime() !== input.effectiveFromMonth.getTime()) {
    throw new Error("Compensation must take effect on the first day of a month.");
  }

  const baseRate = new Prisma.Decimal(input.baseRate);
  if (baseRate.isNegative()) {
    throw new Error("Base rate cannot be negative.");
  }

  const membership = await transaction.employeeBusinessMembership.findFirst({
    where: { businessId: input.businessId, id: input.membershipId },
    select: { id: true },
  });
  if (!membership) {
    throw new Error("Employee membership was not found in the selected business.");
  }

  const existing = await transaction.employeeCompensationVersion.findFirst({
    where: {
      effectiveFromMonth,
      membershipId: input.membershipId,
      status: "ACTIVE",
    },
    select: {
      baseRate: true,
      id: true,
      payBasis: true,
    },
  });

  if (
    existing &&
    existing.payBasis === input.payBasis &&
    existing.baseRate.equals(baseRate)
  ) {
    await synchronizeMembershipCompensationProjection(
      input.businessId,
      input.membershipId,
      transaction,
      input.projectionMonth,
    );
    return transaction.employeeCompensationVersion.findUniqueOrThrow({
      where: { id: existing.id },
    });
  }

  const changedFields = existing
    ? [
        ...(existing.payBasis === input.payBasis ? [] : ["payBasis"]),
        ...(existing.baseRate.equals(baseRate) ? [] : ["baseRate"]),
      ]
    : ["payBasis", "baseRate"];
  const now = new Date();

  if (existing) {
    await transaction.employeeCompensationVersion.update({
      where: { id: existing.id },
      data: {
        status: "SUPERSEDED",
        supersededAt: now,
        supersededById: input.actor.userId,
      },
    });
  }

  const created = await transaction.employeeCompensationVersion.create({
    data: {
      baseRate,
      businessId: input.businessId,
      createdById: input.actor.userId,
      effectiveFromMonth,
      membershipId: input.membershipId,
      payBasis: input.payBasis,
      reasonNote: input.reasonNote
        ? sanitizeAuditReason(input.reasonNote)
        : null,
      reasonType: input.reasonType,
      source: input.source,
      supersedesVersionId: existing?.id ?? null,
    },
  });

  await synchronizeMembershipCompensationProjection(
    input.businessId,
    input.membershipId,
    transaction,
    input.projectionMonth,
  );

  if (!input.skipAudit) await writeSensitiveAuditLog(
    {
      action: existing
        ? "EMPLOYEE_COMPENSATION_VERSION_SUPERSEDED"
        : "EMPLOYEE_COMPENSATION_VERSION_CREATED",
      actor: input.actor,
      businessId: input.businessId,
      entityId: created.id,
      entityType: "EmployeeCompensationVersion",
      metadata: {
        baseRate: "[REDACTED]",
        changedFields,
        effectiveMonth: effectiveFromMonth.toISOString().slice(0, 7),
        membershipId: input.membershipId,
        newVersionId: created.id,
        oldVersionId: existing?.id ?? null,
        payBasis: input.payBasis,
        reasonNote: input.reasonNote
          ? sanitizeAuditReason(input.reasonNote)
          : null,
        reasonType: input.reasonType,
        source: input.source,
      },
      request: input.request,
      summary: existing
        ? "Employee compensation version superseded."
        : "Employee compensation version created.",
    },
    transaction,
  );

  return created;
}

export async function synchronizeMembershipCompensationProjection(
  businessId: string,
  membershipId: string,
  transaction: Prisma.TransactionClient,
  asOfPayrollMonth = currentPayrollMonthStart(),
) {
  const currentMonth = payrollMonthStart(asOfPayrollMonth);
  const applicable = await transaction.employeeCompensationVersion.findFirst({
    where: {
      businessId,
      effectiveFromMonth: { lte: currentMonth },
      membershipId,
      status: "ACTIVE",
    },
    orderBy: [
      { effectiveFromMonth: "desc" },
      { createdAt: "desc" },
      { id: "desc" },
    ],
    select: { baseRate: true, payBasis: true },
  });

  if (!applicable) return null;

  await transaction.$executeRaw`SELECT set_config('tetamu.payroll_profile_command', 'on', true)`;
  await transaction.employeeBusinessMembership.update({
    where: { id: membershipId },
    data: {
      baseSalary: applicable.baseRate,
      payBasis: applicable.payBasis,
    },
  });
  return applicable;
}

async function assertCompensationWriteAuthorization(
  input: Pick<
    CompensationWriteInput,
    "authorization" | "businessId"
  >,
  transaction: Prisma.TransactionClient,
) {
  if (
    !hasBusinessCapability(input.authorization.access, "VIEW_COMPENSATION") ||
    !hasBusinessCapability(input.authorization.access, "EDIT_COMPENSATION")
  ) {
    throw new Error("Compensation editing is not permitted.");
  }

  const access = input.authorization.access;
  if (!access.granted || access.businessId !== input.businessId) {
    throw new Error("Employee membership was not found in the selected business.");
  }

  const activeBranches = await transaction.branch.findMany({
    where: { businessId: input.businessId, status: "ACTIVE" },
    select: { id: true },
  });
  const allowedBranchIds = new Set(input.authorization.allowedBranchIds);
  const wholeBusiness =
    allowedBranchIds.size === activeBranches.length &&
    activeBranches.every((branch) => allowedBranchIds.has(branch.id)) &&
    !(
      access.effectiveBusinessRole === "STAFF" &&
      !access.permissions.includes("ALL_BRANCHES")
    );

  if (!wholeBusiness) {
    throw new Error("Compensation editing requires whole-business payroll scope.");
  }
}
