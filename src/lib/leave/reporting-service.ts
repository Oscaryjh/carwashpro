import type { LeaveLedgerEventType, LeaveRequestStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculateBucketRemaining, leaveUnits } from "./bucket-engine";

export type LeaveReportScope = Readonly<{
  businessId: string;
  allowedBranchIds: readonly string[];
}>;

export type LeaveReportFilters = Readonly<{
  from: Date;
  to: Date;
  branchId?: string;
  policyId?: string;
  employee?: string;
  includeInactive?: boolean;
  expiryDays?: 30 | 60 | 90;
  sort?: "employee" | "remaining_desc" | "remaining_asc" | "used_desc" | "pending_desc" | "expiry";
  page?: number;
  pageSize?: number;
}>;

export type LeaveBalanceRow = Readonly<{
  membershipId: string;
  employeeCode: string;
  employeeName: string;
  policyId: string;
  policyName: string;
  periodStart: string;
  periodEnd: string;
  entitlement: number;
  carryForward: number;
  manualAdjustment: number;
  used: number;
  pending: number;
  remaining: number;
  projectedRemaining: number;
  nextExpiry: string | null;
}>;

export type LeaveUsageRow = Readonly<{
  key: string;
  month: string;
  employeeCode: string;
  employeeName: string;
  policyName: string;
  branchName: string;
  payTreatment: "PAID" | "UNPAID";
  approvedUnits: number;
  requestCount: number;
}>;

type Pagination = Readonly<{ page: number; pageSize: number; total: number; pages: number }>;

const LEDGER_EVENTS: LeaveLedgerEventType[] = [
  "ENTITLEMENT",
  "CARRY_FORWARD",
  "CARRY_FORWARD_LAPSE",
  "MANUAL_ADJUSTMENT",
  "APPROVED_CONSUMPTION",
  "CANCELLATION_RESTORE",
  "EXPIRY",
];

export function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function endOfUtcDay(value: Date) {
  const result = startOfUtcDay(value);
  result.setUTCHours(23, 59, 59, 999);
  return result;
}

export function formatLocalDate(value: Date | null | undefined) {
  if (!value) return "";
  return `${String(value.getUTCDate()).padStart(2, "0")}/${String(value.getUTCMonth() + 1).padStart(2, "0")}/${value.getUTCFullYear()}`;
}

export function aggregateBalanceLedger(entries: readonly { eventType: LeaveLedgerEventType; units: number }[]) {
  const totals = Object.fromEntries(LEDGER_EVENTS.map((event) => [event, 0])) as Record<LeaveLedgerEventType, number>;
  for (const entry of entries) totals[entry.eventType] = leaveUnits(totals[entry.eventType] + entry.units);
  const remaining = leaveUnits(entries.reduce((sum, entry) => sum + entry.units, 0));
  return {
    entitlement: leaveUnits(totals.ENTITLEMENT),
    carryForward: leaveUnits(totals.CARRY_FORWARD),
    manualAdjustment: leaveUnits(totals.MANUAL_ADJUSTMENT),
    used: leaveUnits(Math.max(0, -totals.APPROVED_CONSUMPTION - totals.CANCELLATION_RESTORE)),
    expired: leaveUnits(Math.max(0, -totals.EXPIRY)),
    lapsed: leaveUnits(Math.max(0, -totals.CARRY_FORWARD_LAPSE)),
    remaining,
  };
}

export function sumApprovedUsageUnits(rows: readonly { dayFraction: unknown }[]) {
  return leaveUnits(rows.reduce((sum, row) => sum + Number(row.dayFraction), 0));
}

export function safeCsvCell(value: unknown) {
  const raw = value == null ? "" : String(value);
  const protectedValue = /^[\t\r ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]) {
  return `\uFEFF${[headers, ...rows].map((row) => row.map(safeCsvCell).join(",")).join("\r\n")}`;
}

function pagination(filters: LeaveReportFilters, total: number): Pagination {
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pages, Math.max(1, filters.page ?? 1));
  return { page, pageSize, total, pages };
}

function scopedBranchIds(scope: LeaveReportScope, branchId?: string) {
  if (branchId && scope.allowedBranchIds.includes(branchId)) return [branchId];
  return [...scope.allowedBranchIds];
}

