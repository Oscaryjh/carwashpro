import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import type { ResolvedBusinessAccess } from "../../src/lib/business-groups/business-access";
import { getPayrollExceptionOverview } from "../../src/lib/payroll/exception-center-read";

const prisma = new PrismaClient({ log: [{ level: "query", emit: "event" }] });
let queryCount = 0;
prisma.$on("query", () => { queryCount += 1; });
test.after(async () => prisma.$disconnect());

function ownerAccess(businessId: string, branchId: string, userId: string): ResolvedBusinessAccess {
  return {
    granted: true,
    userId,
    homeBusinessId: businessId,
    businessId,
    branchId,
    identityRole: "BUSINESS_OWNER",
    actorRole: "BUSINESS_OWNER",
    effectiveBusinessRole: "BUSINESS_OWNER",
    permissions: [],
    industryType: "GENERAL_SERVICE",
    source: "DIRECT_BUSINESS",
    groupId: null,
    groupUserId: null,
    capability: null,
  };
}

function staffAccess(base: ResolvedBusinessAccess, permissions: string[]): ResolvedBusinessAccess {
  if (!base.granted) throw new Error("Fixture access must be granted");
  return {
    ...base,
    identityRole: "STAFF",
    actorRole: "STAFF",
    effectiveBusinessRole: "STAFF",
    permissions,
  };
}

