import assert from "node:assert/strict";
import test, { after } from "node:test";
import { walletTestDatabase, walletFixture, assertNoWalletMoney } from "../helpers/wallet-fixture";
import { postWalletTopUp } from "../../src/lib/wallet/top-up";

const db = walletTestDatabase();
after(() => db.$disconnect());
test("Top-up service rejects disabled release without money writes even for owner", async () => {
  const f = await walletFixture(db);
  const old = process.env.TETAMU_WALLET_LOCAL_TEST;
  process.env.TETAMU_WALLET_LOCAL_TEST = "false";
  try {
    await assert.rejects(postWalletTopUp(f.ctx, f.input, db), /controlled Local/i);
    await assertNoWalletMoney(db, f.business.id);
  } finally {
    if (old === undefined) delete process.env.TETAMU_WALLET_LOCAL_TEST;
    else process.env.TETAMU_WALLET_LOCAL_TEST = old;
  }
});
