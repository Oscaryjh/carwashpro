import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  getActiveSessionCount,
  getSessionAuthInfoPath,
  getStatus,
  shouldForwardMessagesUpsert,
} from "./socket.js";
import { getReconnectDelayMs } from "./reconnect.js";
import { connectorHealthFromStates } from "./readiness.js";
import {
  assertConnectorLiveDeliveryAllowed,
  isConnectorLiveDeliveryAllowed,
} from "./delivery-policy.js";

test("uses isolated auth directories for different businesses", () => {
  process.env.AUTH_INFO_PATH = path.join("C:", "tmp", "whatsapp-auth");
  process.env.WHATSAPP_DEFAULT_BUSINESS_ID = "business-a";

  assert.equal(
    getSessionAuthInfoPath("business-a"),
    path.resolve(process.env.AUTH_INFO_PATH),
  );
  assert.equal(
    getSessionAuthInfoPath("business-b"),
    path.join(path.resolve(process.env.AUTH_INFO_PATH), "sessions", "business-b"),
  );
});

test("keeps connector state isolated by business ID", () => {
  const first = getStatus("business-a");
  const second = getStatus("business-b");

  assert.equal(first.businessId, "business-a");
  assert.equal(second.businessId, "business-b");
  assert.notEqual(first, second);
  assert.equal(getActiveSessionCount(), 2);
});

test("forwards realtime and offline appended messages", () => {
  assert.equal(shouldForwardMessagesUpsert("notify"), true);
  assert.equal(shouldForwardMessagesUpsert("append"), true);
  assert.equal(shouldForwardMessagesUpsert("history-sync"), false);
  assert.equal(shouldForwardMessagesUpsert(undefined), false);
});

test("reconnect delay is bounded and increases with retry attempts", () => {
  const firstAttempt = getReconnectDelayMs(0);
  const laterAttempt = getReconnectDelayMs(3);
  const cappedAttempt = getReconnectDelayMs(99);

  assert.ok(firstAttempt >= 1000 && firstAttempt < 1500);
  assert.ok(laterAttempt >= 8000 && laterAttempt < 8500);
  assert.ok(cappedAttempt >= 30000 && cappedAttempt <= 30000);
  assert.ok(getReconnectDelayMs(-1) >= 1000);
});

test("connector health distinguishes process, session and send readiness", () => {
  assert.deepEqual(connectorHealthFromStates([]), {
    process: "PROCESS_HEALTHY",
    session: "SESSION_NOT_CONNECTED",
    send: "NOT_READY_TO_SEND",
    connectedSessions: 0,
    configuredSessions: 0,
  });
  assert.deepEqual(connectorHealthFromStates([{ status: "connected", healthy: true }]), {
    process: "PROCESS_HEALTHY",
    session: "SESSION_CONNECTED",
    send: "READY_TO_SEND",
    connectedSessions: 1,
    configuredSessions: 1,
  });
  assert.equal(
    connectorHealthFromStates([{ status: "connected", healthy: false }]).send,
    "NOT_READY_TO_SEND",
  );
});

test("connector effect boundary only permits source-pinned Production live delivery", () => {
  const production = {
    APP_ENVIRONMENT: "production",
    RAILWAY_ENVIRONMENT_NAME: "production",
    RAILWAY_ENVIRONMENT_ID: "bef43b86-32dc-486e-a1ef-bb9f9699e4f5",
    WHATSAPP_SEND_MODE: "live",
  };
  assert.equal(isConnectorLiveDeliveryAllowed(production), true);
  assert.doesNotThrow(() => assertConnectorLiveDeliveryAllowed(production));

  for (const env of [
    { ...production, APP_ENVIRONMENT: "testing", RAILWAY_ENVIRONMENT_NAME: "testing" },
    { ...production, WHATSAPP_SEND_MODE: "mock" },
    { ...production, RAILWAY_ENVIRONMENT_ID: "wrong" },
    { ...production, APP_ENVIRONMENT: "development" },
  ]) {
    assert.equal(isConnectorLiveDeliveryAllowed(env), false);
    assert.throws(
      () => assertConnectorLiveDeliveryAllowed(env),
      /CONNECTOR_LIVE_DELIVERY_DENIED/,
    );
  }
});

test("connector readiness cannot claim send-ready when delivery policy is closed", () => {
  assert.equal(
    connectorHealthFromStates([{ status: "connected", healthy: true }], false).send,
    "NOT_READY_TO_SEND",
  );
});
