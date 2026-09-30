import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// Architecture guard requested by P1B.5: both screens must use the same adapter,
// never introduce page-specific financial writes or wallet checkout redemption.
test("Customer and Cashier share one wallet summary and one top-up backend", async () => {
  for (const path of ["src/app/(business)/crm/page.tsx", "src/app/(business)/crm/customers/[customerId]/page.tsx", "src/components/cashier-unified-sale-form.tsx"]) {
    const source = await readFile(path, "utf8");
    assert.match(source, /<MemberWalletSummary/);
    assert.doesNotMatch(source, /walletAccount\.(?:update|create)|walletTransaction\.create|postWalletTopUp\(/);
  }
  const summary = await readFile("src/components/wallet/member-wallet-summary.tsx", "utf8");
  assert.match(summary, /<WalletTopUpModal/);
  const actions = await readFile("src/app/(business)/crm/wallet/actions.ts", "utf8");
  assert.match(actions, /walletRefundOptionsAction/);
  assert.match(actions, /readWalletRefundOwner/);
  assert.match(actions, /prisma\.invoice\.findFirst/);
  assert.doesNotMatch(actions, /prisma\.[a-zA-Z]+\.(?:create|update|delete|upsert|updateMany|deleteMany)|walletAccount\.(?:update|create)|payment\.create|walletTransaction\.create|postWalletTopUp\(/);
  const adapter = await readFile("src/lib/wallet/ui-adapter.ts", "utf8");
  assert.equal([...adapter.matchAll(/return postWalletTopUp\(/g)].length, 1);
  assert.doesNotMatch(adapter, /walletAccount\.(?:update|create)|payment\.create|walletTransaction\.create/);
});
