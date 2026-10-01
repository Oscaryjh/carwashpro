import assert from "node:assert/strict";
import test from "node:test";
import * as policy from "../../src/lib/wallet/release-policy";

const A = "10000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";
const testing = { APP_ENVIRONMENT: "testing", RAILWAY_ENVIRONMENT_NAME: "testing", NODE_ENV: "production",
  TETAMU_WALLET_TESTING_PILOT: "true", TETAMU_WALLET_TESTING_BUSINESS_IDS: A };
type Env = Record<string, string | undefined>;
function enabled(businessId: string, env: Env) {
  const fn = (policy as unknown as { isWalletAccessAllowed?: (input: {businessId: string}, env: Env) => boolean }).isWalletAccessAllowed;
  assert.equal(typeof fn, "function", "Business-scoped Wallet release policy must exist");
  return fn!({ businessId }, env);
}
test("Testing Wallet allows only the exact server allowlisted business, including production build mode", () => {
  assert.equal(enabled(A, testing), true);
  assert.equal(enabled(B, testing), false);
  assert.equal(enabled("", testing), false);
  assert.equal(enabled("not-a-uuid", testing), false);
});
test("Testing Wallet normalizes whitespace and duplicates but rejects the entire malformed list", () => {
  assert.equal(enabled(A, {...testing, TETAMU_WALLET_TESTING_BUSINESS_IDS: ` ${A}, ${A} `}), true);
  for (const ids of ["", " ", `${A},bad`, `${A},`, `,${A}`, `${A},,${B}`, "*", "all"]) {
    assert.equal(enabled(A, {...testing, TETAMU_WALLET_TESTING_BUSINESS_IDS: ids}), false, ids);
  }
});
test("Testing Wallet requires explicit matching deployment identities and exact opt-in", () => {
  for (const overrides of [
    {TETAMU_WALLET_TESTING_PILOT: undefined}, {TETAMU_WALLET_TESTING_PILOT: "false"},
    {TETAMU_WALLET_TESTING_PILOT: "TRUE"}, {TETAMU_WALLET_TESTING_BUSINESS_IDS: undefined},
    {APP_ENVIRONMENT: undefined}, {RAILWAY_ENVIRONMENT_NAME: undefined},
    {APP_ENVIRONMENT: "unknown"}, {APP_ENVIRONMENT: "development"},
    {RAILWAY_ENVIRONMENT_NAME: "preview"}, {TETAMU_ENVIRONMENT: "development"},
    {TETAMU_ENVIRONMENT: "unknown"}, {VERCEL: "1"}, {NETLIFY: "true"}, {RENDER: "true"},
  ]) assert.equal(enabled(A, {...testing, ...overrides}), false, JSON.stringify(overrides));
  assert.equal(enabled(A, {...testing, TETAMU_ENVIRONMENT: "TESTING"}), true);
});
test("any Production deployment identity denies even with pilot and allowlist configured", () => {
  for (const overrides of [
    {APP_ENVIRONMENT: "production"}, {RAILWAY_ENVIRONMENT_NAME: "production"},
    {TETAMU_ENVIRONMENT: "PRODUCTION"},
    {APP_ENVIRONMENT: "development", RAILWAY_ENVIRONMENT_NAME: "production"},
    {APP_ENVIRONMENT: "production", RAILWAY_ENVIRONMENT_NAME: "development"},
  ]) assert.equal(enabled(A, {...testing, ...overrides}), false);
});
test("Local disposable contract remains opt-in and never accepts ordinary or hosted databases", () => {
  const local = { TETAMU_WALLET_LOCAL_TEST: "true", NODE_ENV: "test", DATABASE_URL: "postgresql://test:test@localhost:5432/tetamu_wallet_disposable_123" };
  assert.equal(enabled(A, local), true);
  for (const overrides of [{TETAMU_WALLET_LOCAL_TEST: "false"}, {DATABASE_URL: "postgresql://test:test@localhost/ordinary"},
    {DATABASE_URL: "postgresql://test:test@remote.example/tetamu_wallet_disposable_123"}, {NODE_ENV: "production"},
    {APP_ENVIRONMENT: "production"}, {RAILWAY_ENVIRONMENT_NAME: "production"}, {RAILWAY_ENVIRONMENT_ID: "hosted"}]) {
    assert.equal(enabled(A, {...local, ...overrides}), false);
  }
});
