import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { writeEmployeeCompensationVersionInTransaction } from "../../src/lib/payroll/compensation-version";
import {
  addManualPayrollAdjustment,
  editManualPayrollAdjustment,
  removeManualPayrollAdjustment,
} from "../../src/lib/payroll/component-service";
import type { PayrollProfileWriteContext } from "../../src/lib/payroll/employee-profile-write/types";
import { scheduleRecurringPayComponent } from "../../src/lib/payroll/recurring-pay";
import {
  finalizePayrollRun,
  generatePayrollRun,
  submitPayrollRunForReview,
} from "../../src/lib/payroll/service";
import { prisma } from "../../src/lib/prisma";

test("P4B lines explain payroll, manual adjustments survive recalculation and remain idempotent", async () => {
  const fixture = await createFixture();
  const profileContext = writeContext(fixture);
  await prisma.$transaction((transaction) =>
    writeEmployeeCompensationVersionInTransaction(
      {
        actor: profileContext.actor,
        authorization: {
          access: profileContext.access,
          allowedBranchIds: profileContext.allowedBranchIds,
        },
        baseRate: "3000.00",
        businessId: fixture.business.id,
        effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
        membershipId: fixture.membership.id,
        payBasis: "MONTHLY",
        reasonNote: "P4B component calculation salary.",
        reasonType: "OTHER",
        source: "MANUAL",
      },
      transaction,
    ),
  );
  await setRecurring(profileContext, fixture.membership.id, 0, {
    amount: "300.10",
    code: "TRANSPORT_ALLOWANCE",
    name: "Transport Allowance",
    type: "EARNING",
  });
  await setRecurring(profileContext, fixture.membership.id, 1, {
    amount: "200.05",
    code: "STAFF_LOAN",
    name: "Staff Loan",
    type: "DEDUCTION",
  });
  await createLockedTimesheet(fixture);

  const actorContext = {
    actor: profileContext.actor,
    businessId: fixture.business.id,
  };
  const run = await generatePayrollRun({ ...actorContext, month: "2026-08" });
  let entry = await loadEntry(run.id);
  assert.deepEqual(entry.components.map((line) => line.code), [
    "BASIC_SALARY",
    "STAFF_LOAN",
    "TRANSPORT_ALLOWANCE",
  ]);
  assert.equal(entry.components.find((line) => line.code === "BASIC_SALARY")?.sourceVersionId, entry.compensationVersionId);
  assert.equal(entry.grossPay.toFixed(2), "3300.10");
  assert.equal(entry.otherDeductions.toFixed(2), "200.05");

  const manualEarning = await addManualPayrollAdjustment({
    ...actorContext,
    entryId: entry.id,
    expectedRevision: entry.calculationRevision,
    type: "EARNING",
    name: "One-off correction",
    amount: "150.25",
    reason: "Approved P4B earning correction.",
  });
  entry = await loadEntry(run.id);
  await addManualPayrollAdjustment({
    ...actorContext,
    entryId: entry.id,
    expectedRevision: entry.calculationRevision,
    type: "DEDUCTION",
    name: "Uniform correction",
    amount: "50.15",
    reason: "Approved P4B deduction correction.",
  });
  entry = await loadEntry(run.id);
  assert.equal(entry.grossPay.toFixed(2), "3450.35");
  assert.equal(entry.allowances.toFixed(2), "450.35");
  assert.equal(entry.otherDeductions.toFixed(2), "250.20");
  assert.equal(entry.components.filter((line) => line.origin === "MANUAL").length, 2);

  const revisionBeforeRefresh = entry.calculationRevision;
  await generatePayrollRun({ ...actorContext, month: "2026-08" });
  entry = await loadEntry(run.id);
  assert.ok(entry.calculationRevision > revisionBeforeRefresh);
  assert.equal(entry.components.filter((line) => line.code === "BASIC_SALARY").length, 1);
  assert.equal(entry.components.filter((line) => line.code === "TRANSPORT_ALLOWANCE").length, 1);
  assert.equal(entry.components.filter((line) => line.origin === "MANUAL").length, 2);
  assert.equal(entry.grossPay.toFixed(2), "3450.35");

  await editManualPayrollAdjustment({
    ...actorContext,
    entryId: entry.id,
    componentId: manualEarning.id,
    expectedRevision: entry.calculationRevision,
    name: "One-off correction revised",
    amount: "175.30",
    reason: "Approved revised P4B earning correction.",
  });
  entry = await loadEntry(run.id);
  assert.equal(entry.grossPay.toFixed(2), "3475.40");
  const removableDeduction = entry.components.find(
    (line) => line.origin === "MANUAL" && line.type === "DEDUCTION",
  );
  assert.ok(removableDeduction);
  await removeManualPayrollAdjustment({
    ...actorContext,
    entryId: entry.id,
    componentId: removableDeduction.id,
    expectedRevision: entry.calculationRevision,
    reason: "Approved removal after correction review.",
  });
  entry = await loadEntry(run.id);
  assert.equal(entry.otherDeductions.toFixed(2), "200.05");
  assert.equal(
    await prisma.auditLog.count({
      where: {
        businessId: fixture.business.id,
        action: "PAYROLL_COMPONENT_MANUAL_REMOVED",
        entityId: removableDeduction.id,
      },
    }),
    1,
  );

  await assert.rejects(
    addManualPayrollAdjustment({
      ...actorContext,
      businessId: fixture.otherBusiness.id,
      entryId: entry.id,
      expectedRevision: entry.calculationRevision,
      type: "EARNING",
      name: "Cross tenant",
      amount: "1.00",
      reason: "This must be tenant denied.",
    }),
    /editable payroll entry was not found/i,
  );
  await assert.rejects(
    prisma.payrollEntry.update({
      where: { id: entry.id },
      data: { allowances: "999.99" },
    }),
    /PAYROLL_COMPONENT_RECONCILIATION_FAILED/,
  );

  await submitPayrollRunForReview({ ...actorContext, runId: run.id });
  await finalizePayrollRun({
    ...actorContext,
    runId: run.id,
    allowSelfApprovalOverride: true,
    overrideReason: "P4B immutable line integration test.",
  });
  const finalized = await loadEntry(run.id);
  const lockedManualLine = finalized.components.find(
    (line) => line.origin === "MANUAL",
  );
  assert.ok(lockedManualLine);
  await assert.rejects(
    removeManualPayrollAdjustment({
      ...actorContext,
      entryId: finalized.id,
      componentId: lockedManualLine.id,
      expectedRevision: finalized.calculationRevision,
      reason: "Finalized removal must fail.",
    }),
    /editable payroll entry was not found/i,
  );
  await assert.rejects(
    prisma.payrollEntryComponent.update({
      where: { id: lockedManualLine.id },
      data: { amount: "1.00" },
    }),
    /outside Draft are immutable/i,
  );
});

