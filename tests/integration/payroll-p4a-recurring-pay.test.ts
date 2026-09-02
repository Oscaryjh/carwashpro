import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ResolvedBusinessAccess } from "../../src/lib/business-groups/business-access";
import { writeEmployeeCompensationVersionInTransaction } from "../../src/lib/payroll/compensation-version";
import type { PayrollProfileWriteContext } from "../../src/lib/payroll/employee-profile-write/types";
import {
  resolveRecurringPayForEmployee,
  scheduleRecurringPayComponent,
  sumRecurringPay,
} from "../../src/lib/payroll/recurring-pay";
import {
  finalizePayrollRun,
  generatePayrollRun,
  submitPayrollRunForReview,
} from "../../src/lib/payroll/service";
import { prisma } from "../../src/lib/prisma";
import { issueTestHighRiskStepUp } from "../helpers/high-risk-step-up";

const recurringPayFixtureNow = new Date("2026-08-15T00:00:00.000Z");

test("P4A recurring pay resolves, snapshots and preserves finalized payroll history", async () => {
  const fixture = await createFixture();
  const context = writeContext(fixture);
  await prisma.$transaction((transaction) =>
    writeEmployeeCompensationVersionInTransaction(
      {
        actor: context.actor,
        authorization: {
          access: context.access,
          allowedBranchIds: context.allowedBranchIds,
        },
        baseRate: "3000.00",
        businessId: fixture.business.id,
        effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
        membershipId: fixture.membership.id,
        payBasis: "MONTHLY",
        reasonNote: "P4A integration baseline salary.",
        reasonType: "OTHER",
        source: "MANUAL",
      },
      transaction,
    ),
  );

  const transport = await setComponent(context, fixture.membership.id, 0, {
    amount: "300.10",
    code: "TRANSPORT_ALLOWANCE",
    effectiveMonth: "2026-08",
    name: "Transport Allowance",
    type: "EARNING",
  });
  await setComponent(context, fixture.membership.id, 1, {
    amount: "100.00",
    code: "PHONE_ALLOWANCE",
    effectiveMonth: "2026-09",
    name: "Phone Allowance",
    type: "EARNING",
  });
  await setComponent(context, fixture.membership.id, 2, {
    amount: "200.05",
    code: "STAFF_LOAN",
    effectiveMonth: "2026-08",
    name: "Staff Loan",
    type: "DEDUCTION",
  });
  await setComponent(context, fixture.membership.id, 3, {
    amount: "50.00",
    code: "UNIFORM_DEDUCTION",
    effectiveMonth: "2026-08",
    name: "Uniform Deduction",
    type: "DEDUCTION",
  });

  const augustResolved = await resolveRecurringPayForEmployee({
    businessId: fixture.business.id,
    membershipId: fixture.membership.id,
    payrollPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
  });
  assert.deepEqual(
    augustResolved.map((component) => component.code),
    ["PHONE_ALLOWANCE", "STAFF_LOAN", "TRANSPORT_ALLOWANCE", "UNIFORM_DEDUCTION"]
      .filter((code) => code !== "PHONE_ALLOWANCE")
      .sort(),
  );
  assert.equal(sumRecurringPay(augustResolved, "EARNING").toFixed(2), "300.10");
  assert.equal(sumRecurringPay(augustResolved, "DEDUCTION").toFixed(2), "250.05");
  assert.deepEqual(
    await resolveRecurringPayForEmployee({
      businessId: fixture.otherBusiness.id,
      membershipId: fixture.membership.id,
      payrollPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
    }),
    [],
  );

  await createLockedTimesheet(fixture, "2026-08");
  const run = await generatePayrollRun({
    actor: context.actor,
    businessId: fixture.business.id,
    month: "2026-08",
  });
  const entryBefore = await prisma.payrollEntry.findFirstOrThrow({
    where: { businessId: fixture.business.id, payrollRunId: run.id },
    include: { recurringPaySnapshots: { orderBy: { code: "asc" } } },
  });
  assert.equal(entryBefore.allowances.toFixed(2), "300.10");
  assert.equal(entryBefore.otherDeductions.toFixed(2), "250.05");
  assert.equal(entryBefore.recurringAllowancesSnapshot.toFixed(2), "300.10");
  assert.equal(entryBefore.recurringDeductionsSnapshot.toFixed(2), "250.05");
  assert.equal(entryBefore.recurringPaySnapshots.length, 3);
  assert.equal(
    entryBefore.recurringPaySnapshots.find((item) => item.code === "TRANSPORT_ALLOWANCE")?.amount.toFixed(2),
    "300.10",
  );

  await submitPayrollRunForReview({
    actor: context.actor,
    businessId: fixture.business.id,
    runId: run.id,
  });
  const finalizeStepUp = await issueTestHighRiskStepUp(prisma, {
    actionKey: "PAYROLL_FINALIZE",
    businessId: fixture.business.id,
    resourceId: run.id,
    userId: context.actor.userId,
  });
  await finalizePayrollRun({
    actor: context.actor,
    allowSelfApprovalOverride: true,
    businessId: fixture.business.id,
    overrideReason: "P4A immutable snapshot integration test.",
    runId: run.id,
    stepUp: finalizeStepUp.stepUp,
  });

  const correctionCommand = recurringCommand(fixture.membership.id, 4, {
    amount: "350.15",
    code: "TRANSPORT_ALLOWANCE",
    componentId: transport.componentId,
    effectiveMonth: "2026-08",
    name: "Transport Allowance",
    operation: "SET",
    type: "EARNING",
  });
  const correction = await scheduleRecurringPayComponent({
    command: correctionCommand,
    context,
    now: recurringPayFixtureNow,
  });
  const replay = await scheduleRecurringPayComponent({
    command: correctionCommand,
    context,
    now: recurringPayFixtureNow,
  });
  assert.equal(replay.commandReplay, true);
  assert.equal(replay.newVersionId, correction.newVersionId);

  const historicalEntry = await prisma.payrollEntry.findUniqueOrThrow({
    where: { id: entryBefore.id },
    include: { recurringPaySnapshots: true },
  });
  assert.equal(historicalEntry.allowances.toFixed(2), "300.10");
  assert.equal(
    historicalEntry.recurringPaySnapshots.find((item) => item.code === "TRANSPORT_ALLOWANCE")?.amount.toFixed(2),
    "300.10",
  );
  await assert.rejects(
    prisma.payrollEntry.update({
      where: { id: historicalEntry.id },
      data: { allowances: "999.99" },
    }),
    /reviewed or finalized payroll run are immutable|outside Draft are immutable/i,
  );

  await scheduleRecurringPayComponent({
    command: recurringCommand(fixture.membership.id, 5, {
      amount: "350.15",
      code: "TRANSPORT_ALLOWANCE",
      componentId: transport.componentId,
      effectiveMonth: "2026-09",
      name: "Transport Allowance",
      operation: "END",
      type: "EARNING",
    }),
    context,
    now: recurringPayFixtureNow,
  });
  const septemberResolved = await resolveRecurringPayForEmployee({
    businessId: fixture.business.id,
    membershipId: fixture.membership.id,
    payrollPeriodStart: new Date("2026-09-01T00:00:00.000Z"),
  });
  assert.deepEqual(
    septemberResolved.map((component) => component.code),
    ["PHONE_ALLOWANCE", "STAFF_LOAN", "UNIFORM_DEDUCTION"],
  );
  assert.equal(sumRecurringPay(septemberResolved, "EARNING").toFixed(2), "100.00");
  assert.equal(sumRecurringPay(septemberResolved, "DEDUCTION").toFixed(2), "250.05");

  const versions = await prisma.employeeRecurringPayComponentVersion.findMany({
    where: { componentId: transport.componentId },
    orderBy: { revision: "asc" },
  });
  assert.deepEqual(versions.map((version) => version.status), [
    "SUPERSEDED",
    "CURRENT",
    "CURRENT",
  ]);
  await assert.rejects(
    prisma.employeeRecurringPayComponent.delete({
      where: { id: transport.componentId },
    }),
    /cannot be deleted/i,
  );
});

