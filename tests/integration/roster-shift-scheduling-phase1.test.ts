import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  bulkUpsertRosterAssignments,
  copyPreviousRosterWeek,
  getEmployeePublishedRoster,
  publishRoster,
  reconcileRosterExpectedDays,
  RosterError,
  upsertRosterAssignment,
} from "../../src/lib/roster/service";

const prisma = new PrismaClient();
after(async () => prisma.$disconnect());

test("Roster lifecycle isolates Draft, versions published ExpectedDay, copies Draft and protects retrospective dates", async () => {
  assertLocalDatabase();
  const rollback = Symbol("rollback");
  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      const business = await transaction.business.create({ data: { name: `Roster QA ${Date.now()}`, slug: `roster-qa-${Date.now()}`, timezone: "Asia/Kuala_Lumpur" } });
      const branch = await transaction.branch.create({ data: { businessId: business.id, name: "Roster Branch" } });
      const actor = await transaction.user.create({ data: { businessId: business.id, branchId: branch.id, name: "Roster Manager", email: `roster-${Date.now()}@example.test`, role: "BUSINESS_OWNER" } });
      const phone = `+601${String(Date.now()).slice(-8)}`;
      const account = await transaction.employeeAccount.create({ data: { name: "Roster Employee", phoneNumber: phone, phoneNormalized: phone } });
      const membership = await transaction.employeeBusinessMembership.create({ data: { employeeAccountId: account.id, businessId: business.id, employeeCode: "R001", fullName: "Roster Employee", phoneNumber: account.phoneNumber, phoneNumberNormalized: account.phoneNormalized, status: "ACTIVE", attendanceEnabled: true, joinedAt: new Date("2026-01-01T00:00:00.000Z") } });
      await transaction.employeeBranchAssignment.create({ data: { membershipId: membership.id, businessId: business.id, branchId: branch.id, isPrimary: true, effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
      const database = transactionDatabase(transaction);
      const context = { businessId: business.id, allowedBranchIds: [branch.id], actor: { userId: actor.id, name: actor.name, email: actor.email ?? "" }, canAmendPublished: true, canManageRetrospective: true };
      const weekStart = new Date("2026-08-17T00:00:00.000Z");
      const workDate = weekStart;
      const draft = await upsertRosterAssignment({ context, database, input: { branchId: branch.id, weekStart, expectedDraftRevision: 0, membershipId: membership.id, workDate, kind: "WORK_SHIFT", startAt: new Date("2026-08-17T01:00:00.000Z"), endAt: new Date("2026-08-17T10:00:00.000Z"), breakMinutes: 60 } });
      assert.equal(await transaction.attendanceExpectedDay.count({ where: { businessId: business.id } }), 0, "Draft must not affect AttendanceExpectedDay");
      const published = await publishRoster({ context, database, now: new Date("2026-08-11T00:00:00.000Z"), input: { rosterPeriodId: draft.periodId, expectedDraftRevision: 1, operationKey: "roster-qa-publish-0001", reason: "Initial QA publication" } });
      assert.equal(published.publication.revision, 1);
      const expectedV1 = await transaction.attendanceExpectedDay.findFirstOrThrow({ where: { businessId: business.id, membershipId: membership.id, workDate, status: "CURRENT" } });
      assert.equal(expectedV1.kind, "WORKDAY");
      assert.equal(expectedV1.source, "ROSTER");
      assert.equal(expectedV1.expectedStartAt?.toISOString(), "2026-08-17T01:00:00.000Z");
      assert.match(expectedV1.evidenceReference ?? "", /^roster:/);
      const replay = await publishRoster({ context, database, now: new Date("2026-08-11T00:00:00.000Z"), input: { rosterPeriodId: draft.periodId, expectedDraftRevision: 1, operationKey: "roster-qa-publish-0001", reason: "Initial QA publication" } });
      assert.equal(replay.idempotent, true);
      assert.equal(await transaction.rosterPublication.count({ where: { rosterPeriodId: draft.periodId } }), 1);

      const amended = await upsertRosterAssignment({ context, database, input: { branchId: branch.id, weekStart, expectedDraftRevision: 1, membershipId: membership.id, workDate, kind: "WORK_SHIFT", startAt: new Date("2026-08-17T02:00:00.000Z"), endAt: new Date("2026-08-17T11:00:00.000Z"), breakMinutes: 60 } });
      assert.equal(amended.draftRevision, 2);
      await publishRoster({ context, database, now: new Date("2026-08-11T00:00:00.000Z"), input: { rosterPeriodId: draft.periodId, expectedDraftRevision: 2, operationKey: "roster-qa-publish-0002", reason: "Future time amendment" } });
      const allExpected = await transaction.attendanceExpectedDay.findMany({ where: { businessId: business.id, membershipId: membership.id, workDate }, orderBy: { revision: "asc" } });
      assert.deepEqual(allExpected.map((item) => item.status), ["SUPERSEDED", "CURRENT"]);
      assert.equal(allExpected[1]?.expectedStartAt?.toISOString(), "2026-08-17T02:00:00.000Z");
      assert.equal(await transaction.rosterPublication.count({ where: { rosterPeriodId: draft.periodId } }), 2);

      const holidayDate = new Date("2026-08-18T00:00:00.000Z");
      await transaction.attendanceExpectedDay.create({ data: { businessId: business.id, branchId: branch.id, membershipId: membership.id, workDate: holidayDate, kind: "PUBLIC_HOLIDAY", source: "MANUAL_EVIDENCE", timezoneSnapshot: "Asia/Kuala_Lumpur", evidenceReference: "LOCAL_HOLIDAY_CONTEXT", createdById: actor.id } });
      await upsertRosterAssignment({ context, database, input: { branchId: branch.id, weekStart, expectedDraftRevision: 2, membershipId: membership.id, workDate: holidayDate, kind: "WORK_SHIFT", startAt: new Date("2026-08-18T01:00:00.000Z"), endAt: new Date("2026-08-18T10:00:00.000Z"), breakMinutes: 60 } });
      const restDate = new Date("2026-08-19T00:00:00.000Z");
      await upsertRosterAssignment({ context, database, input: { branchId: branch.id, weekStart, expectedDraftRevision: 3, membershipId: membership.id, workDate: restDate, kind: "REST_DAY", breakMinutes: 0 } });
      await publishRoster({ context, database, now: new Date("2026-08-11T00:00:00.000Z"), input: { rosterPeriodId: draft.periodId, expectedDraftRevision: 4, operationKey: "roster-qa-publish-0003", reason: "Holiday and rest context" } });
      const holidayWorkday = await transaction.attendanceExpectedDay.findFirstOrThrow({ where: { businessId: business.id, membershipId: membership.id, workDate: holidayDate, status: "CURRENT" } });
      assert.equal(holidayWorkday.kind, "WORKDAY");
      assert.ok((holidayWorkday.policySnapshot as { publicHolidayContext?: { expectedDayId?: string } }).publicHolidayContext?.expectedDayId, "Public Holiday context must be preserved alongside scheduled work");
      assert.equal((await transaction.attendanceExpectedDay.findFirstOrThrow({ where: { businessId: business.id, membershipId: membership.id, workDate: restDate, status: "CURRENT" } })).kind, "REST_DAY");
      assert.equal(await transaction.attendanceExpectedDay.count({ where: { businessId: business.id, membershipId: membership.id, workDate: new Date("2026-08-20T00:00:00.000Z") } }), 0, "Blank roster date must stay unspecified");
      const ownPublished = await getEmployeePublishedRoster({ businessId: business.id, membershipId: membership.id, from: weekStart, to: new Date("2026-08-23T00:00:00.000Z"), database });
      assert.equal(ownPublished.length, 3);
      assert.ok(ownPublished.every((item) => item.membershipId === membership.id), "Staff roster read must remain membership-scoped");

      const copied = await copyPreviousRosterWeek({ context, database, branchId: branch.id, targetWeekStart: new Date("2026-08-24T00:00:00.000Z") });
      assert.equal(copied.status, "DRAFT");
      assert.equal(await transaction.attendanceExpectedDay.count({ where: { businessId: business.id, workDate: new Date("2026-08-24T00:00:00.000Z") } }), 0);

      const leaveDate = new Date("2026-08-20T00:00:00.000Z");
      await upsertRosterAssignment({ context, database, input: { branchId: branch.id, weekStart, expectedDraftRevision: 4, membershipId: membership.id, workDate: leaveDate, kind: "WORK_SHIFT", startAt: new Date("2026-08-20T01:00:00.000Z"), endAt: new Date("2026-08-20T10:00:00.000Z"), breakMinutes: 60 } });
      const policy = await transaction.leavePolicy.create({ data: { businessId: business.id, code: "ANNUAL", name: "Annual leave", payTreatment: "PAID", countMode: "WEEKDAYS", balanceTracked: true, defaultEntitlementDays: 10, origin: "BUSINESS_CUSTOM", legalStatus: "COMPANY_POLICY_ONLY" } });
      const policyVersion = await transaction.leavePolicyVersion.create({ data: { businessId: business.id, policyId: policy.id, revision: 1, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), nameSnapshot: policy.name, payTreatment: "PAID", countMode: "WEEKDAYS", balanceTracked: true, defaultEntitlementDays: 10, origin: "BUSINESS_CUSTOM", legalStatus: "COMPANY_POLICY_ONLY", sourceReference: "LOCAL_ROSTER_TEST", reason: "Leave conflict fixture", createdById: actor.id } });
      const leave = await transaction.leaveRequest.create({ data: { businessId: business.id, membershipId: membership.id, branchId: branch.id, policyId: policy.id, policyVersionId: policyVersion.id, policyNameSnapshot: policy.name, payTreatmentSnapshot: "PAID", legalStatusSnapshot: "COMPANY_POLICY_ONLY", leaveUnit: "FULL_DAY", startsOn: leaveDate, endsOn: leaveDate, requestedDays: 1, reason: "Approved full-day leave", status: "APPROVED", reviewedById: actor.id, reviewedAt: new Date("2026-08-11T00:00:00.000Z") } });
      await transaction.leaveRequestDay.create({ data: { leaveRequestId: leave.id, businessId: business.id, membershipId: membership.id, leaveDate, dayFraction: 1, leaveUnit: "FULL_DAY", policyVersionId: policyVersion.id, payTreatmentSnapshot: "PAID", balanceConsumptionUnits: 1 } });
      await assert.rejects(
        publishRoster({ context, database, now: new Date("2026-08-11T00:00:00.000Z"), input: { rosterPeriodId: draft.periodId, expectedDraftRevision: 5, operationKey: "roster-qa-leave-conflict", reason: "Must be blocked" } }),
        (error: unknown) => error instanceof RosterError && error.code === "LEAVE_CONFLICT",
      );

      const pastWeek = new Date("2026-08-03T00:00:00.000Z");
      const past = await upsertRosterAssignment({ context, database, input: { branchId: branch.id, weekStart: pastWeek, expectedDraftRevision: 0, membershipId: membership.id, workDate: pastWeek, kind: "WORK_SHIFT", startAt: new Date("2026-08-03T01:00:00.000Z"), endAt: new Date("2026-08-03T10:00:00.000Z"), breakMinutes: 60 } });
      await assert.rejects(
        publishRoster({ context: { ...context, canManageRetrospective: false }, database, now: new Date("2026-08-11T00:00:00.000Z"), input: { rosterPeriodId: past.periodId, expectedDraftRevision: 1, operationKey: "roster-qa-past-denied", reason: null } }),
        (error: unknown) => error instanceof RosterError && error.code === "RETROSPECTIVE_REVIEW_REQUIRED",
      );
      const pastPublished = await publishRoster({ context, database, now: new Date("2026-08-11T00:00:00.000Z"), input: { rosterPeriodId: past.periodId, expectedDraftRevision: 1, operationKey: "roster-qa-past-controlled", reason: "Correct historical schedule record only" } });
      assert.equal(pastPublished.publication.assignments[0]?.evidenceDisposition, "RETROSPECTIVE_REVIEW_REQUIRED");
      assert.equal(await transaction.attendanceExpectedDay.count({ where: { businessId: business.id, membershipId: membership.id, workDate: pastWeek } }), 0, "Retrospective roster must not manufacture no-show evidence");

      throw rollback;
    }, { isolationLevel: "Serializable", timeout: 30_000 }),
    (error: unknown) => error === rollback,
  );
});

