import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Production web and Staff share an attesting build and database-aware health route", () => {
  for (const scope of ["web", "staff"]) {
    const config = JSON.parse(readFileSync(`deployment/production-${scope}.railway.json`, "utf8"));
    assert.equal(config.build.builder, "RAILPACK");
    assert.equal(config.build.buildCommand, "npm ci && npm run build");
    assert.equal(config.deploy.startCommand, `node scripts/validate-release-environment.mjs ${scope} && node node_modules/next/dist/bin/next start --hostname 0.0.0.0`);
    assert.equal(config.deploy.healthcheckPath, "/api/health");
    assert.equal(config.deploy.numReplicas, 1);
    assert.equal(config.deploy.preDeployCommand, undefined);
  }
});

test("Production worker templates use the same attested source build with no migration command", () => {
  const commands = { analytics: "analytics:worker", notification: "notification:worker", whatsapp: "whatsapp:worker", monitor: "ops:monitor" };
  for (const [scope, command] of Object.entries(commands)) {
    const config = JSON.parse(readFileSync(`deployment/production-${scope}.railway.json`, "utf8"));
    assert.equal(config.build.buildCommand, "npm ci && npm run build");
    assert.equal(config.build.builder, "RAILPACK");
    assert.equal(config.deploy.startCommand, `npm run ${command}`);
    assert.equal(config.deploy.numReplicas, 1);
    assert.equal(config.deploy.preDeployCommand, undefined);
  }
  assert.match(readFileSync("Dockerfile.ops-monitor", "utf8"), /COPY src\/lib\/release/);
});
