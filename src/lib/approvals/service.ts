/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import {
  businessCapabilities,
  type BusinessCapability,
} from "@/lib/business-groups/capabilities";
import type { BusinessModuleContext } from "@/lib/modules/entitlements";
import type { ModuleKey } from "@/lib/modules/registry";
import {
  listAttendanceOvertimeCandidates,
  type OvertimeCandidate,
} from "@/lib/attendance/overtime-service";
import { getPayrollPeriodReadiness } from "@/lib/payroll/readiness";
import { prisma } from "@/lib/prisma";
import { getHrApprovalStages, type HrApprovalActorLevel } from "./policy-service";
import {
  approvalDomains,
  type ApprovalCounts,
  type ApprovalDomain,
  type ApprovalInboxFilters,
  type ApprovalInboxItem,
  type UnifiedApprovalInbox,
} from "./types";

export type UnifiedApprovalContext = Readonly<{
  actorUserId: string;
  businessId: string;
  allowedBranchIds: readonly string[];
  wholeBusinessScope: boolean;
  enabledModules: ReadonlySet<ModuleKey>;
  capabilities: ReadonlySet<BusinessCapability>;
  actorLevel?: HrApprovalActorLevel;
}>;

type ApprovalDatabase = PrismaClient;
type AdapterResult = { items: ApprovalInboxItem[]; total: number };

const EMPTY_COUNTS: ApprovalCounts = {
  ATTENDANCE: 0,
  LEAVE: 0,
  CLAIMS: 0,
  COMMISSION: 0,
  PAYROLL: 0,
  total: 0,
};

