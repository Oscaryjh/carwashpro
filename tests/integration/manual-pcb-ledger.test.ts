import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../src/lib/prisma";
import { createCanonicalPcbFixture, confirmFixturePcb } from "../helpers/manual-pcb-fixture";

test("manual PCB ledger exists and preserves immutable confirmation and invalidation history", async () => {
  const f = await createCanonicalPcbFixture();
  const source = await confirmFixturePcb({ businessId: f.business.id, entryId: f.entry.id, actorId: f.owner.id, amount: "0.00", externalReference: "EXPLICIT_ZERO_APPEND_ONLY_LEDGER_FIXTURE" });
  await assert.rejects(prisma.payrollManualPcbConfirmation.update({ where: { id: source.id }, data: { amount: "1.00" } }), /PCB_LEDGER_APPEND_ONLY/);
  await assert.rejects(prisma.payrollManualPcbConfirmation.delete({ where: { id: source.id } }), /PCB_LEDGER_APPEND_ONLY/);
  await prisma.payrollEntry.update({ where: { id: f.entry.id }, data: { notes: "Changed draft input for invalidation proof" } });
  const event = await prisma.payrollManualPcbInvalidation.findUniqueOrThrow({ where: { confirmationId: source.id } });
  await assert.rejects(prisma.payrollManualPcbInvalidation.delete({ where: { id: event.id } }), /PCB_LEDGER_APPEND_ONLY/);
  assert.equal((await prisma.payrollManualPcbConfirmation.findUniqueOrThrow({ where: { id: source.id } })).amount.toFixed(2), "0.00");
});

test.after(async () => { await prisma.$disconnect(); });
