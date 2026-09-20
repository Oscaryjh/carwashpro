import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma";
import { createCanonicalPcbFixture, enrollFixtureMfa } from "../helpers/manual-pcb-fixture";
import { confirmManualPcb, manualPcbInputDigest } from "../../src/lib/payroll/manual-pcb-service";
import { submitPayrollRunForReview, finalizePayrollRun, reopenPayrollRun } from "../../src/lib/payroll/service";
import { publishPayrollPayslips, loadOwnPublishedPayslip } from "../../src/lib/payroll/payslip-publication";
import { updateEmployeeTaxProfile } from "../../src/lib/payroll/employee-profile-write/tax";
import { resolveBusinessAccess } from "../../src/lib/business-groups/business-access";

// Approved recovery policy: published history remains readable and immutable.
test("published history survives current tax changes while reconfirm and reopen remain forbidden", async () => {
  const f = await createCanonicalPcbFixture();
  const authorize = await enrollFixtureMfa(f.business.id, f.owner.id);
  const confirmation = { businessId: f.business.id, entryId: f.entry.id, actorId: f.owner.id,
    expectedRevision: f.entry.calculationRevision, expectedInputDigest: await manualPcbInputDigest(prisma, f.business.id, f.entry.id),
    amount: "125.50", externalReference: "EXPLICIT_SYNTHETIC_LIFECYCLE_PROOF", confirmed: true };
  await confirmManualPcb({ ...confirmation, stepUp: await authorize("PCB_MANUAL_CONFIRM", f.entry.id) });
  await submitPayrollRunForReview({ businessId: f.business.id, runId: f.run.id, actor: f.actor });
  await finalizePayrollRun({ businessId: f.business.id, runId: f.run.id, actor: f.actor,
    allowSelfApprovalOverride: true, overrideReason: "Synthetic lifecycle reproduction", stepUp: await authorize("PAYROLL_FINALIZE", f.run.id) });
  await publishPayrollPayslips({ businessId: f.business.id, runId: f.run.id, actor: f.actor });
  const publication = await prisma.payrollPayslipPublication.findUniqueOrThrow({ where: { payrollEntryId: f.entry.id } });
  const own = { businessId: f.business.id, membershipId: f.member.id, publicationId: publication.id };
  assert.ok(await loadOwnPublishedPayslip(own));
  await updateEmployeeTaxProfile({ command: { commandId: randomUUID(), membershipId: f.member.id,
    expectedRevision: f.member.taxProfileRevision, taxIdentificationNumber: "SYNTHETIC-LIFECYCLE-TAX-UPDATE",
    reasonType: "TAX_INFORMATION_UPDATE", reasonNote: "Explicit current tax update after historical publication" },
    context: { businessId: f.business.id, actor: f.actor, access: await resolveBusinessAccess({ userId: f.owner.id, requestedBusinessId: f.business.id }), allowedBranchIds: [f.branch.id], caller: "PAYROLL_ACTION" } });
  const historical = await loadOwnPublishedPayslip(own);
  assert.ok(historical);
  assert.deepEqual(historical.documentBytes, publication.documentBytes);
  const current = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: f.entry.id } });
  await assert.rejects(confirmManualPcb({ ...confirmation, expectedRevision: current.calculationRevision,
    expectedInputDigest: await manualPcbInputDigest(prisma, f.business.id, f.entry.id), stepUp: await authorize("PCB_MANUAL_CONFIRM", f.entry.id) }), /PCB_INPUT_REVISION_CHANGED/);
  await assert.rejects(reopenPayrollRun({ businessId: f.business.id, runId: f.run.id, actor: f.actor,
    reason: "Attempt documented published source recovery", stepUp: await authorize("PAYROLL_REOPEN", f.run.id) }), /published payslips cannot be reopened/i);
  const retained = await prisma.payrollPayslipPublication.findUniqueOrThrow({ where: { payrollEntryId: f.entry.id } });
  assert.equal(retained.documentSha256, publication.documentSha256);
  assert.equal(await prisma.payrollManualPcbInvalidation.count({ where: { confirmation: { payrollEntryId: f.entry.id } } }), 0);
});
test.after(async () => { await prisma.$disconnect(); });