test("exception aggregation is bounded, branch-safe, permission-aware and read-only", async () => {
  assertLocalDatabase();
  const suffix = randomUUID();
  const business = await prisma.business.create({ data: { name: "Payroll issues integration", slug: `payroll-issues-${suffix}` } });
  const otherBusiness = await prisma.business.create({ data: { name: "Other payroll issues tenant", slug: `other-payroll-issues-${suffix}` } });
  const [branchA, branchB, otherBranch] = await Promise.all([
    prisma.branch.create({ data: { businessId: business.id, name: "Branch A" } }),
    prisma.branch.create({ data: { businessId: business.id, name: "Branch B" } }),
    prisma.branch.create({ data: { businessId: otherBusiness.id, name: "Other branch" } }),
  ]);
  const owner = await prisma.user.create({ data: { businessId: business.id, email: `payroll-issues-${suffix}@local.test`, name: "Payroll Owner", role: "BUSINESS_OWNER" } });
  const access = ownerAccess(business.id, branchA.id, owner.id);

  async function addEmployees(start: number, endExclusive: number) {
    const people = Array.from({ length: endExclusive - start }, (_, offset) => {
      const index = start + offset;
      const accountId = randomUUID();
      const membershipId = randomUUID();
      const phone = `+6018${String(index).padStart(7, "0")}`;
      const branchId = index % 2 === 0 ? branchA.id : branchB.id;
      return { accountId, branchId, membershipId, index, phone };
    });
    await prisma.employeeAccount.createMany({ data: people.map((person) => ({ id: person.accountId, name: `Employee ${person.index}`, phoneNumber: person.phone, phoneNormalized: person.phone })) });
    await prisma.employeeBusinessMembership.createMany({ data: people.map((person) => ({ id: person.membershipId, employeeAccountId: person.accountId, businessId: business.id, employeeCode: `PX-${String(person.index).padStart(4, "0")}`, fullName: `Employee ${String(person.index).padStart(4, "0")}`, phoneNumber: person.phone, phoneNumberNormalized: person.phone, joinedAt: new Date("2025-01-01T00:00:00.000Z") })) });
    await prisma.employeeBranchAssignment.createMany({ data: people.map((person) => ({ membershipId: person.membershipId, businessId: business.id, branchId: person.branchId, isPrimary: true, effectiveFrom: new Date("2025-01-01T00:00:00.000Z") })) });
    return people;
  }

  const initial = await addEmployees(0, 5);
  const leavePolicy = await prisma.leavePolicy.create({ data: {
    businessId: business.id,
    code: `PAYROLL_REVIEW_${suffix}`,
    name: "Payroll review leave",
    payTreatment: "PAID",
    countMode: "WEEKDAYS",
    balanceTracked: false,
    origin: "BUSINESS_CUSTOM",
    legalStatus: "COMPANY_POLICY_ONLY",
  } });
  const leaveVersion = await prisma.leavePolicyVersion.create({ data: {
    businessId: business.id,
    policyId: leavePolicy.id,
    revision: 1,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    nameSnapshot: leavePolicy.name,
    payTreatment: "PAID",
    countMode: "WEEKDAYS",
    balanceTracked: false,
    origin: "BUSINESS_CUSTOM",
    legalStatus: "COMPANY_POLICY_ONLY",
    reason: "Disposable payroll conflict fixture",
    createdById: owner.id,
  } });
  const pendingLeave = await prisma.leaveRequest.create({ data: {
    businessId: business.id,
    membershipId: initial[0]!.membershipId,
    branchId: initial[0]!.branchId,
    policyId: leavePolicy.id,
    policyVersionId: leaveVersion.id,
    policyNameSnapshot: leavePolicy.name,
    payTreatmentSnapshot: "PAID",
    legalStatusSnapshot: "COMPANY_POLICY_ONLY",
    leaveUnit: "HALF_DAY_AM",
    startsOn: new Date("2026-09-15T00:00:00.000Z"),
    endsOn: new Date("2026-09-15T00:00:00.000Z"),
    requestedDays: 0.5,
    reason: "Private fixture reason that must never be projected",
    status: "PENDING",
  } });
  await prisma.leaveRequestDay.create({ data: {
    businessId: business.id,
    membershipId: initial[0]!.membershipId,
    leaveRequestId: pendingLeave.id,
    leaveDate: new Date("2026-09-15T00:00:00.000Z"),
    dayFraction: 0.5,
    leaveUnit: "HALF_DAY_AM",
    expectedDayKindSnapshot: "WORKDAY",
    policyVersionId: leaveVersion.id,
    payTreatmentSnapshot: "PAID",
    balanceConsumptionUnits: 0.5,
  } });
  const otherPhone = "+60189999999";
  const otherAccount = await prisma.employeeAccount.create({ data: { name: "Other tenant employee", phoneNumber: otherPhone, phoneNormalized: otherPhone } });
  const otherMembership = await prisma.employeeBusinessMembership.create({ data: { employeeAccountId: otherAccount.id, businessId: otherBusiness.id, employeeCode: "OTHER-001", fullName: "Other Tenant Employee", phoneNumber: otherPhone, phoneNumberNormalized: otherPhone, joinedAt: new Date("2025-01-01T00:00:00.000Z"), branchAssignments: { create: { businessId: otherBusiness.id, branchId: otherBranch.id, isPrimary: true, effectiveFrom: new Date("2025-01-01T00:00:00.000Z") } } } });

  const auditBefore = await prisma.auditLog.count({ where: { businessId: business.id } });
  queryCount = 0;
  const five = await getPayrollExceptionOverview({ access, allowedBranchIds: [branchA.id, branchB.id], businessId: business.id, month: "2026-09", now: new Date("2026-09-14T00:00:00.000Z"), wholeBusinessScope: true }, prisma);
  const fiveQueries = queryCount;
  assert.equal(five.status, "READY");
  if (five.status !== "READY") return;
  assert.equal(five.data.rows.length, 5);
  assert.ok(five.data.rows.every((row) => row.mainIssue));
  assert.ok(five.data.rows.find((row) => row.membershipId === initial[0]!.membershipId)?.issues.some((issue) => issue.area === "LEAVE"));
  assert.deepEqual(five.data.restrictedAreas, ["TAX", "STATUTORY"]);
  assert.equal(five.data.canClaimPayrollReadiness, false);
  assert.doesNotMatch(JSON.stringify(five), /Other Tenant Employee|OTHER-001|taxIdentificationNumber|statutoryIdentityNumber|baseSalary|bankAccount|sourceDigest|rulesetId|snapshotId/);
  assert.doesNotMatch(JSON.stringify(five), /Private fixture reason|supportingEvidenceStatus|leaveRequestId/);
  assert.equal(await prisma.auditLog.count({ where: { businessId: business.id } }), auditBefore);

  await addEmployees(5, 200);
  queryCount = 0;
  const large = await getPayrollExceptionOverview({ access, allowedBranchIds: [branchA.id, branchB.id], businessId: business.id, month: "2026-09", now: new Date("2026-09-14T00:00:00.000Z"), wholeBusinessScope: true }, prisma);
  const twoHundredQueries = queryCount;
  assert.equal(large.status, "READY");
  if (large.status !== "READY") return;
  assert.equal(large.data.rows.length, 200);
  assert.equal(twoHundredQueries, fiveQueries, "query count must not grow with employee count");
  assert.ok(twoHundredQueries < 80, `expected a bounded domain query plan, received ${twoHundredQueries}`);

  const branchOnly = await getPayrollExceptionOverview({ access: staffAccess(access, ["TEAM_READ", "ATTENDANCE_EMPLOYEE_READ"]), allowedBranchIds: [branchA.id], businessId: business.id, month: "2026-09", now: new Date("2026-09-14T00:00:00.000Z"), wholeBusinessScope: true }, prisma);
  assert.equal(branchOnly.status, "READY");
  if (branchOnly.status === "READY") {
    assert.equal(branchOnly.data.rows.length, 100);
    assert.equal(branchOnly.data.hasAccessibleBranches, true);
    assert.ok(branchOnly.data.rows.every((row) => row.branches.some((branch) => branch.id === branchA.id)));
    assert.ok(branchOnly.data.rows.every((row) => row.issues.every((issue) => issue.area === "ATTENDANCE" || issue.area === "OVERTIME" || issue.area === "TIMESHEET")));
    assert.ok(branchOnly.data.rows.flatMap((row) => row.issues).every((issue) => issue.action?.label === "View issue"));
  }

  const noBranch = await getPayrollExceptionOverview({ access: staffAccess(access, ["TEAM_READ", "ATTENDANCE_EMPLOYEE_READ"]), allowedBranchIds: [], businessId: business.id, month: "2026-09", now: new Date("2026-09-14T00:00:00.000Z"), wholeBusinessScope: false }, prisma);
  assert.equal(noBranch.status, "READY");
  if (noBranch.status === "READY") {
    assert.equal(noBranch.data.hasAccessibleBranches, false);
    assert.equal(noBranch.data.rows.length, 0);
  }

  const copiedBranchUrl = await getPayrollExceptionOverview({ access: staffAccess(access, ["TEAM_READ", "ATTENDANCE_EMPLOYEE_READ"]), allowedBranchIds: [branchA.id], businessId: business.id, membershipId: initial[1]!.membershipId, month: "2026-09", now: new Date("2026-09-14T00:00:00.000Z"), wholeBusinessScope: false }, prisma);
  assert.equal(copiedBranchUrl.status, "READY");
  if (copiedBranchUrl.status === "READY") assert.equal(copiedBranchUrl.data.rows.length, 0);

  const leaveViewer = await getPayrollExceptionOverview({ access: staffAccess(access, ["TEAM_READ", "VIEW_LEAVE"]), allowedBranchIds: [branchA.id], businessId: business.id, month: "2026-09", now: new Date("2026-09-14T00:00:00.000Z"), wholeBusinessScope: false }, prisma);
  assert.equal(leaveViewer.status, "READY");
  if (leaveViewer.status === "READY") {
    const visibleLeave = leaveViewer.data.rows.flatMap((row) => row.issues).filter((issue) => issue.area === "LEAVE");
    assert.equal(visibleLeave.length, initial[0]!.branchId === branchA.id ? 1 : 0);
    assert.ok(visibleLeave.every((issue) => issue.action?.label === "View issue"));
  }

  await addEmployees(200, 1_005);
  const capped = await getPayrollExceptionOverview({ access, allowedBranchIds: [branchA.id, branchB.id], businessId: business.id, month: "2026-09", now: new Date("2026-09-14T00:00:00.000Z"), wholeBusinessScope: true }, prisma);
  assert.equal(capped.status, "READY");
  if (capped.status === "READY") {
    assert.equal(capped.data.rows.length, 1_000);
    assert.equal(capped.data.rowLimitReached, true);
  }

  queryCount = 0;
  const crossBusiness = await getPayrollExceptionOverview({ access, allowedBranchIds: [otherBranch.id], businessId: otherBusiness.id, membershipId: otherMembership.id, month: "2026-09", wholeBusinessScope: true }, prisma);
  assert.equal(crossBusiness.status, "ACCESS_DENIED");
  assert.equal(queryCount, 0);
  assert.equal(await prisma.auditLog.count({ where: { businessId: business.id } }), auditBefore);
});

function assertLocalDatabase() {
  const value = process.env.DATABASE_URL;
  if (!value || !["localhost", "127.0.0.1"].includes(new URL(value).hostname)) {
    throw new Error("Payroll exception integration tests require the local database.");
  }
}
