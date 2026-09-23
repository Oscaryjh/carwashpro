import type { AttendanceExpectedDayKind, LeaveEvidenceStatus, LeaveUnit, PrismaClient } from "@prisma/client";
import { parsePayrollMonth } from "@/lib/payroll/period";

export type LeavePayrollConflictKind = "PENDING_APPROVAL" | "EVIDENCE_REVIEW";

export type LeavePayrollConflictFact = {
  branchId: string;
  kind: LeavePayrollConflictKind;
  membershipId: string;
  relevantDates: string[];
};

type LeaveConflictDay = {
  branchId: string;
  expectedDayKind: AttendanceExpectedDayKind | null;
  evidenceRequired: boolean;
  evidenceStatus: LeaveEvidenceStatus;
  leaveDate: Date;
  leaveRequestId: string;
  leaveUnit: LeaveUnit;
  membershipId: string;
};

/**
 * Reads the smallest canonical Leave context needed by Payroll issues.
 *
 * Pending requests are the only mutable Leave state surfaced here. Approved
 * leave is normal payroll input and rejected/cancelled leave has no downstream
 * effect. Once the monthly Timesheet is locked its frozen evidence is
 * authoritative, so live Leave is deliberately not read at all.
 */
export async function loadLeavePayrollConflictContext(input: {
  allowedBranchIds: readonly string[];
  businessId: string;
  membershipIds: readonly string[];
  month: string;
  timesheetLocked: boolean;
}, database: Pick<PrismaClient, "leaveRequestDay">): Promise<LeavePayrollConflictFact[]> {
  if (input.timesheetLocked || input.allowedBranchIds.length === 0 || input.membershipIds.length === 0) return [];
  const period = parsePayrollMonth(input.month);
  const rows = await database.leaveRequestDay.findMany({
    where: {
      businessId: input.businessId,
      membershipId: { in: [...input.membershipIds] },
      leaveDate: { gte: period.start, lt: period.end },
      leaveRequest: {
        branchId: { in: [...input.allowedBranchIds] },
        status: "PENDING",
      },
    },
    orderBy: [{ membershipId: "asc" }, { leaveDate: "asc" }, { leaveRequestId: "asc" }],
    select: {
      expectedDayKindSnapshot: true,
      leaveDate: true,
      leaveRequestId: true,
      leaveUnit: true,
      membershipId: true,
      leaveRequest: {
        select: {
          branchId: true,
          supportingEvidenceRequiredSnapshot: true,
          supportingEvidenceStatus: true,
        },
      },
    },
  });
  return resolveLeavePayrollConflicts(rows.map((row) => ({
    branchId: row.leaveRequest.branchId,
    expectedDayKind: row.expectedDayKindSnapshot,
    evidenceRequired: row.leaveRequest.supportingEvidenceRequiredSnapshot,
    evidenceStatus: row.leaveRequest.supportingEvidenceStatus,
    leaveDate: row.leaveDate,
    leaveRequestId: row.leaveRequestId,
    leaveUnit: row.leaveUnit,
    membershipId: row.membershipId,
  })));
}

export function resolveLeavePayrollConflicts(rows: readonly LeaveConflictDay[]): LeavePayrollConflictFact[] {
  const payrollRelevant = rows.filter((row) =>
    row.expectedDayKind === null || row.expectedDayKind === "WORKDAY",
  );
  const grouped = new Map<string, LeaveConflictDay[]>();
  for (const row of payrollRelevant) {
    const key = `${row.membershipId}:${row.leaveRequestId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return [...grouped.values()].map((requestDays) => {
    const first = requestDays[0]!;
    const evidenceNeedsReview = first.evidenceRequired && first.evidenceStatus !== "VERIFIED";
    return {
      branchId: first.branchId,
      kind: evidenceNeedsReview ? "EVIDENCE_REVIEW" : "PENDING_APPROVAL",
      membershipId: first.membershipId,
      relevantDates: [...new Set(requestDays.map((day) => day.leaveDate.toISOString().slice(0, 10)))],
    };
  });
}