function membershipWhere(scope: LeaveReportScope, filters: LeaveReportFilters, at = new Date()) {
  const branchIds = scopedBranchIds(scope, filters.branchId);
  const query = filters.employee?.trim();
  return {
    businessId: scope.businessId,
    ...(!filters.includeInactive ? { status: "ACTIVE" as const } : {}),
    ...(query ? {
      OR: [
        { fullName: { contains: query, mode: "insensitive" as const } },
        { employeeCode: { contains: query, mode: "insensitive" as const } },
      ],
    } : {}),
    branchAssignments: {
      some: {
        businessId: scope.businessId,
        branchId: { in: branchIds },
        status: "ACTIVE" as const,
        effectiveFrom: { lte: at },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: at } }],
      },
    },
  };
}

export async function getLeaveReportOptions(scope: LeaveReportScope) {
  const [branches, policies] = await Promise.all([
    prisma.branch.findMany({
      where: { businessId: scope.businessId, id: { in: [...scope.allowedBranchIds] }, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.leavePolicy.findMany({
      where: { businessId: scope.businessId },
      select: { id: true, name: true, active: true },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
  ]);
  return { branches, policies };
}

export async function getLeaveOverview(scope: LeaveReportScope, filters: LeaveReportFilters) {
  const branchIds = scopedBranchIds(scope, filters.branchId);
  const today = startOfUtcDay(new Date());
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const monthEnd = endOfUtcDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)));
  const thirtyDays = new Date(today.getTime() + 30 * 86_400_000);
  const memberScope = membershipWhere(scope, filters, today);
  const employeeQuery = filters.employee?.trim();
  const requestScope = {
    businessId: scope.businessId,
    branchId: { in: branchIds },
    membership: {
      businessId: scope.businessId,
      ...(!filters.includeInactive ? { status: "ACTIVE" as const } : {}),
      ...(employeeQuery ? {
        OR: [
          { fullName: { contains: employeeQuery, mode: "insensitive" as const } },
          { employeeCode: { contains: employeeQuery, mode: "insensitive" as const } },
        ],
      } : {}),
    },
  };
  const sevenDays = new Date(today.getTime() + 7 * 86_400_000);

  const [activeEmployees, pendingApprovals, todayRows, monthDays, periodDays, upcomingSevenDays, upcoming, expiringBuckets, evidenceRequests] = await Promise.all([
    prisma.employeeBusinessMembership.count({ where: memberScope }),
    prisma.leaveRequest.count({ where: { ...requestScope, status: "PENDING", ...(filters.policyId ? { policyId: filters.policyId } : {}) } }),
    prisma.leaveRequestDay.findMany({
      where: { businessId: scope.businessId, leaveDate: today, leaveRequest: { ...requestScope, status: "APPROVED" } },
      select: { membershipId: true },
      distinct: ["membershipId"],
    }),
    prisma.leaveRequestDay.findMany({
      where: {
        businessId: scope.businessId,
        leaveDate: { gte: monthStart, lte: monthEnd },
        leaveRequest: { ...requestScope, status: "APPROVED", ...(filters.policyId ? { policyId: filters.policyId } : {}) },
      },
      select: { dayFraction: true, payTreatmentSnapshot: true },
    }),
    prisma.leaveRequestDay.findMany({
      where: {
        businessId: scope.businessId,
        leaveDate: { gte: startOfUtcDay(filters.from), lte: endOfUtcDay(filters.to) },
        leaveRequest: { ...requestScope, status: "APPROVED", ...(filters.policyId ? { policyId: filters.policyId } : {}) },
      },
      select: { leaveDate: true, dayFraction: true },
    }),
    prisma.leaveRequest.count({
      where: {
        ...requestScope,
        status: "APPROVED",
        endsOn: { gte: today },
        startsOn: { lte: sevenDays },
        ...(filters.policyId ? { policyId: filters.policyId } : {}),
      },
    }),
    prisma.leaveRequest.findMany({
      where: {
        ...requestScope,
        status: "APPROVED",
        endsOn: { gte: today },
        startsOn: { lte: thirtyDays },
        ...(filters.policyId ? { policyId: filters.policyId } : {}),
      },
      select: {
        id: true, startsOn: true, endsOn: true, requestedDays: true, policyNameSnapshot: true,
        membership: { select: { fullName: true, employeeCode: true } },
        branch: { select: { name: true } },
      },
      orderBy: { startsOn: "asc" },
      take: 8,
    }),
    prisma.leaveEntitlementBucket.findMany({
      where: {
        businessId: scope.businessId,
        sourceType: "CARRY_FORWARD",
        status: "ACTIVE",
        expiresAt: { gte: today, lte: thirtyDays },
      },
      select: { id: true, membershipId: true, grantedUnits: true, expiresAt: true },
    }),
    prisma.leaveRequest.findMany({
      where: {
        ...requestScope,
        supportingEvidenceRequiredSnapshot: true,
        startsOn: { lte: endOfUtcDay(filters.to) },
        endsOn: { gte: startOfUtcDay(filters.from) },
        ...(filters.policyId ? { policyId: filters.policyId } : {}),
      },
      select: {
        supportingEvidencePresentSnapshot: true,
        supportingEvidenceStatusSnapshot: true,
        supportingEvidenceStatus: true,
      },
    }),
  ]);

  const scopedMembershipIds = new Set((await prisma.employeeBusinessMembership.findMany({ where: memberScope, select: { id: true } })).map((row) => row.id));
  const scopedExpiring = expiringBuckets.filter((bucket) => scopedMembershipIds.has(bucket.membershipId));
  const bucketIds = scopedExpiring.map((bucket) => bucket.id);
  const [allocations, restorations, expiries] = bucketIds.length ? await Promise.all([
    prisma.leaveConsumptionAllocation.groupBy({ by: ["bucketId"], where: { businessId: scope.businessId, bucketId: { in: bucketIds } }, _sum: { units: true } }),
    prisma.leaveAllocationRestoration.groupBy({ by: ["bucketId"], where: { businessId: scope.businessId, bucketId: { in: bucketIds } }, _sum: { units: true } }),
    prisma.leaveBucketExpiry.findMany({ where: { businessId: scope.businessId, bucketId: { in: bucketIds } }, select: { bucketId: true, units: true } }),
  ]) : [[], [], []] as const;
  const sumMap = (rows: readonly { bucketId: string; _sum?: { units: unknown }; units?: unknown }[]) => new Map(rows.map((row) => [row.bucketId, Number(row._sum?.units ?? row.units ?? 0)]));
  const usedMap = sumMap(allocations);
  const restoredMap = sumMap(restorations);
  const expiredMap = sumMap(expiries);
  const expiringUnits = leaveUnits(scopedExpiring.reduce((sum, bucket) => sum + calculateBucketRemaining({
    grantedUnits: Number(bucket.grantedUnits), consumedUnits: usedMap.get(bucket.id) ?? 0,
    restoredUnits: restoredMap.get(bucket.id) ?? 0, expiredUnits: expiredMap.get(bucket.id) ?? 0,
  }), 0));
  const monthlyUsage = new Map<string, number>();
  for (const day of periodDays) {
    const month = `${day.leaveDate.getUTCFullYear()}-${String(day.leaveDate.getUTCMonth() + 1).padStart(2, "0")}`;
    monthlyUsage.set(month, leaveUnits((monthlyUsage.get(month) ?? 0) + Number(day.dayFraction)));
  }
  const evidenceStatus = evidenceRequests.map((request) => request.supportingEvidenceStatusSnapshot ?? request.supportingEvidenceStatus);

  return {
    activeEmployees,
    onLeaveToday: todayRows.length,
    pendingApprovals,
    approvedThisMonth: sumApprovedUsageUnits(monthDays),
    unpaidThisMonth: sumApprovedUsageUnits(monthDays.filter((row) => row.payTreatmentSnapshot === "UNPAID")),
    expiringSoonUnits: expiringUnits,
    upcomingSevenDays,
    approvedInPeriod: sumApprovedUsageUnits(periodDays),
    monthlyTrend: [...monthlyUsage.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, units]) => ({ month, units })),
    evidenceSummary: {
      required: evidenceRequests.length,
      attached: evidenceRequests.filter((request) => request.supportingEvidencePresentSnapshot === true).length,
      verified: evidenceStatus.filter((status) => status === "VERIFIED").length,
      needsFollowUp: evidenceStatus.filter((status) => status === "REVIEW_REQUIRED" || status === "NOT_REVIEWED").length,
      rejected: evidenceStatus.filter((status) => status === "REJECTED").length,
    },
    upcoming: upcoming.map((row) => ({
      id: row.id, employeeName: row.membership.fullName, employeeCode: row.membership.employeeCode,
      policyName: row.policyNameSnapshot, branchName: row.branch.name,
      startsOn: formatLocalDate(row.startsOn), endsOn: formatLocalDate(row.endsOn), units: Number(row.requestedDays),
    })),
  };
}

