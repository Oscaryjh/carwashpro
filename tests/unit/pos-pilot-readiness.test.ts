import assert from "node:assert/strict";
import test from "node:test";

import { evaluateWebReadiness } from "@/lib/health/web-readiness";
import {
  createWorkerReadinessTracker,
  WORKER_HEARTBEAT_STALE,
} from "@/lib/notification-queue/worker-readiness";

test("web readiness distinguishes process, application and database health", async () => {
  const ready = await evaluateWebReadiness({
    databaseProbe: async () => undefined,
    runtimeContractProbe: () => undefined,
  });
  assert.deepEqual(ready, {
    application: "ready",
    database: "reachable",
    ok: true,
    process: "alive",
  });

  const databaseDown = await evaluateWebReadiness({
    databaseProbe: async () => { throw new Error("secret db host"); },
    runtimeContractProbe: () => undefined,
  });
  assert.deepEqual(databaseDown, {
    application: "not_ready",
    database: "unreachable",
    ok: false,
    process: "alive",
  });
  assert.doesNotMatch(JSON.stringify(databaseDown), /secret db host/);

  const configurationDown = await evaluateWebReadiness({
    databaseProbe: async () => undefined,
    runtimeContractProbe: () => { throw new Error("secret config"); },
  });
  assert.equal(configurationDown.application, "configuration_failed");
  assert.equal(configurationDown.database, "not_checked");
  assert.equal(configurationDown.ok, false);
});

test("worker readiness requires config, DB, queue and a fresh loop heartbeat", () => {
  const tracker = createWorkerReadinessTracker({ staleAfterMs: 10_000 });
  tracker.configurationReady();
  tracker.databaseReady();
  tracker.queueReady();
  tracker.loopHeartbeat(1_000);
  assert.deepEqual(tracker.snapshot(5_000), {
    configuration: "ready",
    database: "reachable",
    loop: "operating",
    ok: true,
    process: "alive",
    queue: "available",
  });
  const stale = tracker.snapshot(12_000);
  assert.equal(stale.ok, false);
  assert.equal(stale.loop, WORKER_HEARTBEAT_STALE);
  tracker.fatalConfigurationFailure();
  assert.equal(tracker.snapshot(12_000).configuration, "fatal");
});

