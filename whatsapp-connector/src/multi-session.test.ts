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
