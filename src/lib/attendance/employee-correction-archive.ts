import { createHash } from "node:crypto";
import type {
  AttendanceExceptionStatus,
  AttendanceExceptionType,
  AttendanceResolutionActorType,
  AttendanceResolutionCaseStatus,
  AttendanceResolutionEventType,
  AttendanceResolutionReason,
  AttendanceFinalResultDisposition,
  AttendanceFinalResultSource,
  AttendanceCorrectionRequestStatus,
  AttendanceP2ExceptionType,
  AttendanceP2Outcome,
  AttendanceP2ResolutionType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { z } from "zod";
import { AttendanceApiError } from "@/lib/attendance/api-error";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { getAttendanceWorkDate } from "@/lib/attendance/work-date";
import { prisma } from "@/lib/prisma";

export const EMPLOYEE_CORRECTION_SOURCE_TYPES = [
  "RESOLUTION_CASE",
  "STANDALONE_EXCEPTION",
  "P2_CORRECTION_REQUEST",
] as const;

export type EmployeeCorrectionSourceType =
  (typeof EMPLOYEE_CORRECTION_SOURCE_TYPES)[number];

export const EMPLOYEE_CORRECTION_STATUSES = [
  "PENDING",
  "RETURNED",
  "APPROVED",
  "REJECTED",
  "ACTION_REQUIRED",
  "CANCELLED",
  "SUPERSEDED",
  "UNKNOWN",
] as const;

export type EmployeeCorrectionStatus =
  (typeof EMPLOYEE_CORRECTION_STATUSES)[number];

export type EmployeeCorrectionType =
  | "MISSING_CLOCK_IN"
  | "MISSING_CLOCK_OUT"
  | "CLOCK_IN_CORRECTION"
  | "CLOCK_OUT_CORRECTION"
  | "DAY_ATTENDANCE_CORRECTION"
  | "OTHER";

export type EmployeeCorrectionNextAction = "SUBMIT" | "UPDATE" | "NONE";

export type EmployeeCorrectionArchiveEvent = Readonly<{
  eventType: AttendanceResolutionEventType;
  occurredAt: string;
  actorType: AttendanceResolutionActorType;
  employeeFacingSummary: string;
}>;

export type EmployeeCorrectionArchiveFinalResult = Readonly<{
  version: number;
  disposition: AttendanceFinalResultDisposition | null;
  outcome: AttendanceP2Outcome | null;
  source: AttendanceFinalResultSource | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  totalBreakMinutes: number;
  totalWorkedMinutes: number;
  createdAt: string;
}>;

export type EmployeeCorrectionArchiveItem = Readonly<{
  sourceKey: string;
  sourceType: EmployeeCorrectionSourceType;
  businessId: string;
  employeeMembershipId: string;
  branchId: string;
  branchName: string;
  workDate: string;
  employeeStatus: EmployeeCorrectionStatus;
  correctionType: EmployeeCorrectionType;
  submittedAt: string | null;
  requestedAt: string | null;
  reviewedAt: string | null;
  resolvedAt: string | null;
  requestedClockIn: string | null;
  requestedClockOut: string | null;
  reason: string | null;
  managerNote: string | null;
  canEmployeeAct: boolean;
  nextAction: EmployeeCorrectionNextAction;
  resolutionEvents: readonly EmployeeCorrectionArchiveEvent[];
  currentFinalResult: EmployeeCorrectionArchiveFinalResult | null;
  finalDisposition: AttendanceFinalResultDisposition | null;
}>;

export type EmployeeCorrectionArchivePage = Readonly<{
  items: readonly EmployeeCorrectionArchiveItem[];
  nextCursor: string | null;
  hasMore: boolean;
}>;

type ArchiveCursor = Readonly<{
  version: 1;
  scopeHash: string;
  orderAt: Date;
  sourceType: EmployeeCorrectionSourceType;
  sourceId: string;
}>;

export type EmployeeCorrectionArchiveCandidate = Readonly<{
  item: EmployeeCorrectionArchiveItem;
  orderAt: Date;
  sourceId: string;
  representedExceptionIds: readonly string[];
}>;

const DEFAULT_LIMIT = 20;
export const EMPLOYEE_CORRECTION_ARCHIVE_MAX_LIMIT = 50;

const archiveQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(2_000).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(EMPLOYEE_CORRECTION_ARCHIVE_MAX_LIMIT)
    .default(DEFAULT_LIMIT),
});

