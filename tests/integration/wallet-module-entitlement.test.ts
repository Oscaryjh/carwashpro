import assert from "node:assert/strict";
import test, { after } from "node:test";
import { walletFixture, walletTestDatabase, assertNoWalletMoney, setWalletModule } from "../helpers/wallet-fixture";
import { getWalletSummary } from "../../src/lib/wallet/read-model";
import { getWalletHistory, listWalletOffers } from "../../src/lib/wallet/ui-adapter";
import { postWalletTopUp } from "../../src/lib/wallet/top-up";
import { isWalletAccessAllowed } from "../../src/lib/wallet/release-policy";
const db = walletTestDatabase();
after(() => db.$disconnect());
test("Wallet module OFF denies sensitive reads and top-up before any money writes", async () => {
  const f = await walletFixture(db);
  await setWalletModule(db, f.business.id, false);
  assert.equal(await isWalletAccessAllowed(f.ctx, { database: db }), false);
  for (const read of [() => getWalletSummary(f.ctx, f.customer.id, db), () => getWalletHistory(f.ctx, f.customer.id, 0, db), () => listWalletOffers(f.ctx, db), () => postWalletTopUp(f.ctx, f.input, db)]) {
    await assert.rejects(read, /Member Wallet is not enabled for this business/);
  }
  await assertNoWalletMoney(db, f.business.id);
});
