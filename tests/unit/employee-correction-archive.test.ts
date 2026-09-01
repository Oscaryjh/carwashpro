import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  EMPLOYEE_CORRECTION_ARCHIVE_MAX_LIMIT,
  getResolutionArchiveActionability,
  mapP2CorrectionEmployeeStatus,
  mapResolutionCaseEmployeeStatus,
  mapStandaloneExceptionEmployeeStatus,
  paginateEmployeeCorrectionArchiveCandidates,
  parseEmployeeCorrectionArchiveCursor,
  type EmployeeCorrectionArchiveCandidate,
  type EmployeeCorrectionArchiveItem,
  type EmployeeCorrectionSourceType,
  type EmployeeCorrectionStatus,
} from "../../src/lib/attendance/employee-correction-archive";

const businessId = "10000000-0000-4000-8000-000000000001";
const membershipId = "20000000-0000-4000-8000-000000000001";
const otherMembershipId = "20000000-0000-4000-8000-000000000002";
const auth = { businessId, membershipId };

test("standalone AttendanceException statuses remain literal and never invent Returned", () => {
  assert.equal(mapStandaloneExceptionEmployeeStatus("PENDING"), "PENDING");
  assert.equal(mapStandaloneExceptionEmployeeStatus("APPROVED"), "APPROVED");
  assert.equal(mapStandaloneExceptionEmployeeStatus("REJECTED"), "REJECTED");
  assert.equal(mapStandaloneExceptionEmployeeStatus("CANCELLED"), "CANCELLED");
});

test("ResolutionCase maps action, pending, returned and cancelled from explicit evidence", () => {
  assert.equal(resolutionStatus("OPEN"), "ACTION_REQUIRED");
  assert.equal(
    resolutionStatus("UNDER_REVIEW", "EMPLOYEE_SUBMITTED"),
    "PENDING",
  );
  assert.equal(
    resolutionStatus("RETURNED_FOR_CORRECTION"),
    "RETURNED",
  );
  assert.equal(
    resolutionStatus("OPEN", "MANAGER_RETURNED"),
    "RETURNED",
  );
  assert.equal(
    resolutionStatus("OPEN", "EMPLOYEE_CANCELLED"),
    "CANCELLED",
  );
});

test("employee actionability is limited to OPEN submission and explicit return updates", () => {
  assert.deepEqual(
    getResolutionArchiveActionability("OPEN", "ACTION_REQUIRED"),
    { canEmployeeAct: true, nextAction: "SUBMIT" },
  );
  assert.deepEqual(
    getResolutionArchiveActionability("RETURNED_FOR_CORRECTION", "RETURNED"),
    { canEmployeeAct: true, nextAction: "UPDATE" },
  );
  for (const [status, employeeStatus] of [
    ["UNDER_REVIEW", "PENDING"],
    ["RESOLVED", "APPROVED"],
    ["SUPERSEDED", "SUPERSEDED"],
    ["OPEN", "CANCELLED"],
  ] as const) {
    assert.deepEqual(
      getResolutionArchiveActionability(status, employeeStatus),
      { canEmployeeAct: false, nextAction: "NONE" },
    );
  }
});

test("ResolutionCase requires a current final disposition for Approved or Rejected", () => {
  assert.equal(resolutionStatus("RESOLVED", null, "INCLUDED"), "APPROVED");
  assert.equal(resolutionStatus("RESOLVED", "MANAGER_EXCLUDED", "EXCLUDED"), "REJECTED");
  assert.equal(resolutionStatus("RESOLVED"), "UNKNOWN");
  assert.equal(resolutionStatus("SUPERSEDED"), "SUPERSEDED");
  assert.equal(resolutionStatus("UNDER_REVIEW", "MANAGER_RETURNED"), "RETURNED");
  assert.equal(resolutionStatus("UNDER_REVIEW", null), "UNKNOWN");
});

test("P2 CorrectionRequest statuses stay canonical and never synthesize Returned", () => {
  assert.equal(mapP2CorrectionEmployeeStatus("PENDING"), "PENDING");
  assert.equal(mapP2CorrectionEmployeeStatus("APPROVED"), "APPROVED");
  assert.equal(mapP2CorrectionEmployeeStatus("REJECTED"), "REJECTED");
  assert.equal(mapP2CorrectionEmployeeStatus("CANCELLED"), "CANCELLED");
  assert.notEqual(mapP2CorrectionEmployeeStatus("PENDING"), "RETURNED");
});

