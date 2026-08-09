import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { writeEmployeeCompensationVersionInTransaction } from "../../src/lib/payroll/compensation-version";
import { addManualPayrollAdjustment } from "../../src/lib/payroll/component-service";
import {
  finalizePayrollRun,
  generatePayrollRun,
  submitPayrollRunForReview,
} from "../../src/lib/payroll/service";
import {
  approvePayrollCorrection,
  approvePayrollVariablePay,
  cancelPayrollVariablePay,
  createPayrollCorrection,
  createPayrollVariablePay,
  editPayrollVariablePay,
  type P4CWriteContext,
} from "../../src/lib/payroll/variable-pay";
import { prisma } from "../../src/lib/prisma";

test("P4C freezes variable pay and applies correction deltas exactly once", async () => {
  const fixture = await createFixture();
  await createCompensation(fixture);
  await createLockedTimesheet(fixture, "2026-07");
  await createLockedTimesheet(fixture, "2026-08");

  const payrollContext = { businessId: fixture.business.id, actor: actor(fixture.owner) };
  const julyRun = await generatePayrollRun({ ...payrollContext, month: "2026-07" });
  await submitPayrollRunForReview({ ...payrollContext, runId: julyRun.id });
  await finalizePayrollRun({
    ...payrollContext,
    runId: julyRun.id,
    allowSelfApprovalOverride: true,
    overrideReason: "Create immutable P4C correction baseline.",
  });
  const julyBefore = await loadEntry(julyRun.id);
  const julySnapshot = snapshot(julyBefore);

  const editor = editContext(fixture, fixture.owner);
  const approver = approveContext(fixture, fixture.approver);
  const commission = await createPayrollVariablePay(editor, {
    membershipId: fixture.membership.id,
    type: "COMMISSION",
    name: "August sales commission",
    amount: "850.25",
    earnedPeriodStart: "2026-07-01",
    earnedPeriodEnd: "2026-07-31",
    payrollPeriod: "2026-08",
    origin: "MANUAL",
    sourceReference: `COMM-${fixture.token}`,
    reason: "Approved July commission paid in August.",
  });
  const editedCommission = await editPayrollVariablePay(editor, {
    variablePayId: commission.id,
    expectedRevision: commission.revision,
    membershipId: fixture.membership.id,
    type: "COMMISSION",
    name: "August sales commission confirmed",
    amount: "850.25",
    earnedPeriodStart: "2026-07-01",
    earnedPeriodEnd: "2026-07-31",
    payrollPeriod: "2026-08",
    origin: "MANUAL",
    sourceReference: `COMM-${fixture.token}`,
    reason: "Commission source was reviewed before approval.",
  });
  await assert.rejects(
    approvePayrollVariablePay(approveContext(fixture, fixture.owner), {
      variablePayId: editedCommission.id,
      expectedRevision: editedCommission.revision,
    }),
    /submitter cannot approve/i,
  );
  await approvePayrollVariablePay(approver, {
    variablePayId: editedCommission.id,
    expectedRevision: editedCommission.revision,
  });
  const cancelledBonus = await createPayrollVariablePay(editor, {
    membershipId: fixture.membership.id,
    type: "BONUS",
    name: "Cancelled August bonus",
    amount: "99.99",
    earnedPeriodStart: "2026-08-01",
    earnedPeriodEnd: "2026-08-31",
    payrollPeriod: "2026-08",
    origin: "MANUAL",
    sourceReference: `CANCELLED-BONUS-${fixture.token}`,
    reason: "This source will be cancelled before payroll application.",
  });
  await assert.rejects(
    approvePayrollVariablePay(editor, {
      variablePayId: cancelledBonus.id,
      expectedRevision: cancelledBonus.revision,
    }),
    /approval requires payroll approval access/i,
  );
  await cancelPayrollVariablePay(editor, {
    variablePayId: cancelledBonus.id,
    expectedRevision: cancelledBonus.revision,
    reason: "Manager withdrew the bonus before approval.",
  });

  const oneOffDeduction = await createPayrollVariablePay(editor, {
    membershipId: fixture.membership.id,
    type: "ONE_OFF_DEDUCTION",
    name: "Uniform replacement",
    amount: "50.10",
    earnedPeriodStart: "2026-08-01",
    earnedPeriodEnd: "2026-08-31",
    payrollPeriod: "2026-08",
    origin: "MANUAL",
    sourceReference: `UNIFORM-${fixture.token}`,
    reason: "Approved one-off uniform replacement deduction.",
  });
  await approvePayrollVariablePay(approver, {
    variablePayId: oneOffDeduction.id,
    expectedRevision: oneOffDeduction.revision,
  });
  await assert.rejects(
    createPayrollVariablePay(editor, {
      membershipId: fixture.membership.id,
      type: "ONE_OFF_DEDUCTION",
      name: "Duplicate uniform replacement",
      amount: "50.10",
      earnedPeriodStart: "2026-08-01",
      earnedPeriodEnd: "2026-08-31",
      payrollPeriod: "2026-08",
      origin: "MANUAL",
      sourceReference: `UNIFORM-${fixture.token}`,
      reason: "Duplicate source reference must be rejected.",
    }),
    /unique constraint/i,
  );

  const underpayment = await createPayrollCorrection(editor, {
    originalPayrollEntryId: julyBefore.id,
    applyToPeriod: "2026-08",
    originalAmount: "3500.00",
    correctedAmount: "3650.00",
    name: "July salary arrears",
    sourceReference: `CORR-UP-${fixture.token}`,
    reason: "July salary underpayment confirmed after finalization.",
  });
  await assert.rejects(
    createPayrollCorrection(
      { ...editor, businessId: fixture.otherBusiness.id },
      {
        originalPayrollEntryId: julyBefore.id,
        applyToPeriod: "2026-08",
        originalAmount: "3500.00",
        correctedAmount: "3650.00",
        name: "Cross-business correction",
        reason: "Cross-business original entry must be denied.",
      },
    ),
    /finalized original payroll entry was not found/i,
  );
  assert.equal(underpayment.deltaType, "EARNING");
  assert.equal(underpayment.deltaAmount.toFixed(2), "150.00");
  await approvePayrollCorrection(approver, {
    correctionId: underpayment.id,
    expectedRevision: underpayment.revision,
  });
  const overpayment = await createPayrollCorrection(editor, {
    originalPayrollEntryId: julyBefore.id,
    applyToPeriod: "2026-08",
    originalAmount: "500.00",
    correctedAmount: "300.00",
    name: "July payroll recovery",
    sourceReference: `CORR-DOWN-${fixture.token}`,
    reason: "July overpayment recovery confirmed after finalization.",
  });
  assert.equal(overpayment.deltaType, "DEDUCTION");
  assert.equal(overpayment.deltaAmount.toFixed(2), "200.00");
  await approvePayrollCorrection(approver, {
    correctionId: overpayment.id,
    expectedRevision: overpayment.revision,
  });

  const augustRun = await generatePayrollRun({ ...payrollContext, month: "2026-08" });
  let august = await loadEntry(augustRun.id);
  assert.equal(august.components.filter((line) => line.code === "COMMISSION").length, 1);
  assert.equal(august.components.filter((line) => line.code === "ONE_OFF_DEDUCTION").length, 1);
  assert.equal(august.components.filter((line) => line.code === "SALARY_ARREARS").length, 1);
  assert.equal(august.components.filter((line) => line.code === "PAYROLL_RECOVERY").length, 1);
  assert.equal(august.components.filter((line) => line.code === "BONUS").length, 0);
  assert.equal(august.components.find((line) => line.code === "SALARY_ARREARS")?.type, "EARNING");
  assert.equal(august.components.find((line) => line.code === "PAYROLL_RECOVERY")?.type, "DEDUCTION");
  assert.equal((await prisma.payrollVariablePay.findUniqueOrThrow({ where: { id: commission.id } })).status, "APPLIED");
  assert.equal((await prisma.payrollCorrection.findUniqueOrThrow({ where: { id: underpayment.id } })).status, "APPLIED");
  assert.deepEqual(snapshot(await loadEntry(julyRun.id)), julySnapshot);
  await assert.rejects(
    prisma.payrollVariablePay.update({
      where: { id: commission.id },
      data: { amount: "999.99", revision: { increment: 1 } },
    }),
    /variable pay.*immutable/i,
  );

  await addManualPayrollAdjustment({
    ...payrollContext,
    entryId: august.id,
    expectedRevision: august.calculationRevision,
    type: "EARNING",
    category: "BONUS",
    name: "Payroll-only recognition award",
    amount: "25.05",
    reason: "Approved payroll-specific recognition award.",
  });
  const revisionBeforeRefresh = (await loadEntry(augustRun.id)).calculationRevision;
  await generatePayrollRun({ ...payrollContext, month: "2026-08" });
  august = await loadEntry(augustRun.id);
  assert.ok(august.calculationRevision > revisionBeforeRefresh);
  assert.equal(august.components.filter((line) => line.code === "COMMISSION").length, 1);
  assert.equal(august.components.filter((line) => line.code === "SALARY_ARREARS").length, 1);
  assert.equal(august.components.filter((line) => line.origin === "MANUAL").length, 1);
  assert.deepEqual(snapshot(await loadEntry(julyRun.id)), julySnapshot);
  await assert.rejects(
    approvePayrollCorrection(approver, {
      correctionId: underpayment.id,
      expectedRevision: underpayment.revision,
    }),
    /not found or changed/i,
  );
});

