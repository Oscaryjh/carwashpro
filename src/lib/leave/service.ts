import type { AppSession } from "@/lib/auth/session";
import type { AuditRequestContext } from "@/lib/audit";
import { writeAuditLog } from "@/lib/audit";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth";
import { AttendanceApiError } from "@/lib/attendance/api-error";
import { addDaysToDateValue, parseBusinessDateTime, utcDateToDateValue } from "@/lib/business-time";
import { prisma } from "@/lib/prisma";
import {
  enumerateLeaveDates,
  leaveBalanceInputSchema,
  leaveCancelInputSchema,
  leaveRequestInputSchema,
  leaveReviewInputSchema,
  PENINSULAR_LABUAN_LEAVE_PRESET,
  resolveLeaveEntitlementDays,
} from "./policy";

export async function installPeninsularLabuanLeavePreset(businessId: string) {
  await prisma.$transaction(
    PENINSULAR_LABUAN_LEAVE_PRESET.map((item) => prisma.leavePolicy.upsert({
      where: { businessId_code: { businessId, code: item.code } },
      create: { businessId, ...item },
      update: { ...item, active: true },
    })),
  );
}

export async function getEmployeeLeaveOverview(auth: EmployeeAuthContext) {
  const year = new Date().getUTCFullYear();
  const [membership, policies, balances, requests, used] = await Promise.all([
    prisma.employeeBusinessMembership.findFirstOrThrow({
      where: { id: auth.membershipId, businessId: auth.businessId, status: "ACTIVE" },
      select: { id: true, fullName: true, employeeCode: true, joinedAt: true },
    }),
    prisma.leavePolicy.findMany({ where: { businessId: auth.businessId, active: true }, orderBy: { name: "asc" } }),
    prisma.employeeLeaveBalance.findMany({ where: { businessId: auth.businessId, membershipId: auth.membershipId, year } }),
    prisma.leaveRequest.findMany({
      where: { businessId: auth.businessId, membershipId: auth.membershipId },
      orderBy: [{ startsOn: "desc" }, { createdAt: "desc" }],
      take: 50,
      select: { id: true, policyId: true, policyNameSnapshot: true, payTreatmentSnapshot: true, startsOn: true, endsOn: true, requestedDays: true, reason: true, status: true, reviewNote: true, createdAt: true },
    }),
    prisma.leaveRequestDay.groupBy({
      by: ["leaveRequestId"],
      where: {
        businessId: auth.businessId,
        membershipId: auth.membershipId,
        leaveDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
        leaveRequest: { status: "APPROVED" },
      },
      _sum: { dayFraction: true },
    }),
  ]);

  const usedByRequest = new Map(used.map((row) => [row.leaveRequestId, Number(row._sum.dayFraction ?? 0)]));
  const requestPolicy = new Map(requests.map((request) => [request.id, request.policyId]));
  const usedByPolicy = new Map<string, number>();
  for (const [requestId, days] of usedByRequest) {
    const policyId = requestPolicy.get(requestId);
    if (policyId) usedByPolicy.set(policyId, (usedByPolicy.get(policyId) ?? 0) + days);
  }
  const balanceByPolicy = new Map(balances.map((balance) => [balance.policyId, balance]));

  return {
    year,
    employee: { fullName: membership.fullName, employeeCode: membership.employeeCode },
    policies: policies.map((policy) => {
      const balance = balanceByPolicy.get(policy.id);
      const entitlement = balance?.entitlementOverrideDays !== null && balance?.entitlementOverrideDays !== undefined
        ? Number(balance.entitlementOverrideDays)
        : resolveLeaveEntitlementDays(policy, membership.joinedAt, year);
      const available = entitlement + Number(balance?.carriedForwardDays ?? 0) + Number(balance?.adjustmentDays ?? 0);
      const usedDays = usedByPolicy.get(policy.id) ?? 0;
      return {
        id: policy.id,
        code: policy.code,
        name: policy.name,
        payTreatment: policy.payTreatment,
        countMode: policy.countMode,
        requiresDocument: policy.requiresDocument,
        balanceTracked: policy.balanceTracked,
        entitlementDays: available,
        usedDays,
        remainingDays: policy.balanceTracked ? available - usedDays : null,
      };
    }),
    requests: requests.map((request) => ({
      ...request,
      startsOn: utcDateToDateValue(request.startsOn),
      endsOn: utcDateToDateValue(request.endsOn),
      requestedDays: Number(request.requestedDays),
      createdAt: request.createdAt.toISOString(),
    })),
  };
}

