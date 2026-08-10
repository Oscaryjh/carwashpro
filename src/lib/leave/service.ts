import { createHash } from "node:crypto";
import type { AppSession } from "@/lib/auth/session";
import type { AuditRequestContext } from "@/lib/audit";
import { writeAuditLog } from "@/lib/audit";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth";
import { AttendanceApiError } from "@/lib/attendance/api-error";
import { addDaysToDateValue, parseBusinessDateTime, utcDateToDateValue } from "@/lib/business-time";
import { prisma } from "@/lib/prisma";
import type { LeavePolicyVersion, Prisma } from "@prisma/client";
import {
  COMPANY_LEAVE_STARTER,
  enumerateCalendarDates,
  leaveBalanceInputSchema,
  leaveCancelInputSchema,
  leaveManagerCancelInputSchema,
  leavePolicyVersionInputSchema,
  leaveRequestInputSchema,
  leaveReviewInputSchema,
  resolveLeaveEntitlementDays,
} from "./policy";

type LeaveTransaction = Prisma.TransactionClient;

export async function installCompanyLeaveStarter(businessId: string, actorUserId?: string) {
  const year = new Date().getUTCFullYear();
  await prisma.$transaction(async (tx) => {
    for (const item of COMPANY_LEAVE_STARTER) {
      const policy = await tx.leavePolicy.upsert({
        where: { businessId_code: { businessId, code: item.code } },
        create: {
          businessId,
          ...item,
          origin: "BUSINESS_CUSTOM",
          legalStatus: "COMPANY_POLICY_ONLY",
        },
        update: { active: true },
      });
      const existing = await tx.leavePolicyVersion.findFirst({
        where: { businessId, policyId: policy.id, legalStatus: "COMPANY_POLICY_ONLY" },
        select: { id: true },
      });
      if (!existing) {
        const latest = await tx.leavePolicyVersion.findFirst({
          where: { businessId, policyId: policy.id },
          orderBy: { revision: "desc" },
          select: { revision: true },
        });
        await tx.leavePolicyVersion.create({
          data: {
            businessId,
            policyId: policy.id,
            revision: (latest?.revision ?? 0) + 1,
            effectiveFrom: new Date(Date.UTC(year, 0, 1)),
            nameSnapshot: item.name,
            payTreatment: item.payTreatment,
            countMode: item.countMode,
            balanceTracked: item.balanceTracked,
            defaultEntitlementDays: item.defaultEntitlementDays,
            requiresDocument: item.requiresDocument ?? false,
            allowNegativeBalance: false,
            origin: "BUSINESS_CUSTOM",
            legalStatus: "COMPANY_POLICY_ONLY",
            sourceReference: "COMPANY_POLICY",
            reason: "Company-policy starter. This version does not assert a statutory minimum.",
            createdById: actorUserId,
          },
        });
      }
    }
  }, { isolationLevel: "Serializable" });
}

// Backward-compatible export; the old unverified legal preset is intentionally
// no longer installed. Callers receive the safe company-policy starter.
export const installPeninsularLabuanLeavePreset = installCompanyLeaveStarter;

export async function createCompanyLeavePolicyVersion(input: {
  businessId: string;
  actor: AppSession;
  request?: AuditRequestContext;
  rawInput: unknown;
}) {
  const data = leavePolicyVersionInputSchema.parse(input.rawInput);
  const effectiveFrom = new Date(`${data.effectiveFrom}T00:00:00.000Z`);
  return prisma.$transaction(async (tx) => {
    await lockLeaveKey(tx, `policy:${input.businessId}:${data.policyId}`);
    const policy = await tx.leavePolicy.findFirst({ where: { id: data.policyId, businessId: input.businessId } });
    if (!policy) throw new Error("Leave type is outside your business scope.");
    const latest = await tx.leavePolicyVersion.findFirst({
      where: { businessId: input.businessId, policyId: policy.id },
      orderBy: { revision: "desc" },
      select: { revision: true },
    });
    const nullable = (value: number | "" | undefined) => value === "" || value === undefined ? null : value;
    const version = await tx.leavePolicyVersion.create({
      data: {
        businessId: input.businessId,
        policyId: policy.id,
        revision: (latest?.revision ?? 0) + 1,
        effectiveFrom,
        nameSnapshot: data.name,
        payTreatment: data.payTreatment,
        countMode: data.countMode,
        balanceTracked: data.balanceTracked,
        defaultEntitlementDays: nullable(data.defaultEntitlementDays),
        underTwoYearsDays: nullable(data.underTwoYearsDays),
        twoToFiveYearsDays: nullable(data.twoToFiveYearsDays),
        fiveYearsPlusDays: nullable(data.fiveYearsPlusDays),
        requiresDocument: data.requiresDocument,
        allowNegativeBalance: data.allowNegativeBalance,
        origin: "BUSINESS_CUSTOM",
        legalStatus: "COMPANY_POLICY_ONLY",
        sourceReference: "COMPANY_POLICY",
        reason: data.reason,
        createdById: input.actor.userId,
      },
    });
    await tx.leavePolicy.update({
      where: { id: policy.id },
      data: {
        name: data.name,
        payTreatment: data.payTreatment,
        countMode: data.countMode,
        balanceTracked: data.balanceTracked,
        defaultEntitlementDays: nullable(data.defaultEntitlementDays),
        underTwoYearsDays: nullable(data.underTwoYearsDays),
        twoToFiveYearsDays: nullable(data.twoToFiveYearsDays),
        fiveYearsPlusDays: nullable(data.fiveYearsPlusDays),
        requiresDocument: data.requiresDocument,
        allowNegativeBalance: data.allowNegativeBalance,
        origin: "BUSINESS_CUSTOM",
        legalStatus: "COMPANY_POLICY_ONLY",
      },
    });
    await writeAuditLog({
      businessId: input.businessId,
      actor: input.actor,
      request: input.request,
      action: "LEAVE_POLICY_VERSION_CREATED",
      entityType: "LeavePolicyVersion",
      entityId: version.id,
      summary: `Company leave policy revision ${version.revision} created.`,
      after: { policyId: policy.id, revision: version.revision, effectiveFrom: data.effectiveFrom, legalStatus: "COMPANY_POLICY_ONLY" },
    }, tx);
    return version;
  }, { isolationLevel: "Serializable" });
}

