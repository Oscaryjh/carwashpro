import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { createOpsAlertEvent, emitOpsAlert, resetOpsAlertStateForTests, sendOpsAlert } from "../../src/lib/ops/alerting";
// @ts-expect-error Standalone backup CLI module has no declaration file.
import { deliverFailureAlert } from "../../scripts/lib/database-backup-core.mjs";

const originalEnv = { ...process.env };
test.beforeEach(() => {
  resetOpsAlertStateForTests();
  process.env.APP_ENVIRONMENT = "production";
  process.env.APP_DEPLOYMENT_PROFILE = "rc-staging";
  process.env.OPS_ALERT_WEBHOOK_BEARER_TOKEN = randomBytes(48).toString("base64url");
});
test.afterEach(() => { process.env = { ...originalEnv }; });

function event(status: "ACTIVE" | "RECOVERED" = "ACTIVE") {
  return createOpsAlertEvent({ event: status === "ACTIVE" ? "SERVICE_HEALTH_FAILED" : "SERVICE_HEALTH_RECOVERED", environment: "production", severity: "INFO", service: "synthetic-monitor", stage: "health-probe", code: "SYNTHETIC_HEALTH", message: "Synthetic health test", status });
}
const endpoint = "https://receiver.example.test/events";
const transports = {
  monitor: (options: Parameters<typeof sendOpsAlert>[1], value = event()) => sendOpsAlert(value, options),
  backup: (options: Parameters<typeof sendOpsAlert>[1], value = event()) => deliverFailureAlert({ event: value, ...options }),
};

for (const [name, send] of Object.entries(transports)) {
  test(`${name}: staging missing or malformed bearer is rejected before transport`, async () => {
    for (const token of [undefined, "", "short", " ".repeat(40), randomBytes(32).toString("hex") + "\r\nHeader:bad"]) {
      if (token === undefined) delete process.env.OPS_ALERT_WEBHOOK_BEARER_TOKEN;
      else process.env.OPS_ALERT_WEBHOOK_BEARER_TOKEN = token;
      let calls = 0;
      await assert.rejects(() => send({ webhookUrl: endpoint, fetchImpl: async () => { calls++; return new Response(null, { status: 202 }); } }), /ALERT_.*TOKEN/);
      assert.equal(calls, 0);
    }
  });

  test(`${name}: correct bearer authenticates fault and recovery without entering payload or URL`, async () => {
    const token = process.env.OPS_ALERT_WEBHOOK_BEARER_TOKEN!;
    let accepted = 0;
    for (const status of ["ACTIVE", "RECOVERED"] as const) {
      const result = await send({ webhookUrl: endpoint, fetchImpl: async (url, init) => {
        assert.equal(String(url).includes(token), false);
        assert.equal(String(init?.body).includes(token), false);
        assert.equal(init?.redirect, "manual");
        const authenticated = new Headers(init?.headers).get("authorization") === `Bearer ${token}`;
        if (authenticated) accepted++;
        return new Response(null, { status: authenticated ? 202 : 401 });
      } }, event(status));
      assert.equal(result.delivered, true);
    }
    assert.equal(accepted, 2);
  });

  test(`${name}: incorrect bearer gets 401 without retries or response body reflection`, async () => {
    let calls = 0;
    const token = process.env.OPS_ALERT_WEBHOOK_BEARER_TOKEN!;
    const result = await send({ webhookUrl: endpoint, fetchImpl: async (_url, init) => {
      calls++;
      assert.equal(new Headers(init?.headers).get("authorization") === `Bearer ${token}`, true);
      return new Response(token, { status: 401 });
    } });
    assert.equal(result.delivered, false);
    assert.equal(result.reason, "ALERT_HTTP_401");
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(result).includes(token), false);
  });

  test(`${name}: transient errors retry authenticated delivery`, async () => {
    let calls = 0;
    const token = process.env.OPS_ALERT_WEBHOOK_BEARER_TOKEN!;
    const result = await send({ webhookUrl: endpoint, sleepImpl: async () => {}, fetchImpl: async (_url, init) => {
      assert.equal(new Headers(init?.headers).get("authorization") === `Bearer ${token}`, true);
      return new Response(null, { status: ++calls < 3 ? 503 : 202 });
    } });
    assert.equal(result.delivered, true);
    assert.equal(result.attempts, 3);
  });

  test(`${name}: every redirect is refused with one request and no location reflection`, async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      resetOpsAlertStateForTests();
      let calls = 0;
      const token = process.env.OPS_ALERT_WEBHOOK_BEARER_TOKEN!;
      const result = await send({ webhookUrl: endpoint, fetchImpl: async (_url, init) => {
        calls++;
        assert.equal(init?.redirect, "manual");
        return new Response(null, { status, headers: { location: `https://other.example.test/${token}` } });
      } });
      assert.equal(calls, 1);
      assert.equal(result.delivered, false);
      assert.equal(JSON.stringify(result).includes(token), false);
    }
  });

  test(`${name}: rejects credential-bearing and token-reflecting destinations before fetch`, async () => {
    const token = process.env.OPS_ALERT_WEBHOOK_BEARER_TOKEN!;
    for (const url of ["https://user:pass@receiver.example.test/events", endpoint + "?secret=x", endpoint + "#secret", endpoint + "/" + token, endpoint + "/" + [...token].map(c => "%" + c.charCodeAt(0).toString(16)).join("")]) {
      let calls = 0;
      await assert.rejects(() => send({ webhookUrl: url, fetchImpl: async () => { calls++; return new Response(null, { status: 202 }); } }), error => error instanceof Error && !error.message.includes(token));
      assert.equal(calls, 0);
    }
  });

  test(`${name}: payload, success receiver identity, transport exceptions and logs never disclose bearer`, async () => {
    const token = process.env.OPS_ALERT_WEBHOOK_BEARER_TOKEN!;
    const value = { ...event(), message: token, metadata: { nested: [token] } };
    const logs: string[] = [];
    const prior = console.error;
    console.error = (...args) => { logs.push(args.join(" ")); };
    try {
      const ok = await send({ webhookUrl: endpoint, fetchImpl: async (_url, init) => {
        assert.equal(String(init?.body).includes(token), false);
        return new Response(null, { status: 202, headers: { "x-request-id": token } });
      } }, value);
      assert.equal(ok.delivered, true);
      assert.equal(JSON.stringify(ok).includes(token), false);
      resetOpsAlertStateForTests();
      const failed = await send({ webhookUrl: endpoint, sleepImpl: async () => {}, fetchImpl: async () => { throw new Error(`Transport reflected ${token}`); } }, value);
      assert.equal(failed.delivered, false);
      assert.equal(JSON.stringify(failed).includes(token), false);
      assert.equal(logs.join("\n").includes(token), false);
    } finally { console.error = prior; }
  });
}