export async function submitEmployeeLeave(auth: EmployeeAuthContext, rawInput: unknown) {
  const input = leaveRequestInputSchema.parse(rawInput);
  const policy = await prisma.leavePolicy.findFirst({ where: { id: input.policyId, businessId: auth.businessId, active: true } });
  if (!policy) throw new AttendanceApiError("VALIDATION_ERROR", "Leave type is unavailable.");
  if (policy.requiresDocument && !input.documentReference) {
    throw new AttendanceApiError("VALIDATION_ERROR", "Supporting document reference is required for this leave type.");
  }
  const dates = enumerateLeaveDates(input.startsOn, input.endsOn, policy.countMode);
  const overlap = await prisma.leaveRequestDay.findFirst({
    where: {
      businessId: auth.businessId,
      membershipId: auth.membershipId,
      leaveDate: { in: dates.map((date) => new Date(`${date}T00:00:00.000Z`)) },
      leaveRequest: { status: { in: ["PENDING", "APPROVED"] } },
    },
    select: { id: true },
  });
  if (overlap) throw new AttendanceApiError("INVALID_ATTENDANCE_STATE", "A pending or approved leave request already covers one of these dates.");

  const result = await prisma.$transaction(async (tx) => {
    const request = await tx.leaveRequest.create({
      data: {
        businessId: auth.businessId,
        membershipId: auth.membershipId,
        branchId: auth.attendanceBranchId ?? auth.primaryBranchId,
        policyId: policy.id,
        policyNameSnapshot: policy.name,
        payTreatmentSnapshot: policy.payTreatment,
        startsOn: new Date(`${input.startsOn}T00:00:00.000Z`),
        endsOn: new Date(`${input.endsOn}T00:00:00.000Z`),
        requestedDays: dates.length,
        reason: input.reason,
        documentReference: input.documentReference || null,
        days: { create: dates.map((date) => ({ businessId: auth.businessId, membershipId: auth.membershipId, leaveDate: new Date(`${date}T00:00:00.000Z`) })) },
      },
    });
    await writeAuditLog({ businessId: auth.businessId, branchId: auth.attendanceBranchId ?? auth.primaryBranchId, action: "LEAVE_REQUEST_SUBMITTED", entityType: "LeaveRequest", entityId: request.id, summary: `Employee submitted ${policy.name}.`, after: { startsOn: input.startsOn, endsOn: input.endsOn, days: dates.length } }, tx);
    return request;
  });
  return { id: result.id, status: result.status };
}