test("P4C denies unauthorized, cross-business and invalid money operations", async () => {
  const fixture = await createFixture();
  const editor = editContext(fixture, fixture.owner);
  await assert.rejects(
    createPayrollVariablePay({ ...editor, capabilities: ["VIEW_COMPENSATION"] }, variableCommand(fixture)),
    /require.*payroll entry and compensation access/i,
  );
  await assert.rejects(
    createPayrollVariablePay(editor, { ...variableCommand(fixture), membershipId: fixture.otherMembership.id }),
    /not found in this business/i,
  );
  await assert.rejects(
    createPayrollVariablePay(editor, { ...variableCommand(fixture), amount: "0.00" }),
    /greater than zero/i,
  );
  await assert.rejects(
    createPayrollVariablePay(editor, { ...variableCommand(fixture), amount: "-1.00" }),
    /non-negative MYR amount/i,
  );
});

async function createFixture() {
  const token = randomUUID();
  const business = await prisma.business.create({ data: { name: `P4C ${token}`, slug: `p4c-${token}` } });
  const otherBusiness = await prisma.business.create({ data: { name: `P4C Other ${token}`, slug: `p4c-other-${token}` } });
  const branch = await prisma.branch.create({ data: { businessId: business.id, name: "Main" } });
  const otherBranch = await prisma.branch.create({ data: { businessId: otherBusiness.id, name: "Other" } });
  const owner = await prisma.user.create({ data: { branchId: branch.id, businessId: business.id, email: `p4c-owner-${token}@test.local`, name: "P4C Owner", role: "BUSINESS_OWNER" } });
  const approver = await prisma.user.create({ data: { branchId: branch.id, businessId: business.id, email: `p4c-approver-${token}@test.local`, name: "P4C Approver", role: "BUSINESS_OWNER" } });
  const membership = await createMembership(business.id, `P4C-${token.slice(0, 8)}`, "+601", token);
  const otherMembership = await createMembership(otherBusiness.id, `OTHER-${token.slice(0, 8)}`, "+602", token);
  await recordNonAct4Lindung24Fixture(business.id, membership.id, owner.id);
  return { approver, branch, business, membership, otherBranch, otherBusiness, otherMembership, owner, token };
}

