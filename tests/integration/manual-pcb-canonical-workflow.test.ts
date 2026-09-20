import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma";
import { confirmManualPcb, resolveManualPcb, assertManualPcbForEntry, manualPcbInputDigest } from "../../src/lib/payroll/manual-pcb-service";
import { addManualPayrollAdjustment } from "../../src/lib/payroll/component-service";
import { updateEmployeeTaxProfile } from "../../src/lib/payroll/employee-profile-write/tax";
import { resolveBusinessAccess } from "../../src/lib/business-groups/business-access";
import { getPayrollPeriodReadiness } from "../../src/lib/payroll/readiness";
import { finalizePayrollRun } from "../../src/lib/payroll/service";
import { publishPayrollPayslips, loadOwnPublishedPayslip } from "../../src/lib/payroll/payslip-publication";
import { createCanonicalPcbFixture, enrollFixtureMfa } from "../helpers/manual-pcb-fixture";
import { submitPayrollRunForReview } from "../helpers/rc-readiness-diagnostics";

test("canonical manual PCB: real MFA, locked attendance, review, finalize and own-only published payslip", async () => {
  const f = await createCanonicalPcbFixture();
  const authorize = await enrollFixtureMfa(f.business.id, f.owner.id);
  const input = { businessId: f.business.id, entryId: f.entry.id, actorId: f.owner.id, expectedRevision: f.entry.calculationRevision, expectedInputDigest: await manualPcbInputDigest(prisma, f.business.id, f.entry.id), amount: "125.50", externalReference: "EXTERNAL_SYNTHETIC_PAYROLL_JULY_APPROVAL", confirmed: true };
  const readyInput = { businessId: f.business.id, runId: f.run.id, month: "2026-07" };
  assert.equal((await getPayrollPeriodReadiness(readyInput)).canProceed, false);
  const stepUp = await authorize("PCB_MANUAL_CONFIRM", f.entry.id);
  await assert.rejects(confirmManualPcb({ ...input, amount: undefined, stepUp }));
  await assert.rejects(confirmManualPcb({ ...input, amount: "0", externalReference: "", stepUp }));
  await assert.rejects(confirmManualPcb(input), /STEP_UP_REQUIRED/);
  await assert.rejects(confirmManualPcb({ ...input, expectedRevision: f.entry.calculationRevision + 1, stepUp }), /PCB_INPUT_REVISION_CHANGED/);
  await confirmManualPcb({ ...input, stepUp });
  const source = await resolveManualPcb(prisma, f.business.id, f.entry.id);
  assert.equal(source?.amount.toFixed(2), "125.50");
  assert.equal((await getPayrollPeriodReadiness(readyInput)).canProceed, true);
  await submitPayrollRunForReview({ businessId: f.business.id, runId: f.run.id, actor: f.actor });
  await finalizePayrollRun({ businessId: f.business.id, runId: f.run.id, actor: f.actor, allowSelfApprovalOverride: true, overrideReason: "Canonical synthetic owner final review", stepUp: await authorize("PAYROLL_FINALIZE", f.run.id) });
  const result = await publishPayrollPayslips({ businessId: f.business.id, runId: f.run.id, actor: f.actor });
  assert.equal(result.publishedCount, 1);
  const publication = await prisma.payrollPayslipPublication.findUniqueOrThrow({ where: { payrollEntryId: f.entry.id } });
  assert.ok(await loadOwnPublishedPayslip({ businessId: f.business.id, membershipId: f.member.id, publicationId: publication.id }));
  assert.equal(await loadOwnPublishedPayslip({ businessId: f.business.id, membershipId: randomUUID(), publicationId: publication.id }), null);
  assert.equal(await loadOwnPublishedPayslip({ businessId: randomUUID(), membershipId: f.member.id, publicationId: publication.id }), null);
  const finalEntry = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: f.entry.id } });
  assert.equal(finalEntry.pcb.toFixed(2), "125.50");
  assert.equal(finalEntry.netPay.toFixed(2), "2874.50");
});
test.after(async () => { await prisma.$disconnect(); });