export async function getLeaveBalanceReport(scope: LeaveReportScope, filters: LeaveReportFilters) {
  // The balance report intentionally shows the canonical current balance only.
  // Historical reconstruction is not inferred from today's ledger state.
  const at = startOfUtcDay(new Date());
  const scopedMembers = await prisma.employeeBusinessMembership.findMany({
    where: membershipWhere(scope, filters, at),
    select: { id: true, employeeCode: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
  const scopedMemberIds = scopedMembers.map((member) => member.id);
  const memberMap = new Map(scopedMembers.map((member) => [member.id, member]));
  const where = {
    businessId: scope.businessId,
    leaveYearStart: { lte: at },
    leaveYearEnd: { gte: at },
    ...(filters.policyId ? { policyId: filters.policyId } : {}),
    membershipId: { in: scopedMemberIds },
  };
  const entitlements = await prisma.employeeLeaveEntitlement.findMany({
    where,
    select: {
      membershipId: true, policyId: true, leaveYearStart: true, leaveYearEnd: true, entitledUnits: true,
    },
    orderBy: [{ membershipId: "asc" }, { policyId: "asc" }],
  });
  const membershipIds = [...new Set(entitlements.map((row) => row.membershipId))];
  const policyIds = [...new Set(entitlements.map((row) => row.policyId))];
  const [policies, ledger, pending, carryBuckets] = await Promise.all([
    prisma.leavePolicy.findMany({ where: { businessId: scope.businessId, id: { in: policyIds } }, select: { id: true, name: true } }),
    prisma.leaveBalanceLedgerEntry.findMany({
      where: { businessId: scope.businessId, membershipId: { in: membershipIds }, policyId: { in: policyIds } },
      select: { membershipId: true, policyId: true, leaveYearStart: true, eventType: true, units: true },
    }),
    prisma.leaveRequest.groupBy({
      by: ["membershipId", "policyId"],
      where: { businessId: scope.businessId, branchId: { in: scopedBranchIds(scope, filters.branchId) }, membershipId: { in: membershipIds }, policyId: { in: policyIds }, status: "PENDING" },
      _sum: { requestedDays: true },
    }),
    prisma.leaveEntitlementBucket.findMany({
      where: { businessId: scope.businessId, membershipId: { in: membershipIds }, policyId: { in: policyIds }, sourceType: "CARRY_FORWARD", status: "ACTIVE", expiresAt: { gte: at } },
      select: { membershipId: true, policyId: true, expiresAt: true },
      orderBy: { expiresAt: "asc" },
    }),
  ]);
  const policyMap = new Map(policies.map((policy) => [policy.id, policy.name]));
  const pendingMap = new Map(pending.map((row) => [`${row.membershipId}:${row.policyId}`, Number(row._sum.requestedDays ?? 0)]));
  const rows: LeaveBalanceRow[] = entitlements.map((entitlement) => {
    const entries = ledger.filter((entry) => entry.membershipId === entitlement.membershipId
      && entry.policyId === entitlement.policyId
      && entry.leaveYearStart.getTime() === entitlement.leaveYearStart.getTime())
      .map((entry) => ({ eventType: entry.eventType, units: Number(entry.units) }));
    const totals = aggregateBalanceLedger(entries);
    const pendingUnits = leaveUnits(pendingMap.get(`${entitlement.membershipId}:${entitlement.policyId}`) ?? 0);
    const nextExpiry = carryBuckets.find((bucket) => bucket.membershipId === entitlement.membershipId && bucket.policyId === entitlement.policyId)?.expiresAt ?? null;
    return {
      membershipId: entitlement.membershipId,
      employeeCode: memberMap.get(entitlement.membershipId)?.employeeCode ?? "—",
      employeeName: memberMap.get(entitlement.membershipId)?.fullName ?? "Unknown employee",
      policyId: entitlement.policyId,
      policyName: policyMap.get(entitlement.policyId) ?? "Leave",
      periodStart: formatLocalDate(entitlement.leaveYearStart),
      periodEnd: formatLocalDate(entitlement.leaveYearEnd),
      entitlement: totals.entitlement || Number(entitlement.entitledUnits),
      carryForward: totals.carryForward,
      manualAdjustment: totals.manualAdjustment,
      used: totals.used,
      pending: pendingUnits,
      remaining: totals.remaining,
      projectedRemaining: leaveUnits(totals.remaining - pendingUnits),
      nextExpiry: nextExpiry ? formatLocalDate(nextExpiry) : null,
    };
  });
  rows.sort((a, b) => {
    if (filters.sort === "remaining_desc") return b.remaining - a.remaining || a.employeeName.localeCompare(b.employeeName);
    if (filters.sort === "remaining_asc") return a.remaining - b.remaining || a.employeeName.localeCompare(b.employeeName);
    if (filters.sort === "used_desc") return b.used - a.used || a.employeeName.localeCompare(b.employeeName);
    if (filters.sort === "pending_desc") return b.pending - a.pending || a.employeeName.localeCompare(b.employeeName);
    if (filters.sort === "expiry") return (a.nextExpiry ?? "99/99/9999").split("/").reverse().join("").localeCompare((b.nextExpiry ?? "99/99/9999").split("/").reverse().join(""));
    return a.employeeName.localeCompare(b.employeeName) || a.policyName.localeCompare(b.policyName);
  });
  const pg = pagination(filters, rows.length);
  return { rows: rows.slice((pg.page - 1) * pg.pageSize, pg.page * pg.pageSize), pagination: pg };
}

export async function getLeaveUsageReport(scope: LeaveReportScope, filters: LeaveReportFilters) {
  const days = await prisma.leaveRequestDay.findMany({
    where: {
      businessId: scope.businessId,
      leaveDate: { gte: startOfUtcDay(filters.from), lte: endOfUtcDay(filters.to) },
      ...(filters.policyId ? { leaveRequest: { policyId: filters.policyId, status: "APPROVED" as LeaveRequestStatus, branchId: { in: scopedBranchIds(scope, filters.branchId) } } } : {
        leaveRequest: { status: "APPROVED" as LeaveRequestStatus, branchId: { in: scopedBranchIds(scope, filters.branchId) } },
      }),
      membership: membershipWhere(scope, filters, filters.to),
    },
    select: {
      leaveRequestId: true, leaveDate: true, dayFraction: true, payTreatmentSnapshot: true,
      membership: { select: { employeeCode: true, fullName: true } },
      leaveRequest: { select: { policyNameSnapshot: true, branch: { select: { name: true } } } },
    },
  });
  const grouped = new Map<string, LeaveUsageRow>();
  const requestIds = new Map<string, Set<string>>();
  for (const day of days) {
    const month = `${day.leaveDate.getUTCFullYear()}-${String(day.leaveDate.getUTCMonth() + 1).padStart(2, "0")}`;
    const key = `${month}:${day.membership.employeeCode}:${day.leaveRequest.policyNameSnapshot}:${day.leaveRequest.branch.name}:${day.payTreatmentSnapshot}`;
    const current = grouped.get(key);
    const ids = requestIds.get(key) ?? new Set<string>();
    ids.add(day.leaveRequestId);
    requestIds.set(key, ids);
    grouped.set(key, {
      key,
      month,
      employeeCode: day.membership.employeeCode,
      employeeName: day.membership.fullName,
      policyName: day.leaveRequest.policyNameSnapshot,
      branchName: day.leaveRequest.branch.name,
      payTreatment: day.payTreatmentSnapshot,
      approvedUnits: leaveUnits((current?.approvedUnits ?? 0) + Number(day.dayFraction)),
      requestCount: ids.size,
    });
  }
  const allRows = [...grouped.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName) || a.policyName.localeCompare(b.policyName));
  const pg = pagination(filters, allRows.length);
  return { rows: allRows.slice((pg.page - 1) * pg.pageSize, pg.page * pg.pageSize), pagination: pg };
}

export async function getLeaveCarryReport(scope: LeaveReportScope, filters: LeaveReportFilters) {
  const scopedMembers = await prisma.employeeBusinessMembership.findMany({
    where: membershipWhere(scope, filters, filters.to),
    select: { id: true, employeeCode: true, fullName: true },
  });
  const memberMap = new Map(scopedMembers.map((member) => [member.id, member]));
  const where = {
    businessId: scope.businessId,
    sourceType: "CARRY_FORWARD" as const,
    ...(filters.policyId ? { policyId: filters.policyId } : {}),
    membershipId: { in: scopedMembers.map((member) => member.id) },
    ...(filters.expiryDays ? {
      expiresAt: {
        gte: startOfUtcDay(new Date()),
        lte: endOfUtcDay(new Date(startOfUtcDay(new Date()).getTime() + filters.expiryDays * 86_400_000)),
      },
    } : {}),
  };
  const total = await prisma.leaveEntitlementBucket.count({ where });
  const pg = pagination(filters, total);
  const buckets = await prisma.leaveEntitlementBucket.findMany({
    where,
    select: { id: true, membershipId: true, policyId: true, periodStart: true, periodEnd: true, grantedUnits: true, expiresAt: true, status: true, rolloverId: true },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "desc" }],
    skip: (pg.page - 1) * pg.pageSize, take: pg.pageSize,
  });
  const bucketIds = buckets.map((bucket) => bucket.id);
  const policyIds = [...new Set(buckets.map((bucket) => bucket.policyId))];
  const rolloverIds = buckets.flatMap((bucket) => bucket.rolloverId ? [bucket.rolloverId] : []);
  const [policies, rollovers, allocations, restorations, expiries] = await Promise.all([
    prisma.leavePolicy.findMany({ where: { businessId: scope.businessId, id: { in: policyIds } }, select: { id: true, name: true } }),
    prisma.leavePeriodRollover.findMany({ where: { businessId: scope.businessId, id: { in: rolloverIds } }, select: { id: true, sourcePeriodStart: true, sourcePeriodEnd: true } }),
    prisma.leaveConsumptionAllocation.groupBy({ by: ["bucketId"], where: { businessId: scope.businessId, bucketId: { in: bucketIds } }, _sum: { units: true } }),
    prisma.leaveAllocationRestoration.groupBy({ by: ["bucketId"], where: { businessId: scope.businessId, bucketId: { in: bucketIds } }, _sum: { units: true } }),
    prisma.leaveBucketExpiry.findMany({ where: { businessId: scope.businessId, bucketId: { in: bucketIds } }, select: { bucketId: true, units: true, expiresAt: true } }),
  ]);
  const policiesMap = new Map(policies.map((row) => [row.id, row.name]));
  const rolloverMap = new Map(rollovers.map((row) => [row.id, row]));
  const allocationMap = new Map(allocations.map((row) => [row.bucketId, Number(row._sum.units ?? 0)]));
  const restorationMap = new Map(restorations.map((row) => [row.bucketId, Number(row._sum.units ?? 0)]));
  const expiryMap = new Map(expiries.map((row) => [row.bucketId, row]));
  return { rows: buckets.map((bucket) => {
    const rollover = bucket.rolloverId ? rolloverMap.get(bucket.rolloverId) : undefined;
    const expired = expiryMap.get(bucket.id);
    const consumed = allocationMap.get(bucket.id) ?? 0;
    const restored = restorationMap.get(bucket.id) ?? 0;
    const expiredUnits = Number(expired?.units ?? 0);
    return {
      bucketId: bucket.id, employeeCode: memberMap.get(bucket.membershipId)?.employeeCode ?? "—", employeeName: memberMap.get(bucket.membershipId)?.fullName ?? "Unknown employee",
      policyName: policiesMap.get(bucket.policyId) ?? "Leave",
      sourcePeriod: rollover ? `${formatLocalDate(rollover.sourcePeriodStart)} – ${formatLocalDate(rollover.sourcePeriodEnd)}` : "—",
      destinationPeriod: `${formatLocalDate(bucket.periodStart)} – ${formatLocalDate(bucket.periodEnd)}`,
      granted: Number(bucket.grantedUnits), used: leaveUnits(Math.max(0, consumed - restored)),
      remaining: calculateBucketRemaining({ grantedUnits: Number(bucket.grantedUnits), consumedUnits: consumed, restoredUnits: restored, expiredUnits }),
      expiry: formatLocalDate(bucket.expiresAt), status: expired ? "EXPIRED" : bucket.status,
    };
  }), pagination: pg };
}

