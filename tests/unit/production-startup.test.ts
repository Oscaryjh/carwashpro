import assert from "node:assert/strict";
import test from "node:test";
import * as instrumentation from "../../src/instrumentation";

test("direct Next server startup rejects unattested Production before serving requests", async () => {
  const previous = { runtime: process.env.NEXT_RUNTIME, environment: process.env.APP_ENVIRONMENT };
  try {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.APP_ENVIRONMENT = "production";
    assert.equal(typeof (instrumentation as Record<string, unknown>).register, "function");
    await assert.rejects((instrumentation as unknown as { register(): Promise<void> }).register());
    process.env.APP_ENVIRONMENT = "testing";
    await (instrumentation as unknown as { register(): Promise<void> }).register();
  } finally {
    if (previous.runtime === undefined) delete process.env.NEXT_RUNTIME; else process.env.NEXT_RUNTIME = previous.runtime;
    if (previous.environment === undefined) delete process.env.APP_ENVIRONMENT; else process.env.APP_ENVIRONMENT = previous.environment;
  }
});