export async function resolveUnifiedApprovalContext(input: {
  access: ResolvedBusinessAccess;
  actorUserId: string;
  moduleContext: BusinessModuleContext;
  database?: ApprovalDatabase;
}): Promise<UnifiedApprovalContext | null> {
  const { access } = input;
  if (!access.granted || access.source === "PLATFORM_ADMIN" || !access.businessId) {
    return null;
  }

  const database = input.database ?? prisma;
  const allActiveBranches = await database.branch.findMany({
    where: { businessId: access.businessId, status: "ACTIVE" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const wholeBusinessScope =
    access.effectiveBusinessRole === "BUSINESS_OWNER" ||
    access.effectiveBusinessRole === "GROUP_MANAGER_READ_ONLY" ||
    (access.effectiveBusinessRole === "STAFF" && access.permissions.includes("ALL_BRANCHES"));
  const allowedBranchIds = wholeBusinessScope
    ? allActiveBranches.map((branch) => branch.id)
    : access.branchId && allActiveBranches.some((branch) => branch.id === access.branchId)
      ? [access.branchId]
      : [];

  return {
    actorUserId: input.actorUserId,
    businessId: access.businessId,
    allowedBranchIds,
    wholeBusinessScope,
    enabledModules: input.moduleContext.enabledModules,
    capabilities: new Set(
      businessCapabilities.filter((capability) =>
        hasBusinessCapability(access, capability),
      ),
    ),
    actorLevel: access.effectiveBusinessRole === "BUSINESS_OWNER" ? "OWNER" : "MANAGER",
  };
}

export function availableApprovalDomains(
  context: UnifiedApprovalContext,
): readonly ApprovalDomain[] {
  if (!context.enabledModules.has("HR")) return [];
  return approvalDomains.filter((domain) => domainAvailable(context, domain));
}

export function isUnifiedApprovalCenterAvailable(context: UnifiedApprovalContext) {
  return availableApprovalDomains(context).length > 0;
}

export async function getUnifiedApprovalInbox(
  context: UnifiedApprovalContext,
  filters: ApprovalInboxFilters = {},
  database: ApprovalDatabase = prisma,
): Promise<UnifiedApprovalInbox> {
  const pageSize = Math.min(50, Math.max(1, Math.floor(filters.pageSize ?? 20)));
  const page = Math.min(100, Math.max(1, Math.floor(filters.page ?? 1)));
  const fetchLimit = page * pageSize;
  const domains = availableApprovalDomains(context);
  const adapters = domains.map((domain) => ({
    domain,
    promise: loadDomain(domain, context, filters, fetchLimit, database),
  }));
  const settled = await Promise.allSettled(adapters.map((adapter) => adapter.promise));
  const counts = { ...EMPTY_COUNTS };
  const unavailableDomains: ApprovalDomain[] = [];
  const allItems: ApprovalInboxItem[] = [];

  settled.forEach((result, index) => {
    const domain = adapters[index].domain;
    if (result.status === "rejected") {
      unavailableDomains.push(domain);
      return;
    }
    counts[domain] = result.value.total;
    allItems.push(...result.value.items);
  });
  counts.total = approvalDomains.reduce((sum, domain) => sum + counts[domain], 0);

  const visibleItems = filters.domain
    ? allItems.filter((item) => item.domain === filters.domain)
    : allItems;
  visibleItems.sort(compareItems);
  const visibleTotal = filters.domain ? counts[filters.domain] : counts.total;
  const totalPages = Math.max(1, Math.ceil(visibleTotal / pageSize));
  const effectivePage = Math.min(page, totalPages);
  const start = (effectivePage - 1) * pageSize;
  return {
    items: visibleItems.slice(start, start + pageSize),
    counts,
    unavailableDomains,
    pagination: {
      page: effectivePage,
      pageSize,
      total: visibleTotal,
      totalPages,
    },
  };
}

export async function getUnifiedApprovalCounts(
  context: UnifiedApprovalContext,
  database: ApprovalDatabase = prisma,
) {
  const inbox = await getUnifiedApprovalInbox(
    context,
    { page: 1, pageSize: 1 },
    database,
  );
  return {
    counts: inbox.counts,
    complete: inbox.unavailableDomains.length === 0,
    unavailableDomains: inbox.unavailableDomains,
  };
}

function domainAvailable(context: UnifiedApprovalContext, domain: ApprovalDomain) {
  switch (domain) {
    case "ATTENDANCE":
      return context.capabilities.has("MODIFY_ATTENDANCE_EMPLOYEES");
    case "LEAVE":
      return context.capabilities.has("APPROVE_LEAVE");
    case "CLAIMS":
      return context.enabledModules.has("CLAIMS") && context.capabilities.has("REVIEW_CLAIM");
    case "COMMISSION":
      return context.enabledModules.has("COMMISSION") && context.capabilities.has("APPROVE_COMMISSION");
    case "PAYROLL":
      return context.enabledModules.has("PAYROLL") &&
        context.wholeBusinessScope &&
        context.capabilities.has("APPROVE_PAYROLL");
  }
}

function loadDomain(
  domain: ApprovalDomain,
  context: UnifiedApprovalContext,
  filters: ApprovalInboxFilters,
  limit: number,
  database: ApprovalDatabase,
): Promise<AdapterResult> {
  switch (domain) {
    case "ATTENDANCE": return loadAttendance(context, filters, limit, database);
    case "LEAVE": return loadLeave(context, filters, limit, database);
    case "CLAIMS": return loadClaims(context, filters, limit, database);
    case "COMMISSION": return loadCommission(context, filters, limit, database);
    case "PAYROLL": return loadPayroll(context, filters, limit, database);
  }
}

async function loadAttendance(
  context: UnifiedApprovalContext,
  filters: ApprovalInboxFilters,
  limit: number,
  database: ApprovalDatabase,
): Promise<AdapterResult> {
  const branchIds = scopedBranchIds(context, filters.branchId);
  if (!branchIds.length) return { items: [], total: 0 };
  const employee = normalizedEmployee(filters.employee);
  const dateWhere = dateRange(filters);
  const matchingMembers = employee
    ? await database.employeeBusinessMembership.findMany({
        where: {
          businessId: context.businessId,
          OR: employeeSearch(employee),
        },
        select: { id: true },
      })
    : [];
  const p2MembershipIds = employee ? matchingMembers.map((member) => member.id) : null;
  const memberWhere = employee
    ? { employee: { OR: employeeSearch(employee) } }
    : {};
  const p2Where = {
    businessId: context.businessId,
    branchId: { in: branchIds },
    status: { in: ["OPEN", "PENDING_EMPLOYEE", "PENDING_MANAGER"] },
    ...(p2MembershipIds ? { membershipId: { in: p2MembershipIds } } : {}),
    ...(dateWhere ? { workDate: dateWhere } : {}),
  } satisfies Prisma.AttendanceP2ExceptionWhereInput;
  const caseWhere = {
    businessId: context.businessId,
    branchId: { in: branchIds },
    status: { in: ["OPEN", "UNDER_REVIEW", "RETURNED_FOR_CORRECTION"] },
    ...(dateWhere ? { openedAt: dateWhere } : {}),
    ...memberWhere,
  } satisfies Prisma.AttendanceResolutionCaseWhereInput;
  const includeTimesheets = context.wholeBusinessScope && !filters.branchId && !employee;
  const overtimePeriodStart = filters.from ?? new Date("2000-01-01T00:00:00.000Z");
  const overtimePeriodEnd = filters.to ?? new Date("2100-01-01T00:00:00.000Z");
  const [p2Count, p2, caseCount, cases, timesheets, overtimeCandidates] = await Promise.all([
    database.attendanceP2Exception.count({ where: p2Where }),
    database.attendanceP2Exception.findMany({
      where: p2Where,
      select: {
        id: true,
        branchId: true,
        workDate: true,
        type: true,
        status: true,
        revision: true,
        detectedAt: true,
        exceptionMinutes: true,
        membershipId: true,
      },
      orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
      take: limit,
    }),
    database.attendanceResolutionCase.count({ where: caseWhere }),
    database.attendanceResolutionCase.findMany({
      where: caseWhere,
      select: {
        id: true,
        branchId: true,
        status: true,
        openedReason: true,
        openedAt: true,
        updatedAt: true,
        employee: { select: { id: true, fullName: true, employeeCode: true } },
        branch: { select: { name: true } },
        attendanceSession: { select: { workDate: true } },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit,
    }),
    includeTimesheets
      ? database.attendanceMonthlyTimesheet.findMany({
          where: {
            businessId: context.businessId,
            status: { in: ["DRAFT", "APPROVED"] },
            ...(dateWhere ? { periodStart: dateWhere } : {}),
          },
          include: {
            branchReadiness: { select: { status: true } },
          },
          orderBy: { periodStart: "asc" },
          take: 200,
        })
      : Promise.resolve([]),
    listAttendanceOvertimeCandidates({
      businessId: context.businessId,
      allowedBranchIds: branchIds,
      periodStart: overtimePeriodStart,
      periodEndExclusive: overtimePeriodEnd,
      database,
    }),
  ]);
  const actionableOvertime = overtimeCandidates.filter((candidate) => {
    if (candidate.employeeUserId === context.actorUserId) return false;
    if (employee) {
      const query = employee.toLocaleLowerCase("en");
      if (
        !candidate.employeeName.toLocaleLowerCase("en").includes(query) &&
        !candidate.employeeCode.toLocaleLowerCase("en").includes(query)
      ) return false;
    }
    return candidate.effectiveStatus === "PENDING_REVIEW";
  });
  const actionableTimesheets = timesheets.filter((timesheet) =>
    timesheet.status === "APPROVED" ||
    (timesheet.branchReadiness.length === context.allowedBranchIds.length &&
      timesheet.branchReadiness.every((branch) => branch.status === "READY")),
  );
  const [p2Members, p2Branches] = await Promise.all([
    database.employeeBusinessMembership.findMany({
      where: { businessId: context.businessId, id: { in: p2.map((row) => row.membershipId) } },
      select: { id: true, fullName: true, employeeCode: true },
    }),
    database.branch.findMany({
      where: { businessId: context.businessId, id: { in: p2.map((row) => row.branchId) } },
      select: { id: true, name: true },
    }),
  ]);
  const p2MemberById = new Map(p2Members.map((member) => [member.id, member]));
  const p2BranchById = new Map(p2Branches.map((branch) => [branch.id, branch]));
  return {
    total: p2Count + caseCount + actionableTimesheets.length + actionableOvertime.length,
    items: [
      ...p2.flatMap((row) => {
        const membership = p2MemberById.get(row.membershipId);
        const branch = p2BranchById.get(row.branchId);
        return membership && branch
          ? [projectAttendanceP2({ ...row, membership, branch }, context.businessId)]
          : [];
      }),
      ...cases.map((row) => projectAttendanceCase(row, context.businessId)),
      ...actionableOvertime.slice(0, limit).map((row) => projectAttendanceOvertime(row)),
      ...actionableTimesheets.map((row) => projectTimesheet(row, context.businessId)),
    ],
  };
}

export function projectAttendanceOvertime(row: OvertimeCandidate): ApprovalInboxItem {
  const blocked = Boolean(row.blockedReason);
  return {
    id: `ATTENDANCE:OT:${row.finalResultId}`,
    domain: "ATTENDANCE",
    businessId: row.businessId,
    branchId: row.branchId,
    branchName: row.branchName,
    subjectType: "ATTENDANCE_OVERTIME_REVIEW",
    subjectId: row.finalResultId,
    employeeId: row.membershipId,
    membershipId: row.membershipId,
    employeeName: row.employeeName,
    title: blocked ? "OT review blocked" : "Review potential OT",
    summary: `${row.employeeCode} · ${dateValue(row.workDate)} · ${row.potentialOtMinutes} potential minute(s) · ${humanize(row.context)}`,
    requestedAt: row.workDate,
    status: blocked ? "BLOCKED" : "PENDING",
    priority: "HIGH",
    requestedBy: row.membershipId,
    requestedByName: row.employeeName,
    amount: null,
    units: row.potentialOtMinutes,
    requiredCapability: "MODIFY_ATTENDANCE_EMPLOYEES",
    targetUrl: `/team/attendance/timesheets?month=${monthValue(row.workDate)}#overtime-review`,
    revision: row.review?.revision ?? 0,
    metadata: {
      overtimeContext: row.context,
      stale: row.stale,
      blockedReason: row.blockedReason,
    },
  };
}

async function loadLeave(
  context: UnifiedApprovalContext,
  filters: ApprovalInboxFilters,
  limit: number,
  database: ApprovalDatabase,
): Promise<AdapterResult> {
  const branchIds = scopedBranchIds(context, filters.branchId);
  if (!branchIds.length) return { items: [], total: 0 };
  const employee = normalizedEmployee(filters.employee);
  const range = dateRange(filters);
  const where = {
    businessId: context.businessId,
    branchId: { in: branchIds },
    status: "PENDING" as const,
    membership: {
      staffUser: { isNot: { id: context.actorUserId } },
      ...(employee ? { OR: employeeSearch(employee) } : {}),
    },
    ...(range ? { createdAt: range } : {}),
  };
  const rows = await database.leaveRequest.findMany({
      where,
      select: {
        id: true,
        branchId: true,
        policyNameSnapshot: true,
        payTreatmentSnapshot: true,
        leaveUnit: true,
        startsOn: true,
        endsOn: true,
        requestedDays: true,
        documentReference: true,
        revision: true,
        createdAt: true,
        membership: { select: { id: true, fullName: true, employeeCode: true } },
        branch: { select: { name: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: Math.max(limit, 500),
    });
  const stages = await getHrApprovalStages({
    businessId: context.businessId,
    domain: "LEAVE",
    actorLevel: context.actorLevel ?? "MANAGER",
    subjects: rows.map((row) => ({ id: row.id, revision: row.revision, value: Number(row.requestedDays) })),
  }, database);
  const visible = rows.filter((row) => stages.get(row.id)?.visible);
  return {
    total: visible.length,
    items: visible.slice(0, limit).map((row) => projectLeave(row, context.businessId, stages.get(row.id)?.stage)),
  };
}

async function loadClaims(
  context: UnifiedApprovalContext,
  filters: ApprovalInboxFilters,
  limit: number,
  database: ApprovalDatabase,
): Promise<AdapterResult> {
  const branchIds = scopedBranchIds(context, filters.branchId);
  if (!branchIds.length) return { items: [], total: 0 };
  const employee = normalizedEmployee(filters.employee);
  const range = dateRange(filters);
  const where = {
    businessId: context.businessId,
    branchId: { in: branchIds },
    status: "SUBMITTED" as const,
    membership: {
      staffUser: { isNot: { id: context.actorUserId } },
      ...(employee ? { OR: employeeSearch(employee) } : {}),
    },
    ...(range ? { submittedAt: range } : {}),
  };
  const rows = await database.employeeClaim.findMany({
      where,
      select: {
        id: true,
        branchId: true,
        claimNumber: true,
        submittedTotal: true,
        duplicateWarning: true,
        revision: true,
        submittedAt: true,
        createdAt: true,
        membership: { select: { id: true, fullName: true, employeeCode: true } },
        branch: { select: { name: true } },
        lines: {
          select: {
            categoryNameSnapshot: true,
            expenseDate: true,
            attachments: { select: { id: true }, take: 1 },
          },
          orderBy: { lineNumber: "asc" },
        },
      },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      take: Math.max(limit, 500),
    });
  const stages = await getHrApprovalStages({
    businessId: context.businessId,
    domain: "CLAIMS",
    actorLevel: context.actorLevel ?? "MANAGER",
    subjects: rows.map((row) => ({ id: row.id, revision: row.revision, value: Number(row.submittedTotal) })),
  }, database);
  const visible = rows.filter((row) => stages.get(row.id)?.visible);
  return {
    total: visible.length,
    items: visible.slice(0, limit).map((row) => projectClaim(row, context.businessId, stages.get(row.id)?.stage)),
  };
}

async function loadCommission(
  context: UnifiedApprovalContext,
  filters: ApprovalInboxFilters,
  limit: number,
  database: ApprovalDatabase,
): Promise<AdapterResult> {
  const branchIds = scopedBranchIds(context, filters.branchId);
  if (!branchIds.length) return { items: [], total: 0 };
  const actor = await database.user.findFirst({
    where: { id: context.actorUserId, businessId: context.businessId },
    select: { employeeBusinessMembershipId: true },
  });
  const employee = normalizedEmployee(filters.employee);
  const range = dateRange(filters);
  const statementFilters: Prisma.CommissionPeriodWhereInput[] = [
    ...(actor?.employeeBusinessMembershipId
      ? [{ statements: { none: { membershipId: actor.employeeBusinessMembershipId } } }]
      : []),
    ...(employee
      ? [{ statements: { some: { membership: { OR: employeeSearch(employee) } } } }]
      : []),
  ];
  const where = {
    businessId: context.businessId,
    status: "CALCULATED" as const,
    AND: [
      { OR: [{ branchId: null }, { branchId: { in: branchIds } }] },
      { OR: [{ calculatedById: null }, { calculatedById: { not: context.actorUserId } }] },
      ...statementFilters,
    ],
    ...(range ? { calculatedAt: range } : {}),
  } satisfies Prisma.CommissionPeriodWhereInput;
  const [total, rows] = await Promise.all([
    database.commissionPeriod.count({ where }),
    database.commissionPeriod.findMany({
      where,
      select: {
        id: true,
        branchId: true,
        earnedPeriodStart: true,
        earnedPeriodEnd: true,
        currentRevision: true,
        calculatedAt: true,
        statements: {
          where: { status: "CALCULATED" },
          select: {
            eligibleSalesCents: true,
            adjustmentCents: true,
            finalCommissionCents: true,
            membership: { select: { id: true, fullName: true } },
          },
        },
        branch: { select: { name: true } },
      },
      orderBy: [{ calculatedAt: "asc" }, { id: "asc" }],
      take: limit,
    }),
  ]);
  return { total, items: rows.map((row) => projectCommission(row, context.businessId)) };
}

async function loadPayroll(
  context: UnifiedApprovalContext,
  filters: ApprovalInboxFilters,
  limit: number,
  database: ApprovalDatabase,
): Promise<AdapterResult> {
  if (filters.branchId || normalizedEmployee(filters.employee)) {
    return { items: [], total: 0 };
  }
  const range = dateRange(filters);
  const where = {
    businessId: context.businessId,
    status: "REVIEW" as const,
    ...(range ? { updatedAt: range } : {}),
  };
  const [total, rows] = await Promise.all([
    database.payrollRun.count({ where }),
    database.payrollRun.findMany({
      where,
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        status: true,
        submittedAt: true,
        updatedAt: true,
        entries: { select: { grossPay: true, netPay: true } },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit,
    }),
  ]);
  const readiness = await Promise.all(rows.map((row) =>
    getPayrollPeriodReadiness({
      businessId: context.businessId,
      month: row.periodStart.toISOString().slice(0, 7),
      runId: row.id,
    }, database),
  ));
  const items = rows.map((row, index) => projectPayroll(row, readiness[index], context.businessId));
  return { total, items };
}

export function projectAttendanceP2(row: any, businessId: string): ApprovalInboxItem {
  return {
    id: `ATTENDANCE:P2:${row.id}`,
    domain: "ATTENDANCE",
    businessId,
    branchId: row.branchId,
    branchName: row.branch.name,
    subjectType: "ATTENDANCE_P2_EXCEPTION",
    subjectId: row.id,
    employeeId: row.membership.id,
    membershipId: row.membership.id,
    employeeName: row.membership.fullName,
    title: attendanceLabel(row.type),
    summary: `${row.membership.employeeCode} · ${dateValue(row.workDate)} · ${row.exceptionMinutes} minute variance`,
    requestedAt: row.detectedAt,
    status: "PENDING",
    priority: row.type === "SUSPECTED_NO_SHOW" ? "HIGH" : "NORMAL",
    requestedBy: row.membership.id,
    requestedByName: row.membership.fullName,
    amount: null,
    units: row.exceptionMinutes,
    requiredCapability: "MODIFY_ATTENDANCE_EMPLOYEES",
    targetUrl: `/team/attendance/resolutions?employee=${encodeURIComponent(row.membership.employeeCode)}`,
    revision: row.revision,
    metadata: { exceptionType: row.type, workDate: dateValue(row.workDate) },
  };
}

export function projectAttendanceCase(row: any, businessId: string): ApprovalInboxItem {
  return {
    id: `ATTENDANCE:CASE:${row.id}`,
    domain: "ATTENDANCE",
    businessId,
    branchId: row.branchId,
    branchName: row.branch.name,
    subjectType: "ATTENDANCE_RESOLUTION_CASE",
    subjectId: row.id,
    employeeId: row.employee.id,
    membershipId: row.employee.id,
    employeeName: row.employee.fullName,
    title: "Attendance resolution",
    summary: `${row.employee.employeeCode} · ${dateValue(row.attendanceSession.workDate)} · ${humanize(row.openedReason)}`,
    requestedAt: row.openedAt,
    status: "PENDING",
    priority: "NORMAL",
    requestedBy: row.employee.id,
    requestedByName: row.employee.fullName,
    amount: null,
    units: null,
    requiredCapability: "MODIFY_ATTENDANCE_EMPLOYEES",
    targetUrl: `/team/attendance/resolutions?employee=${encodeURIComponent(row.employee.employeeCode)}`,
    revision: row.updatedAt.toISOString(),
    metadata: { caseStatus: row.status },
  };
}

export function projectTimesheet(row: any, businessId: string): ApprovalInboxItem {
  return {
    id: `ATTENDANCE:TIMESHEET:${row.id}`,
    domain: "ATTENDANCE",
    businessId,
    branchId: null,
    branchName: null,
    subjectType: "ATTENDANCE_MONTHLY_TIMESHEET",
    subjectId: row.id,
    employeeId: null,
    membershipId: null,
    employeeName: null,
    title: row.status === "APPROVED" ? "Lock approved Timesheet" : "Approve monthly Timesheet",
    summary: `${monthValue(row.periodStart)} · all branches ready · canonical Attendance workflow`,
    requestedAt: row.updatedAt,
    status: "PENDING",
    priority: "HIGH",
    requestedBy: null,
    requestedByName: null,
    amount: null,
    units: null,
    requiredCapability: "MODIFY_ATTENDANCE_EMPLOYEES",
    targetUrl: `/team/attendance/timesheets?month=${monthValue(row.periodStart)}`,
    revision: row.approvalRevision,
    metadata: { timesheetStatus: row.status },
  };
}

export function projectLeave(row: any, businessId: string, approvalStage?: "LEVEL_ONE" | "LEVEL_TWO"): ApprovalInboxItem {
  return {
    id: `LEAVE:${row.id}`,
    domain: "LEAVE",
    businessId,
    branchId: row.branchId,
    branchName: row.branch.name,
    subjectType: "LEAVE_REQUEST",
    subjectId: row.id,
    employeeId: row.membership.id,
    membershipId: row.membership.id,
    employeeName: row.membership.fullName,
    title: approvalStage === "LEVEL_TWO" ? "Leave request · Owner approval" : "Leave request",
    summary: `${row.policyNameSnapshot} · ${dateValue(row.startsOn)}–${dateValue(row.endsOn)} · ${Number(row.requestedDays)} day(s) · ${humanize(row.payTreatmentSnapshot)}`,
    requestedAt: row.createdAt,
    status: "PENDING",
    priority: "NORMAL",
    requestedBy: row.membership.id,
    requestedByName: row.membership.fullName,
    amount: null,
    units: Number(row.requestedDays),
    requiredCapability: "APPROVE_LEAVE",
    targetUrl: `/team/leave?year=${new Date(row.startsOn).getUTCFullYear()}&employee=${encodeURIComponent(row.membership.employeeCode)}&status=PENDING`,
    revision: row.revision,
    metadata: {
      attachment: Boolean(row.documentReference),
      leaveUnit: row.leaveUnit,
      payTreatment: row.payTreatmentSnapshot,
      approvalStage: approvalStage ?? "LEVEL_ONE",
    },
  };
}

export function projectClaim(row: any, businessId: string, approvalStage?: "LEVEL_ONE" | "LEVEL_TWO"): ApprovalInboxItem {
  const categories = [...new Set(row.lines.map((line: any) => line.categoryNameSnapshot))].slice(0, 2);
  const receiptAttached = row.lines.some((line: any) => line.attachments.length > 0);
  return {
    id: `CLAIM:${row.id}`,
    domain: "CLAIMS",
    businessId,
    branchId: row.branchId,
    branchName: row.branch.name,
    subjectType: "EMPLOYEE_CLAIM",
    subjectId: row.id,
    employeeId: row.membership.id,
    membershipId: row.membership.id,
    employeeName: row.membership.fullName,
    title: approvalStage === "LEVEL_TWO" ? `Claim ${row.claimNumber} · Owner approval` : `Claim ${row.claimNumber}`,
    summary: `${categories.join(", ") || "Claim"} · ${receiptAttached ? "Receipt attached" : "No receipt"}${row.duplicateWarning ? " · possible duplicate warning" : ""}`,
    requestedAt: row.submittedAt ?? row.createdAt,
    status: "PENDING",
    priority: row.duplicateWarning ? "HIGH" : "NORMAL",
    requestedBy: row.membership.id,
    requestedByName: row.membership.fullName,
    amount: Number(row.submittedTotal),
    units: row.lines.length,
    requiredCapability: "REVIEW_CLAIM",
    targetUrl: `/team/claims?employee=${encodeURIComponent(row.membership.employeeCode)}&status=SUBMITTED`,
    revision: row.revision,
    metadata: { receiptAttached, duplicateWarning: row.duplicateWarning, approvalStage: approvalStage ?? "LEVEL_ONE" },
  };
}

export function projectCommission(row: any, businessId: string): ApprovalInboxItem {
  const totals = row.statements.reduce((value: any, statement: any) => ({
    eligible: value.eligible + statement.eligibleSalesCents,
    adjustment: value.adjustment + statement.adjustmentCents,
    commission: value.commission + statement.finalCommissionCents,
  }), { eligible: 0, adjustment: 0, commission: 0 });
  return {
    id: `COMMISSION:${row.id}`,
    domain: "COMMISSION",
    businessId,
    branchId: row.branchId,
    branchName: row.branch?.name ?? null,
    subjectType: "COMMISSION_PERIOD",
    subjectId: row.id,
    employeeId: null,
    membershipId: null,
    employeeName: row.statements.length === 1 ? row.statements[0].membership.fullName : null,
    title: "Commission period",
    summary: `${dateValue(row.earnedPeriodStart)}–${dateValue(row.earnedPeriodEnd)} · ${row.statements.length} statement(s) · eligible sales RM ${(totals.eligible / 100).toFixed(2)} · adjustments RM ${(totals.adjustment / 100).toFixed(2)}`,
    requestedAt: row.calculatedAt ?? row.earnedPeriodEnd,
    status: "PENDING",
    priority: "NORMAL",
    requestedBy: null,
    requestedByName: null,
    amount: totals.commission / 100,
    units: row.statements.length,
    requiredCapability: "APPROVE_COMMISSION",
    targetUrl: "/team/commission",
    revision: row.currentRevision,
    metadata: { finalCommission: totals.commission / 100 },
  };
}

export function projectPayroll(row: any, readiness: any, businessId: string): ApprovalInboxItem {
  const totals = row.entries.reduce((value: any, entry: any) => ({
    gross: value.gross + Number(entry.grossPay),
    net: value.net + Number(entry.netPay),
  }), { gross: 0, net: 0 });
  const requiredCapability: BusinessCapability = row.status === "DRAFT"
    ? "SUBMIT_PAYROLL_REVIEW"
    : "APPROVE_PAYROLL";
  return {
    id: `PAYROLL:${row.id}`,
    domain: "PAYROLL",
    businessId,
    branchId: null,
    branchName: null,
    subjectType: "PAYROLL_RUN",
    subjectId: row.id,
    employeeId: null,
    membershipId: null,
    employeeName: null,
    title: row.status === "DRAFT" ? "Payroll ready for review" : "Payroll awaiting approval",
    summary: `${monthValue(row.periodStart)} · ${row.entries.length} employee(s) · ${readiness.blockers.length} blocker(s)`,
    requestedAt: row.submittedAt ?? row.updatedAt,
    status: readiness.canProceed ? "PENDING" : "BLOCKED",
    priority: "HIGH",
    requestedBy: null,
    requestedByName: null,
    amount: totals.net,
    units: row.entries.length,
    requiredCapability,
    targetUrl: `/team/payroll/runs/${row.id}`,
    revision: row.updatedAt.toISOString(),
    metadata: {
      grossPayroll: totals.gross,
      netPayroll: totals.net,
      readiness: readiness.canProceed ? "READY" : "BLOCKED",
      blockers: readiness.blockers.length,
      mfaBoundary: row.status === "REVIEW",
    },
  };
}

function scopedBranchIds(context: UnifiedApprovalContext, requested?: string) {
  if (!requested) return [...context.allowedBranchIds];
  return context.allowedBranchIds.includes(requested) ? [requested] : [];
}

function normalizedEmployee(value?: string) {
  return value?.trim().slice(0, 100) || "";
}

function employeeSearch(value: string) {
  return [
    { fullName: { contains: value, mode: "insensitive" as const } },
    { employeeCode: { contains: value, mode: "insensitive" as const } },
  ];
}

function dateRange(filters: ApprovalInboxFilters) {
  if (!filters.from && !filters.to) return null;
  return {
    ...(filters.from ? { gte: filters.from } : {}),
    ...(filters.to ? { lt: filters.to } : {}),
  };
}

function compareItems(left: ApprovalInboxItem, right: ApprovalInboxItem) {
  const time = left.requestedAt.getTime() - right.requestedAt.getTime();
  if (time !== 0) return time;
  if (left.priority !== right.priority) return left.priority === "HIGH" ? -1 : 1;
  return left.id.localeCompare(right.id);
}

function attendanceLabel(value: string) {
  if (value === "NO_ATTENDANCE_RECORDED") return "No attendance recorded";
  return humanize(value);
}

function humanize(value: string) {
  const normalized = value.toLowerCase().replaceAll("_", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function dateValue(value: Date) {
  return value.toISOString().slice(0, 10);
}

function monthValue(value: Date) {
  return value.toISOString().slice(0, 7);
}