test("P4B manual adjustment requires reason and optimistic revision", async () => {
  const fixture = await createFixture();
  const profileContext = writeContext(fixture);
  await prisma.$transaction((transaction) =>
    writeEmployeeCompensationVersionInTransaction(
      {
        actor: profileContext.actor,
        authorization: { access: profileContext.access, allowedBranchIds: profileContext.allowedBranchIds },
        baseRate: "1000.00",
        businessId: fixture.business.id,
        effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
        membershipId: fixture.membership.id,
        payBasis: "MONTHLY",
        reasonNote: "P4B concurrency salary.",
        reasonType: "OTHER",
        source: "MANUAL",
      },
      transaction,
    ),
  );
  await createLockedTimesheet(fixture);
  const actorContext = { actor: profileContext.actor, businessId: fixture.business.id };
  const run = await generatePayrollRun({ ...actorContext, month: "2026-08" });
  const entry = await loadEntry(run.id);

  await assert.rejects(
    addManualPayrollAdjustment({
      ...actorContext,
      entryId: entry.id,
      expectedRevision: entry.calculationRevision,
      type: "EARNING",
      name: "Adjustment",
      amount: "10.00",
      reason: "",
    }),
    /reason must be 5 to 500/i,
  );
  await addManualPayrollAdjustment({
    ...actorContext,
    entryId: entry.id,
    expectedRevision: entry.calculationRevision,
    type: "EARNING",
    name: "Adjustment",
    amount: "10.00",
    reason: "Approved valid adjustment.",
  });
  await assert.rejects(
    addManualPayrollAdjustment({
      ...actorContext,
      entryId: entry.id,
      expectedRevision: entry.calculationRevision,
      type: "DEDUCTION",
      name: "Stale adjustment",
      amount: "5.00",
      reason: "This stale revision must fail.",
    }),
    /changed after this page was loaded/i,
  );
});