export async function getEmployeeLeaveOverview(auth: EmployeeAuthContext) {
  const year = new Date().getUTCFullYear();
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  const today = new Date();
  const [membership, policies, entitlements, ledger, pending, requests] = await Promise.all([
    prisma.employeeBusinessMembership.findFirstOrThrow({
      where: { id: auth.membershipId, businessId: auth.businessId, status: "ACTIVE" },
      select: { id: true, fullName: true, employeeCode: true, joinedAt: true, terminatedAt: true },
    }),
    prisma.leavePolicy.findMany({
      where: { businessId: auth.businessId, active: true },
      include: { versions: { where: { effectiveFrom: { lte: today }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] }, orderBy: { revision: "desc" }, take: 1 } },
      orderBy: { name: "asc" },
    }),
    prisma.employeeLeaveEntitlement.findMany({ where: { businessId: auth.businessId, membershipId: auth.membershipId, leaveYearStart: from } }),
    prisma.leaveBalanceLedgerEntry.groupBy({
      by: ["policyId", "eventType"],
      where: { businessId: auth.businessId, membershipId: auth.membershipId, leaveYearStart: from },
      _sum: { units: true },
    }),
    prisma.leaveRequest.groupBy({
      by: ["policyId"],
      where: { businessId: auth.businessId, membershipId: auth.membershipId, status: "PENDING", startsOn: { gte: from, lt: to } },
      _sum: { requestedDays: true },
    }),
    prisma.leaveRequest.findMany({
      where: { businessId: auth.businessId, membershipId: auth.membershipId },
      orderBy: [{ startsOn: "desc" }, { createdAt: "desc" }],
      take: 50,
      select: {
        id: true, policyId: true, policyNameSnapshot: true, payTreatmentSnapshot: true,
        startsOn: true, endsOn: true, requestedDays: true, leaveUnit: true, reason: true,
        status: true, revision: true, reviewNote: true, cancellationReason: true, createdAt: true,
      },
    }),
  ]);
  const entitlementByPolicy = new Map(entitlements.map((row) => [row.policyId, Number(row.entitledUnits)]));
  const balanceByPolicy = new Map<string, number>();
  const usedByPolicy = new Map<string, number>();
  for (const row of ledger) {
    const units = Number(row._sum.units ?? 0);
    balanceByPolicy.set(row.policyId, (balanceByPolicy.get(row.policyId) ?? 0) + units);
    if (row.eventType === "APPROVED_CONSUMPTION") {
      usedByPolicy.set(row.policyId, (usedByPolicy.get(row.policyId) ?? 0) + Math.abs(units));
    } else if (row.eventType === "CANCELLATION_RESTORE") {
      usedByPolicy.set(row.policyId, Math.max(0, (usedByPolicy.get(row.policyId) ?? 0) - units));
    }
  }
  const pendingByPolicy = new Map(pending.map((row) => [row.policyId, Number(row._sum.requestedDays ?? 0)]));

  return {
    year,
    employee: { fullName: membership.fullName, employeeCode: membership.employeeCode },
    policies: policies.flatMap((policy) => {
      const version = policy.versions[0];
      if (!version) return [];
      const projected = resolveLeaveEntitlementDays(version, membership.joinedAt, year);
      const balance = balanceByPolicy.get(policy.id) ?? 0;
      return [{
        id: policy.id,
        code: policy.code,
        name: version.nameSnapshot,
        payTreatment: version.payTreatment,
        countMode: version.countMode,
        requiresDocument: version.requiresDocument,
        balanceTracked: version.balanceTracked,
        legalStatus: version.legalStatus,
        policyRevision: version.revision,
        entitlementDays: entitlementByPolicy.get(policy.id) ?? projected,
        usedDays: usedByPolicy.get(policy.id) ?? 0,
        pendingDays: pendingByPolicy.get(policy.id) ?? 0,
        remainingDays: version.balanceTracked ? balance : null,
        applicationReady: ["COMPANY_POLICY_ONLY", "VERIFIED_LEGAL"].includes(version.legalStatus),
        readinessCode: version.legalStatus === "LEGACY_REVIEW_REQUIRED" ? "LEGACY_LEAVE_REVIEW_REQUIRED" : version.legalStatus === "LEGAL_RULE_NOT_READY" ? "LEAVE_LEGAL_RULE_NOT_READY" : null,
      }];
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
  const existing = await prisma.leaveRequest.findFirst({
    where: { businessId: auth.businessId, membershipId: auth.membershipId, clientRequestId: input.clientRequestId },
  });
  if (existing) return replaySubmission(existing, input);

  const membership = await prisma.employeeBusinessMembership.findFirst({
    where: { id: auth.membershipId, businessId: auth.businessId, status: "ACTIVE" },
    select: { id: true, joinedAt: true, terminatedAt: true },
  });
  if (!membership) throw new AttendanceApiError("EMPLOYEE_INACTIVE", "Employee membership is unavailable.");
  const startsOn = new Date(`${input.startsOn}T00:00:00.000Z`);
  if (membership.terminatedAt && startsOn > membership.terminatedAt) {
    throw new AttendanceApiError("VALIDATION_ERROR", "Future leave cannot start after employment ended.");
  }
  const version = await resolvePolicyVersion(auth.businessId, input.policyId, startsOn);
  assertForwardPolicy(version);
  if (version.requiresDocument && !input.documentReference) {
    throw new AttendanceApiError("VALIDATION_ERROR", "Supporting document reference is required for this leave type.");
  }
  const daySnapshots = await buildLeaveDaySnapshots({
    businessId: auth.businessId,
    membershipId: auth.membershipId,
    version,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    leaveUnit: input.leaveUnit,
  });
  const requestedDays = daySnapshots.reduce((sum, day) => sum + day.fraction, 0);

  return prisma.$transaction(async (tx) => {
    await lockLeaveKey(tx, `submit:${auth.businessId}:${auth.membershipId}`);
    const replay = await tx.leaveRequest.findFirst({
      where: { businessId: auth.businessId, membershipId: auth.membershipId, clientRequestId: input.clientRequestId },
    });
    if (replay) return replaySubmission(replay, input);
    await assertNoPendingOrApprovedOverlap(tx, auth.businessId, auth.membershipId, daySnapshots);
    if (version.balanceTracked) {
      await ensureEntitlement(tx, { businessId: auth.businessId, membershipId: auth.membershipId, joinedAt: membership.joinedAt, policyId: input.policyId, version, year: startsOn.getUTCFullYear() });
    }
    const request = await tx.leaveRequest.create({
      data: {
        businessId: auth.businessId,
        membershipId: auth.membershipId,
        branchId: auth.attendanceBranchId ?? auth.primaryBranchId,
        policyId: input.policyId,
        policyVersionId: version.id,
        policyNameSnapshot: version.nameSnapshot,
        payTreatmentSnapshot: version.payTreatment,
        balanceTrackedSnapshot: version.balanceTracked,
        legalStatusSnapshot: version.legalStatus,
        leaveUnit: input.leaveUnit,
        startsOn,
        endsOn: new Date(`${input.endsOn}T00:00:00.000Z`),
        requestedDays,
        reason: input.reason,
        documentReference: input.documentReference || null,
        clientRequestId: input.clientRequestId,
        days: {
          create: daySnapshots.map((day) => ({
            businessId: auth.businessId,
            membershipId: auth.membershipId,
            leaveDate: day.date,
            dayFraction: day.fraction,
            leaveUnit: input.leaveUnit,
            expectedDayId: day.expectedDayId,
            expectedDayKindSnapshot: day.expectedKind,
            policyVersionId: version.id,
            payTreatmentSnapshot: version.payTreatment,
            balanceConsumptionUnits: day.fraction,
          })),
        },
      },
    });
    await tx.leaveApplicationEvent.create({
      data: {
        businessId: auth.businessId,
        leaveRequestId: request.id,
        revision: 0,
        eventType: "SUBMITTED",
        statusSnapshot: "PENDING",
        reason: "Employee submitted leave.",
        sourceKey: `leave-submit:${auth.businessId}:${auth.membershipId}:${input.clientRequestId}`,
        actorMembershipId: auth.membershipId,
      },
    });
    await writeAuditLog({
      businessId: auth.businessId,
      branchId: auth.attendanceBranchId ?? auth.primaryBranchId,
      action: "LEAVE_REQUEST_SUBMITTED",
      entityType: "LeaveRequest",
      entityId: request.id,
      summary: `Employee submitted ${version.nameSnapshot}.`,
      after: { policyVersionId: version.id, startsOn: input.startsOn, endsOn: input.endsOn, units: requestedDays, leaveUnit: input.leaveUnit },
    }, tx);
    return { id: request.id, status: request.status, revision: request.revision };
  }, { isolationLevel: "Serializable" });
}

export async function cancelEmployeeLeave(auth: EmployeeAuthContext, rawInput: unknown) {
  const input = leaveCancelInputSchema.parse(rawInput);
  await prisma.$transaction(async (tx) => {
    await lockLeaveKey(tx, `request:${auth.businessId}:${input.requestId}`);
    const request = await tx.leaveRequest.findFirst({ where: { id: input.requestId, businessId: auth.businessId, membershipId: auth.membershipId } });
    if (!request) throw new AttendanceApiError("INVALID_ATTENDANCE_STATE", "Leave request was not found.");
    if (request.status === "CANCELLED") return;
    if (request.status !== "PENDING") throw new AttendanceApiError("INVALID_ATTENDANCE_STATE", "Only a pending request can be withdrawn by the employee.");
    if (request.revision !== input.expectedRevision) throw new AttendanceApiError("INVALID_ATTENDANCE_STATE", "LEAVE_APPLICATION_UPDATED: refresh and try again.");
    const updated = await tx.leaveRequest.updateMany({
      where: { id: request.id, status: "PENDING", revision: input.expectedRevision },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: input.reason, revision: { increment: 1 } },
    });
    if (updated.count !== 1) throw new AttendanceApiError("INVALID_ATTENDANCE_STATE", "LEAVE_APPLICATION_UPDATED: refresh and try again.");
    await tx.leaveApplicationEvent.create({ data: {
      businessId: auth.businessId,
      leaveRequestId: request.id,
      revision: input.expectedRevision + 1,
      eventType: "WITHDRAWN",
      statusSnapshot: "CANCELLED",
      reason: input.reason,
      sourceKey: `leave-withdraw:${request.id}`,
      actorMembershipId: auth.membershipId,
    } });
    await writeAuditLog({ businessId: auth.businessId, branchId: request.branchId, action: "LEAVE_REQUEST_WITHDRAWN", entityType: "LeaveRequest", entityId: request.id, summary: "Employee withdrew a pending leave request." }, tx);
  }, { isolationLevel: "Serializable" });
}

export async function getManagerLeaveDashboard(input: { businessId: string; allowedBranchIds: readonly string[]; year: number }) {
  const from = new Date(Date.UTC(input.year, 0, 1));
  const to = new Date(Date.UTC(input.year + 1, 0, 1));
  const [policies, requests, employees, ledger] = await Promise.all([
    prisma.leavePolicy.findMany({
      where: { businessId: input.businessId },
      include: { versions: { orderBy: { revision: "desc" }, take: 1 } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    prisma.leaveRequest.findMany({
      where: { businessId: input.businessId, branchId: { in: [...input.allowedBranchIds] }, startsOn: { lt: to }, endsOn: { gte: from } },
      include: {
        membership: { select: { id: true, fullName: true, employeeCode: true } },
        branch: { select: { id: true, name: true } },
        reviewedBy: { select: { name: true } },
      },
      orderBy: [{ status: "asc" }, { startsOn: "asc" }],
      take: 200,
    }),
    prisma.employeeBusinessMembership.findMany({
      where: { businessId: input.businessId, status: "ACTIVE", branchAssignments: { some: { branchId: { in: [...input.allowedBranchIds] }, status: "ACTIVE" } } },
      select: { id: true, fullName: true, employeeCode: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.leaveBalanceLedgerEntry.groupBy({
      by: ["membershipId", "policyId"],
      where: { businessId: input.businessId, leaveYearStart: from },
      _sum: { units: true },
    }),
  ]);
  const balanceMap = new Map(ledger.map((row) => [`${row.membershipId}:${row.policyId}`, Number(row._sum.units ?? 0)]));
  return {
    policies: policies.map((policy) => ({ ...policy, latestVersion: policy.versions[0] ? serializeVersion(policy.versions[0]) : null })),
    employees,
    requests: requests.map((request) => ({
      id: request.id,
      employee: request.membership,
      branch: request.branch,
      policyId: request.policyId,
      policyName: request.policyNameSnapshot,
      policyRevision: request.policyVersionId,
      payTreatment: request.payTreatmentSnapshot,
      legalStatus: request.legalStatusSnapshot,
      startsOn: utcDateToDateValue(request.startsOn),
      endsOn: utcDateToDateValue(request.endsOn),
      requestedDays: Number(request.requestedDays),
      leaveUnit: request.leaveUnit,
      reason: request.reason,
      documentReference: request.documentReference,
      status: request.status,
      revision: request.revision,
      reviewNote: request.reviewNote,
      cancellationReason: request.cancellationReason,
      reviewedBy: request.reviewedBy?.name ?? null,
      currentBalance: request.balanceTrackedSnapshot ? balanceMap.get(`${request.membershipId}:${request.policyId}`) ?? 0 : null,
      resultingBalance: request.balanceTrackedSnapshot
        ? request.status === "PENDING"
          ? (balanceMap.get(`${request.membershipId}:${request.policyId}`) ?? 0) - Number(request.requestedDays)
          : balanceMap.get(`${request.membershipId}:${request.policyId}`) ?? 0
        : null,
    })),
    balances: ledger.map((row) => ({ membershipId: row.membershipId, policyId: row.policyId, units: Number(row._sum.units ?? 0) })),
    summary: { pending: requests.filter((request) => request.status === "PENDING").length, approved: requests.filter((request) => request.status === "APPROVED").length, employees: employees.length },
  };
}

export async function reviewLeaveRequest(input: { businessId: string; allowedBranchIds: readonly string[]; actor: AppSession; request?: AuditRequestContext; rawInput: unknown }) {
  const decision = leaveReviewInputSchema.parse(input.rawInput);
  return prisma.$transaction(async (tx) => {
    const leave = await tx.leaveRequest.findFirst({
      where: { id: decision.requestId, businessId: input.businessId, branchId: { in: [...input.allowedBranchIds] } },
      include: { membership: { include: { staffUser: { select: { id: true } } } }, days: true, policyVersion: true },
    });
    if (!leave) throw new Error("Leave request is unavailable in your branch scope.");
    await lockLeaveKey(tx, `approval:${leave.businessId}:${leave.membershipId}:${leave.policyId}:${leave.startsOn.getUTCFullYear()}`);
    if (leave.status === decision.decision) return { id: leave.id, status: leave.status, revision: leave.revision };
    if (leave.status !== "PENDING" || leave.revision !== decision.expectedRevision) throw new Error("LEAVE_APPLICATION_UPDATED: refresh before reviewing.");
    if (leave.membership.staffUser?.id === input.actor.userId) throw new Error("Employees cannot approve or reject their own Leave application.");
    if (decision.decision === "APPROVED") {
      assertForwardPolicy(leave.policyVersion);
      await assertNoApprovedOverlap(tx, leave);
      if (leave.balanceTrackedSnapshot) {
        await ensureEntitlement(tx, {
          businessId: input.businessId,
          membershipId: leave.membershipId,
          joinedAt: leave.membership.joinedAt,
          policyId: leave.policyId,
          version: leave.policyVersion,
          year: leave.startsOn.getUTCFullYear(),
          actorUserId: input.actor.userId,
        });
        const available = await getLedgerBalance(tx, input.businessId, leave.membershipId, leave.policyId, leave.startsOn.getUTCFullYear());
        if (!leave.policyVersion.allowNegativeBalance && available < Number(leave.requestedDays)) {
          throw new Error(`Insufficient leave balance. Available: ${available.toFixed(2)} day(s).`);
        }
        await tx.leaveBalanceLedgerEntry.create({ data: {
          businessId: input.businessId,
          membershipId: leave.membershipId,
          policyId: leave.policyId,
          policyVersionId: leave.policyVersionId,
          leaveYearStart: yearStart(leave.startsOn.getUTCFullYear()),
          eventType: "APPROVED_CONSUMPTION",
          units: -Number(leave.requestedDays),
          sourceKey: `leave-approval:${leave.id}`,
          leaveRequestId: leave.id,
          reason: "Approved leave balance consumption.",
          actorUserId: input.actor.userId,
        } });
      }
    }
    const nextRevision = leave.revision + 1;
    const digest = sha256({ requestId: leave.id, policyVersionId: leave.policyVersionId, payTreatment: leave.payTreatmentSnapshot, units: leave.requestedDays.toString(), decision: decision.decision });
    const updated = await tx.leaveRequest.updateMany({
      where: { id: leave.id, status: "PENDING", revision: decision.expectedRevision },
      data: { status: decision.decision, revision: nextRevision, reviewedById: input.actor.userId, reviewedAt: new Date(), reviewNote: decision.reviewNote || null, decisionDigest: digest },
    });
    if (updated.count !== 1) throw new Error("LEAVE_APPLICATION_UPDATED: refresh before reviewing.");
    if (decision.decision === "APPROVED" && leave.membership.staffUser) {
      const start = utcDateToDateValue(leave.startsOn);
      const endExclusive = addDaysToDateValue(utcDateToDateValue(leave.endsOn), 1);
      await tx.staffTimeOff.upsert({
        where: { leaveRequestId: leave.id },
        create: { businessId: input.businessId, userId: leave.membership.staffUser.id, leaveRequestId: leave.id, startsAt: parseBusinessDateTime(start, "00:00"), endsAt: parseBusinessDateTime(endExclusive, "00:00"), reason: leave.policyNameSnapshot },
        update: {},
      });
    }
    await tx.leaveApplicationEvent.create({ data: {
      businessId: input.businessId,
      leaveRequestId: leave.id,
      revision: nextRevision,
      eventType: decision.decision,
      statusSnapshot: decision.decision,
      reason: decision.reviewNote || (decision.decision === "APPROVED" ? "Approved." : "Rejected."),
      sourceKey: `leave-decision:${leave.id}:${decision.decision}`,
      actorUserId: input.actor.userId,
    } });
    await writeAuditLog({
      businessId: input.businessId,
      branchId: leave.branchId,
      actor: input.actor,
      request: input.request,
      action: `LEAVE_REQUEST_${decision.decision}`,
      entityType: "LeaveRequest",
      entityId: leave.id,
      summary: `${leave.policyNameSnapshot} ${decision.decision.toLowerCase()}.`,
      after: { status: decision.decision, revision: nextRevision, decisionDigest: digest },
    }, tx);
    return { id: leave.id, status: decision.decision, revision: nextRevision };
  }, { isolationLevel: "Serializable" });
}

export async function cancelApprovedLeaveRequest(input: { businessId: string; allowedBranchIds: readonly string[]; actor: AppSession; request?: AuditRequestContext; rawInput: unknown }) {
  const data = leaveManagerCancelInputSchema.parse(input.rawInput);
  return prisma.$transaction(async (tx) => {
    const leave = await tx.leaveRequest.findFirst({ where: { id: data.requestId, businessId: input.businessId, branchId: { in: [...input.allowedBranchIds] } } });
    if (!leave) throw new Error("Leave request is unavailable in your branch scope.");
    await lockLeaveKey(tx, `approval:${leave.businessId}:${leave.membershipId}:${leave.policyId}:${leave.startsOn.getUTCFullYear()}`);
    if (leave.status === "CANCELLED") return { id: leave.id, status: leave.status, revision: leave.revision };
    if (leave.status !== "APPROVED" || leave.revision !== data.expectedRevision) throw new Error("LEAVE_APPLICATION_UPDATED: refresh before cancelling.");
    const nextRevision = leave.revision + 1;
    const updated = await tx.leaveRequest.updateMany({
      where: { id: leave.id, status: "APPROVED", revision: data.expectedRevision },
      data: { status: "CANCELLED", revision: nextRevision, cancelledAt: new Date(), cancelledById: input.actor.userId, cancellationReason: data.reason },
    });
    if (updated.count !== 1) throw new Error("LEAVE_APPLICATION_UPDATED: refresh before cancelling.");
    if (leave.balanceTrackedSnapshot) {
      await tx.leaveBalanceLedgerEntry.create({ data: {
        businessId: input.businessId,
        membershipId: leave.membershipId,
        policyId: leave.policyId,
        policyVersionId: leave.policyVersionId,
        leaveYearStart: yearStart(leave.startsOn.getUTCFullYear()),
        eventType: "CANCELLATION_RESTORE",
        units: Number(leave.requestedDays),
        sourceKey: `leave-cancel-restore:${leave.id}`,
        leaveRequestId: leave.id,
        reason: data.reason,
        actorUserId: input.actor.userId,
      } });
    }
    await tx.staffTimeOff.deleteMany({ where: { businessId: input.businessId, leaveRequestId: leave.id } });
    await tx.leaveApplicationEvent.create({ data: {
      businessId: input.businessId,
      leaveRequestId: leave.id,
      revision: nextRevision,
      eventType: "CANCELLED",
      statusSnapshot: "CANCELLED",
      reason: data.reason,
      sourceKey: `leave-manager-cancel:${leave.id}`,
      actorUserId: input.actor.userId,
    } });
    await writeAuditLog({ businessId: input.businessId, branchId: leave.branchId, actor: input.actor, request: input.request, action: "LEAVE_REQUEST_CANCELLED", entityType: "LeaveRequest", entityId: leave.id, summary: "Manager cancelled approved leave and restored its balance once.", after: { revision: nextRevision } }, tx);
    return { id: leave.id, status: "CANCELLED" as const, revision: nextRevision };
  }, { isolationLevel: "Serializable" });
}

export async function upsertEmployeeLeaveBalance(input: { businessId: string; allowedBranchIds: readonly string[]; actor: AppSession; request?: AuditRequestContext; rawInput: unknown }) {
  const data = leaveBalanceInputSchema.parse(input.rawInput);
  return prisma.$transaction(async (tx) => {
    await lockLeaveKey(tx, `balance:${input.businessId}:${data.membershipId}:${data.policyId}:${data.year}`);
    const [membership, version] = await Promise.all([
      tx.employeeBusinessMembership.findFirst({ where: { id: data.membershipId, businessId: input.businessId, branchAssignments: { some: { branchId: { in: [...input.allowedBranchIds] }, status: "ACTIVE" } } } }),
      resolvePolicyVersion(input.businessId, data.policyId, yearStart(data.year), tx),
    ]);
    if (!membership || !version) throw new Error("Employee or leave policy is outside your access scope.");
    assertForwardPolicy(version);
    await ensureEntitlement(tx, { businessId: input.businessId, membershipId: membership.id, joinedAt: membership.joinedAt, policyId: data.policyId, version, year: data.year, actorUserId: input.actor.userId });
    const saved = await tx.leaveBalanceLedgerEntry.create({ data: {
      businessId: input.businessId,
      membershipId: membership.id,
      policyId: data.policyId,
      policyVersionId: version.id,
      leaveYearStart: yearStart(data.year),
      eventType: "MANUAL_ADJUSTMENT",
      units: data.units,
      sourceKey: `leave-adjustment:${input.businessId}:${data.sourceKey}`,
      reason: data.reason,
      actorUserId: input.actor.userId,
    } });
    await writeAuditLog({ businessId: input.businessId, actor: input.actor, request: input.request, action: "LEAVE_BALANCE_ADJUSTED", entityType: "LeaveBalanceLedgerEntry", entityId: saved.id, summary: `Leave balance adjusted for ${membership.fullName}.`, after: { year: data.year, policyId: data.policyId, units: data.units } }, tx);
    return saved;
  }, { isolationLevel: "Serializable" });
}

async function resolvePolicyVersion(businessId: string, policyId: string, effectiveDate: Date, tx: LeaveTransaction | typeof prisma = prisma) {
  const policy = await tx.leavePolicy.findFirst({ where: { id: policyId, businessId, active: true }, select: { id: true } });
  if (!policy) throw new AttendanceApiError("VALIDATION_ERROR", "Leave type is unavailable.");
  const version = await tx.leavePolicyVersion.findFirst({
    where: { businessId, policyId, effectiveFrom: { lte: effectiveDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveDate } }] },
    orderBy: [{ effectiveFrom: "desc" }, { revision: "desc" }],
  });
  if (!version) throw new AttendanceApiError("VALIDATION_ERROR", "LEAVE_POLICY_NOT_READY: no effective policy version exists.");
  return version;
}

function assertForwardPolicy(version: LeavePolicyVersion) {
  if (version.legalStatus === "LEGACY_REVIEW_REQUIRED") throw new Error("LEGACY_LEAVE_REVIEW_REQUIRED: create an effective company policy revision before new use.");
  if (version.legalStatus === "LEGAL_RULE_NOT_READY") throw new Error("LEAVE_LEGAL_RULE_NOT_READY: configure a company policy or activate a verified legal rule.");
}

async function buildLeaveDaySnapshots(input: { businessId: string; membershipId: string; version: LeavePolicyVersion; startsOn: string; endsOn: string; leaveUnit: "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" }) {
  const dates = enumerateCalendarDates(input.startsOn, input.endsOn);
  if (input.leaveUnit !== "FULL_DAY" && dates.length !== 1) throw new Error("Half-day leave must cover one date only.");
  const dateObjects = dates.map((date) => new Date(`${date}T00:00:00.000Z`));
  const evidence = await prisma.attendanceExpectedDay.findMany({
    where: { businessId: input.businessId, membershipId: input.membershipId, workDate: { in: dateObjects }, status: "CURRENT" },
    orderBy: { revision: "desc" },
  });
  const latest = new Map<string, (typeof evidence)[number]>();
  for (const item of evidence) {
    const key = utcDateToDateValue(item.workDate);
    if (!latest.has(key)) latest.set(key, item);
  }
  if (input.version.countMode === "WEEKDAYS") {
    const missing = dates.filter((date) => !latest.has(date));
    if (missing.length) throw new Error(`LEAVE_EXPECTED_ATTENDANCE_NOT_READY: ${missing[0]} has no current expected-attendance evidence.`);
  }
  const included = dates.flatMap((date) => {
    const expected = latest.get(date);
    if (input.version.countMode === "WEEKDAYS" && expected?.kind !== "WORKDAY") return [];
    const fraction = input.leaveUnit === "FULL_DAY" ? 1 : 0.5;
    return [{ date: new Date(`${date}T00:00:00.000Z`), dateValue: date, fraction, expectedDayId: expected?.id ?? null, expectedKind: expected?.kind ?? null, leaveUnit: input.leaveUnit }];
  });
  if (!included.length) throw new Error("The selected period contains no countable leave workday.");
  return included;
}

async function assertNoPendingOrApprovedOverlap(tx: LeaveTransaction, businessId: string, membershipId: string, days: Array<{ date: Date; leaveUnit: string }>) {
  const existing = await tx.leaveRequestDay.findMany({
    where: { businessId, membershipId, leaveDate: { in: days.map((day) => day.date) }, leaveRequest: { status: { in: ["PENDING", "APPROVED"] } } },
    select: { leaveDate: true, leaveUnit: true },
  });
  const conflict = existing.some((row) => days.some((day) => day.date.getTime() === row.leaveDate.getTime() && (day.leaveUnit === "FULL_DAY" || row.leaveUnit === "FULL_DAY" || day.leaveUnit === row.leaveUnit)));
  if (conflict) throw new AttendanceApiError("INVALID_ATTENDANCE_STATE", "A pending or approved leave application overlaps this period.");
}

async function assertNoApprovedOverlap(tx: LeaveTransaction, leave: { id: string; businessId: string; membershipId: string; days: Array<{ leaveDate: Date; leaveUnit: string }> }) {
  const existing = await tx.leaveRequestDay.findMany({
    where: { businessId: leave.businessId, membershipId: leave.membershipId, leaveDate: { in: leave.days.map((day) => day.leaveDate) }, leaveRequestId: { not: leave.id }, leaveRequest: { status: "APPROVED" } },
    select: { leaveDate: true, leaveUnit: true },
  });
  const conflict = existing.some((row) => leave.days.some((day) => day.leaveDate.getTime() === row.leaveDate.getTime() && (day.leaveUnit === "FULL_DAY" || row.leaveUnit === "FULL_DAY" || day.leaveUnit === row.leaveUnit)));
  if (conflict) throw new Error("LEAVE_OVERLAP: another approved Leave application covers this time.");
}

async function ensureEntitlement(tx: LeaveTransaction, input: { businessId: string; membershipId: string; joinedAt: Date; policyId: string; version: LeavePolicyVersion; year: number; actorUserId?: string }) {
  const start = yearStart(input.year);
  const existing = await tx.employeeLeaveEntitlement.findFirst({ where: { businessId: input.businessId, membershipId: input.membershipId, policyId: input.policyId, leaveYearStart: start } });
  if (existing) return existing;
  const units = resolveLeaveEntitlementDays(input.version, input.joinedAt, input.year);
  const digest = sha256({ businessId: input.businessId, membershipId: input.membershipId, policyVersionId: input.version.id, year: input.year, units });
  const entitlement = await tx.employeeLeaveEntitlement.create({ data: {
    businessId: input.businessId,
    membershipId: input.membershipId,
    policyId: input.policyId,
    policyVersionId: input.version.id,
    leaveYearStart: start,
    leaveYearEnd: new Date(Date.UTC(input.year, 11, 31)),
    entitledUnits: units,
    source: input.version.legalStatus === "VERIFIED_LEGAL" ? "VERIFIED_LEGAL_POLICY" : "COMPANY_POLICY",
    sourceDigest: digest,
    createdById: input.actorUserId,
  } });
  if (units !== 0) {
    await tx.leaveBalanceLedgerEntry.create({ data: {
      businessId: input.businessId,
      membershipId: input.membershipId,
      policyId: input.policyId,
      policyVersionId: input.version.id,
      leaveYearStart: start,
      eventType: "ENTITLEMENT",
      units,
      sourceKey: `leave-entitlement:${entitlement.id}`,
      entitlementId: entitlement.id,
      reason: "Deterministic entitlement from the frozen policy version.",
      actorUserId: input.actorUserId,
    } });
  }
  return entitlement;
}

async function getLedgerBalance(tx: LeaveTransaction, businessId: string, membershipId: string, policyId: string, year: number) {
  const result = await tx.leaveBalanceLedgerEntry.aggregate({ where: { businessId, membershipId, policyId, leaveYearStart: yearStart(year) }, _sum: { units: true } });
  return Number(result._sum.units ?? 0);
}

async function lockLeaveKey(tx: LeaveTransaction, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

function replaySubmission(existing: { id: string; status: string; revision: number; policyId: string; startsOn: Date; endsOn: Date; leaveUnit: string; reason: string }, input: ReturnType<typeof leaveRequestInputSchema.parse>) {
  if (existing.policyId !== input.policyId || utcDateToDateValue(existing.startsOn) !== input.startsOn || utcDateToDateValue(existing.endsOn) !== input.endsOn || existing.leaveUnit !== input.leaveUnit || existing.reason !== input.reason) {
    throw new AttendanceApiError("INVALID_ATTENDANCE_STATE", "Leave submission key was already used with different facts.");
  }
  return { id: existing.id, status: existing.status, revision: existing.revision };
}

function yearStart(yearOrDate: number | Date) {
  const year = typeof yearOrDate === "number" ? yearOrDate : yearOrDate.getUTCFullYear();
  return new Date(Date.UTC(year, 0, 1));
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function serializeVersion(version: LeavePolicyVersion) {
  return {
    ...version,
    effectiveFrom: utcDateToDateValue(version.effectiveFrom),
    effectiveTo: version.effectiveTo ? utcDateToDateValue(version.effectiveTo) : null,
    defaultEntitlementDays: version.defaultEntitlementDays === null ? null : Number(version.defaultEntitlementDays),
    underTwoYearsDays: version.underTwoYearsDays === null ? null : Number(version.underTwoYearsDays),
    twoToFiveYearsDays: version.twoToFiveYearsDays === null ? null : Number(version.twoToFiveYearsDays),
    fiveYearsPlusDays: version.fiveYearsPlusDays === null ? null : Number(version.fiveYearsPlusDays),
  };
}
