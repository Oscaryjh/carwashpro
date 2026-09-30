import assert from "node:assert/strict";
import test from "node:test";

async function policy() {
  const module = await import("../../src/lib/wallet/release-policy").catch(() => null);
  assert.ok(module?.isWalletLocalTestEnabled, "Wallet must provide a default-deny server release gate");
  return module;
}
const local = { TETAMU_WALLET_LOCAL_TEST: "true", NODE_ENV: "test", DATABASE_URL: "postgresql://test:test@localhost:5432/tetamu_wallet_disposable_123_456" };
test("wallet money is restricted to explicitly opted-in Local disposable databases", async () => {
  const { isWalletLocalTestEnabled: enabled } = await policy();
  assert.equal(enabled(local), true);
  for (const env of [{}, { ...local, TETAMU_WALLET_LOCAL_TEST: "false" }, { ...local, DATABASE_URL: "invalid" },
    { ...local, DATABASE_URL: "postgresql://test:test@remote.example/tetamu_wallet_disposable_1" },
    { ...local, DATABASE_URL: "postgresql://test:test@localhost/tetamu_real_store" },
    { ...local, APP_ENVIRONMENT: "unknown" }, { ...local, NODE_ENV: "production", APP_ENVIRONMENT: "development" },
    { ...local, APP_ENVIRONMENT: "production" }, { ...local, TETAMU_ENVIRONMENT: "PRODUCTION" },
    { ...local, RAILWAY_ENVIRONMENT_NAME: "testing" }, { ...local, RAILWAY_DEPLOYMENT_ID: "deployed" },
    { ...local, RAILWAY_ENVIRONMENT_ID: "hosted" }]) assert.equal(enabled(env), false);
});
