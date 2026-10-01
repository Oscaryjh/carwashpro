import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase, walletFixture } from "../helpers/wallet-fixture";
import { writeAuditLog } from "../../src/lib/audit";

const db = walletTestDatabase();
after(() => db.$disconnect());

test("wallet loyalty evidence survives audit sanitization and rolls back with its transaction", async () => {
  const f = await walletFixture(db);
  const invoiceId = randomUUID();
  const evidence = {
    version: 1, invoiceId, operationId: randomUUID(), eligibleCents: 120,
    pointsPerRinggit: "1", earnedPoints: 1, redeemedPoints: 0,
    payments: [
      { paymentId: randomUUID(), eligibleCents: 60, earnedPoints: 0 },
      { paymentId: randomUUID(), eligibleCents: 60, earnedPoints: 1 },
    ],
  };
  const input = { businessId: f.business.id, branchId: f.branch.id,
    action: "WALLET_LOYALTY_SETTLED", entityType: "Invoice", entityId: invoiceId,
    summary: "Wallet invoice loyalty evidence", metadata: evidence };
  await assert.rejects(db.$transaction(async tx => {
    await writeAuditLog(input, tx);
    throw new Error("P1F evidence rollback probe");
  }), /rollback probe/);
  assert.equal(await db.auditLog.count({ where: { businessId: f.business.id, entityId: invoiceId } }), 0);
  await db.$transaction(tx => writeAuditLog(input, tx));
  const stored = await db.auditLog.findMany({ where: { businessId: f.business.id, entityId: invoiceId } });
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].metadata, evidence);
  const foreign = await walletFixture(db);
  assert.equal(await db.auditLog.count({ where: { businessId: foreign.business.id, entityId: invoiceId } }), 0);
});