test("resolution aggregate suppresses its explicitly represented exception", () => {
  const exceptionId = uuid(20);
  const resolution = candidate({
    id: uuid(10),
    sourceType: "RESOLUTION_CASE",
    representedExceptionIds: [exceptionId],
  });
  const exception = candidate({
    id: exceptionId,
    sourceType: "STANDALONE_EXCEPTION",
  });
  const page = paginateEmployeeCorrectionArchiveCandidates({
    auth,
    candidates: [exception, resolution],
  });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.sourceType, "RESOLUTION_CASE");
});

test("standalone exception and P2 aggregate each remain one item", () => {
  const items = [
    candidate({ id: uuid(1), sourceType: "STANDALONE_EXCEPTION" }),
    candidate({ id: uuid(2), sourceType: "P2_CORRECTION_REQUEST" }),
  ];
  const page = paginateEmployeeCorrectionArchiveCandidates({ auth, candidates: items });
  assert.deepEqual(page.items.map((item) => item.sourceType), [
    "STANDALONE_EXCEPTION",
    "P2_CORRECTION_REQUEST",
  ]);
});

test("two unrelated issues on the same work date remain separate", () => {
  const page = paginateEmployeeCorrectionArchiveCandidates({
    auth,
    candidates: [
      candidate({ id: uuid(1), workDate: "2026-08-24" }),
      candidate({ id: uuid(2), workDate: "2026-08-24" }),
    ],
  });
  assert.equal(page.items.length, 2);
  assert.notEqual(page.items[0]?.sourceKey, page.items[1]?.sourceKey);
});

test("mixed-source cursor pagination is deterministic with tied timestamps", () => {
  const tied = new Date("2026-08-24T10:00:00.000Z");
  const candidates = [
    candidate({ id: uuid(1), sourceType: "P2_CORRECTION_REQUEST", orderAt: tied }),
    candidate({ id: uuid(4), sourceType: "RESOLUTION_CASE", orderAt: tied }),
    candidate({ id: uuid(3), sourceType: "STANDALONE_EXCEPTION", orderAt: tied }),
    candidate({ id: uuid(2), sourceType: "RESOLUTION_CASE", orderAt: tied }),
    candidate({ id: uuid(5), orderAt: new Date("2026-08-23T10:00:00.000Z") }),
  ];
  const first = paginateEmployeeCorrectionArchiveCandidates({
    auth,
    candidates,
    limit: 2,
  });
  assert.equal(first.items.length, 2);
  assert.equal(first.hasMore, true);
  assert.ok(first.nextCursor);
  assert.deepEqual(first.items.map((item) => item.sourceKey), [
    `resolution:${uuid(4)}`,
    `resolution:${uuid(2)}`,
  ]);

  const second = paginateEmployeeCorrectionArchiveCandidates({
    auth,
    candidates,
    cursor: first.nextCursor!,
    limit: 2,
  });
  const third = paginateEmployeeCorrectionArchiveCandidates({
    auth,
    candidates,
    cursor: second.nextCursor!,
    limit: 2,
  });
  const all = [...first.items, ...second.items, ...third.items];
  assert.equal(new Set(all.map((item) => item.sourceKey)).size, 5);
  assert.equal(all.length, 5);
});

test("pagination returns empty archive and clamps oversized direct helper limit", () => {
  assert.deepEqual(
    paginateEmployeeCorrectionArchiveCandidates({ auth, candidates: [] }),
    { items: [], nextCursor: null, hasMore: false },
  );
  const candidates = Array.from(
    { length: EMPLOYEE_CORRECTION_ARCHIVE_MAX_LIMIT + 2 },
    (_, index) => candidate({ id: uuid(index + 1) }),
  );
  const page = paginateEmployeeCorrectionArchiveCandidates({
    auth,
    candidates,
    limit: 500,
  });
  assert.equal(page.items.length, EMPLOYEE_CORRECTION_ARCHIVE_MAX_LIMIT);
  assert.equal(page.hasMore, true);
});

test("invalid and cross-employee cursors fail closed", () => {
  assert.throws(
    () => parseEmployeeCorrectionArchiveCursor("not-a-cursor", auth),
    /invalid for this employee/,
  );
  const first = paginateEmployeeCorrectionArchiveCandidates({
    auth,
    candidates: [candidate({ id: uuid(1) }), candidate({ id: uuid(2) })],
    limit: 1,
  });
  assert.throws(
    () => parseEmployeeCorrectionArchiveCursor(first.nextCursor!, {
      businessId,
      membershipId: otherMembershipId,
    }),
    /invalid for this employee/,
  );
});

