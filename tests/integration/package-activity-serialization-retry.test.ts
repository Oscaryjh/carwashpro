import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { walletFixture, walletTestDatabase } from "../helpers/wallet-fixture";
import { runFinancialOperation } from "../../src/lib/financial-idempotency";
import { appendCustomerPackageActivity, captureCustomerPackageActivityBefore } from "../../src/lib/packages/activity";

assert.equal(process.env.TETAMU_WALLET_LOCAL_TEST, "true", "Disposable runner required");
const db = walletTestDatabase();
after(() => db.$disconnect());
async function fixture() {
  const f = await walletFixture(db);
  const pkg = await db.package.create({ data: { businessId: f.business.id, name: "Retry disposable package", totalUses: 10, price: 100 } });
  const cp = await db.customerPackage.create({ data: { businessId: f.business.id, customerId: f.customer.id, packageId: pkg.id, totalUses: 10, remainingUses: 5, purchasePrice: 100, status: "ACTIVE" } });
  return { ...f, cp };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function operation(f: Fixture, execute: (tx: Prisma.TransactionClient) => Promise<{ activityId: string }>, operationKey = randomUUID()) {
  return { actorUserId: f.actor.id, businessId: f.business.id, branchId: f.branch.id, operationKey, operationType: "PACKAGE_REDEMPTION" as const, payload: { customerPackageId: f.cp.id }, execute };
}
async function consumeOnce(tx: Prisma.TransactionClient, f: Fixture, key: string) {
  // Writes before lock must roll back too, rather than leave duplicate tender/invoice rows.
  const invoice = await tx.invoice.create({ data: { businessId: f.business.id, customerId: f.customer.id, branchId: f.branch.id, invoiceNumber: randomUUID(), subtotal: 10, total: 10, paidAmount: 10, balance: 0, status: "PAID" } });
  const before = await captureCustomerPackageActivityBefore(tx, { businessId: f.business.id, customerPackageId: f.cp.id });
  const payment = await tx.payment.create({ data: { businessId: f.business.id, branchId: f.branch.id, cashierId: f.actor.id, invoiceId: invoice.id, customerPackageId: f.cp.id, method: "PACKAGE", packageUses: 1, amount: 10 } });
  await tx.customerPackage.update({ where: { id: f.cp.id }, data: { remainingUses: { decrement: 1 } } });
  const financialOperation = await tx.financialOperation.findUniqueOrThrow({ where: { businessId_operationType_operationKey: { businessId: f.business.id, operationType: "PACKAGE_REDEMPTION", operationKey: key } } });
  const activity = await appendCustomerPackageActivity(tx, before, { eventType: "USED", sourceType: "CHECKOUT", actorUserId: f.actor.id, financialOperationId: financialOperation.id, paymentId: payment.id, invoiceId: invoice.id, branchId: f.branch.id });
  return { activityId: activity.id };
}
async function expectCounts(f: Fixture, count: number, remaining: number) {
  const where = { businessId: f.business.id };
  assert.equal((await db.customerPackage.findUniqueOrThrow({ where: { id: f.cp.id } })).remainingUses, remaining);
  assert.equal(await db.invoice.count({ where }), count);
  assert.equal(await db.payment.count({ where }), count);
  assert.equal(await db.customerPackageActivity.count({ where }), count);
  assert.equal(await db.financialOperation.count({ where }), count);
  assert.equal(await db.financialOperation.count({ where: { ...where, state: "COMPLETED" } }), count);
}

test("real FOR UPDATE 40001 retries a fresh Serializable operation: two uses, continuous snapshots, exact replay", async () => {
  const f = await fixture(), firstKey = randomUUID(), secondKey = randomUUID();
  let release!: () => void, ready!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const captured = new Promise<void>(resolve => { ready = resolve; });
  const transactions = new Set<Prisma.TransactionClient>();
  const errors: { code: string; sqlstate: unknown }[] = [];
  let attempts = 0;
  const first = runFinancialOperation(operation(f, async tx => {
    const result = await consumeOnce(tx, f, firstKey); ready(); await held; return result;
  }, firstKey), db);
  const firstSettled = first.then(result => ({ result }), error => ({ error }));
  await Promise.race([captured, first.then(() => { throw Error("First transaction did not hold lock"); })]);
  const secondInput = operation(f, async tx => {
    attempts++; transactions.add(tx);
    try { return await consumeOnce(tx, f, secondKey); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) errors.push({ code: error.code, sqlstate: error.meta?.code });
      throw error;
    }
  }, secondKey);
  const second = runFinancialOperation(secondInput, db).then(result => ({ result }), error => ({ error }));
  try {
    const deadline = Date.now() + 10000;
    while (true) {
      const [state] = await db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND query ILIKE '%customer_packages%' AND query ILIKE '%FOR UPDATE%'
      ) AS waiting`;
      if (state.waiting) break;
      assert.ok(Date.now() < deadline, "Second capture must wait on the actual FOR UPDATE lock");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } finally { release(); }
  const one = await firstSettled, two = await second;
  if ("error" in one) throw one.error;
  assert.deepEqual(errors[0], { code: "P2010", sqlstate: "40001" }, "Must exercise the real Prisma error shape");
  assert.ok("result" in two, `Expected successful retry, attempts=${attempts}; ${"error" in two ? String(two.error) : ""}`);
  assert.equal(attempts, 2); assert.equal(transactions.size, 2);
  await expectCounts(f, 2, 3);
  const rows = await db.customerPackageActivity.findMany({ where: { customerPackageId: f.cp.id }, orderBy: { sequence: "asc" } });
  assert.deepEqual(rows.map(row => [row.sequence, row.remainingBefore, row.remainingAfter, row.usesDelta]), [[1, 5, 4, -1], [2, 4, 3, -1]]);
  const replay = await runFinancialOperation(secondInput, db);
  assert.equal(replay.replayed, true); assert.deepEqual(replay.result, two.result.result); assert.equal(attempts, 2);
  await expectCounts(f, 2, 3);
  await assert.rejects(runFinancialOperation({ ...secondInput, payload: { changed: true } }, db), /different transaction details/);
  await expectCounts(f, 2, 3);
});

for (const code of ["P2010", "P2034", "P2002"]) test(`existing wrapper retries ${code} with all first-attempt effects rolled back`, async () => {
  const f = await fixture(), key = randomUUID(); let attempts = 0;
  const conflict = new Prisma.PrismaClientKnownRequestError("controlled conflict", { clientVersion: Prisma.prismaVersion.client, code, meta: code === "P2010" ? { code: "40001" } : undefined });
  const result = await runFinancialOperation(operation(f, async tx => {
    const row = await consumeOnce(tx, f, key);
    if (++attempts === 1) throw conflict;
    return row;
  }, key), db);
  assert.equal(result.replayed, false); assert.equal(attempts, 2);
  await expectCounts(f, 1, 4);
  const row = await db.customerPackageActivity.findFirstOrThrow({ where: { customerPackageId: f.cp.id } });
  assert.deepEqual([row.sequence, row.remainingBefore, row.remainingAfter], [1, 5, 4]);
});

test("P2010 serialization retry remains bounded at five attempts and rolls back every attempt", async () => {
  const f = await fixture(), key = randomUUID(); let attempts = 0;
  const conflict = new Prisma.PrismaClientKnownRequestError("limit", { clientVersion: Prisma.prismaVersion.client, code: "P2010", meta: { code: "40001" } });
  await assert.rejects(runFinancialOperation(operation(f, async tx => {
    attempts++; await consumeOnce(tx, f, key); throw conflict;
  }, key), db), error => error === conflict);
  assert.equal(attempts, 5); await expectCounts(f, 0, 5);
});

for (const meta of [{ code: "42601" }, { code: "23514" }, { code: "400010" }, { code: 40001 }, {}, { database_error: "40001" }]) test(`non-matching P2010 structured metadata is not retried: ${JSON.stringify(meta)}`, async () => {
  const f = await fixture(); let attempts = 0;
  const error = new Prisma.PrismaClientKnownRequestError("message mentions 40001 but is not authoritative", { clientVersion: Prisma.prismaVersion.client, code: "P2010", meta });
  await assert.rejects(runFinancialOperation(operation(f, async () => { attempts++; throw error; }), db), caught => caught === error);
  assert.equal(attempts, 1); await expectCounts(f, 0, 5);
});

test("unknown error with lookalike metadata does not enter Prisma retry", async () => {
  const f = await fixture(); let attempts = 0;
  const error = Object.assign(new Error("40001"), { code: "P2010", meta: { code: "40001" } });
  await assert.rejects(runFinancialOperation(operation(f, async () => { attempts++; throw error; }), db), caught => caught === error);
  assert.equal(attempts, 1); await expectCounts(f, 0, 5);
});

test("real non-40001 raw SQL error propagates without retry", async () => {
  const f = await fixture(); let attempts = 0; let original: unknown;
  await assert.rejects(runFinancialOperation(operation(f, async tx => {
    attempts++;
    try { await tx.$queryRaw`SELECT 1 / 0`; } catch (error) { original = error; throw error; }
    return { activityId: "unreachable" };
  }), db), error => error === original && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010" && error.meta?.code === "22012");
  assert.equal(attempts, 1); await expectCounts(f, 0, 5);
});

test("real Activity insert rejection rolls back all effects without serialization retry", async () => {
  const f = await fixture(), key = randomUUID(); let attempts = 0;
  await db.$executeRawUnsafe(`CREATE FUNCTION retry_test_reject_activity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'RETRY_TEST_ACTIVITY_REJECTED' USING ERRCODE='23514'; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER retry_test_reject_activity BEFORE INSERT ON customer_package_activities FOR EACH ROW EXECUTE FUNCTION retry_test_reject_activity()`);
  try {
    await assert.rejects(runFinancialOperation(operation(f, async tx => { attempts++; return consumeOnce(tx, f, key); }, key), db), /RETRY_TEST_ACTIVITY_REJECTED/);
    assert.equal(attempts, 1); await expectCounts(f, 0, 5);
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER retry_test_reject_activity ON customer_package_activities`);
    await db.$executeRawUnsafe(`DROP FUNCTION retry_test_reject_activity()`);
  }
});