test("manual PCB refuses a stale reviewed input digest before consuming the MFA grant", async () => {
  const f = await createCanonicalPcbFixture();
  const authorize = await enrollFixtureMfa(f.business.id, f.owner.id);
  const stepUp = await authorize("PCB_MANUAL_CONFIRM", f.entry.id);
  const input = { businessId: f.business.id, entryId: f.entry.id, actorId: f.owner.id, expectedRevision: f.entry.calculationRevision,
    expectedInputDigest: await manualPcbInputDigest(prisma, f.business.id, f.entry.id), amount: "125.50", externalReference: "STALE_EXTERNALLY_REVIEWED_INPUT", confirmed: true, stepUp };
  await updateEmployeeTaxProfile({ command: { commandId: randomUUID(), membershipId: f.member.id, expectedRevision: f.member.taxProfileRevision,
    taxIdentificationNumber: "SYNTHETIC-STALE-FORM-TAX", reasonType: "TAX_INFORMATION_UPDATE", reasonNote: "Change after old form was displayed" },
    context: { businessId: f.business.id, actor: f.actor, access: await resolveBusinessAccess({ userId: f.owner.id, requestedBusinessId: f.business.id }), allowedBranchIds: [f.branch.id], caller: "PAYROLL_ACTION" } });
  assert.equal((await prisma.payrollEntry.findUniqueOrThrow({ where: { id: f.entry.id } })).calculationRevision, input.expectedRevision);
  await assert.rejects(confirmManualPcb(input), /PCB_INPUT_DIGEST_CHANGED/);
  assert.equal(await prisma.payrollManualPcbConfirmation.count({ where: { payrollEntryId: f.entry.id } }), 0);
  await confirmManualPcb({ ...input, expectedInputDigest: await manualPcbInputDigest(prisma, f.business.id, f.entry.id) });
  assert.ok(await resolveManualPcb(prisma, f.business.id, f.entry.id));
});

test("manual PCB denies restricted branch actors and cross-business inputs while permitting the explicit payroll admin capability", async () => {
  const f = await createCanonicalPcbFixture();
  const authorizeOwner = await enrollFixtureMfa(f.business.id, f.owner.id);
  const input = { businessId: f.business.id, entryId: f.entry.id, actorId: f.owner.id, expectedRevision: f.entry.calculationRevision, expectedInputDigest: await manualPcbInputDigest(prisma, f.business.id, f.entry.id), amount: "0.00", externalReference: "EXPLICIT_ZERO_PERMISSION_MATRIX", confirmed: true, stepUp: await authorizeOwner("PCB_MANUAL_CONFIRM", f.entry.id) };
  const other = await prisma.business.create({ data: { name: "Other synthetic business", slug: `other-manual-${randomUUID()}` } });
  await assert.rejects(confirmManualPcb({ ...input, businessId: other.id }), /PCB_MANUAL_PERMISSION_DENIED/);
  const otherBranch = await prisma.branch.create({ data: { businessId: f.business.id, name: "Other branch" } });
  for (const permissions of [[], ["ATTENDANCE_EMPLOYEE_MANAGE"], ["EDIT_PAYROLL_ENTRY"]]) {
    const restricted = await prisma.user.create({ data: { businessId: f.business.id, branchId: otherBranch.id, name: "Restricted synthetic actor", email: `restricted-${randomUUID()}@test.invalid`, role: "STAFF", permissions } });
    await assert.rejects(confirmManualPcb({ ...input, actorId: restricted.id }), /PCB_MANUAL_PERMISSION_DENIED/);
  }
  assert.equal(await prisma.payrollManualPcbConfirmation.count({ where: { payrollEntryId: f.entry.id } }), 0);
  const admin = await prisma.user.create({ data: { businessId: f.business.id, branchId: f.branch.id, name: "Synthetic Payroll Admin", email: `admin-${randomUUID()}@test.invalid`, role: "STAFF", permissions: ["ALL_BRANCHES", "EDIT_PAYROLL_ENTRY"] } });
  const authorizeAdmin = await enrollFixtureMfa(f.business.id, admin.id);
  await confirmManualPcb({ ...input, actorId: admin.id, stepUp: await authorizeAdmin("PCB_MANUAL_CONFIRM", f.entry.id) });
  assert.equal((await resolveManualPcb(prisma, f.business.id, f.entry.id))?.confirmedById, admin.id);
});