test("emitOpsAlert redacts the configured bearer even under an unrelated metadata key", async () => {
  const token = process.env.OPS_ALERT_WEBHOOK_BEARER_TOKEN!;
  const logs: string[] = [];
  const prior = console.log;
  console.log = (...args) => { logs.push(args.join(" ")); };
  try {
    const result = await emitOpsAlert({ event: "SERVICE_HEALTH_RECOVERED", severity: "INFO", service: "synthetic", stage: "health-probe", code: "RECOVERY", message: token, metadata: { diagnostic: token } }, { webhookUrl: endpoint, fetchImpl: async () => new Response(null, { status: 202 }) });
    assert.equal(JSON.stringify(result).includes(token), false);
    assert.equal(logs.join("\n").includes(token), false);
  } finally { console.log = prior; }
});

test("staging token guard cannot be bypassed by profile whitespace or the named platform", async () => {
  delete process.env.OPS_ALERT_WEBHOOK_BEARER_TOKEN;
  for (const profile of [" rc-staging ", ""]) {
    process.env.APP_DEPLOYMENT_PROFILE = profile;
    process.env.RAILWAY_ENVIRONMENT_NAME = "Production-RC-Staging-20260920";
    await assert.rejects(() => sendOpsAlert(event(), { webhookUrl: endpoint, fetchImpl: async () => new Response(null, { status: 202 }) }), /TOKEN_REQUIRED/);
  }
});

test("percent-encoded bearer cannot enter destinations, payloads, receiver identities or logs", async () => {
  const token = process.env.OPS_ALERT_WEBHOOK_BEARER_TOKEN!;
  const encoded = [...token].map(c => "%" + c.charCodeAt(0).toString(16)).join("");
  const twice = encoded.replaceAll("%", "%25");
  const logs: string[] = [];
  const prior = console.log;
  console.log = (...args) => { logs.push(args.join(" ")); };
  try {
    for (const send of Object.values(transports)) {
      for (const representation of [encoded, twice]) {
        resetOpsAlertStateForTests();
        await assert.rejects(() => send({ webhookUrl: endpoint + "/" + representation, fetchImpl: async () => new Response(null, { status: 202 }) }), /ALERT_DESTINATION_INVALID/);
        const result = await send({ webhookUrl: endpoint, fetchImpl: async (_url, init) => {
          assert.equal(String(init?.body).includes(representation), false);
          return new Response(null, { status: 202, headers: { "x-request-id": representation } });
        } }, { ...event(), message: representation });
        assert.equal(JSON.stringify(result).includes(representation), false);
      }
    }
    resetOpsAlertStateForTests();
    const result = await emitOpsAlert({ event: "SERVICE_HEALTH_RECOVERED", severity: "INFO", service: "synthetic", stage: "health-probe", code: "RECOVERY", message: encoded, metadata: { [token]: twice } }, { webhookUrl: endpoint, fetchImpl: async () => new Response(null, { status: 202 }) });
    for (const representation of [token, encoded, twice]) {
      assert.equal(JSON.stringify(result).includes(representation), false);
      assert.equal(logs.join("\n").includes(representation), false);
    }
  } finally { console.log = prior; }
});

test("returned emitted event never carries bearer in metadata keys", async () => {
  const token = process.env.OPS_ALERT_WEBHOOK_BEARER_TOKEN!;
  const prior = console.log;
  console.log = () => {};
  try {
    const result = await emitOpsAlert({ event: "SERVICE_HEALTH_RECOVERED", severity: "INFO", service: "synthetic", stage: "health-probe", code: "RECOVERY", message: "safe", metadata: { [token]: "safe" } }, { webhookUrl: endpoint, fetchImpl: async () => new Response(null, { status: 202 }) });
    assert.equal(JSON.stringify(result).includes(token), false);
  } finally { console.log = prior; }
});
