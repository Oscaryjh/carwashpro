import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { readWalletHubOverview, readWalletHubTransactions, readWalletHubTopUps, readWalletHubCustomerBalances } from "../../src/lib/wallet/hub-read-model";

const ctx = { businessId: randomUUID(), user: { userId: randomUUID() } };
const window = { fromDate: new Date("2026-10-01Z"), toDateExclusive: new Date("2026-11-01Z") };
for (const read of [readWalletHubOverview, readWalletHubTransactions, readWalletHubTopUps]) {
  test(`${read.name} rejects an inverted resolved window before querying`, async () => {
    await assert.rejects(read(ctx, { fromDate: window.toDateExclusive, toDateExclusive: window.fromDate }));
  });
}
for (const pageSize of [0, 21, 1000]) {
  test(`unbounded/unsupported page size ${pageSize} rejected`, async () => {
    await assert.rejects(readWalletHubCustomerBalances(ctx, { pageSize }));
  });
}
test("malformed activity cursor is not accepted", async () => {
  await assert.rejects(readWalletHubTransactions(ctx, { ...window, cursor: "tampered" }));
});
test("unknown type cannot silently become an unfiltered transaction read", async () => {
  await assert.rejects(readWalletHubTransactions(ctx, { ...window, type: "ADJUSTMENT" }));
});
test("Hub integration contracts remain independent of partial reversal helpers", async () => {
  const result = await build({ entryPoints: ["tests/integration/wallet-hub.test.ts"], bundle: true,
    packages: "external", platform: "node", format: "esm", write: false, metafile: true });
  assert.deepEqual(Object.keys(result.metafile.inputs).filter(path => /src\/lib\/wallet\/(reversals|top-up-consumed)\.ts$/.test(path)), []);
});
