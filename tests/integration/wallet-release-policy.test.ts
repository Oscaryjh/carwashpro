import { setWalletModule } from "../helpers/wallet-fixture";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { walletTestDatabase, walletFixture, assertNoWalletMoney } from "../helpers/wallet-fixture";
import { postWalletTopUp } from "../../src/lib/wallet/top-up";

const db = walletTestDatabase();
after(() => db.$disconnect());
test("Top-up service rejects disabled release without money writes even for owner", async () => {
  const f = await walletFixture(db);
  await setWalletModule(db, f.business.id, false);
  try {
    await assert.rejects(postWalletTopUp(f.ctx, f.input, db), /Member Wallet is not enabled for this business/);
    await assertNoWalletMoney(db, f.business.id);
  } finally {
    await setWalletModule(db, f.business.id, true);
  }
});