const resolutionSelect = {
  id: true,
  businessId: true,
  branchId: true,
  employeeId: true,
  status: true,
  openedReason: true,
  openedAt: true,
  resolvedAt: true,
  branch: {
    select: {
      name: true,
      attendanceSetting: { select: { timezone: true } },
    },
  },
  attendanceSession: {
    select: {
      workDate: true,
      clockInAt: true,
      clockOutAt: true,
      exceptions: {
        orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
        select: {
          id: true,
          type: true,
          status: true,
          createdAt: true,
          requestedClockInAt: true,
          requestedClockOutAt: true,
          reason: true,
          reviewedAt: true,
          reviewNote: true,
        },
      },
    },
  },
  events: {
    orderBy: [{ sequence: "asc" as const }, { id: "asc" as const }],
    select: {
      type: true,
      actorType: true,
      reason: true,
      proposedClockInAt: true,
      proposedClockOutAt: true,
      createdAt: true,
    },
  },
  currentFinalResult: {
    select: {
      version: true,
      disposition: true,
      source: true,
      clockInAt: true,
      clockOutAt: true,
      totalBreakMinutes: true,
      totalWorkedMinutes: true,
      createdAt: true,
    },
  },
} satisfies Prisma.AttendanceResolutionCaseSelect;

const exceptionSelect = {
  id: true,
  businessId: true,
  branchId: true,
  employeeId: true,
  type: true,
  reason: true,
  status: true,
  requestedClockInAt: true,
  requestedClockOutAt: true,
  reviewedAt: true,
  reviewNote: true,
  createdAt: true,
  branch: {
    select: {
      name: true,
      attendanceSetting: { select: { timezone: true } },
    },
  },
  attendanceSession: {
    select: { workDate: true },
  },
} satisfies Prisma.AttendanceExceptionSelect;

const p2RequestSelect = {
  id: true,
  businessId: true,
  exceptionId: true,
  membershipId: true,
  requestedClockInAt: true,
  requestedClockOutAt: true,
  reason: true,
  status: true,
  reviewedAt: true,
  reviewReason: true,
  createdAt: true,
} satisfies Prisma.AttendanceCorrectionRequestSelect;

type ResolutionRow = Prisma.AttendanceResolutionCaseGetPayload<{
  select: typeof resolutionSelect;
}>;
type ExceptionRow = Prisma.AttendanceExceptionGetPayload<{
  select: typeof exceptionSelect;
}>;
type P2RequestRow = Prisma.AttendanceCorrectionRequestGetPayload<{
  select: typeof p2RequestSelect;
}>;

type P2ExceptionRow = Readonly<{
  id: string;
  businessId: string;
  branchId: string;
  membershipId: string;
  workDate: Date;
  type: AttendanceP2ExceptionType;
  status: string;
  currentResolutionId: string | null;
  resolvedAt: Date | null;
}>;

type P2ResolutionRow = Readonly<{
  id: string;
  type: AttendanceP2ResolutionType;
  outcome: AttendanceP2Outcome;
  createdAt: Date;
}>;

type P2FinalResultRow = Readonly<{
  businessId: string;
  membershipId: string;
  workDate: Date;
  version: number;
  outcome: AttendanceP2Outcome;
  actualClockInAt: Date | null;
  actualClockOutAt: Date | null;
  totalBreakMinutes: number;
  totalWorkedMinutes: number;
  createdAt: Date;
}>;

