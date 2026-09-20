import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";

test("monitor rejects conflicting Production environment before any network request", () => {
  const child = spawnSync(process.execPath, ["--import", "tsx", "scripts/ops-health-monitor.ts"], {
    encoding: "utf8", timeout: 5000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test", APP_ENVIRONMENT: "testing", RAILWAY_ENVIRONMENT_NAME: "production" },
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /RUNTIME_ENVIRONMENT_CONFLICT/);
  assert.doesNotMatch(child.stdout, /HEALTH_MONITOR_STARTED/);
});
