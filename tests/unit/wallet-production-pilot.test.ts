import assert from "node:assert/strict";
import test from "node:test";
import { isWalletAccessAllowed } from "../../src/lib/wallet/release-policy";

const A = "a0000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";
const production = { APP_ENVIRONMENT: "production", RAILWAY_ENVIRONMENT_NAME: "production", NODE_ENV: "production",
  TETAMU_WALLET_PRODUCTION_PILOT: "true", TETAMU_WALLET_PRODUCTION_BUSINESS_IDS: A };
type Env = Record<string, string | undefined>;
const allowed = (id: string, env: Env) => isWalletAccessAllowed({ businessId: id }, env);

test("Production Wallet enables only the explicitly allowlisted business", () => {
  assert.equal(allowed(A, production), true);
  assert.equal(allowed(B, production), false);
  assert.equal(allowed("", production), false);
  assert.equal(allowed("invalid", production), false);
});

test("Production requires valid opt-in and a complete valid UUID list", () => {
  for (const flag of [undefined, "", "false", "TRUE", "1", "yes", "true,false"]) {
    assert.equal(allowed(A, { ...production, TETAMU_WALLET_PRODUCTION_PILOT: flag }), false, String(flag));
  }
  for (const ids of [undefined, "", " ", "all", "*", `${A},bad`, `${A},`, `,${A}`, `${A},,${B}`]) {
    assert.equal(allowed(A, { ...production, TETAMU_WALLET_PRODUCTION_BUSINESS_IDS: ids }), false, String(ids));
  }
  assert.equal(allowed(A, { ...production, TETAMU_WALLET_PRODUCTION_BUSINESS_IDS: ` ${A}, ${A} ` }), true);
  assert.equal(allowed(B, { ...production, TETAMU_WALLET_PRODUCTION_BUSINESS_IDS: ` ${A}, ${A} ` }), false);
  assert.equal(allowed(A, { ...production, TETAMU_WALLET_PRODUCTION_BUSINESS_IDS: A.toUpperCase() }), true);
});

test("Production requires matching explicit Railway identity, never NODE_ENV alone", () => {
  for (const overrides of [
    { APP_ENVIRONMENT: undefined }, { RAILWAY_ENVIRONMENT_NAME: undefined },
    { APP_ENVIRONMENT: "testing" }, { RAILWAY_ENVIRONMENT_NAME: "testing" },
    { APP_ENVIRONMENT: "unknown" }, { RAILWAY_ENVIRONMENT_NAME: "preview" },
    { TETAMU_ENVIRONMENT: "testing" }, { TETAMU_ENVIRONMENT: "unknown" },
    { NODE_ENV: "unknown" }, { VERCEL: "1" }, { NETLIFY: "true" }, { RENDER: "true" },
  ]) assert.equal(allowed(A, { ...production, ...overrides }), false, JSON.stringify(overrides));
  assert.equal(allowed(A, { NODE_ENV: "production", TETAMU_WALLET_PRODUCTION_PILOT: "true", TETAMU_WALLET_PRODUCTION_BUSINESS_IDS: A }), false);
  assert.equal(allowed(A, { ...production, TETAMU_ENVIRONMENT: "PRODUCTION" }), true);
  assert.equal(allowed(A, { ...production, APP_ENVIRONMENT: " production ", RAILWAY_ENVIRONMENT_NAME: " production " }), true);
});

test("Testing and Production flags and allowlists never authorize the other environment", () => {
  const testing = { APP_ENVIRONMENT: "testing", RAILWAY_ENVIRONMENT_NAME: "testing", NODE_ENV: "production",
    TETAMU_WALLET_TESTING_PILOT: "true", TETAMU_WALLET_TESTING_BUSINESS_IDS: A };
  assert.equal(allowed(A, testing), true);
  assert.equal(allowed(B, testing), false);
  assert.equal(allowed(A, { ...production, TETAMU_WALLET_PRODUCTION_PILOT: undefined, ...{
    TETAMU_WALLET_TESTING_PILOT: "true", TETAMU_WALLET_TESTING_BUSINESS_IDS: A } }), false);
  assert.equal(allowed(A, { ...testing, TETAMU_WALLET_TESTING_PILOT: undefined,
    TETAMU_WALLET_PRODUCTION_PILOT: "true", TETAMU_WALLET_PRODUCTION_BUSINESS_IDS: A }), false);
  assert.equal(allowed(B, { ...testing, ...production, TETAMU_WALLET_PRODUCTION_BUSINESS_IDS: A,
    TETAMU_WALLET_TESTING_BUSINESS_IDS: B }), false);
});

test("Production gate re-reads current allowlist rather than caching access", () => {
  const env: Env = { ...production };
  assert.equal(allowed(A, env), true);
  env.TETAMU_WALLET_PRODUCTION_BUSINESS_IDS = B;
  assert.equal(allowed(A, env), false);
  env.TETAMU_WALLET_PRODUCTION_BUSINESS_IDS = A;
  assert.equal(allowed(A, env), true);
  env.TETAMU_WALLET_PRODUCTION_PILOT = "false";
  assert.equal(allowed(A, env), false);
});
