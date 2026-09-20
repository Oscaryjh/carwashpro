import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma";
import { confirmManualPcb, resolveManualPcb, assertManualPcbForEntry, manualPcbInputDigest } from "../../src/lib/payroll/manual-pcb-service";
import { issueTestHighRiskStepUp } from "../helpers/high-risk-step-up";
import { updateEmployeeTaxProfile } from "../../src/lib/payroll/employee-profile-write/tax";
import { resolveBusinessAccess } from "../../src/lib/business-groups/business-access";
import { loadPayrollPayslip } from "../../src/lib/payroll/documents";
import { pcbPayslipPresentation } from "../../src/lib/payroll/export";

test("manual source: MFA, exact revision, amount reconciliation, immutable history and tax invalidation", async () => {
  const suffix = randomUUID();
  const business = await prisma.business.create({ data: { name: "Manual PCB synthetic", slug: `pcb-${suffix}` } });
  const owner = await prisma.user.create({ data: { businessId: business.id, name: "Synthetic Owner", email: `synthetic-${suffix}@test.invalid`, role: "BUSINESS_OWNER" } });
  await prisma.businessModuleEntitlement.createMany({ data: (["HR", "PAYROLL"] as const).map((moduleKey) => ({ businessId: business.id, moduleKey, status: "ENABLED", source: "MANUAL", enabledFrom: new Date("2020-01-01") })) });
  const phone = `+601${suffix.replace(/\D/g, "").slice(0, 8).padEnd(8, "0")}`;
  const account = await prisma.employeeAccount.create({ data: { name: "Synthetic employee", phoneNumber: phone, phoneNormalized: phone } });
  const member = await prisma.employeeBusinessMembership.create({ data: { employeeAccountId: account.id, businessId: business.id, employeeCode: "SYNTHETIC", fullName: "Synthetic employee", phoneNumber: phone, phoneNumberNormalized: phone, isTestAccount: true } });
  const run = await prisma.payrollRun.create({ data: { businessId: business.id, periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-10-01"), createdById: owner.id, attendanceSource: "LEGACY_OPERATIONAL_SESSION", workingDaysPerMonthSnapshot: 26, normalWorkMinutesPerDaySnapshot: 480, breakMinutesPerDaySnapshot: 60, overtimeMultiplierSnapshot: 1.5, publicHolidayExtraMultiplierSnapshot: 2 } });
  const entry = await prisma.$transaction(async (transaction) => {
    const compensation = await transaction.employeeCompensationVersion.create({ data: { businessId: business.id, membershipId: member.id, effectiveFromMonth: new Date("2026-09-01"), payBasis: "MONTHLY", baseRate: 1000, source: "MANUAL", reasonType: "OTHER", createdById: owner.id } });
    const created = await transaction.payrollEntry.create({ data: { compensationVersionId: compensation.id, payrollRunId: run.id, businessId: business.id, membershipId: member.id, employeeCodeSnapshot: "SYNTHETIC", fullNameSnapshot: "Synthetic employee", payBasisSnapshot: "MONTHLY", baseRateSnapshot: 1000, workingDaysSnapshot: 26, normalWorkMinutesSnapshot: 480, basicPay: 1000, grossPay: 1000, netPay: 1000 } });
    await transaction.payrollEntryComponent.create({ data: { sourceVersionId: compensation.id, businessId: business.id, membershipId: member.id, payrollEntryId: created.id, payrollRunId: run.id, lineKey: "SYSTEM:BASIC_SALARY", code: "BASIC_SALARY", name: "Salary", type: "EARNING", sourceType: "BASIC_SALARY", origin: "SYSTEM", amount: 1000, calculationBasis: "MONTHLY", sortOrder: 1, createdById: owner.id } });
    return created;
  });
  const input = { businessId: business.id, entryId: entry.id, actorId: owner.id, expectedRevision: 0, expectedInputDigest: await manualPcbInputDigest(prisma, business.id, entry.id), amount: "125.50", externalReference: "synthetic external evidence", confirmed: true };
  await assert.rejects(assertManualPcbForEntry(prisma, business.id, entry.id), /PCB_MANUAL_CONFIRMATION_REQUIRED/);
  await assert.rejects(confirmManualPcb(input), /STEP_UP_REQUIRED/);
  const authorization = await issueTestHighRiskStepUp(prisma, { actionKey: "PCB_MANUAL_CONFIRM", businessId: business.id, resourceId: entry.id, userId: owner.id });
  await confirmManualPcb({ ...input, stepUp: authorization.stepUp });
  const current = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
  assert.equal(current.netPay.toFixed(2), "874.50");
  assert.equal(current.pcb.toFixed(2), "125.50");
  assert.equal(current.calculationRevision, 1);
  assert.ok(await resolveManualPcb(prisma, business.id, entry.id));
  await assertManualPcbForEntry(prisma, business.id, entry.id);
  await assert.rejects(confirmManualPcb({ ...input, stepUp: authorization.stepUp }));
  await updateEmployeeTaxProfile({ command: { commandId: randomUUID(), membershipId: member.id, expectedRevision: 0, taxIdentificationNumber: "SYNTHETIC-TAX", reasonType: "TAX_INFORMATION_UPDATE", reasonNote: "Synthetic tax correction" }, context: { businessId: business.id, actor: { userId: owner.id, name: "Synthetic Owner", email: owner.email ?? "synthetic@test.invalid" }, access: await resolveBusinessAccess({ userId: owner.id, requestedBusinessId: business.id }), allowedBranchIds: [], caller: "PAYROLL_ACTION" } });
  assert.equal(await resolveManualPcb(prisma, business.id, entry.id), null);
  await assert.rejects(assertManualPcbForEntry(prisma, business.id, entry.id), /PCB_MANUAL_CONFIRMATION_REQUIRED/);
  assert.equal(await prisma.payrollManualPcbInvalidation.count({ where: { confirmation: { payrollEntryId: entry.id } } }), 1);
  const next = await issueTestHighRiskStepUp(prisma, { actionKey: "PCB_MANUAL_CONFIRM", businessId: business.id, resourceId: entry.id, userId: owner.id });
  await confirmManualPcb({ ...input, expectedRevision: 1, expectedInputDigest: await manualPcbInputDigest(prisma, business.id, entry.id), amount: "0.00", stepUp: next.stepUp });
  assert.equal((await resolveManualPcb(prisma, business.id, entry.id))?.amount.toFixed(2), "0.00");
  assert.equal(await prisma.payrollManualPcbConfirmation.count({ where: { payrollEntryId: entry.id } }), 2);
  assert.equal((await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } })).netPay.toFixed(2), "1000.00");
  const payslip = await loadPayrollPayslip(business.id, entry.id);
  assert.ok(payslip);
  assert.equal(pcbPayslipPresentation(payslip.run.status, payslip.entry).sourceLabel, "Manually confirmed");
  assert.equal(payslip.entry.statutorySnapshots?.find((snapshot) => snapshot.scheme === "PCB")?.status, "MANUAL");
  for (const permissions of [[], ["ALL_BRANCHES", "ATTENDANCE_EMPLOYEE_MANAGE"], ["EDIT_PAYROLL_ENTRY"]]) {
    const denied = await prisma.user.create({ data: { businessId: business.id, name: "Synthetic restricted actor", email: `restricted-${randomUUID()}@test.invalid`, role: "STAFF", permissions } });
    const proof = await issueTestHighRiskStepUp(prisma, { actionKey: "PCB_MANUAL_CONFIRM", businessId: business.id, resourceId: entry.id, userId: denied.id });
    await assert.rejects(confirmManualPcb({ ...input, actorId: denied.id, expectedRevision: 2, stepUp: proof.stepUp }), /PCB_MANUAL_PERMISSION_DENIED/);
  }
  process.env.TETAMU_MFA_ENABLED = "false";
  try { await assert.rejects(confirmManualPcb({ ...input, expectedRevision: 2, stepUp: next.stepUp }), /PCB_MANUAL_MFA_REQUIRED/); }
  finally { process.env.TETAMU_MFA_ENABLED = "true"; }
});
test.after(async () => { await prisma.$disconnect(); });
