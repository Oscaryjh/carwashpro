import assert from "node:assert/strict";
import test, { after } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { walletTestDatabase, walletFixture } from "../helpers/wallet-fixture";
import { postWalletTopUp } from "../../src/lib/wallet/top-up";
import { getDailySalesReport } from "../../src/lib/reports/daily-sales";
import { getBusinessDayRange, getCurrentBusinessDateValue } from "../../src/lib/business-day";
const db = walletTestDatabase();
after(() => db.$disconnect());
test("a top-up committed between report queries cannot mix old collections with new wallet activity", async () => {
  const f = await walletFixture(db);
  const day = getCurrentBusinessDateValue(new Date(), f.business.timezone, f.business.businessDayCutoffTime);
  const range = getBusinessDayRange({ fromDateValue: day, toDateValue: day, timezone: f.business.timezone, businessDayCutoffTime: f.business.businessDayCutoffTime });
  let committed = false;
  const client = db.$extends({ query: { walletTransaction: { async findMany({ args, query }) {
    if (!committed) { committed = true; await postWalletTopUp(f.ctx, f.input, db); }
    return query(args);
  } } } });
  const report = await getDailySalesReport({ businessId: f.business.id, branchId: f.branch.id, range }, client as unknown as PrismaClient);
  assert.equal(committed, true);
  assert.equal(report.summary.grossCollectionsCents, 0);
  assert.equal(report.walletActivity.topUpPrincipalCents, 0);
  const fresh = await getDailySalesReport({ businessId: f.business.id, branchId: f.branch.id, range }, db);
  assert.equal(fresh.summary.grossCollectionsCents, 100000);
  assert.equal(fresh.walletActivity.topUpPrincipalCents, 100000);
});