export async function getLeaveAdjustmentReport(scope: LeaveReportScope, filters: LeaveReportFilters) {
  const where = {
    businessId: scope.businessId,
    eventType: "MANUAL_ADJUSTMENT" as const,
    createdAt: { gte: startOfUtcDay(filters.from), lte: endOfUtcDay(filters.to) },
    ...(filters.policyId ? { policyId: filters.policyId } : {}),
    membershipId: { in: (await prisma.employeeBusinessMembership.findMany({ where: membershipWhere(scope, filters, filters.to), select: { id: true } })).map((row) => row.id) },
  };
  const total = await prisma.leaveBalanceLedgerEntry.count({ where });
  const pg = pagination(filters, total);
  const entries = await prisma.leaveBalanceLedgerEntry.findMany({ where, orderBy: { createdAt: "desc" }, skip: (pg.page - 1) * pg.pageSize, take: pg.pageSize });
  const memberIds = [...new Set(entries.map((row) => row.membershipId))];
  const policyIds = [...new Set(entries.map((row) => row.policyId))];
  const actorIds = entries.flatMap((row) => row.actorUserId ? [row.actorUserId] : []);
  const [members, policies, actors] = await Promise.all([
    prisma.employeeBusinessMembership.findMany({ where: { businessId: scope.businessId, id: { in: memberIds } }, select: { id: true, employeeCode: true, fullName: true } }),
    prisma.leavePolicy.findMany({ where: { businessId: scope.businessId, id: { in: policyIds } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } }),
  ]);
  const memberMap = new Map(members.map((row) => [row.id, row]));
  const policyMap = new Map(policies.map((row) => [row.id, row.name]));
  const actorMap = new Map(actors.map((row) => [row.id, row.name || row.email]));
  return { rows: entries.map((entry) => ({
    id: entry.id, employeeCode: memberMap.get(entry.membershipId)?.employeeCode ?? "—",
    employeeName: memberMap.get(entry.membershipId)?.fullName ?? "Unknown employee",
    policyName: policyMap.get(entry.policyId) ?? "Leave", units: Number(entry.units), reason: entry.reason,
    actor: entry.actorUserId ? actorMap.get(entry.actorUserId) ?? "Authorised user" : "System",
    createdAt: entry.createdAt.toISOString(),
  })), pagination: pg };
}

