import assert from "node:assert/strict";
import test from "node:test";
import { walletFixture, walletTestDatabase } from "../helpers/wallet-fixture";
import { verifyOptionalShiftsUpgrade } from "../helpers/optional-shifts-upgrade";

test("optional shifts foundation: explicit ON fixture and nullable shift preserve scoped FK", async () => {
  const db = walletTestDatabase();
  try {
    const f = await walletFixture(db);
    assert.equal((f.business as unknown as { cashierShiftsEnabled: boolean }).cashierShiftsEnabled, true);
    const columns = await db.$queryRaw<Array<{table_name:string;column_name:string;is_nullable:string;column_default:string|null}>>`SELECT table_name,column_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND ((table_name='businesses' AND column_name='cashier_shifts_enabled') OR (table_name='wallet_top_ups' AND column_name='shift_id') OR (table_name='cashier_shift_expense_payouts' AND column_name='shift_id'))`;
    assert.equal(columns.find(c=>c.table_name==='businesses')?.is_nullable,'NO');
    assert.match(columns.find(c=>c.table_name==='businesses')?.column_default ?? '',/false/);
    assert.equal(columns.find(c=>c.table_name==='wallet_top_ups')?.is_nullable,'YES');
    assert.equal(columns.find(c=>c.table_name==='cashier_shift_expense_payouts')?.is_nullable,'NO');
  } finally { await db.$disconnect(); }
});

test("optional shifts: actual 226 -> 227 -> 228 upgrade preserves all historical facts and scoped FK", verifyOptionalShiftsUpgrade);