test("component, tax, statutory digest and payroll month changes invalidate prior manual confirmation without rewriting history", async () => {
  const f = await createCanonicalPcbFixture();
  const authorize = await enrollFixtureMfa(f.business.id, f.owner.id);
  const confirm = async () => {
    const entry = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: f.entry.id } });
    return confirmManualPcb({ businessId: f.business.id, entryId: entry.id, actorId: f.owner.id, expectedRevision: entry.calculationRevision, expectedInputDigest: await manualPcbInputDigest(prisma, f.business.id, entry.id), amount: "125.50", externalReference: "EXTERNAL_RECONFIRMATION_AFTER_INPUT_REVIEW", confirmed: true, stepUp: await authorize("PCB_MANUAL_CONFIRM", entry.id) });
  };
  const assertInvalid = async () => {
    assert.equal(await resolveManualPcb(prisma, f.business.id, f.entry.id), null);
    await assert.rejects(assertManualPcbForEntry(prisma, f.business.id, f.entry.id), /PCB_MANUAL_CONFIRMATION_REQUIRED/);
  };
  const first = await confirm();
  await addManualPayrollAdjustment({ businessId: f.business.id, actor: f.actor, entryId: f.entry.id, expectedRevision: first.inputRevision, type: "EARNING", name: "Synthetic adjustment", amount: "25.00", reason: "Verified pay input mutation" });
  await assertInvalid();
  await confirm();
  await updateEmployeeTaxProfile({ command: { commandId: randomUUID(), membershipId: f.member.id, expectedRevision: f.member.taxProfileRevision, taxIdentificationNumber: "SYNTHETIC-TAX-CHANGE", reasonType: "TAX_INFORMATION_UPDATE", reasonNote: "Explicit synthetic tax correction" }, context: { businessId: f.business.id, actor: f.actor, access: await resolveBusinessAccess({ userId: f.owner.id, requestedBusinessId: f.business.id }), allowedBranchIds: [f.branch.id], caller: "PAYROLL_ACTION" } });
  await assertInvalid();
  await confirm();
  const snapshot = await prisma.payrollEntryStatutorySnapshot.findFirstOrThrow({ where: { payrollEntryId: f.entry.id, scheme: "PCB" } });
  await prisma.payrollEntryStatutorySnapshot.update({ where: { id: snapshot.id }, data: { calculationInputDigest: "e".repeat(64) } });
  await assertInvalid();
  await confirm();
  const augustStart = new Date("2026-08-01");
  const augustTimesheet = await prisma.attendanceMonthlyTimesheet.create({ data: { businessId: f.business.id, periodStart: augustStart } });
  const augustRevision = await prisma.attendanceTimesheetRevision.create({ data: { businessId: f.business.id, timesheetId: augustTimesheet.id, lockedById: f.owner.id, periodStart: augustStart, revision: 1, sourceDigest: "c".repeat(64), reason: "Matching source for explicit month change test" } });
  await prisma.attendanceMonthlyTimesheet.update({ where: { id: augustTimesheet.id }, data: { currentRevisionId: augustRevision.id, status: "LOCKED" } });
  await prisma.payrollRun.update({ where: { id: f.run.id }, data: { periodStart: augustStart, periodEnd: new Date("2026-09-01"), attendanceTimesheetRevisionId: augustRevision.id, attendanceTimesheetRevisionSnapshot: augustRevision.revision, attendanceTimesheetDigestSnapshot: augustRevision.sourceDigest, attendanceTimesheetLockedAtSnapshot: augustRevision.lockedAt } });
  await assertInvalid();
  const retained = await prisma.payrollManualPcbConfirmation.findUniqueOrThrow({ where: { id: first.id } });
  assert.equal(retained.inputDigest, first.inputDigest);
  assert.equal(retained.amount.toFixed(2), "125.50");
  assert.equal(await prisma.payrollManualPcbInvalidation.count({ where: { confirmation: { payrollEntryId: f.entry.id } } }), 4);
});