test("P4A recurring pay write denies Group Manager, Staff and cross-business targets", async () => {
  const fixture = await createFixture();
  const context = writeContext(fixture);
  const command = recurringCommand(fixture.membership.id, 0, {
    amount: "100.00",
    code: "MEAL_ALLOWANCE",
    effectiveMonth: "2026-08",
    name: "Meal Allowance",
    operation: "SET",
    type: "EARNING",
  });
  await assert.rejects(
    scheduleRecurringPayComponent({
      command,
      context: {
        ...context,
        access: {
          ...(context.access as Extract<ResolvedBusinessAccess, { granted: true }>),
          actorRole: "GROUP_MANAGER",
          effectiveBusinessRole: "GROUP_MANAGER_READ_ONLY",
          source: "GROUP_ACCESS",
        },
      },
    }),
    (error: unknown) => hasCode(error, "ACCESS_DENIED"),
  );
  await assert.rejects(
    scheduleRecurringPayComponent({
      command: { ...command, commandId: randomUUID() },
      context: {
        ...context,
        access: {
          ...(context.access as Extract<ResolvedBusinessAccess, { granted: true }>),
          effectiveBusinessRole: "STAFF",
          identityRole: "STAFF",
          permissions: ["ALL_BRANCHES"],
        },
      },
    }),
    (error: unknown) => hasCode(error, "ACCESS_DENIED"),
  );
  await assert.rejects(
    scheduleRecurringPayComponent({
      command: {
        ...command,
        commandId: randomUUID(),
        membershipId: fixture.otherMembership.id,
      },
      context,
    }),
    (error: unknown) => hasCode(error, "NOT_FOUND"),
  );
});

async function setComponent(
  context: PayrollProfileWriteContext,
  membershipId: string,
  expectedRevision: number,
  input: {
    amount: string;
    code: string;
    effectiveMonth: string;
    name: string;
    type: "EARNING" | "DEDUCTION";
  },
) {
  return scheduleRecurringPayComponent({
    command: recurringCommand(membershipId, expectedRevision, {
      ...input,
      operation: "SET",
    }),
    context,
    now: recurringPayFixtureNow,
  });
}