export async function getEmployeeLeaveDrilldown(scope: LeaveReportScope, membershipId: string, filters: LeaveReportFilters) {
  const member = await prisma.employeeBusinessMembership.findFirst({
    where: { id: membershipId, ...membershipWhere(scope, { ...filters, includeInactive: true }, filters.to) },
    select: { id: true, employeeCode: true, fullName: true, status: true },
  });
  if (!member) return null;
  const [balances, usage, pending, upcoming, history] = await Promise.all([
    getLeaveBalanceReport(scope, { ...filters, employee: member.employeeCode, page: 1, pageSize: 100 }),
    getLeaveUsageReport(scope, { ...filters, employee: member.employeeCode, page: 1, pageSize: 100 }),
    prisma.leaveRequest.count({ where: { businessId: scope.businessId, membershipId, branchId: { in: scopedBranchIds(scope, filters.branchId) }, status: "PENDING" } }),
    prisma.leaveRequest.findMany({ where: { businessId: scope.businessId, membershipId, branchId: { in: scopedBranchIds(scope, filters.branchId) }, status: "APPROVED", endsOn: { gte: startOfUtcDay(new Date()) } }, select: { id: true, policyNameSnapshot: true, startsOn: true, endsOn: true, requestedDays: true }, orderBy: { startsOn: "asc" }, take: 10 }),
    prisma.leaveApplicationEvent.findMany({ where: { businessId: scope.businessId, leaveRequest: { membershipId, branchId: { in: scopedBranchIds(scope, filters.branchId) } } }, select: { id: true, eventType: true, statusSnapshot: true, createdAt: true, leaveRequest: { select: { policyNameSnapshot: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return {
    member,
    balances: balances.rows.filter((row) => row.membershipId === membershipId),
    usage: usage.rows.filter((row) => row.employeeCode === member.employeeCode),
    pending,
    upcoming: upcoming.map((row) => ({ ...row, startsOn: formatLocalDate(row.startsOn), endsOn: formatLocalDate(row.endsOn), requestedDays: Number(row.requestedDays) })),
    history: history.map((row) => ({ id: row.id, eventType: row.eventType, status: row.statusSnapshot, policyName: row.leaveRequest.policyNameSnapshot, createdAt: row.createdAt.toISOString() })),
  };
}
