import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { stagingRuntimeFixture } from "../helpers/staging-runtime-fixture";

function isolatedProof(scope: string) {
  const f = stagingRuntimeFixture(scope);
  const root = mkdtempSync(join(tmpdir(), "tetamu-staging-contract-"));
  const lockfile = "{}\n";
  f.attestation.lockfileHash = createHash("sha256").update(lockfile).digest("hex");
  mkdirSync(join(root, ".release"));
  writeFileSync(join(root, "package-lock.json"), lockfile);
  writeFileSync(join(root, ".release/source-attestation.json"), JSON.stringify(f.attestation));
  return { ...f, root };
}

test("release CLI accepts all six attested staging services and rejects identity drift", () => {
  for (const scope of ["web", "staff", "analytics", "notification", "whatsapp", "monitor"]) {
    const f = isolatedProof(scope);
    try {
      const invoke = () => spawnSync(process.execPath, [resolve("scripts/validate-release-environment.mjs"), scope], { cwd: f.root, env: f.env, encoding: "utf8" });
      assert.equal(invoke().status, 0, `${scope} accepts isolated proof`);
      f.env.RAILWAY_ENVIRONMENT_ID = "protected-production";
      assert.equal(invoke().status, 1, `${scope} rejects protected identity`);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});

test("disabled notification and whatsapp processes boot and stop without database or transport access", async () => {
  for (const scope of ["notification", "whatsapp"]) {
    const f = isolatedProof(scope);
    try {
      const script = resolve(scope === "notification" ? "scripts/notification-queue-worker.ts" : "scripts/whatsapp-worker.ts");
      const child = spawn(process.execPath, ["--import", resolve("node_modules/tsx/dist/loader.mjs"), script], {
        cwd: f.root, env: { ...f.env, TSX_TSCONFIG_PATH: resolve("tsconfig.json"), NODE_OPTIONS: `--import=${resolve("scripts/rc-network-guard.mjs")}` }, stdio: ["ignore", "pipe", "pipe"],
      });
      let output = ""; let ready = false;
      const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
      const accept = (data: Buffer) => {
        output += data.toString();
        if (!ready && output.includes("RC_STAGING_COMMUNICATION_DISABLED")) { ready = true; setTimeout(() => child.kill("SIGTERM"), 50); }
      };
      child.stdout.on("data", accept); child.stderr.on("data", accept);
      const exit = await new Promise((done) => child.on("close", (code) => done(code)));
      clearTimeout(timer);
      assert.equal(ready, true, `${scope} reaches disabled startup`);
      assert.equal(exit, 0, `${scope} exits cleanly`);
      assert.equal(/RC_EXTERNAL_NETWORK_DENIED|Fatal error/.test(output), false);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});

test("staging monitor executes attested DB-down and recovery alert cycles without outbound traffic", () => {
  const f = isolatedProof("monitor");
  const hook = join(f.root, "synthetic-monitor.mjs");
  try {
    writeFileSync(hook, `
      let cycle = 0; const codes = [];
      const timeout = globalThis.setTimeout;
      globalThis.setTimeout = (fn, ms, ...args) => timeout(fn, ms >= 60000 ? 1 : ms, ...args);
      globalThis.fetch = async (url, options) => {
        if (url === process.env.OPS_ALERT_WEBHOOK_URL) {
          if (options.headers.authorization !== "Bearer " + process.env.OPS_ALERT_WEBHOOK_BEARER_TOKEN || options.redirect !== "manual") throw new Error("ALERT_AUTH_CONTRACT_FAILED");
          codes.push(JSON.parse(options.body).code);
          return Response.json({receiverId: "synthetic-receiver"});
        }
        if (url === process.env.OPS_DESKTOP_HEALTH_URL) cycle++;
        else if (url !== process.env.OPS_STAFF_PROBE_URL) throw new Error("UNAPPROVED_TARGET");
        if (cycle >= 5 && url === process.env.OPS_STAFF_PROBE_URL) process.emit("SIGTERM");
        const ok = cycle > 3;
        return Response.json({ok, database: ok ? "ready" : "unavailable", release: {
          environment: "production", commitSha: process.env.APP_RELEASE_SHA,
          tree: process.env.APP_RELEASE_TREE, sourceDigest: process.env.APP_RELEASE_SOURCE_DIGEST
        }}, {status: ok ? 200 : 503});
      };
      process.on("exit", () => console.log("SYNTHETIC_MONITOR_CODES=" + JSON.stringify(codes)));
    `);
    const child = spawnSync(process.execPath, ["--import", resolve("node_modules/tsx/dist/loader.mjs"), "--import", hook, resolve("scripts/ops-health-monitor.ts")], {
      cwd: f.root, env: { ...f.env, TSX_TSCONFIG_PATH: resolve("tsconfig.json"), NODE_OPTIONS: `--import=${resolve("scripts/rc-network-guard.mjs")}` }, encoding: "utf8", timeout: 15_000,
    });
    assert.equal(child.status, 0, "synthetic monitor completes and exits");
    const codes = JSON.parse(child.stdout.match(/SYNTHETIC_MONITOR_CODES=(\[[^\n]*\])/)?.[1] ?? "[]");
    for (const code of ["DATABASE_UNAVAILABLE", "DATABASE_RECOVERED", "SERVICE_HEALTH_FAILED", "SERVICE_HEALTH_RECOVERED"]) assert.equal(codes.includes(code), true, code);
    assert.equal(/UNAPPROVED_TARGET|RC_EXTERNAL_NETWORK_DENIED|ALERT_AUTH_CONTRACT_FAILED/.test(child.stdout + child.stderr), false);
    assert.equal((child.stdout + child.stderr).includes(f.env.OPS_ALERT_WEBHOOK_BEARER_TOKEN), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