function recurringCommand(
  membershipId: string,
  expectedRevision: number,
  input: {
    amount: string;
    code: string;
    componentId?: string;
    effectiveMonth: string;
    name: string;
    operation: "SET" | "END";
    type: "EARNING" | "DEDUCTION";
  },
) {
  return {
    amount: input.amount,
    code: input.code,
    commandId: randomUUID(),
    componentId: input.componentId ?? null,
    effectiveFromMonth: new Date(`${input.effectiveMonth}-01T00:00:00.000Z`),
    expectedRevision,
    membershipId,
    name: input.name,
    operation: input.operation,
    reasonNote: "P4A recurring pay integration test.",
    reasonType: "OTHER" as const,
    source: "MANUAL" as const,
    type: input.type,
  };
}

async function createFixture() {
  const token = randomUUID();
  const business = await prisma.business.create({
    data: { name: `P4A ${token}`, slug: `p4a-${token}` },
  });
  const otherBusiness = await prisma.business.create({
    data: { name: `P4A Other ${token}`, slug: `p4a-other-${token}` },
  });
  const branch = await prisma.branch.create({
    data: { businessId: business.id, name: "Main" },
  });
  const owner = await prisma.user.create({
    data: {
      branchId: branch.id,
      businessId: business.id,
      email: `p4a-${token}@test.local`,
      name: "P4A Owner",
      role: "BUSINESS_OWNER",
    },
  });
  const membership = await createMembership(business.id, `A-${token.slice(0, 8)}`, "+601", token);
  const otherMembership = await createMembership(otherBusiness.id, `B-${token.slice(0, 8)}`, "+609", token);
  await recordNonAct4Lindung24Fixture(business.id, membership.id, owner.id);
  return { branch, business, membership, otherBusiness, otherMembership, owner };
}

async function recordNonAct4Lindung24Fixture(
  businessId: string,
  membershipId: string,
  recordedById: string,
) {
  await prisma.employeeLindung24ParticipationVersion.create({
    data: {
      act4Covered: false,
      businessId,
      effectiveFromMonth: new Date("2026-06-01T00:00:00.000Z"),
      employerContext: "SINGLE_EMPLOYER",
      membershipId,
      reason: "Integration fixture confirms the employee is outside Act 4 coverage.",
      recordedById,
      revision: 1,
      selectedEmployer: "CURRENT_BUSINESS",
      sourceDigest: "f".repeat(64),
      sourceReference: "INTEGRATION_FIXTURE_NOT_ACT4_COVERED",
      sourceType: "OFFICIAL_TRANSITION",
      status: "DEFAULT_PARTICIPATING",
    },
  });
}

async function createMembership(
  businessId: string,
  employeeCode: string,
  prefix: string,
  token: string,
) {
  const digits = token.replace(/\D/g, "").slice(0, 8).padEnd(8, "0");
  const phone = `${prefix}${digits}`;
  const account = await prisma.employeeAccount.create({
    data: { name: employeeCode, phoneNormalized: phone, phoneNumber: phone },
  });
  return prisma.employeeBusinessMembership.create({
    data: {
      businessId,
      employeeAccountId: account.id,
      employeeCode,
      fullName: "P4A Employee",
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      phoneNumber: phone,
      phoneNumberNormalized: phone,
      statutoryNationality: "MALAYSIAN",
    },
  });
}

async function createLockedTimesheet(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  month: string,
) {
  const periodStart = new Date(`${month}-01T00:00:00.000Z`);
  const timesheet = await prisma.attendanceMonthlyTimesheet.create({
    data: { businessId: fixture.business.id, periodStart },
  });
  const revision = await prisma.attendanceTimesheetRevision.create({
    data: {
      businessId: fixture.business.id,
      lockedById: fixture.owner.id,
      periodStart,
      reason: "P4A payroll snapshot test.",
      revision: 1,
      sourceDigest: "b".repeat(64),
      timesheetId: timesheet.id,
    },
  });
  await prisma.attendanceMonthlyTimesheet.update({
    where: { id: timesheet.id },
    data: { currentRevisionId: revision.id, status: "LOCKED" },
  });
}

function writeContext(
  fixture: Awaited<ReturnType<typeof createFixture>>,
): PayrollProfileWriteContext {
  return {
    access: {
      actorRole: "BUSINESS_OWNER",
      branchId: fixture.branch.id,
      businessId: fixture.business.id,
      capability: null,
      effectiveBusinessRole: "BUSINESS_OWNER",
      granted: true,
      groupId: null,
      groupUserId: null,
      homeBusinessId: fixture.business.id,
      identityRole: "BUSINESS_OWNER",
      industryType: "AUTO_DETAILING",
      permissions: [],
      source: "DIRECT_BUSINESS",
      userId: fixture.owner.id,
    },
    actor: {
      email: fixture.owner.email!,
      name: fixture.owner.name,
      userId: fixture.owner.id,
    },
    allowedBranchIds: [fixture.branch.id],
    businessId: fixture.business.id,
    caller: "SYSTEM",
  };
}

function hasCode(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