async function loadEntry(runId: string) {
  return prisma.payrollEntry.findFirstOrThrow({
    where: { payrollRunId: runId },
    include: { components: { orderBy: [{ sortOrder: "asc" }, { lineKey: "asc" }] } },
  });
}

async function setRecurring(
  context: PayrollProfileWriteContext,
  membershipId: string,
  expectedRevision: number,
  input: { amount: string; code: string; name: string; type: "EARNING" | "DEDUCTION" },
) {
  return scheduleRecurringPayComponent({
    context,
    command: {
      ...input,
      commandId: randomUUID(),
      componentId: null,
      effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
      expectedRevision,
      membershipId,
      operation: "SET",
      reasonNote: "P4B recurring component integration.",
      reasonType: "OTHER",
      source: "MANUAL",
    },
  });
}

async function createFixture() {
  const token = randomUUID();
  const business = await prisma.business.create({ data: { name: `P4B ${token}`, slug: `p4b-${token}` } });
  const otherBusiness = await prisma.business.create({ data: { name: `P4B Other ${token}`, slug: `p4b-other-${token}` } });
  const branch = await prisma.branch.create({ data: { businessId: business.id, name: "Main" } });
  const owner = await prisma.user.create({
    data: {
      branchId: branch.id,
      businessId: business.id,
      email: `p4b-${token}@test.local`,
      name: "P4B Owner",
      role: "BUSINESS_OWNER",
    },
  });
  const membership = await createMembership(business.id, `A-${token.slice(0, 8)}`, "+601", token);
  await recordNonAct4Lindung24Fixture(business.id, membership.id, owner.id);
  return { branch, business, membership, otherBusiness, owner };
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

async function createMembership(businessId: string, employeeCode: string, prefix: string, token: string) {
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
      fullName: "P4B Employee",
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      phoneNumber: phone,
      phoneNumberNormalized: phone,
      statutoryNationality: "MALAYSIAN",
    },
  });
}

async function createLockedTimesheet(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const periodStart = new Date("2026-08-01T00:00:00.000Z");
  const timesheet = await prisma.attendanceMonthlyTimesheet.create({
    data: { businessId: fixture.business.id, periodStart },
  });
  const revision = await prisma.attendanceTimesheetRevision.create({
    data: {
      businessId: fixture.business.id,
      lockedById: fixture.owner.id,
      periodStart,
      reason: "P4B payroll component test.",
      revision: 1,
      sourceDigest: "c".repeat(64),
      timesheetId: timesheet.id,
    },
  });
  await prisma.attendanceMonthlyTimesheet.update({
    where: { id: timesheet.id },
    data: { currentRevisionId: revision.id, status: "LOCKED" },
  });
}

function writeContext(fixture: Awaited<ReturnType<typeof createFixture>>): PayrollProfileWriteContext {
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
    actor: { email: fixture.owner.email!, name: fixture.owner.name, userId: fixture.owner.id },
    allowedBranchIds: [fixture.branch.id],
    businessId: fixture.business.id,
    caller: "SYSTEM",
  };
}
