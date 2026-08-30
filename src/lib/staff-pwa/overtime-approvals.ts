import type { PrismaClient } from "@prisma/client";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import type { AttendanceServiceContext } from "@/lib/attendance/employee-service";
import {
  decideAttendanceOvertime,
  listAttendanceOvertimeCandidates,
} from "@/lib/attendance/overtime-service";
import type { AuditRequestContext } from "@/lib/audit";
import type { AppSession } from "@/lib/auth/session";
import { canDirectStaff } from "@/lib/business-groups/capabilities";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import { prisma } from "@/lib/prisma";

type OvertimeApprovalDatabase = PrismaClient;

export type StaffOvertimeAccess = Readonly<{
  actor: AppSession;
  businessId: string;
  allowedBranchIds: readonly string[];
  wholeBusinessScope: boolean;
}>;

export async function resolveStaffOvertimeAccess(
  auth: EmployeeAuthContext,
  database: OvertimeApprovalDatabase = prisma,
): Promise<StaffOvertimeAccess | null> {
  const membership = await database.employeeBusinessMembership.findFirst({
    where: {
      id: auth.membershipId,
      businessId: auth.businessId,
      status: "ACTIVE",
    },
    select: {
      staffUser: {
        select: {
          id: true,
          businessId: true,
          branchId: true,
          name: true,
          email: true,
          role: true,
          permissions: true,
          status: true,
        },
      },
    },
  });
  const user = membership?.staffUser;
  if (!user || user.businessId !== auth.businessId || user.status !== "active") return null;

  const moduleContext = await loadBusinessModuleContext(auth.businessId, { database });
  const canReviewOvertime = moduleContext.enabledModules.has("HR") && (
    user.role === "BUSINESS_OWNER" ||
    (user.role === "STAFF" && canDirectStaff(user.permissions, "MODIFY_ATTENDANCE_EMPLOYEES"))
  );
  if (!canReviewOvertime) return null;

  const activeBranches = await database.branch.findMany({
    where: { businessId: auth.businessId, status: "ACTIVE" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const activeBranchIds = activeBranches.map((branch) => branch.id);
  const wholeBusinessScope = user.role === "BUSINESS_OWNER" || user.permissions.includes("ALL_BRANCHES");
  const currentBranchId = [user.branchId, auth.attendanceBranchId, auth.primaryBranchId]
    .find((branchId): branchId is string => Boolean(branchId && activeBranchIds.includes(branchId)));
  const allowedBranchIds = wholeBusinessScope
    ? activeBranchIds
    : currentBranchId ? [currentBranchId] : [];
  if (!allowedBranchIds.length) return null;

  return {
    actor: {
      userId: user.id,
      homeBusinessId: user.businessId,
      activeBusinessId: user.businessId,
      contextVersion: 1,
      businessId: user.businessId,
      branchId: currentBranchId ?? null,
      name: user.name,
      email: user.email ?? "",
      role: user.role,
      permissions: user.permissions,
      status: user.status,
    },
    businessId: auth.businessId,
    allowedBranchIds,
    wholeBusinessScope,
  };
}

export async function getStaffOvertimeSummary(auth: EmployeeAuthContext) {
  const access = await resolveStaffOvertimeAccess(auth);
  if (!access) return null;
  const period = overtimeMonthPeriod(currentMonthValue());
  const candidates = await listAttendanceOvertimeCandidates({
    businessId: access.businessId,
    allowedBranchIds: access.allowedBranchIds,
    ...period,
  });
  return {
    canReviewOvertime: true as const,
    pending: candidates.filter((candidate) =>
      candidate.employeeUserId !== access.actor.userId &&
      candidate.effectiveStatus === "PENDING_REVIEW"
    ).length,
  };
}

export async function getStaffOvertimeQueue(input: {
  auth: EmployeeAuthContext;
  month?: string;
  database?: OvertimeApprovalDatabase;
}) {
  const database = input.database ?? prisma;
  const access = await resolveStaffOvertimeAccess(input.auth, database);
  if (!access) return null;
  const month = validMonth(input.month) ? input.month : currentMonthValue();
  const period = overtimeMonthPeriod(month);
  const candidates = await listAttendanceOvertimeCandidates({
    businessId: access.businessId,
    allowedBranchIds: access.allowedBranchIds,
    ...period,
    database,
  });
  const visible = candidates.filter((candidate) => candidate.employeeUserId !== access.actor.userId);
  const facts = await loadFinalResultFacts(visible.map((candidate) => candidate.finalResultId), access, database);
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const items = visible.flatMap((candidate) => {
    const fact = factById.get(candidate.finalResultId);
    return fact ? [{ ...candidate, ...fact }] : [];
  }).sort((left, right) => {
    const leftPending = left.effectiveStatus === "PENDING_REVIEW" ? 0 : 1;
    const rightPending = right.effectiveStatus === "PENDING_REVIEW" ? 0 : 1;
    return leftPending - rightPending || right.workDate.getTime() - left.workDate.getTime();
  });
  return {
    access,
    month,
    items,
    pending: items.filter((item) => item.effectiveStatus === "PENDING_REVIEW").length,
  };
}

export async function getStaffOvertimeDetail(
  auth: EmployeeAuthContext,
  finalResultId: string,
  database: OvertimeApprovalDatabase = prisma,
) {
  const access = await resolveStaffOvertimeAccess(auth, database);
  if (!access) return null;
  const source = await database.attendanceP2FinalResult.findFirst({
    where: {
      id: finalResultId,
      businessId: access.businessId,
      branchId: { in: [...access.allowedBranchIds] },
    },
    select: { workDate: true },
  });
  if (!source) return null;
  const month = source.workDate.toISOString().slice(0, 7);
  const queue = await getStaffOvertimeQueue({ auth, month, database });
  if (!queue) return null;
  const item = queue.items.find((candidate) => candidate.finalResultId === finalResultId);
  if (!item) return null;
  const periodStart = overtimeMonthPeriod(month).periodStart;
  const timesheet = await database.attendanceMonthlyTimesheet.findUnique({
    where: { businessId_periodStart: { businessId: access.businessId, periodStart } },
    select: { status: true, approvalRevision: true },
  });
  return {
    access,
    item,
    month,
    timesheetStatus: timesheet?.status ?? "DRAFT",
    timesheetRevision: timesheet?.approvalRevision ?? 0,
    locked: timesheet?.status === "LOCKED",
  };
}

export async function decideStaffOvertime(input: {
  auth: EmployeeAuthContext;
  finalResultId: string;
  expectedRevision: number;
  decision: "APPROVE" | "ADJUST" | "REJECT";
  approvedMinutes?: number;
  reason?: string;
  request?: AuditRequestContext;
}) {
  const access = await resolveStaffOvertimeAccess(input.auth);
  if (!access) throw new Error("You do not have permission to review overtime in this workplace.");
  const context: AttendanceServiceContext = {
    businessId: access.businessId,
    allowedBranchIds: access.allowedBranchIds,
    wholeBusinessScope: access.wholeBusinessScope,
    actor: access.actor,
    request: input.request,
  };
  return decideAttendanceOvertime({
    context,
    finalResultId: input.finalResultId,
    expectedRevision: input.expectedRevision,
    input: input.decision === "REJECT"
      ? { decision: "REJECT", reason: input.reason ?? "" }
      : input.decision === "ADJUST"
        ? { decision: "ADJUST", approvedMinutes: input.approvedMinutes ?? Number.NaN, reason: input.reason ?? "" }
        : { decision: "APPROVE" },
  });
}

function loadFinalResultFacts(
  finalResultIds: string[],
  access: StaffOvertimeAccess,
  database: OvertimeApprovalDatabase,
) {
  if (!finalResultIds.length) return Promise.resolve([]);
  return database.attendanceP2FinalResult.findMany({
    where: {
      id: { in: finalResultIds },
      businessId: access.businessId,
      branchId: { in: [...access.allowedBranchIds] },
    },
    select: {
      id: true,
      outcome: true,
      expectedDayKindSnapshot: true,
      expectedStartAt: true,
      expectedEndAt: true,
      actualClockInAt: true,
      actualClockOutAt: true,
      totalBreakMinutes: true,
      totalWorkedMinutes: true,
    },
  });
}

function validMonth(value?: string): value is string {
  return Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));
}

function currentMonthValue(now = new Date()) {
  const malaysia = new Date(now.getTime() + 8 * 60 * 60 * 1_000);
  return `${malaysia.getUTCFullYear()}-${String(malaysia.getUTCMonth() + 1).padStart(2, "0")}`;
}

function overtimeMonthPeriod(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return {
    periodStart: new Date(Date.UTC(year, monthNumber - 1, 1)),
    periodEndExclusive: new Date(Date.UTC(year, monthNumber, 1)),
  };
}