type BranchRow = Readonly<{ id: string; name: string }>;

export async function loadEmployeeCorrectionArchive(args: {
  auth: EmployeeAuthContext;
  input?: unknown;
  database?: PrismaClient;
}): Promise<EmployeeCorrectionArchivePage> {
  const database = args.database ?? prisma;
  const input = archiveQuerySchema.parse(args.input ?? {});
  const cursor = input.cursor
    ? parseEmployeeCorrectionArchiveCursor(input.cursor, args.auth)
    : null;
  const sourceLimit = input.limit + 1;
  const scope = {
    businessId: args.auth.businessId,
    membershipId: args.auth.membershipId,
  };

  const [resolutionRows, exceptionRows, p2RequestRows] = await Promise.all([
    database.attendanceResolutionCase.findMany({
      where: {
        businessId: scope.businessId,
        employeeId: scope.membershipId,
        AND: sourceCursorWhere<Prisma.AttendanceResolutionCaseWhereInput>(
          "openedAt",
          "RESOLUTION_CASE",
          cursor,
        ),
      },
      orderBy: [{ openedAt: "desc" }, { id: "desc" }],
      take: sourceLimit,
      select: resolutionSelect,
    }),
    database.attendanceException.findMany({
      where: {
        businessId: scope.businessId,
        employeeId: scope.membershipId,
        AND: [
          ...sourceCursorWhere<Prisma.AttendanceExceptionWhereInput>(
            "createdAt",
            "STANDALONE_EXCEPTION",
            cursor,
          ),
          {
            OR: [
              { attendanceSessionId: null },
              {
                attendanceSession: {
                  is: { resolutionCase: { is: null } },
                },
              },
            ],
          },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: sourceLimit,
      select: exceptionSelect,
    }),
    database.attendanceCorrectionRequest.findMany({
      where: {
        businessId: scope.businessId,
        membershipId: scope.membershipId,
        AND: sourceCursorWhere<Prisma.AttendanceCorrectionRequestWhereInput>(
          "createdAt",
          "P2_CORRECTION_REQUEST",
          cursor,
        ),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: sourceLimit,
      select: p2RequestSelect,
    }),
  ]);

  const p2Candidates = await hydrateP2Candidates({
    database,
    requests: p2RequestRows,
    scope,
  });
  const candidates = [
    ...resolutionRows.map(normalizeResolutionCaseCandidate),
    ...exceptionRows.map(normalizeStandaloneExceptionCandidate),
    ...p2Candidates,
  ];

  return paginateEmployeeCorrectionArchiveCandidates({
    auth: args.auth,
    candidates,
    limit: input.limit,
    cursor: input.cursor,
  });
}

export function paginateEmployeeCorrectionArchiveCandidates(args: {
  auth: Pick<EmployeeAuthContext, "businessId" | "membershipId">;
  candidates: readonly EmployeeCorrectionArchiveCandidate[];
  limit?: number;
  cursor?: string;
}): EmployeeCorrectionArchivePage {
  const limit = Math.min(
    EMPLOYEE_CORRECTION_ARCHIVE_MAX_LIMIT,
    Math.max(1, Math.floor(args.limit ?? DEFAULT_LIMIT)),
  );
  const cursor = args.cursor
    ? parseEmployeeCorrectionArchiveCursor(args.cursor, args.auth)
    : null;
  for (const candidate of args.candidates) {
    if (
      candidate.item.businessId !== args.auth.businessId ||
      candidate.item.employeeMembershipId !== args.auth.membershipId
    ) {
      throw new AttendanceApiError(
        "INTERNAL_ERROR",
        "Unable to read the employee attendance correction archive.",
      );
    }
  }
  const inCursorWindow = cursor
    ? args.candidates.filter((candidate) => isAfterCursor(candidate, cursor))
    : [...args.candidates];
  const representedExceptionIds = new Set(
    inCursorWindow.flatMap((candidate) => candidate.representedExceptionIds),
  );
  const unique = new Map<string, EmployeeCorrectionArchiveCandidate>();
  for (const candidate of inCursorWindow) {
    if (
      candidate.item.sourceType === "STANDALONE_EXCEPTION" &&
      representedExceptionIds.has(candidate.sourceId)
    ) {
      continue;
    }
    unique.set(candidate.item.sourceKey, candidate);
  }
  const sorted = [...unique.values()].sort(compareArchiveCandidates);
  const hasMore = sorted.length > limit;
  const page = sorted.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((candidate) => candidate.item),
    nextCursor:
      hasMore && last
        ? serializeEmployeeCorrectionArchiveCursor(last, args.auth)
        : null,
    hasMore,
  };
}

export function mapStandaloneExceptionEmployeeStatus(
  status: AttendanceExceptionStatus,
): EmployeeCorrectionStatus {
  return status;
}

export function mapP2CorrectionEmployeeStatus(
  status: AttendanceCorrectionRequestStatus,
): EmployeeCorrectionStatus {
  return status;
}

export function mapResolutionCaseEmployeeStatus(input: {
  status: AttendanceResolutionCaseStatus;
  latestEventType: AttendanceResolutionEventType | null;
  finalDisposition: AttendanceFinalResultDisposition | null;
}): EmployeeCorrectionStatus {
  if (input.status === "SUPERSEDED") return "SUPERSEDED";
  if (input.status === "RESOLVED") {
    if (input.finalDisposition === "INCLUDED") return "APPROVED";
    if (input.finalDisposition === "EXCLUDED") return "REJECTED";
    return "UNKNOWN";
  }
  if (
    input.status === "RETURNED_FOR_CORRECTION" ||
    input.latestEventType === "MANAGER_RETURNED"
  ) {
    return "RETURNED";
  }
  if (
    input.status === "UNDER_REVIEW" &&
    input.latestEventType === "EMPLOYEE_SUBMITTED"
  ) {
    return "PENDING";
  }
  if (input.latestEventType === "EMPLOYEE_CANCELLED") return "CANCELLED";
  if (input.status === "OPEN") return "ACTION_REQUIRED";
  return "UNKNOWN";
}

export function serializeEmployeeCorrectionArchiveCursor(
  candidate: Pick<
    EmployeeCorrectionArchiveCandidate,
    "orderAt" | "sourceId" | "item"
  >,
  auth: Pick<EmployeeAuthContext, "businessId" | "membershipId">,
) {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      s: employeeCorrectionScopeHash(auth),
      t: candidate.orderAt.toISOString(),
      y: candidate.item.sourceType,
      i: candidate.sourceId,
    }),
    "utf8",
  ).toString("base64url");
}

