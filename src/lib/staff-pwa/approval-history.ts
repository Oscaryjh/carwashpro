import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { prisma } from "@/lib/prisma";
import {
  resolveStaffTeamApprovalAccess,
  type StaffTeamApprovalAccess,
} from "@/lib/staff-pwa/team-approvals";

export type StaffApprovalHistoryDomain = "LEAVE" | "CLAIMS" | "ATTENDANCE" | "OT";
export type StaffApprovalHistoryDecision = "APPROVED" | "REJECTED" | "ADJUSTED" | "RETURNED";

export type StaffApprovalHistoryItem = Readonly<{
  id: string;
  sourceId: string;
  domain: StaffApprovalHistoryDomain;
  subjectId: string;
  employeeName: string;
  branchName: string;
  title: string;
  summary: string;
  decision: StaffApprovalHistoryDecision;
  decisionDetail: string | null;
  reviewedAt: Date;
  reviewNote: string | null;
  currentStatus: string | null;
}>;

export type StaffApprovalHistoryDetail = StaffApprovalHistoryItem & Readonly<{
  facts: readonly Readonly<{ label: string; value: string }>[];
  leaveDocumentIds: readonly Readonly<{ id: string; fileName: string }>[];
  claimAttachmentIds: readonly Readonly<{ id: string; fileName: string }>[];
}>;

type ApprovalHistoryDatabase = PrismaClient;

const HISTORY_PAGE_SIZE = 20;
const HISTORY_MONTHS = 12;

export async function getStaffApprovalHistoryPage(input: {
  auth: EmployeeAuthContext;
  domain?: StaffApprovalHistoryDomain;
  month?: string;
  employee?: string;
  page?: number;
  now?: Date;
  database?: ApprovalHistoryDatabase;
}) {
  const database = input.database ?? prisma;
  const access = await resolveStaffTeamApprovalAccess(input.auth, database);
  if (!access) return null;
  const now = input.now ?? new Date();
  const selectedMonth = normalizeHistoryMonth(input.month, now);
  const range = monthRange(selectedMonth);
  const employee = input.employee?.trim().slice(0, 80) || "";
  const page = Math.min(100, Math.max(1, Math.floor(input.page ?? 1)));
  const domains = supportedHistoryDomains(access).filter((domain) => !input.domain || input.domain === domain);
  const groups = await Promise.all(domains.map((domain) => loadDomainHistory({
    access,
    domain,
    range,
    employee,
    database,
  })));
  const allItems = groups.flat().sort(compareNewestFirst);
  const total = allItems.length;
  const totalPages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  const effectivePage = Math.min(page, totalPages);
  const start = (effectivePage - 1) * HISTORY_PAGE_SIZE;

  return {
    access,
    items: allItems.slice(start, start + HISTORY_PAGE_SIZE),
    selectedMonth,
    availableMonths: recentMonths(now),
    employee,
    pagination: {
      page: effectivePage,
      pageSize: HISTORY_PAGE_SIZE,
      total,
      totalPages,
    },
    supportedDomains: supportedHistoryDomains(access),
  };
}

export async function getStaffApprovalHistoryDetail(input: {
  auth: EmployeeAuthContext;
  domain: StaffApprovalHistoryDomain;
  sourceId: string;
  database?: ApprovalHistoryDatabase;
}): Promise<StaffApprovalHistoryDetail | null> {
  const database = input.database ?? prisma;
  const access = await resolveStaffTeamApprovalAccess(input.auth, database);
  if (!access || !supportedHistoryDomains(access).includes(input.domain)) return null;
  const items = await loadDomainHistory({
    access,
    domain: input.domain,
    sourceId: input.sourceId,
    employee: "",
    database,
  });
  const item = items[0];
  if (!item) return null;
  return loadHistoryDetail(item, access, database);
}

export function normalizeHistoryMonth(value: string | undefined, now = new Date()) {
  const allowed = recentMonths(now);
  return value && allowed.includes(value) ? value : allowed[0];
}

