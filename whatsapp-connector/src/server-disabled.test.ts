import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import test from "node:test";

function readOutboundNetworkCalls(child: ReturnType<typeof spawn>) {
  return new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("provider network probe did not respond")), 2_000);
    child.once("message", (message: unknown) => {
      clearTimeout(timeout);
      if (!message || typeof message !== "object" || !("outboundNetworkCalls" in message)) return reject(new Error("invalid provider network probe response"));
      resolve(Number(message.outboundNetworkCalls));
    });
    child.send("provider-network-snapshot");
  });
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function verifyBlockedHttpCommands(profile: Record<string, string>) {
  const port = await freePort();
  const child = spawn(process.execPath, ["--import", "./src/provider-network-probe.mjs", "--import", "tsx", "src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...profile,
      AUTH_INFO_PATH: "./nonexistent-disabled-test-auth",
      CONNECTOR_API_SECRET: "test-only-secret",
      WHATSAPP_DEFAULT_BUSINESS_ID: "synthetic-business",
      PORT: String(port),
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  try {
    const url = `http://127.0.0.1:${port}`;
    let healthy = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const response = await fetch(`${url}/health`);
        if (response.ok) { healthy = true; break; }
      } catch { /* server not ready */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(healthy, true, "local connector must start for HTTP boundary test");
    // tsx opens local loader IPC during startup; only HTTP-command deltas are provider relevant.
    const baselineOutboundCalls = await readOutboundNetworkCalls(child);
    const headers = { "x-connector-api-secret": "test-only-secret", "content-type": "application/json" };
    for (const [path, method, body] of [
      ["/status", "GET", undefined],
      ["/session", "GET", undefined],
      ["/diagnostics", "GET", undefined],
      ["/qr", "GET", undefined],
      ["/qr/image", "GET", undefined],
      ["/jid?phone=60123456789", "GET", undefined],
      ["/reconnect", "POST", "{}"],
      ["/logout", "POST", "{}"],
      ["/send", "POST", JSON.stringify({ businessId: "synthetic-business", requestId: "test-request", phone: "60123456789", message: "test" })],
    ] as const) {
      const response = await fetch(`${url}${path}`, { method, headers, body });
      assert.equal(response.status, 403, `${path} must reject disabled mode`);
    }
    const health = await (await fetch(`${url}/health`)).json() as { data: { activeSessions: number } };
    assert.equal(health.data.activeSessions, 0, "no socket session was created");
    const outboundNetworkCalls = await readOutboundNetworkCalls(child);
    assert.equal(outboundNetworkCalls - baselineOutboundCalls, 0, "providerCalls=0: blocked HTTP commands made no outbound network attempt");
  } finally {
    child.kill();
  }
}

test("disabled Production HTTP commands reject before socket or send", async () => {
  await verifyBlockedHttpCommands({ APP_ENVIRONMENT: "production", RAILWAY_ENVIRONMENT_NAME: "production", WHATSAPP_SEND_MODE: "disabled" });
});

test("Testing mock/intercept HTTP commands reject before socket or send", async () => {
  await verifyBlockedHttpCommands({ APP_ENVIRONMENT: "testing", RAILWAY_ENVIRONMENT_NAME: "testing", WHATSAPP_SEND_MODE: "mock", TETAMU_TESTING_OUTBOUND_MODE: "intercept", RAILWAY_GIT_COMMIT_SHA: "a".repeat(40) });
});