export function parseEmployeeCorrectionArchiveCursor(
  value: string,
  auth: Pick<EmployeeAuthContext, "businessId" | "membershipId">,
): ArchiveCursor {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const parsed = z.object({
      v: z.literal(1),
      s: z.string().length(64),
      t: z.string().datetime(),
      y: z.enum(EMPLOYEE_CORRECTION_SOURCE_TYPES),
      i: z.string().uuid(),
    }).parse(decoded);
    if (parsed.s !== employeeCorrectionScopeHash(auth)) {
      throw new Error("Cursor scope mismatch.");
    }
    return {
      version: 1,
      scopeHash: parsed.s,
      orderAt: new Date(parsed.t),
      sourceType: parsed.y,
      sourceId: parsed.i,
    };
  } catch (error) {
    throw new AttendanceApiError(
      "VALIDATION_ERROR",
      "Attendance correction cursor is invalid for this employee.",
      { cause: error },
    );
  }
}

function normalizeResolutionCaseCandidate(
  row: ResolutionRow,
): EmployeeCorrectionArchiveCandidate {
  const latestEvent = row.events.at(-1) ?? null;
  const latestEmployeeSubmission = [...row.events]
    .reverse()
    .find((event) => event.type === "EMPLOYEE_SUBMITTED") ?? null;
  const latestManagerEvent = [...row.events]
    .reverse()
    .find((event) => event.actorType === "MANAGER") ?? null;
  const status = mapResolutionCaseEmployeeStatus({
    status: row.status,
    latestEventType: latestEvent?.type ?? null,
    finalDisposition: row.currentFinalResult?.disposition ?? null,
  });
  const actionability = getResolutionArchiveActionability(row.status, status);
  const primaryException = row.attendanceSession.exceptions.find((exception) =>
    exception.type === "FORGOT_CLOCK_IN" ||
    exception.type === "FORGOT_CLOCK_OUT"
  ) ?? row.attendanceSession.exceptions[0] ?? null;

  return {
    sourceId: row.id,
    orderAt: row.openedAt,
    representedExceptionIds: row.attendanceSession.exceptions.map(
      (exception) => exception.id,
    ),
    item: {
      sourceKey: `resolution:${row.id}`,
      sourceType: "RESOLUTION_CASE",
      businessId: row.businessId,
      employeeMembershipId: row.employeeId,
      branchId: row.branchId,
      branchName: row.branch.name,
      workDate: workDateValue(row.attendanceSession.workDate),
      employeeStatus: status,
      correctionType: resolutionCorrectionType({
        openedReason: row.openedReason,
        clockOutAt: row.attendanceSession.clockOutAt,
        exceptionType: primaryException?.type ?? null,
      }),
      submittedAt: latestEmployeeSubmission?.createdAt.toISOString() ?? null,
      requestedAt: latestEmployeeSubmission?.createdAt.toISOString() ?? null,
      reviewedAt: latestManagerEvent?.createdAt.toISOString() ?? null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      requestedClockIn:
        latestEmployeeSubmission?.proposedClockInAt?.toISOString() ??
        primaryException?.requestedClockInAt?.toISOString() ??
        null,
      requestedClockOut:
        latestEmployeeSubmission?.proposedClockOutAt?.toISOString() ??
        primaryException?.requestedClockOutAt?.toISOString() ??
        null,
      reason:
        latestEmployeeSubmission?.reason ?? primaryException?.reason ?? null,
      managerNote:
        latestManagerEvent?.reason ?? primaryException?.reviewNote ?? null,
      canEmployeeAct: actionability.canEmployeeAct,
      nextAction: actionability.nextAction,
      resolutionEvents: row.events.map((event) => ({
        eventType: event.type,
        occurredAt: event.createdAt.toISOString(),
        actorType: event.actorType,
        employeeFacingSummary: resolutionEventSummary(event.type),
      })),
      currentFinalResult: row.currentFinalResult
        ? {
            version: row.currentFinalResult.version,
            disposition: row.currentFinalResult.disposition,
            outcome: null,
            source: row.currentFinalResult.source,
            clockInAt:
              row.currentFinalResult.clockInAt?.toISOString() ?? null,
            clockOutAt:
              row.currentFinalResult.clockOutAt?.toISOString() ?? null,
            totalBreakMinutes: row.currentFinalResult.totalBreakMinutes,
            totalWorkedMinutes: row.currentFinalResult.totalWorkedMinutes,
            createdAt: row.currentFinalResult.createdAt.toISOString(),
          }
        : null,
      finalDisposition: row.currentFinalResult?.disposition ?? null,
    },
  };
}