test("candidate scope mismatch fails without returning foreign employee metadata", () => {
  assert.throws(
    () => paginateEmployeeCorrectionArchiveCandidates({
      auth,
      candidates: [candidate({ id: uuid(1), employeeMembershipId: otherMembershipId })],
    }),
    /Unable to read the employee attendance correction archive/,
  );
});

test("archive service is scoped, linked-source deduped and read-only", async () => {
  const source = await readFile(
    "src/lib/attendance/employee-correction-archive.ts",
    "utf8",
  );
  assert.match(source, /businessId: scope\.businessId/);
  assert.match(source, /employeeId: scope\.membershipId/);
  assert.match(source, /membershipId: scope\.membershipId/);
  assert.match(source, /resolutionCase: \{ is: null \}/);
  assert.match(source, /currentFinalResult:/);
  assert.match(source, /events:/);
  assert.doesNotMatch(
    source,
    /database\.\w+\.(create|update|updateMany|upsert|delete|deleteMany)\s*\(/,
  );
  assert.doesNotMatch(source, /auditLog\./);
});

test("new endpoint exports GET only and takes employee scope from existing auth", async () => {
  const route = await readFile(
    "src/app/api/employee-attendance/corrections/route.ts",
    "utf8",
  );
  assert.match(route, /requireEmployeeAuthContext\(request\)/);
  assert.match(route, /requireEmployeeBusinessModule\(auth, "HR"\)/);
  assert.match(route, /loadEmployeeCorrectionArchive/);
  assert.doesNotMatch(route, /export async function (POST|PATCH|PUT|DELETE)/);
  assert.doesNotMatch(route, /businessId: searchParams|membershipId: searchParams/);
});

function resolutionStatus(
  status:
    | "OPEN"
    | "UNDER_REVIEW"
    | "RETURNED_FOR_CORRECTION"
    | "RESOLVED"
    | "SUPERSEDED",
  latestEventType:
    | "EMPLOYEE_SUBMITTED"
    | "EMPLOYEE_CANCELLED"
    | "MANAGER_ACCEPTED_AS_RECORDED"
    | "MANAGER_APPLIED_CORRECTION"
    | "MANAGER_RETURNED"
    | "MANAGER_EXCLUDED"
    | null = null,
  finalDisposition: "INCLUDED" | "EXCLUDED" | null = null,
) {
  return mapResolutionCaseEmployeeStatus({
    status,
    latestEventType,
    finalDisposition,
  });
}

function candidate(input: {
  id: string;
  sourceType?: EmployeeCorrectionSourceType;
  status?: EmployeeCorrectionStatus;
  orderAt?: Date;
  workDate?: string;
  employeeMembershipId?: string;
  representedExceptionIds?: readonly string[];
}): EmployeeCorrectionArchiveCandidate {
  const sourceType = input.sourceType ?? "STANDALONE_EXCEPTION";
  const prefix = sourceType === "RESOLUTION_CASE"
    ? "resolution"
    : sourceType === "P2_CORRECTION_REQUEST"
      ? "p2-request"
      : "exception";
  const item: EmployeeCorrectionArchiveItem = {
    sourceKey: `${prefix}:${input.id}`,
    sourceType,
    businessId,
    employeeMembershipId: input.employeeMembershipId ?? membershipId,
    branchId: "30000000-0000-4000-8000-000000000001",
    branchName: "Salon Online",
    workDate: input.workDate ?? "2026-08-24",
    employeeStatus: input.status ?? "PENDING",
    correctionType: "MISSING_CLOCK_OUT",
    submittedAt: input.orderAt?.toISOString() ?? "2026-08-24T10:00:00.000Z",
    requestedAt: input.orderAt?.toISOString() ?? "2026-08-24T10:00:00.000Z",
    reviewedAt: null,
    resolvedAt: null,
    requestedClockIn: null,
    requestedClockOut: "2026-08-24T10:00:00.000Z",
    reason: "Forgot to clock out",
    managerNote: null,
    canEmployeeAct: false,
    nextAction: "NONE",
    resolutionEvents: [],
    currentFinalResult: null,
    finalDisposition: null,
  };
  return {
    item,
    orderAt: input.orderAt ?? new Date("2026-08-24T10:00:00.000Z"),
    sourceId: input.id,
    representedExceptionIds: input.representedExceptionIds ?? [],
  };
}

function uuid(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
