import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolveWhatsAppSendMode, sendWhatsAppQueueItem } from "../../src/lib/notification-queue/worker-send";
import { stagingRuntimeFixture } from "../helpers/staging-runtime-fixture";

test("staging disabled communications refuse sends and workers idle before touching queues or sessions", async () => {
  const f = stagingRuntimeFixture("notification");
  assert.equal(Reflect.apply(resolveWhatsAppSendMode, null, [f.env, f.attestation]), "disabled");
  let calls = 0;
  await assert.rejects(sendWhatsAppQueueItem({ businessId: "synthetic-business", queueId: "synthetic-queue", phone: f.env.RC_STAGING_SYNTHETIC_PHONE_ALLOWLIST, message: "synthetic" }, { env: f.env, sourceAttestation: f.attestation, transport: async () => { calls++; throw new Error("OUTBOUND_DENIED"); } }), /COMMUNICATION_DISABLED/);
  assert.equal(calls, 0);
  for (const filename of ["scripts/notification-queue-worker.ts", "scripts/whatsapp-worker.ts"]) {
    const source = readFileSync(filename, "utf8");
    assert.match(source, /await runDisabledStagingWorker/);
    const main = source.slice(source.indexOf("async function main()"));
    assert.ok(main.indexOf("await runDisabledStagingWorker") < main.indexOf(filename.includes("notification") ? "getWhatsAppSendModeRuntimeConfig" : "restoreActiveSessions"));
  }
});

test("staging connector configuration cannot activate an alternate real transport", () => {
  const f = stagingRuntimeFixture("notification"); f.env.WHATSAPP_CONNECTOR_URL = "https://forbidden.invalid";
  assert.throws(() => Reflect.apply(resolveWhatsAppSendMode, null, [f.env, f.attestation]), /PRODUCTION_/);
});

test("staging platform identity cannot select a live transport by removing the profile", () => {
  const f = stagingRuntimeFixture("notification"); delete f.env.APP_DEPLOYMENT_PROFILE; f.env.WHATSAPP_SEND_MODE = "live";
  assert.throws(() => resolveWhatsAppSendMode(f.env, f.attestation), /PRODUCTION_/);
});