function normalizeStandaloneExceptionCandidate(
  row: ExceptionRow,
): EmployeeCorrectionArchiveCandidate {
  const timezone =
    row.branch.attendanceSetting?.timezone ?? "Asia/Kuala_Lumpur";
  const workDate = row.attendanceSession?.workDate ?? getAttendanceWorkDate(
    row.requestedClockInAt ?? row.requestedClockOutAt ?? row.createdAt,
    timezone,
  );
  return {
    sourceId: row.id,
    orderAt: row.createdAt,
    representedExceptionIds: [],
    item: {
      sourceKey: `exception:${row.id}`,
      sourceType: "STANDALONE_EXCEPTION",
      businessId: row.businessId,
      employeeMembershipId: row.employeeId,
      branchId: row.branchId,
      branchName: row.branch.name,
      workDate: workDateValue(workDate),
      employeeStatus: mapStandaloneExceptionEmployeeStatus(row.status),
      correctionType: exceptionCorrectionType(row.type),
      submittedAt: row.createdAt.toISOString(),
      requestedAt: row.createdAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      resolvedAt: null,
      requestedClockIn: row.requestedClockInAt?.toISOString() ?? null,
      requestedClockOut: row.requestedClockOutAt?.toISOString() ?? null,
      reason: row.reason,
      managerNote: row.reviewNote,
      canEmployeeAct: false,
      nextAction: "NONE",
      resolutionEvents: [],
      currentFinalResult: null,
      finalDisposition: null,
    },
  };
}