export async function cancelEmployeeLeave(auth: EmployeeAuthContext, rawInput: unknown) {
  const input = leaveCancelInputSchema.parse(rawInput);
  const request = await prisma.leaveRequest.findFirst({ where: { id: input.requestId, businessId: auth.businessId, membershipId: auth.membershipId, status: "PENDING" } });
  if (!request) throw new AttendanceApiError("INVALID_ATTENDANCE_STATE", "Only your pending leave request can be cancelled.");
  await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.update({ where: { id: request.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await writeAuditLog({ businessId: auth.businessId, branchId: request.branchId, action: "LEAVE_REQUEST_CANCELLED", entityType: "LeaveRequest", entityId: request.id, summary: "Employee cancelled a pending leave request." }, tx);
  });
}

export async function getManagerLeaveDashboard(input: { businessId: string; allowedBranchIds: readonly string[]; year: number }) {
  const from = new Date(Date.UTC(input.year, 0, 1));
  const to = new Date(Date.UTC(input.year + 1, 0, 1));
  const [policies, requests, employees] = await Promise.all([
    prisma.leavePolicy.findMany({ where: { businessId: input.businessId }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
    prisma.leaveRequest.findMany({
      where: { businessId: input.businessId, branchId: { in: [...input.allowedBranchIds] }, startsOn: { lt: to }, endsOn: { gte: from } },
      include: { membership: { select: { id: true, fullName: true, employeeCode: true } }, branch: { select: { id: true, name: true } }, reviewedBy: { select: { name: true } } },
      orderBy: [{ status: "asc" }, { startsOn: "asc" }],
      take: 200,
    }),
    prisma.employeeBusinessMembership.findMany({
      where: { businessId: input.businessId, status: "ACTIVE", branchAssignments: { some: { branchId: { in: [...input.allowedBranchIds] }, status: "ACTIVE" } } },
      select: { id: true, fullName: true, employeeCode: true },
      orderBy: { fullName: "asc" },
    }),
  ]);
  return {
    policies: policies.map((policy) => ({ ...policy, defaultEntitlementDays: policy.defaultEntitlementDays === null ? null : Number(policy.defaultEntitlementDays), underTwoYearsDays: policy.underTwoYearsDays === null ? null : Number(policy.underTwoYearsDays), twoToFiveYearsDays: policy.twoToFiveYearsDays === null ? null : Number(policy.twoToFiveYearsDays), fiveYearsPlusDays: policy.fiveYearsPlusDays === null ? null : Number(policy.fiveYearsPlusDays) })),
    employees,
    requests: requests.map((request) => ({ id: request.id, employee: request.membership, branch: request.branch, policyName: request.policyNameSnapshot, payTreatment: request.payTreatmentSnapshot, startsOn: utcDateToDateValue(request.startsOn), endsOn: utcDateToDateValue(request.endsOn), requestedDays: Number(request.requestedDays), reason: request.reason, documentReference: request.documentReference, status: request.status, reviewNote: request.reviewNote, reviewedBy: request.reviewedBy?.name ?? null })),
    summary: { pending: requests.filter((request) => request.status === "PENDING").length, approved: requests.filter((request) => request.status === "APPROVED").length, employees: employees.length },
  };
}

export async function reviewLeaveRequest(input: { businessId: string; allowedBranchIds: readonly string[]; actor: AppSession; request?: AuditRequestContext; rawInput: unknown }) {
  const decision = leaveReviewInputSchema.parse(input.rawInput);
  const leave = await prisma.leaveRequest.findFirst({
    where: { id: decision.requestId, businessId: input.businessId, branchId: { in: [...input.allowedBranchIds] }, status: "PENDING" },
    include: { policy: true, membership: { include: { staffUser: { select: { id: true } } } } },
  });
  if (!leave) throw new Error("Pending leave request is unavailable in your branch scope.");

  if (decision.decision === "APPROVED" && leave.policy.balanceTracked && !leave.policy.allowNegativeBalance) {
    const year = leave.startsOn.getUTCFullYear();
    const [balance, used] = await Promise.all([
      prisma.employeeLeaveBalance.findUnique({ where: { membershipId_policyId_year: { membershipId: leave.membershipId, policyId: leave.policyId, year } } }),
      prisma.leaveRequestDay.aggregate({ where: { businessId: input.businessId, membershipId: leave.membershipId, leaveRequest: { policyId: leave.policyId, status: "APPROVED" }, leaveDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } }, _sum: { dayFraction: true } }),
    ]);
    const base = balance?.entitlementOverrideDays !== null && balance?.entitlementOverrideDays !== undefined ? Number(balance.entitlementOverrideDays) : resolveLeaveEntitlementDays(leave.policy, leave.membership.joinedAt, year);
    const available = base + Number(balance?.carriedForwardDays ?? 0) + Number(balance?.adjustmentDays ?? 0) - Number(used._sum.dayFraction ?? 0);
    if (available < Number(leave.requestedDays)) throw new Error(`Insufficient leave balance. Available: ${available.toFixed(2)} day(s).`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.update({ where: { id: leave.id }, data: { status: decision.decision, reviewedById: input.actor.userId, reviewedAt: new Date(), reviewNote: decision.reviewNote || null } });
    if (decision.decision === "APPROVED" && leave.membership.staffUser) {
      const start = utcDateToDateValue(leave.startsOn);
      const endExclusive = addDaysToDateValue(utcDateToDateValue(leave.endsOn), 1);
      await tx.staffTimeOff.create({ data: { businessId: input.businessId, userId: leave.membership.staffUser.id, leaveRequestId: leave.id, startsAt: parseBusinessDateTime(start, "00:00"), endsAt: parseBusinessDateTime(endExclusive, "00:00"), reason: `${leave.policyNameSnapshot}: ${leave.reason}` } });
    }
    await writeAuditLog({ businessId: input.businessId, branchId: leave.branchId, actor: input.actor, request: input.request, action: `LEAVE_REQUEST_${decision.decision}`, entityType: "LeaveRequest", entityId: leave.id, summary: `${leave.policyNameSnapshot} ${decision.decision.toLowerCase()}.`, after: { status: decision.decision, reviewNote: decision.reviewNote || null } }, tx);
  });
}

export async function upsertEmployeeLeaveBalance(input: { businessId: string; allowedBranchIds: readonly string[]; actor: AppSession; request?: AuditRequestContext; rawInput: unknown }) {
  const data = leaveBalanceInputSchema.parse(input.rawInput);
  const [membership, policy] = await Promise.all([
    prisma.employeeBusinessMembership.findFirst({ where: { id: data.membershipId, businessId: input.businessId, branchAssignments: { some: { branchId: { in: [...input.allowedBranchIds] }, status: "ACTIVE" } } } }),
    prisma.leavePolicy.findFirst({ where: { id: data.policyId, businessId: input.businessId } }),
  ]);
  if (!membership || !policy) throw new Error("Employee or leave policy is outside your access scope.");
  const saved = await prisma.employeeLeaveBalance.upsert({
    where: { membershipId_policyId_year: { membershipId: data.membershipId, policyId: data.policyId, year: data.year } },
    create: { businessId: input.businessId, membershipId: data.membershipId, policyId: data.policyId, year: data.year, entitlementOverrideDays: data.entitlementOverrideDays === "" || data.entitlementOverrideDays === undefined ? null : data.entitlementOverrideDays, carriedForwardDays: data.carriedForwardDays, adjustmentDays: data.adjustmentDays, note: data.note || null },
    update: { entitlementOverrideDays: data.entitlementOverrideDays === "" || data.entitlementOverrideDays === undefined ? null : data.entitlementOverrideDays, carriedForwardDays: data.carriedForwardDays, adjustmentDays: data.adjustmentDays, note: data.note || null },
  });
  await writeAuditLog({ businessId: input.businessId, actor: input.actor, request: input.request, action: "LEAVE_BALANCE_UPDATED", entityType: "EmployeeLeaveBalance", entityId: saved.id, summary: `Leave balance updated for ${membership.fullName}.`, after: { year: data.year, policy: policy.code } });
}
