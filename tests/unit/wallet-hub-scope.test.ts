import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { resolveWalletHubScope } from "../../src/lib/wallet/hub-scope";

for (const branchId of ["", "all", "not-a-uuid"]) {
  test(`explicit malformed branch ${JSON.stringify(branchId)} cannot fall back to all`, async () => {
    await assert.rejects(resolveWalletHubScope({ businessId: randomUUID(), user: { userId: randomUUID() }, branchId }));
  });
}
test("malformed Business cannot reach any wallet data", async () => {
  await assert.rejects(resolveWalletHubScope({ businessId: "foreign", user: { userId: randomUUID() } }));
});