async function hydrateP2Candidates(args: {
  database: PrismaClient;
  requests: readonly P2RequestRow[];
  scope: { businessId: string; membershipId: string };
}): Promise<EmployeeCorrectionArchiveCandidate[]> {
  if (!args.requests.length) return [];
  const exceptionIds = [...new Set(args.requests.map((item) => item.exceptionId))];
  const exceptions = await args.database.attendanceP2Exception.findMany({
    where: {
      id: { in: exceptionIds },
      businessId: args.scope.businessId,
      membershipId: args.scope.membershipId,
    },
    select: {
      id: true,
      businessId: true,
      branchId: true,
      membershipId: true,
      workDate: true,
      type: true,
      status: true,
      currentResolutionId: true,
      resolvedAt: true,
    },
  }) as P2ExceptionRow[];
  const exceptionById = new Map(exceptions.map((item) => [item.id, item]));
  if (exceptionById.size !== exceptionIds.length) {
    throw new AttendanceApiError(
      "INTERNAL_ERROR",
      "Unable to read the employee attendance correction archive.",
    );
  }

  const branchIds = [...new Set(exceptions.map((item) => item.branchId))];
  const resolutionIds = exceptions.flatMap((item) =>
    item.currentResolutionId ? [item.currentResolutionId] : []
  );
  const workDates = [...new Map(
    exceptions.map((item) => [workDateValue(item.workDate), item.workDate]),
  ).values()];
  const [branches, resolutions, finalResults] = await Promise.all([
    args.database.branch.findMany({
      where: {
        id: { in: branchIds },
        businessId: args.scope.businessId,
      },
      select: { id: true, name: true },
    }) as Promise<BranchRow[]>,
    resolutionIds.length
      ? args.database.attendanceP2Resolution.findMany({
          where: {
            id: { in: resolutionIds },
            businessId: args.scope.businessId,
            membershipId: args.scope.membershipId,
          },
          select: { id: true, type: true, outcome: true, createdAt: true },
        }) as Promise<P2ResolutionRow[]>
      : Promise.resolve([]),
    args.database.attendanceP2FinalResult.findMany({
      where: {
        businessId: args.scope.businessId,
        membershipId: args.scope.membershipId,
        workDate: { in: workDates },
      },
      orderBy: [{ workDate: "asc" }, { version: "desc" }],
      select: {
        businessId: true,
        membershipId: true,
        workDate: true,
        version: true,
        outcome: true,
        actualClockInAt: true,
        actualClockOutAt: true,
        totalBreakMinutes: true,
        totalWorkedMinutes: true,
        createdAt: true,
      },
    }) as Promise<P2FinalResultRow[]>,
  ]);
  const branchById = new Map(branches.map((item) => [item.id, item]));
  const resolutionById = new Map(resolutions.map((item) => [item.id, item]));
  const finalByWorkDate = new Map<string, P2FinalResultRow>();
  for (const result of finalResults) {
    const key = workDateValue(result.workDate);
    if (!finalByWorkDate.has(key)) finalByWorkDate.set(key, result);
  }

  return args.requests.map((request) => {
    const exception = exceptionById.get(request.exceptionId)!;
    const branch = branchById.get(exception.branchId);
    if (!branch) {
      throw new AttendanceApiError(
        "INTERNAL_ERROR",
        "Unable to read the employee attendance correction archive.",
      );
    }
    const resolution = exception.currentResolutionId
      ? resolutionById.get(exception.currentResolutionId) ?? null
      : null;
    const finalResult = finalByWorkDate.get(workDateValue(exception.workDate)) ?? null;
    return normalizeP2CorrectionCandidate({
      request,
      exception,
      branch,
      resolution,
      finalResult,
    });
  });
}

