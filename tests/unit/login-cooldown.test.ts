import assert from "node:assert/strict";
import test from "node:test";
import { checkPasswordLoginRateLimit } from "../../src/lib/auth/security";

type Failure = { identifierHash: string; ipAddressHash: string; createdAt: Date };
function database(rows: Failure[]) {
  type Query = { where: { identifierHash?: string; ipAddressHash?: string; createdAt: { gte: Date }; eventType: string }; skip?: number };
  const matching = ({ where }: Query) => {
    assert.equal(where.eventType, "LOGIN_FAILED", "blocked attempts must not extend cooldown");
    return rows.filter(r => (!where.identifierHash || r.identifierHash === where.identifierHash)
      && (!where.ipAddressHash || r.ipAddressHash === where.ipAddressHash)
      && r.createdAt >= where.createdAt.gte).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  };
  return { authSecurityEvent: {
    count: async (q: Query) => matching(q).length,
    findFirst: async (q: Query) => matching(q)[q.skip ?? 0] ?? null,
  } } as unknown as NonNullable<Parameters<typeof checkPasswordLoginRateLimit>[1]>;
}
const base = Date.parse("2026-10-07T12:00:00Z");
const row = (minute: number, identifierHash = "account", ipAddressHash = "ip") => ({ identifierHash, ipAddressHash, createdAt: new Date(base + minute * 60_000) });

test("cooldown expires when the fifth newest failure leaves the rolling window, not 15 minutes from retry", async () => {
  const result = await checkPasswordLoginRateLimit({ identifierHash: "account", ipAddressHash: "ip", now: new Date(base + 7 * 60_000) }, database([0, 1, 2, 3, 4, 5, 6].map(m => row(m))));
  assert.equal(result.allowed, false);
  assert.equal((result as { retryAt?: Date }).retryAt?.toISOString(), "2026-10-07T12:17:00.001Z");
});

test("cooldown waits for every blocked bucket, including an IP shared by other identifiers", async () => {
  const rows = [...[0, 1, 2, 3, 4].map(m => row(m)), ...Array.from({ length: 25 }, (_, i) => row(8, `other-${i}`))];
  const result = await checkPasswordLoginRateLimit({ identifierHash: "account", ipAddressHash: "ip", now: new Date(base + 9 * 60_000) }, database(rows));
  assert.equal((result as { retryAt?: Date }).retryAt?.toISOString(), "2026-10-07T12:23:00.001Z");
});

test("cooldown preserves the inclusive boundary and permits the next millisecond", async () => {
  const db = database([0, 1, 2, 3, 4].map(m => row(m)));
  const atBoundary = await checkPasswordLoginRateLimit({ identifierHash: "account", ipAddressHash: null, now: new Date(base + 900_000) }, db);
  assert.equal(atBoundary.allowed, false);
  assert.equal((atBoundary as { retryAt?: Date }).retryAt?.getTime(), base + 900_001);
  const after = await checkPasswordLoginRateLimit({ identifierHash: "account", ipAddressHash: null, now: new Date(base + 900_001) }, db);
  assert.equal(after.allowed, true);
  assert.equal((after as { retryAt?: Date | null }).retryAt, null);
});

test("unblocked accounts do not receive a fabricated cooldown", async () => {
  const result = await checkPasswordLoginRateLimit({ identifierHash: "account", ipAddressHash: null, now: new Date(base) }, database([]));
  assert.equal(result.allowed, true);
  assert.equal((result as { retryAt?: Date | null }).retryAt, null);
});
