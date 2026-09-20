import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../../src/app/api/health/route";

test("health returns a non-sensitive 503 when Production source attestation is unavailable", async () => {
  const old = process.env.APP_ENVIRONMENT;
  try {
    process.env.APP_ENVIRONMENT = "production";
    const result = await GET();
    assert.equal(result.status, 503);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.deepEqual(await result.json(), { ok: false, database: "unavailable", release: null });
  } finally {
    if (old === undefined) delete process.env.APP_ENVIRONMENT; else process.env.APP_ENVIRONMENT = old;
  }
});