function normalizeP2CorrectionCandidate(args: {
  request: P2RequestRow;
  exception: P2ExceptionRow;
  branch: BranchRow;
  resolution: P2ResolutionRow | null;
  finalResult: P2FinalResultRow | null;
}): EmployeeCorrectionArchiveCandidate {
  return {
    sourceId: args.request.id,
    orderAt: args.request.createdAt,
    representedExceptionIds: [],
    item: {
      sourceKey: `p2-request:${args.request.id}`,
      sourceType: "P2_CORRECTION_REQUEST",
      businessId: args.request.businessId,
      employeeMembershipId: args.request.membershipId,
      branchId: args.exception.branchId,
      branchName: args.branch.name,
      workDate: workDateValue(args.exception.workDate),
      employeeStatus: mapP2CorrectionEmployeeStatus(args.request.status),
      correctionType: p2CorrectionType(args.exception.type),
      submittedAt: args.request.createdAt.toISOString(),
      requestedAt: args.request.createdAt.toISOString(),
      reviewedAt: args.request.reviewedAt?.toISOString() ?? null,
      resolvedAt: args.exception.resolvedAt?.toISOString() ?? null,
      requestedClockIn:
        args.request.requestedClockInAt?.toISOString() ?? null,
      requestedClockOut:
        args.request.requestedClockOutAt?.toISOString() ?? null,
      reason: args.request.reason,
      managerNote: args.request.reviewReason,
      canEmployeeAct: false,
      nextAction: "NONE",
      resolutionEvents: [],
      currentFinalResult: args.finalResult
        ? {
            version: args.finalResult.version,
            disposition: null,
            outcome: args.finalResult.outcome,
            source: null,
            clockInAt: args.finalResult.actualClockInAt?.toISOString() ?? null,
            clockOutAt: args.finalResult.actualClockOutAt?.toISOString() ?? null,
            totalBreakMinutes: args.finalResult.totalBreakMinutes,
            totalWorkedMinutes: args.finalResult.totalWorkedMinutes,
            createdAt: args.finalResult.createdAt.toISOString(),
          }
        : null,
      finalDisposition: null,
    },
  };
}

export function getResolutionArchiveActionability(
  status: AttendanceResolutionCaseStatus,
  employeeStatus: EmployeeCorrectionStatus,
): {
  canEmployeeAct: boolean;
  nextAction: EmployeeCorrectionNextAction;
} {
  if (employeeStatus === "CANCELLED") {
    return { canEmployeeAct: false, nextAction: "NONE" };
  }
  if (status === "RETURNED_FOR_CORRECTION") {
    return { canEmployeeAct: true, nextAction: "UPDATE" };
  }
  if (status === "OPEN") {
    return { canEmployeeAct: true, nextAction: "SUBMIT" };
  }
  return { canEmployeeAct: false, nextAction: "NONE" };
}

function exceptionCorrectionType(
  type: AttendanceExceptionType,
): EmployeeCorrectionType {
  if (type === "FORGOT_CLOCK_IN") return "MISSING_CLOCK_IN";
  if (type === "FORGOT_CLOCK_OUT") return "MISSING_CLOCK_OUT";
  return "OTHER";
}

