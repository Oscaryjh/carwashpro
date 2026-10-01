import assert from "node:assert/strict";
import test from "node:test";
import { isWalletAccessAllowed } from "../../src/lib/wallet/release-policy";

const businessId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
test("development availability is controlled by module, never legacy flags or allowlists", async () => {
  const keys = ["APP_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "TETAMU_WALLET_LOCAL_TEST", "TETAMU_WALLET_TESTING_PILOT", "TETAMU_WALLET_TESTING_BUSINESS_IDS", "TETAMU_WALLET_PRODUCTION_PILOT", "TETAMU_WALLET_PRODUCTION_BUSINESS_IDS"];
  const before = keys.map(key => [key, process.env[key]] as const);
  try {
    for (const value of [undefined, "", "false", "true", "malformed", businessId, `${businessId},bad`]) {
      for (const key of keys) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      for (const status of ["ENABLED", "DISABLED"]) {
        const database = { businessModuleEntitlement: { findMany: async (query: {where:{businessId:string}}) => {
          assert.equal(query.where.businessId, businessId);
          return [{moduleKey:"POS",status:"ENABLED",enabledFrom:new Date(0),enabledUntil:null},
            {moduleKey:"WALLET",status,enabledFrom:new Date(0),enabledUntil:null}];
        } } } as never;
        assert.equal(await isWalletAccessAllowed({businessId}, {database}), status === "ENABLED");
        assert.equal(await isWalletAccessAllowed({businessId:"invalid"}, {database}), false);
      }
    }
  } finally { for (const [key,value] of before) { if(value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
