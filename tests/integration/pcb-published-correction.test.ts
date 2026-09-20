import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma";
import { createCanonicalPcbFixture, enrollFixtureMfa } from "../helpers/manual-pcb-fixture";
import { confirmManualPcb, manualPcbInputDigest } from "../../src/lib/payroll/manual-pcb-service";
import { submitPayrollRunForReview, finalizePayrollRun, generatePayrollRun } from "../../src/lib/payroll/service";
import { publishPayrollPayslips, loadOwnPublishedPayslip } from "../../src/lib/payroll/payslip-publication";
import { correctPublishedPcb, loadPcbPublicationHistory } from "../../src/lib/payroll/pcb-published-correction";
import { authoritativePcbHistory } from "../../src/lib/payroll/pcb-history";
import { pendingPcbCorrections } from "../../src/lib/payroll/pcb-correction-settlement";
import { getPayrollPeriodReadiness } from "../../src/lib/payroll/readiness";

test("authorized correction appends publication, preserves original, defaults Staff to latest and remains unsettled without next run", async () => {
  const f = await createCanonicalPcbFixture();
  const authorize = await enrollFixtureMfa(f.business.id, f.owner.id);
  await confirmManualPcb({ businessId: f.business.id, entryId: f.entry.id, actorId: f.owner.id, expectedRevision: f.entry.calculationRevision,
    expectedInputDigest: await manualPcbInputDigest(prisma, f.business.id, f.entry.id), amount: "125.50", confirmed: true,
    externalReference: "SYNTHETIC_ORIGINAL_EVIDENCE", stepUp: await authorize("PCB_MANUAL_CONFIRM", f.entry.id) });
  await submitPayrollRunForReview({ businessId: f.business.id, runId: f.run.id, actor: f.actor });
  await finalizePayrollRun({ businessId: f.business.id, runId: f.run.id, actor: f.actor, allowSelfApprovalOverride: true,
    overrideReason: "Synthetic correction workflow", stepUp: await authorize("PAYROLL_FINALIZE", f.run.id) });
  await publishPayrollPayslips({ businessId: f.business.id, runId: f.run.id, actor: f.actor });
  const original = await prisma.payrollPayslipPublication.findUniqueOrThrow({ where: { payrollEntryId: f.entry.id } });
  const before = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: f.entry.id } });
  const input = { businessId: f.business.id, publicationId: original.id, actorId: f.owner.id, expectedVersion: 1,
    expectedInputDigest: await manualPcbInputDigest(prisma, f.business.id, f.entry.id), amount: "150.00", confirmed: true,
    externalReference: "SYNTHETIC_CORRECTION_EVIDENCE", reason: "Correct certified historical PCB amount" };
  await assert.rejects(correctPublishedPcb(input), /STEP_UP_REQUIRED/);
  const probe = { ...input, stepUp: { rawToken: "not-an-authorization", sessionId: randomUUID() } };
  for (const permissions of [[], ["ATTENDANCE_EMPLOYEE_MANAGE"], ["EDIT_PAYROLL_ENTRY"]]) {
    const restricted = await prisma.user.create({ data: { businessId: f.business.id, branchId: f.branch.id, name: "Restricted synthetic actor", email: `restricted-${randomUUID()}@test.invalid`, role: "STAFF", permissions } });
    await assert.rejects(correctPublishedPcb({ ...probe, actorId: restricted.id }), /PCB_MANUAL_PERMISSION_DENIED/);
    await assert.rejects(loadPcbPublicationHistory({ businessId: f.business.id, publicationId: original.id, actorId: restricted.id }), /PCB_MANUAL_PERMISSION_DENIED/);
  }
  const other = await prisma.business.create({ data: { name: "Other synthetic tenant", slug: `correction-other-${randomUUID()}` } });
  await assert.rejects(correctPublishedPcb({ ...probe, businessId: other.id }), /PCB_MANUAL_PERMISSION_DENIED/);
  await assert.rejects(correctPublishedPcb({ ...probe, amount: "", confirmed: false }));
  await assert.rejects(correctPublishedPcb({ ...probe, amount: "0.00", externalReference: "" }));
  await assert.rejects(correctPublishedPcb({ ...probe, expectedInputDigest: "0".repeat(64) }), /PCB_INPUT_DIGEST_CHANGED/);
  const corrected = await correctPublishedPcb({ ...input, stepUp: await authorize("PCB_HISTORICAL_CORRECT", original.id) });
  assert.equal(corrected.version, 2);
  assert.notEqual(corrected.inputDigest, input.expectedInputDigest, "Corrected evidence digest must bind the corrected amount and reference");
  assert.equal(corrected.delta.toFixed(2), "24.50");
  assert.equal(corrected.settlementState, "UNSETTLED");
  const history = await loadPcbPublicationHistory({ businessId: f.business.id, publicationId: original.id, actorId: f.owner.id });
  assert.deepEqual(history.map((v) => v.version), [1, 2]);
  assert.equal(history[1].supersedesId, history[0].id);
  const own = await loadOwnPublishedPayslip({ businessId: f.business.id, membershipId: f.member.id, publicationId: original.id });
  assert.ok(own);
  assert.notDeepEqual(own.documentBytes, original.documentBytes);
  assert.match(Buffer.from(own.documentBytes).toString(), /Corrected/);
  assert.match(Buffer.from(own.documentBytes).toString(), /Supersedes previous version/);
  assert.equal(await loadOwnPublishedPayslip({ businessId: f.business.id, membershipId: randomUUID(), publicationId: original.id }), null);
  assert.deepEqual(await prisma.payrollEntry.findUniqueOrThrow({ where: { id: f.entry.id } }), before);
  assert.deepEqual((await prisma.payrollPayslipPublication.findUniqueOrThrow({ where: { id: original.id } })).documentBytes, original.documentBytes);
  await assert.rejects(correctPublishedPcb({ ...input, stepUp: await authorize("PCB_HISTORICAL_CORRECT", original.id) }), /PCB_VERSION_CONFLICT/);
  await assert.rejects(prisma.payrollPcbPublicationVersion.update({ where: { id: corrected.id }, data: { reason: "overwrite" } }), /PCB_LEDGER_APPEND_ONLY/);
  const timesheet = await prisma.attendanceMonthlyTimesheet.create({ data: { businessId: f.business.id, periodStart: new Date("2026-08-01") } });
  const revision = await prisma.attendanceTimesheetRevision.create({ data: { businessId: f.business.id, timesheetId: timesheet.id, lockedById: f.owner.id,
    periodStart: new Date("2026-08-01"), revision: 1, sourceDigest: "e".repeat(64), reason: "Next open period synthetic attendance" } });
  await prisma.attendanceMonthlyTimesheet.update({ where: { id: timesheet.id }, data: { currentRevisionId: revision.id, status: "LOCKED" } });
  const nextRun = await generatePayrollRun({ businessId: f.business.id, actor: f.actor, month: "2026-08" });
  const next = await prisma.payrollEntry.findFirstOrThrow({ where: { payrollRunId: nextRun.id, membershipId: f.member.id } });
  const deltas = await prisma.payrollEntryComponent.findMany({ where: { payrollEntryId: next.id, code: "PRIOR_PERIOD_PCB_ADJUSTMENT" } });
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].amount.toFixed(2), "24.50");
  assert.equal(deltas[0].type, "DEDUCTION");
  const secondSource = await confirmManualPcb({ businessId: f.business.id, entryId: next.id, actorId: f.owner.id, expectedRevision: next.calculationRevision,
    expectedInputDigest: await manualPcbInputDigest(prisma, f.business.id, next.id), amount: "200.00", confirmed: true,
    externalReference: "SYNTHETIC_AUGUST_EVIDENCE", stepUp: await authorize("PCB_MANUAL_CONFIRM", next.id) });
  const digest = await manualPcbInputDigest(prisma, f.business.id, next.id);
  await correctPublishedPcb({ ...input, amount: "100.00", expectedVersion: 2, expectedInputDigest: await manualPcbInputDigest(prisma, f.business.id, f.entry.id),
    stepUp: await authorize("PCB_HISTORICAL_CORRECT", original.id) });
  assert.notEqual(await manualPcbInputDigest(prisma, f.business.id, next.id), digest, "Prior correction must invalidate later current inputs");
  assert.equal(await prisma.payrollManualPcbInvalidation.count({ where: { confirmationId: secondSource.id } }), 1);
  const ytd = await authoritativePcbHistory(prisma, f.business.id, f.member.id, new Date("2026-08-01"));
  assert.equal(ytd.length, 1, "Manual BLOCKED snapshot month must not be omitted");
  assert.equal(ytd[0].amount?.toFixed(2), "100.00");
  assert.equal(ytd[0].sourceVersion, 3);
  const liveLines = await prisma.payrollEntryComponent.findMany({ where: { payrollEntryId: next.id, code: "PRIOR_PERIOD_PCB_ADJUSTMENT" } });
  assert.equal(liveLines.length, 2);
  assert.equal(liveLines.filter((line) => line.type === "EARNING")[0].amount.toFixed(2), "50.00");
  await generatePayrollRun({ businessId: f.business.id, actor: f.actor, month: "2026-08" });
  assert.equal(await prisma.payrollEntryComponent.count({ where: { businessId: f.business.id, membershipId: f.member.id, code: "PRIOR_PERIOD_PCB_ADJUSTMENT" } }), 2, "Regeneration must not double-apply deltas");
  const fresh = { ...input, expectedVersion: 3, expectedInputDigest: await manualPcbInputDigest(prisma, f.business.id, f.entry.id), amount: "110.00" };
  const firstMfa = await authorize("PCB_HISTORICAL_CORRECT", original.id);
  const secondMfa = await authorize("PCB_HISTORICAL_CORRECT", original.id);
  const concurrent = await Promise.allSettled([correctPublishedPcb({ ...fresh, stepUp: firstMfa }), correctPublishedPcb({ ...fresh, stepUp: secondMfa })]);
  assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await loadPcbPublicationHistory({ businessId: f.business.id, publicationId: original.id, actorId: f.owner.id })).length, 4);
  const august = await prisma.payrollEntry.findFirstOrThrow({ where: { payrollRunId: nextRun.id, membershipId: f.member.id } });
  await confirmManualPcb({ businessId: f.business.id, entryId: august.id, actorId: f.owner.id, expectedRevision: august.calculationRevision,
    expectedInputDigest: await manualPcbInputDigest(prisma, f.business.id, august.id), amount: "200.00", confirmed: true,
    externalReference: "RECONFIRMED_AUGUST_AFTER_HISTORY_CORRECTION", stepUp: await authorize("PCB_MANUAL_CONFIRM", august.id) });
  await submitPayrollRunForReview({ businessId: f.business.id, runId: nextRun.id, actor: f.actor });
  await finalizePayrollRun({ businessId: f.business.id, runId: nextRun.id, actor: f.actor, allowSelfApprovalOverride: true,
    overrideReason: "Synthetic next-period settlement proof", stepUp: await authorize("PAYROLL_FINALIZE", nextRun.id) });
  await publishPayrollPayslips({ businessId: f.business.id, runId: nextRun.id, actor: f.actor });
  const septemberYtd = await authoritativePcbHistory(prisma, f.business.id, f.member.id, new Date("2026-09-01"));
  assert.equal(septemberYtd.length, 2);
  assert.equal(septemberYtd.reduce((sum, row) => sum + Number(row.amount), 0), 310, "Settlement lines must not be counted as another PCB month");
});
test("non-PCB membership changes preserve confirmation; terminated employee correction stays unsettled with no payment/export", async () => {
  const f = await createCanonicalPcbFixture();
  const authorize = await enrollFixtureMfa(f.business.id, f.owner.id);
  const source = await confirmManualPcb({ businessId: f.business.id, entryId: f.entry.id, actorId: f.owner.id, expectedRevision: f.entry.calculationRevision,
    expectedInputDigest: await manualPcbInputDigest(prisma, f.business.id, f.entry.id), amount: "125.50", confirmed: true,
    externalReference: "EXPLICIT_TERMINATED_ORIGINAL_EVIDENCE", stepUp: await authorize("PCB_MANUAL_CONFIRM", f.entry.id) });
  const digest = await manualPcbInputDigest(prisma, f.business.id, f.entry.id);
  await prisma.employeeBusinessMembership.update({ where: { id: f.member.id }, data: { attendanceEnabled: true } });
  assert.equal(await manualPcbInputDigest(prisma, f.business.id, f.entry.id), digest);
  assert.equal(await prisma.payrollManualPcbInvalidation.count({ where: { confirmationId: source.id } }), 0);
  await submitPayrollRunForReview({ businessId: f.business.id, runId: f.run.id, actor: f.actor });
  await finalizePayrollRun({ businessId: f.business.id, runId: f.run.id, actor: f.actor, allowSelfApprovalOverride: true,
    overrideReason: "Synthetic terminated policy proof", stepUp: await authorize("PAYROLL_FINALIZE", f.run.id) });
  await publishPayrollPayslips({ businessId: f.business.id, runId: f.run.id, actor: f.actor });
  const original = await prisma.payrollPayslipPublication.findUniqueOrThrow({ where: { payrollEntryId: f.entry.id } });
  await prisma.employeeBusinessMembership.update({ where: { id: f.member.id }, data: { status: "TERMINATED", terminatedAt: new Date("2026-08-01") } });
  const result = await correctPublishedPcb({ businessId: f.business.id, publicationId: original.id, actorId: f.owner.id, expectedVersion: 1,
    expectedInputDigest: await manualPcbInputDigest(prisma, f.business.id, f.entry.id), amount: "0.00", confirmed: true,
    reason: "Authorized terminated employee correction", externalReference: "EXPLICIT_ZERO_TERMINATED_EVIDENCE", stepUp: await authorize("PCB_HISTORICAL_CORRECT", original.id) });
  assert.equal(result.settlementState, "UNSETTLED");
  assert.equal(await prisma.payrollEntryComponent.count({ where: { businessId: f.business.id, code: "PRIOR_PERIOD_PCB_ADJUSTMENT" } }), 0);
  assert.equal(await prisma.payrollPaymentBatch.count({ where: { businessId: f.business.id } }), 0);
  assert.equal(await prisma.payrollManualPcbInvalidation.count({ where: { confirmationId: source.id } }), 0);
});
test("insufficient next-run net leaves full delta unsettled; removed adjustments append an unsettled event", async () => {
  const f = await createCanonicalPcbFixture();
  const authorize = await enrollFixtureMfa(f.business.id, f.owner.id);
  await confirmManualPcb({ businessId: f.business.id, entryId: f.entry.id, actorId: f.owner.id, expectedRevision: f.entry.calculationRevision,
    expectedInputDigest: await manualPcbInputDigest(prisma, f.business.id, f.entry.id), amount: "125.50", confirmed: true,
    externalReference: "EXPLICIT_CAPACITY_ORIGINAL", stepUp: await authorize("PCB_MANUAL_CONFIRM", f.entry.id) });
  await submitPayrollRunForReview({ businessId: f.business.id, runId: f.run.id, actor: f.actor });
  await finalizePayrollRun({ businessId: f.business.id, runId: f.run.id, actor: f.actor, allowSelfApprovalOverride: true,
    overrideReason: "Synthetic insufficient net proof", stepUp: await authorize("PAYROLL_FINALIZE", f.run.id) });
  await publishPayrollPayslips({ businessId: f.business.id, runId: f.run.id, actor: f.actor });
  const original = await prisma.payrollPayslipPublication.findUniqueOrThrow({ where: { payrollEntryId: f.entry.id } });
  const sheet = await prisma.attendanceMonthlyTimesheet.create({ data: { businessId: f.business.id, periodStart: new Date("2026-08-01") } });
  const revision = await prisma.attendanceTimesheetRevision.create({ data: { businessId: f.business.id, timesheetId: sheet.id,
    lockedById: f.owner.id, periodStart: new Date("2026-08-01"), revision: 1, sourceDigest: "e".repeat(64), reason: "Synthetic capacity period" } });
  await prisma.attendanceMonthlyTimesheet.update({ where: { id: sheet.id }, data: { currentRevisionId: revision.id, status: "LOCKED" } });
  await generatePayrollRun({ businessId: f.business.id, actor: f.actor, month: "2026-08" });
  const input = { businessId: f.business.id, publicationId: original.id, actorId: f.owner.id, expectedVersion: 1,
    expectedInputDigest: await manualPcbInputDigest(prisma, f.business.id, f.entry.id), amount: "6000.00", confirmed: true,
    externalReference: "EXPLICIT_CAPACITY_CORRECTION", reason: "Certified correction greater than next payroll net" };
  const large = await correctPublishedPcb({ ...input, stepUp: await authorize("PCB_HISTORICAL_CORRECT", original.id) });
  assert.equal(large.settlementState, "UNSETTLED");
  assert.equal(await prisma.payrollEntryComponent.count({ where: { businessId: f.business.id, code: "PRIOR_PERIOD_PCB_ADJUSTMENT" } }), 0);
  assert.equal((await pendingPcbCorrections(prisma, f.business.id, f.member.id, new Date("2026-08-01"))).length, 1);
  const lower = await correctPublishedPcb({ ...input, expectedVersion: 2, amount: "150.00",
    expectedInputDigest: await manualPcbInputDigest(prisma, f.business.id, f.entry.id), stepUp: await authorize("PCB_HISTORICAL_CORRECT", original.id) });
  assert.equal(lower.settlementState, "APPLIED_TO_PAYROLL_NOT_PAYMENT");
  assert.equal(await prisma.payrollEntryComponent.count({ where: { businessId: f.business.id, code: "PRIOR_PERIOD_PCB_ADJUSTMENT" } }), 2);
  await prisma.employeeBusinessMembership.update({ where: { id: f.member.id }, data: { status: "TERMINATED", terminatedAt: new Date("2026-08-31") } });
  const august = await prisma.payrollEntry.findFirstOrThrow({ where: { businessId: f.business.id, membershipId: f.member.id, payrollRun: { periodStart: new Date("2026-08-01") } } });
  await confirmManualPcb({ businessId: f.business.id, entryId: august.id, actorId: f.owner.id, expectedRevision: august.calculationRevision,
    expectedInputDigest: await manualPcbInputDigest(prisma, f.business.id, august.id), amount: "4000.00", confirmed: true,
    externalReference: "EXPLICIT_CURRENT_PCB_OVER_CAPACITY", stepUp: await authorize("PCB_MANUAL_CONFIRM", august.id) });
  const readiness = await getPayrollPeriodReadiness({ businessId: f.business.id, month: "2026-08" });
  assert.ok(readiness.issues.some((issue) => issue.code === "PCB_CORRECTION_SETTLEMENT_REQUIRED"), "Terminated status must not bypass insufficient applied correction guard");
  await assert.rejects(submitPayrollRunForReview({ businessId: f.business.id, runId: august.payrollRunId, actor: f.actor }), /Payroll readiness|Prior-period PCB|blocked/i);
  await prisma.employeeBusinessMembership.update({ where: { id: f.member.id }, data: { terminatedAt: new Date("2026-07-31") } });
  const orphanReadiness = await getPayrollPeriodReadiness({ businessId: f.business.id, month: "2026-08" });
  assert.ok(orphanReadiness.issues.some((issue) => issue.code === "PCB_CORRECTION_SETTLEMENT_REQUIRED"), "Existing payroll entry must be checked even outside eligible membership query");
  await prisma.employeeBusinessMembership.update({ where: { id: f.member.id }, data: { terminatedAt: new Date("2026-08-31") } });
  await generatePayrollRun({ businessId: f.business.id, actor: f.actor, month: "2026-08" });
  assert.equal(await prisma.payrollEntryComponent.count({ where: { businessId: f.business.id, code: "PRIOR_PERIOD_PCB_ADJUSTMENT" } }), 0);
  for (const correctionId of [large.id, lower.id]) {
    const event = await prisma.payrollPcbSettlementEvent.findFirstOrThrow({ where: { correctionId }, orderBy: { recordedAt: "desc" } });
    assert.equal(event.state, "UNSETTLED");
  }
});
test.after(async () => { await prisma.$disconnect(); });