function p2CorrectionType(
  type: AttendanceP2ExceptionType,
): EmployeeCorrectionType {
  if (type === "MISSING_CLOCK_IN") return "MISSING_CLOCK_IN";
  if (type === "MISSING_CLOCK_OUT") return "MISSING_CLOCK_OUT";
  return "DAY_ATTENDANCE_CORRECTION";
}

function resolutionCorrectionType(input: {
  openedReason: AttendanceResolutionReason;
  clockOutAt: Date | null;
  exceptionType: AttendanceExceptionType | null;
}): EmployeeCorrectionType {
  if (input.exceptionType) return exceptionCorrectionType(input.exceptionType);
  if (input.openedReason === "INCOMPLETE_SESSION" && !input.clockOutAt) {
    return "MISSING_CLOCK_OUT";
  }
  if (input.openedReason === "MANAGER_ADJUSTMENT") {
    return "DAY_ATTENDANCE_CORRECTION";
  }
  return "OTHER";
}

function resolutionEventSummary(type: AttendanceResolutionEventType) {
  const summaries: Record<AttendanceResolutionEventType, string> = {
    EMPLOYEE_SUBMITTED: "You submitted an attendance response.",
    EMPLOYEE_CANCELLED: "You cancelled the pending response.",
    MANAGER_ACCEPTED_AS_RECORDED: "Your manager accepted the recorded attendance.",
    MANAGER_APPLIED_CORRECTION: "Your manager approved corrected attendance times.",
    MANAGER_RETURNED: "Your manager returned the attendance response for changes.",
    MANAGER_EXCLUDED: "Your manager excluded this attendance record.",
  };
  return summaries[type];
}

function compareArchiveCandidates(
  left: EmployeeCorrectionArchiveCandidate,
  right: EmployeeCorrectionArchiveCandidate,
) {
  const time = right.orderAt.getTime() - left.orderAt.getTime();
  if (time) return time;
  const type = sourceRank(left.item.sourceType) - sourceRank(right.item.sourceType);
  if (type) return type;
  return right.sourceId.localeCompare(left.sourceId);
}

function isAfterCursor(
  candidate: EmployeeCorrectionArchiveCandidate,
  cursor: ArchiveCursor,
) {
  const candidateTime = candidate.orderAt.getTime();
  const cursorTime = cursor.orderAt.getTime();
  if (candidateTime !== cursorTime) return candidateTime < cursorTime;
  const candidateRank = sourceRank(candidate.item.sourceType);
  const cursorRank = sourceRank(cursor.sourceType);
  if (candidateRank !== cursorRank) return candidateRank > cursorRank;
  return candidate.sourceId.localeCompare(cursor.sourceId) < 0;
}

function sourceCursorWhere<T>(
  field: "openedAt" | "createdAt",
  sourceType: EmployeeCorrectionSourceType,
  cursor: ArchiveCursor | null,
): T[] {
  if (!cursor) return [];
  const older = { [field]: { lt: cursor.orderAt } };
  const currentRank = sourceRank(sourceType);
  const cursorRank = sourceRank(cursor.sourceType);
  if (currentRank < cursorRank) return [older as T];
  if (currentRank > cursorRank) {
    return [{ OR: [older, { [field]: { equals: cursor.orderAt } }] } as T];
  }
  return [{
    OR: [
      older,
      {
        AND: [
          { [field]: { equals: cursor.orderAt } },
          { id: { lt: cursor.sourceId } },
        ],
      },
    ],
  } as T];
}

function sourceRank(sourceType: EmployeeCorrectionSourceType) {
  return EMPLOYEE_CORRECTION_SOURCE_TYPES.indexOf(sourceType);
}

function employeeCorrectionScopeHash(
  auth: Pick<EmployeeAuthContext, "businessId" | "membershipId">,
) {
  return createHash("sha256")
    .update(`${auth.businessId}:${auth.membershipId}`)
    .digest("hex");
}

function workDateValue(value: Date) {
  return value.toISOString().slice(0, 10);
}