test("Locked Timesheet blocks roster publication and tenant scope is enforced", async () => {
  assertLocalDatabase();
  const rollback = Symbol("rollback");
  await assert.rejects(prisma.$transaction(async (transaction) => {
    const business = await transaction.business.create({ data: { name: `Roster Lock ${Date.now()}`, slug: `roster-lock-${Date.now()}` } });
    const otherBusiness = await transaction.business.create({ data: { name: `Roster Other ${Date.now()}`, slug: `roster-other-${Date.now()}` } });
    const branch = await transaction.branch.create({ data: { businessId: business.id, name: "Lock Branch" } });
    const otherBranch = await transaction.branch.create({ data: { businessId: otherBusiness.id, name: "Other Branch" } });
    const actor = await transaction.user.create({ data: { businessId: business.id, name: "Owner", email: `roster-lock-${Date.now()}@example.test`, role: "BUSINESS_OWNER" } });
    const phone = `+601${String(Date.now() + 1).slice(-8)}`;
    const account = await transaction.employeeAccount.create({ data: { name: "Lock Employee", phoneNumber: phone, phoneNormalized: phone } });
    const membership = await transaction.employeeBusinessMembership.create({ data: { employeeAccountId: account.id, businessId: business.id, employeeCode: "L001", fullName: "Lock Employee", phoneNumber: account.phoneNumber, phoneNumberNormalized: account.phoneNormalized, joinedAt: new Date("2026-01-01T00:00:00.000Z") } });
    await transaction.employeeBranchAssignment.create({ data: { membershipId: membership.id, businessId: business.id, branchId: branch.id, effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
    const timesheet = await transaction.attendanceMonthlyTimesheet.create({ data: { businessId: business.id, periodStart: new Date("2026-09-01T00:00:00.000Z") } });
    const timesheetRevision = await transaction.attendanceTimesheetRevision.create({ data: { timesheetId: timesheet.id, businessId: business.id, revision: 1, periodStart: timesheet.periodStart, sourceDigest: "a".repeat(64), reason: "Local roster lock protection fixture", lockedById: actor.id } });
    await transaction.attendanceMonthlyTimesheet.update({ where: { id: timesheet.id }, data: { status: "LOCKED", currentRevisionId: timesheetRevision.id } });
    const database = transactionDatabase(transaction);
    const context = { businessId: business.id, allowedBranchIds: [branch.id], actor: { userId: actor.id, name: actor.name, email: actor.email ?? "" }, canAmendPublished: true, canManageRetrospective: true };
    const weekStart = new Date("2026-09-07T00:00:00.000Z");
    await assert.rejects(
      upsertRosterAssignment({ context, database, input: { branchId: otherBranch.id, weekStart, expectedDraftRevision: 0, membershipId: membership.id, workDate: weekStart, kind: "REST_DAY", breakMinutes: 0 } }),
      (error: unknown) => error instanceof RosterError && error.code === "OUTSIDE_SCOPE",
    );
    const draft = await upsertRosterAssignment({ context, database, input: { branchId: branch.id, weekStart, expectedDraftRevision: 0, membershipId: membership.id, workDate: weekStart, kind: "REST_DAY", breakMinutes: 0 } });
    await assert.rejects(
      publishRoster({ context, database, now: new Date("2026-08-11T00:00:00.000Z"), input: { rosterPeriodId: draft.periodId, expectedDraftRevision: 1, operationKey: "roster-locked-timesheet", reason: "Should be blocked" } }),
      (error: unknown) => error instanceof RosterError && error.code === "TIMESHEET_REOPEN_REQUIRED",
    );
    throw rollback;
  }, { isolationLevel: "Serializable", timeout: 30_000 }), (error: unknown) => error === rollback);
});

test("Roster blocks cross-day overlap, supports overnight and bulk Draft, and reconciles published evidence", async () => {
  assertLocalDatabase();
  const rollback = Symbol("rollback");
  await assert.rejects(prisma.$transaction(async (transaction) => {
    const nonce = Date.now();
    const business = await transaction.business.create({ data: { name: `Roster Overlap ${nonce}`, slug: `roster-overlap-${nonce}`, timezone: "Asia/Kuala_Lumpur" } });
    const branchA = await transaction.branch.create({ data: { businessId: business.id, name: "Overlap Branch A" } });
    const branchB = await transaction.branch.create({ data: { businessId: business.id, name: "Overlap Branch B" } });
    const actor = await transaction.user.create({ data: { businessId: business.id, branchId: branchA.id, name: "Roster Owner", email: `roster-overlap-${nonce}@example.test`, role: "BUSINESS_OWNER" } });
    const phone = `+601${String(nonce).slice(-8)}`;
    const account = await transaction.employeeAccount.create({ data: { name: "Overnight Employee", phoneNumber: phone, phoneNormalized: phone } });
    const membership = await transaction.employeeBusinessMembership.create({ data: { employeeAccountId: account.id, businessId: business.id, employeeCode: "N001", fullName: "Overnight Employee", phoneNumber: phone, phoneNumberNormalized: phone, status: "ACTIVE", joinedAt: new Date("2026-01-01T00:00:00.000Z") } });
    await transaction.employeeBranchAssignment.createMany({ data: [branchA, branchB].map((branch) => ({ membershipId: membership.id, businessId: business.id, branchId: branch.id, status: "ACTIVE" as const, effectiveFrom: new Date("2026-01-01T00:00:00.000Z") })) });
    const database = transactionDatabase(transaction);
    const context = { businessId: business.id, allowedBranchIds: [branchA.id, branchB.id], actor: { userId: actor.id, name: actor.name, email: actor.email ?? "" }, canAmendPublished: true, canManageRetrospective: true };
    const weekStart = new Date("2026-08-31T00:00:00.000Z");
    const overnight = await upsertRosterAssignment({ context, database, input: { branchId: branchA.id, weekStart, expectedDraftRevision: 0, membershipId: membership.id, workDate: weekStart, kind: "WORK_SHIFT", startAt: new Date("2026-08-31T14:00:00.000Z"), endAt: new Date("2026-08-31T22:00:00.000Z"), breakMinutes: 30 } });
    await assert.rejects(
      upsertRosterAssignment({ context, database, input: { branchId: branchB.id, weekStart, expectedDraftRevision: 0, membershipId: membership.id, workDate: new Date("2026-09-01T00:00:00.000Z"), kind: "WORK_SHIFT", startAt: new Date("2026-08-31T21:00:00.000Z"), endAt: new Date("2026-09-01T04:00:00.000Z"), breakMinutes: 30 } }),
      (error: unknown) => error instanceof RosterError && error.code === "SHIFT_CONFLICT",
    );
    const bulk = await bulkUpsertRosterAssignments({ context, database, input: { branchId: branchA.id, weekStart, expectedDraftRevision: 1, assignments: [{ membershipId: membership.id, workDate: new Date("2026-09-02T00:00:00.000Z"), kind: "REST_DAY", breakMinutes: 0 }] } });
    assert.equal(bulk.draftRevision, 2);
    assert.equal(await transaction.attendanceExpectedDay.count({ where: { businessId: business.id } }), 0, "Bulk Draft must remain isolated from AttendanceExpectedDay");
    await publishRoster({ context, database, now: new Date("2026-08-11T00:00:00.000Z"), input: { rosterPeriodId: overnight.periodId, expectedDraftRevision: 2, operationKey: "roster-overnight-publish", reason: "Overnight and bulk roster QA" } });
    const expected = await transaction.attendanceExpectedDay.findMany({ where: { businessId: business.id, membershipId: membership.id, status: "CURRENT" }, orderBy: { workDate: "asc" } });
    assert.equal(expected[0]?.kind, "WORKDAY");
    assert.equal(expected[0]?.expectedStartAt?.toISOString(), "2026-08-31T14:00:00.000Z");
    assert.equal(expected[0]?.expectedEndAt?.toISOString(), "2026-08-31T22:00:00.000Z");
    assert.equal(expected[1]?.kind, "REST_DAY");
    const reconciliation = await reconcileRosterExpectedDays({ context, database, from: weekStart, to: new Date("2026-09-06T00:00:00.000Z") });
    assert.equal(reconciliation.consistent, true);
    assert.equal(reconciliation.checked, 2);
    assert.deepEqual(reconciliation.issues, []);
    throw rollback;
  }, { isolationLevel: "Serializable", timeout: 30_000 }), (error: unknown) => error === rollback);
});

function transactionDatabase(transaction: Prisma.TransactionClient) {
  return new Proxy(transaction as unknown as PrismaClient, {
    get(target, property, receiver) {
      if (property === "$transaction") return async <T>(operation: (client: Prisma.TransactionClient) => Promise<T>) => operation(transaction);
      return Reflect.get(target, property, receiver);
    },
  });
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Roster integration tests.");
  const hostname = new URL(databaseUrl).hostname;
  if (!new Set(["localhost", "127.0.0.1"]).has(hostname)) throw new Error("Roster integration tests are restricted to Local / Testing database hosts.");
}