async function recordNonAct4Lindung24Fixture(businessId: string, membershipId: string, recordedById: string) {
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
  const phone = `${prefix}${digits}${prefix.slice(-1)}`;
  const account = await prisma.employeeAccount.create({ data: { name: employeeCode, phoneNormalized: phone, phoneNumber: phone } });
  return prisma.employeeBusinessMembership.create({ data: { businessId, employeeAccountId: account.id, employeeCode, fullName: employeeCode, joinedAt: new Date("2026-01-01T00:00:00.000Z"), phoneNumber: phone, phoneNumberNormalized: phone, statutoryNationality: "MALAYSIAN" } });
}

async function createCompensation(fixture: Awaited<ReturnType<typeof createFixture>>) {
  await prisma.$transaction((transaction) => writeEmployeeCompensationVersionInTransaction({
    actor: actor(fixture.owner),
    authorization: { access: directAccess(fixture), allowedBranchIds: [fixture.branch.id] },
    baseRate: "3000.00",
    businessId: fixture.business.id,
    effectiveFromMonth: new Date("2026-07-01T00:00:00.000Z"),
    membershipId: fixture.membership.id,
    payBasis: "MONTHLY",
    reasonNote: "P4C immutable correction baseline salary.",
    reasonType: "OTHER",
    source: "MANUAL",
  }, transaction));
}