export function recentMonths(now = new Date()) {
  const malaysia = new Date(now.getTime() + 8 * 60 * 60 * 1_000);
  return Array.from({ length: HISTORY_MONTHS }, (_, index) => {
    const date = new Date(Date.UTC(malaysia.getUTCFullYear(), malaysia.getUTCMonth() - index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export function formatApprovalDuration(minutes: number) {
  const safe = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${hours} hr ${String(remainder).padStart(2, "0")} min`;
}

function supportedHistoryDomains(access: StaffTeamApprovalAccess): StaffApprovalHistoryDomain[] {
  return [
    ...(access.canReviewLeave ? ["LEAVE" as const] : []),
    ...(access.canReviewClaims ? ["CLAIMS" as const] : []),
    ...(access.canReviewAttendance ? ["ATTENDANCE" as const, "OT" as const] : []),
  ];
}

function monthRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const malaysiaOffsetMs = 8 * 60 * 60 * 1_000;
  return {
    gte: new Date(Date.UTC(year, monthNumber - 1, 1) - malaysiaOffsetMs),
    lt: new Date(Date.UTC(year, monthNumber, 1) - malaysiaOffsetMs),
  };
}

async function loadDomainHistory(input: {
  access: StaffTeamApprovalAccess;
  domain: StaffApprovalHistoryDomain;
  range?: { gte: Date; lt: Date };
  sourceId?: string;
  employee: string;
  database: ApprovalHistoryDatabase;
}): Promise<StaffApprovalHistoryItem[]> {
  switch (input.domain) {
    case "LEAVE":
    case "CLAIMS":
      return loadHrDecisionHistory({ ...input, domain: input.domain });
    case "ATTENDANCE":
      return loadAttendanceHistory(input);
    case "OT":
      return loadOvertimeHistory(input);
  }
}

async function loadHrDecisionHistory(input: {
  access: StaffTeamApprovalAccess;
  domain: "LEAVE" | "CLAIMS";
  range?: { gte: Date; lt: Date };
  sourceId?: string;
  employee: string;
  database: ApprovalHistoryDatabase;
}) {
  const decisions = await input.database.hrApprovalDecision.findMany({
    where: {
      businessId: input.access.businessId,
      actorUserId: input.access.actor.userId,
      domain: input.domain,
      ...(input.sourceId ? { id: input.sourceId } : {}),
      ...(input.range ? { decidedAt: input.range } : {}),
    },
    orderBy: [{ decidedAt: "desc" }, { id: "desc" }],
  });
  if (!decisions.length) return [];
  const subjectIds = [...new Set(decisions.map((decision) => decision.subjectId))];

  if (input.domain === "LEAVE") {
    const subjects = await input.database.leaveRequest.findMany({
      where: {
        id: { in: subjectIds },
        businessId: input.access.businessId,
        branchId: { in: [...input.access.allowedBranchIds] },
        ...(input.employee ? { membership: { fullName: { contains: input.employee, mode: "insensitive" } } } : {}),
      },
      select: {
        id: true,
        policyNameSnapshot: true,
        startsOn: true,
        endsOn: true,
        requestedDays: true,
        status: true,
        membership: { select: { fullName: true } },
        branch: { select: { name: true } },
      },
    });
    const byId = new Map(subjects.map((subject) => [subject.id, subject]));
    return decisions.flatMap((decision) => {
      const subject = byId.get(decision.subjectId);
      return subject ? [{
        id: `LEAVE:${decision.id}`,
        sourceId: decision.id,
        domain: "LEAVE" as const,
        subjectId: subject.id,
        employeeName: subject.membership.fullName,
        branchName: subject.branch.name,
        title: subject.policyNameSnapshot,
        summary: `${formatUtcDate(subject.startsOn)} – ${formatUtcDate(subject.endsOn)} · ${numberValue(subject.requestedDays)} day${numberValue(subject.requestedDays) === 1 ? "" : "s"}`,
        decision: decision.outcome,
        decisionDetail: null,
        reviewedAt: decision.decidedAt,
        reviewNote: decision.reason,
        currentStatus: subject.status,
      }] : [];
    });
  }

  const subjects = await input.database.employeeClaim.findMany({
    where: {
      id: { in: subjectIds },
      businessId: input.access.businessId,
      branchId: { in: [...input.access.allowedBranchIds] },
      ...(input.employee ? { membership: { fullName: { contains: input.employee, mode: "insensitive" } } } : {}),
    },
    select: {
      id: true,
      purpose: true,
      currency: true,
      submittedTotal: true,
      approvedTotal: true,
      status: true,
      membership: { select: { fullName: true } },
      branch: { select: { name: true } },
    },
  });
  const byId = new Map(subjects.map((subject) => [subject.id, subject]));
  return decisions.flatMap((decision) => {
    const subject = byId.get(decision.subjectId);
    return subject ? [{
      id: `CLAIMS:${decision.id}`,
      sourceId: decision.id,
      domain: "CLAIMS" as const,
      subjectId: subject.id,
      employeeName: subject.membership.fullName,
      branchName: subject.branch.name,
      title: `Claim · ${subject.currency} ${moneyValue(subject.submittedTotal)}`,
      summary: subject.purpose,
      decision: decision.outcome,
      decisionDetail: decision.outcome === "APPROVED" ? `Approved amount ${subject.currency} ${moneyValue(subject.approvedTotal)}` : null,
      reviewedAt: decision.decidedAt,
      reviewNote: decision.reason,
      currentStatus: subject.status,
    }] : [];
  });
}

async function loadAttendanceHistory(input: {
  access: StaffTeamApprovalAccess;
  range?: { gte: Date; lt: Date };
  sourceId?: string;
  employee: string;
  database: ApprovalHistoryDatabase;
}) {
  const [resolutionEvents, exceptionAudits] = await Promise.all([
    input.database.attendanceResolutionEvent.findMany({
      where: {
        businessId: input.access.businessId,
        branchId: { in: [...input.access.allowedBranchIds] },
        actorUserId: input.access.actor.userId,
        actorType: "MANAGER",
        type: { in: ["MANAGER_ACCEPTED_AS_RECORDED", "MANAGER_APPLIED_CORRECTION", "MANAGER_RETURNED", "MANAGER_EXCLUDED"] },
        ...(input.sourceId?.startsWith("resolution:") ? { id: input.sourceId.slice("resolution:".length) } : input.sourceId ? { id: "00000000-0000-0000-0000-000000000000" } : {}),
        ...(input.range ? { createdAt: input.range } : {}),
        ...(input.employee ? { employee: { fullName: { contains: input.employee, mode: "insensitive" } } } : {}),
      },
      select: {
        id: true,
        resolutionCaseId: true,
        type: true,
        reason: true,
        proposedClockInAt: true,
        proposedClockOutAt: true,
        proposedBreakMinutes: true,
        createdAt: true,
        employee: { select: { fullName: true } },
        branch: { select: { name: true } },
        resolutionCase: {
          select: {
            status: true,
            attendanceSession: { select: { workDate: true, clockInAt: true, clockOutAt: true } },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    input.database.auditLog.findMany({
      where: {
        businessId: input.access.businessId,
        branchId: { in: [...input.access.allowedBranchIds] },
        actorUserId: input.access.actor.userId,
        entityType: "AttendanceException",
        action: { in: ["ATTENDANCE_EXCEPTION_APPROVED", "ATTENDANCE_EXCEPTION_REJECTED"] },
        ...(input.sourceId?.startsWith("exception:") ? { id: input.sourceId.slice("exception:".length) } : input.sourceId ? { id: "00000000-0000-0000-0000-000000000000" } : {}),
        ...(input.range ? { createdAt: input.range } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
  ]);

  const exceptionIds = exceptionAudits.flatMap((audit) => audit.entityId ? [audit.entityId] : []);
  const exceptions = exceptionIds.length ? await input.database.attendanceException.findMany({
    where: {
      id: { in: exceptionIds },
      businessId: input.access.businessId,
      branchId: { in: [...input.access.allowedBranchIds] },
      ...(input.employee ? { employee: { fullName: { contains: input.employee, mode: "insensitive" } } } : {}),
    },
    select: {
      id: true,
      type: true,
      status: true,
      reviewNote: true,
      requestedClockInAt: true,
      requestedClockOutAt: true,
      employee: { select: { fullName: true } },
      branch: { select: { name: true } },
      attendanceSession: { select: { workDate: true, clockInAt: true, clockOutAt: true } },
    },
  }) : [];
  const exceptionById = new Map(exceptions.map((exception) => [exception.id, exception]));

  const resolutionItems: StaffApprovalHistoryItem[] = resolutionEvents.map((event) => ({
    id: `ATTENDANCE:resolution:${event.id}`,
    sourceId: `resolution:${event.id}`,
    domain: "ATTENDANCE",
    subjectId: event.resolutionCaseId,
    employeeName: event.employee.fullName,
    branchName: event.branch.name,
    title: "Attendance correction",
    summary: `${formatUtcDate(event.resolutionCase.attendanceSession.workDate)} · ${attendanceEventLabel(event.type)}`,
    decision: attendanceDecision(event.type),
    decisionDetail: event.proposedClockOutAt ? `Clock out ${formatMalaysiaTime(event.proposedClockOutAt)}` : null,
    reviewedAt: event.createdAt,
    reviewNote: event.reason,
    currentStatus: event.resolutionCase.status,
  }));
  const exceptionItems: StaffApprovalHistoryItem[] = exceptionAudits.flatMap((audit) => {
    const exception = audit.entityId ? exceptionById.get(audit.entityId) : null;
    return exception ? [{
      id: `ATTENDANCE:exception:${audit.id}`,
      sourceId: `exception:${audit.id}`,
      domain: "ATTENDANCE" as const,
      subjectId: exception.id,
      employeeName: exception.employee.fullName,
      branchName: exception.branch.name,
      title: "Attendance correction",
      summary: `${formatUtcDate(exception.attendanceSession?.workDate ?? audit.createdAt)} · ${humanize(exception.type)}`,
      decision: audit.action.endsWith("APPROVED") ? "APPROVED" as const : "REJECTED" as const,
      decisionDetail: exception.requestedClockOutAt ? `Requested clock out ${formatMalaysiaTime(exception.requestedClockOutAt)}` : null,
      reviewedAt: audit.createdAt,
      reviewNote: reviewNoteFromAudit(audit.after),
      currentStatus: exception.status,
    }] : [];
  });
  return [...resolutionItems, ...exceptionItems];
}

async function loadOvertimeHistory(input: {
  access: StaffTeamApprovalAccess;
  range?: { gte: Date; lt: Date };
  sourceId?: string;
  employee: string;
  database: ApprovalHistoryDatabase;
}) {
  const membershipIds = input.employee ? await input.database.employeeBusinessMembership.findMany({
    where: { businessId: input.access.businessId, fullName: { contains: input.employee, mode: "insensitive" } },
    select: { id: true },
  }).then((rows) => rows.map((row) => row.id)) : null;
  if (membershipIds && !membershipIds.length) return [];
  const events = await input.database.attendanceOvertimeReviewEvent.findMany({
    where: {
      businessId: input.access.businessId,
      branchId: { in: [...input.access.allowedBranchIds] },
      actorId: input.access.actor.userId,
      type: { in: ["OT_APPROVED", "OT_ADJUSTED", "OT_REJECTED"] },
      ...(membershipIds ? { membershipId: { in: membershipIds } } : {}),
      ...(input.sourceId ? { id: input.sourceId } : {}),
      ...(input.range ? { createdAt: input.range } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (!events.length) return [];
  const [memberships, branches, reviews] = await Promise.all([
    input.database.employeeBusinessMembership.findMany({
      where: { businessId: input.access.businessId, id: { in: [...new Set(events.map((event) => event.membershipId))] } },
      select: { id: true, fullName: true },
    }),
    input.database.branch.findMany({
      where: { businessId: input.access.businessId, id: { in: [...new Set(events.map((event) => event.branchId))] } },
      select: { id: true, name: true },
    }),
    input.database.attendanceOvertimeReview.findMany({
      where: { businessId: input.access.businessId, id: { in: [...new Set(events.map((event) => event.reviewId))] } },
      select: { id: true, status: true },
    }),
  ]);
  const memberById = new Map(memberships.map((membership) => [membership.id, membership]));
  const branchById = new Map(branches.map((branch) => [branch.id, branch]));
  const reviewById = new Map(reviews.map((review) => [review.id, review]));
  return events.flatMap((event) => {
    const membership = memberById.get(event.membershipId);
    const branch = branchById.get(event.branchId);
    if (!membership || !branch) return [];
    return [{
      id: `OT:${event.id}`,
      sourceId: event.id,
      domain: "OT" as const,
      subjectId: event.reviewId,
      employeeName: membership.fullName,
      branchName: branch.name,
      title: "Overtime",
      summary: `${formatUtcDate(event.workDate)} · ${formatApprovalDuration(event.potentialOtMinutes)} potential`,
      decision: event.type === "OT_ADJUSTED" ? "ADJUSTED" as const : event.type === "OT_REJECTED" ? "REJECTED" as const : "APPROVED" as const,
      decisionDetail: event.type === "OT_REJECTED" ? null : `Approved overtime ${formatApprovalDuration(event.approvedOtMinutes)}`,
      reviewedAt: event.createdAt,
      reviewNote: event.reason,
      currentStatus: reviewById.get(event.reviewId)?.status ?? null,
    }];
  });
}

async function loadHistoryDetail(
  item: StaffApprovalHistoryItem,
  access: StaffTeamApprovalAccess,
  database: ApprovalHistoryDatabase,
): Promise<StaffApprovalHistoryDetail | null> {
  if (item.domain === "LEAVE") {
    const request = await database.leaveRequest.findFirst({
      where: { id: item.subjectId, businessId: access.businessId, branchId: { in: [...access.allowedBranchIds] } },
      select: {
        reason: true,
        startsOn: true,
        endsOn: true,
        requestedDays: true,
        leaveUnit: true,
        supportingDocuments: {
          where: { lifecycleStatus: "ACTIVE" },
          select: { id: true, sanitizedFileName: true },
        },
      },
    });
    if (!request) return null;
    return {
      ...item,
      facts: [
        { label: "Dates", value: `${formatUtcDate(request.startsOn)} – ${formatUtcDate(request.endsOn)}` },
        { label: "Duration", value: `${numberValue(request.requestedDays)} day(s) · ${humanize(request.leaveUnit)}` },
        { label: "Reason", value: request.reason || "No reason provided" },
      ],
      leaveDocumentIds: request.supportingDocuments.map((document) => ({ id: document.id, fileName: document.sanitizedFileName ?? "Supporting document" })),
      claimAttachmentIds: [],
    };
  }
  if (item.domain === "CLAIMS") {
    const claim = await database.employeeClaim.findFirst({
      where: { id: item.subjectId, businessId: access.businessId, branchId: { in: [...access.allowedBranchIds] } },
      select: {
        purpose: true,
        currency: true,
        submittedTotal: true,
        approvedTotal: true,
        lines: {
          select: {
            categoryNameSnapshot: true,
            description: true,
            expenseDate: true,
            attachments: { select: { id: true, sanitizedFileName: true } },
          },
          orderBy: { lineNumber: "asc" },
        },
      },
    });
    if (!claim) return null;
    return {
      ...item,
      facts: [
        { label: "Purpose", value: claim.purpose },
        { label: "Submitted amount", value: `${claim.currency} ${moneyValue(claim.submittedTotal)}` },
        { label: "Approved amount", value: `${claim.currency} ${moneyValue(claim.approvedTotal)}` },
        ...claim.lines.map((line) => ({ label: `${line.categoryNameSnapshot} · ${formatUtcDate(line.expenseDate)}`, value: line.description })),
      ],
      leaveDocumentIds: [],
      claimAttachmentIds: claim.lines.flatMap((line) => line.attachments.map((attachment) => ({ id: attachment.id, fileName: attachment.sanitizedFileName }))),
    };
  }
  return {
    ...item,
    facts: [
      { label: "Request", value: item.summary },
      ...(item.decisionDetail ? [{ label: "Decision result", value: item.decisionDetail }] : []),
    ],
    leaveDocumentIds: [],
    claimAttachmentIds: [],
  };
}

function attendanceDecision(type: string): StaffApprovalHistoryDecision {
  if (type === "MANAGER_RETURNED") return "RETURNED";
  if (type === "MANAGER_EXCLUDED") return "REJECTED";
  return "APPROVED";
}

function attendanceEventLabel(type: string) {
  if (type === "MANAGER_RETURNED") return "Returned to employee";
  if (type === "MANAGER_EXCLUDED") return "Excluded from attendance";
  if (type === "MANAGER_ACCEPTED_AS_RECORDED") return "Accepted as recorded";
  return "Correction approved";
}

function compareNewestFirst(left: StaffApprovalHistoryItem, right: StaffApprovalHistoryItem) {
  return right.reviewedAt.getTime() - left.reviewedAt.getTime() || right.id.localeCompare(left.id);
}

function formatUtcDate(value: Date) {
  return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(value);
}

function formatMalaysiaTime(value: Date) {
  return new Intl.DateTimeFormat("en-MY", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).format(value);
}

function numberValue(value: Prisma.Decimal | number) {
  return Number(value);
}

function moneyValue(value: Prisma.Decimal | number) {
  return Number(value).toFixed(2);
}

function humanize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function reviewNoteFromAudit(value: Prisma.JsonValue | null) {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const note = (value as Prisma.JsonObject).reviewNote;
  return typeof note === "string" && note.trim() ? note : null;
}