async function createLockedTimesheet(fixture: Awaited<ReturnType<typeof createFixture>>, month: string) {
  const periodStart = new Date(`${month}-01T00:00:00.000Z`);
  const timesheet = await prisma.attendanceMonthlyTimesheet.create({ data: { businessId: fixture.business.id, periodStart } });
  const revision = await prisma.attendanceTimesheetRevision.create({ data: { businessId: fixture.business.id, lockedById: fixture.owner.id, periodStart, reason: "P4C payroll source test.", revision: 1, sourceDigest: month === "2026-07" ? "d".repeat(64) : "e".repeat(64), timesheetId: timesheet.id } });
  await prisma.attendanceMonthlyTimesheet.update({ where: { id: timesheet.id }, data: { currentRevisionId: revision.id, status: "LOCKED" } });
}

function editContext(fixture: Awaited<ReturnType<typeof createFixture>>, user: typeof fixture.owner): P4CWriteContext {
  return { businessId: fixture.business.id, actor: actor(user), capabilities: ["VIEW_COMPENSATION", "EDIT_PAYROLL_ENTRY"] };
}

function approveContext(fixture: Awaited<ReturnType<typeof createFixture>>, user: typeof fixture.owner): P4CWriteContext {
  return { businessId: fixture.business.id, actor: actor(user), capabilities: ["VIEW_COMPENSATION", "APPROVE_PAYROLL"] };
}

function actor(user: { id: string; email: string | null; name: string }) {
  return { email: user.email!, name: user.name, userId: user.id };
}

function directAccess(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return { actorRole: "BUSINESS_OWNER" as const, branchId: fixture.branch.id, businessId: fixture.business.id, capability: null, effectiveBusinessRole: "BUSINESS_OWNER" as const, granted: true as const, groupId: null, groupUserId: null, homeBusinessId: fixture.business.id, identityRole: "BUSINESS_OWNER" as const, industryType: "AUTO_DETAILING" as const, permissions: [] as string[], source: "DIRECT_BUSINESS" as const, userId: fixture.owner.id };
}

function variableCommand(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return { membershipId: fixture.membership.id, type: "BONUS" as const, name: "Performance bonus", amount: "10.25", earnedPeriodStart: "2026-08-01", earnedPeriodEnd: "2026-08-31", payrollPeriod: "2026-08", origin: "MANUAL" as const, sourceReference: `BONUS-${randomUUID()}`, reason: "Approved one-off performance bonus." };
}

async function loadEntry(runId: string) {
  return prisma.payrollEntry.findFirstOrThrow({ where: { payrollRunId: runId }, include: { components: { orderBy: [{ sortOrder: "asc" }, { lineKey: "asc" }] } } });
}

function snapshot(entry: Awaited<ReturnType<typeof loadEntry>>) {
  return { gross: entry.grossPay.toFixed(2), net: entry.netPay.toFixed(2), compensationVersionId: entry.compensationVersionId, components: entry.components.map((line) => [line.lineKey, line.amount.toFixed(2), line.sourceRevision]) };
}
