import assert from "node:assert/strict";
import test from "node:test";

import {
  assertConnectorReleaseProfile,
  assertWhatsAppProviderAvailable,
} from "./testing-boundary.js";
import { sendTextMessage, validateWhatsAppRecipient } from "./sender.js";
import { getSocket, logoutSession, reconnectSocket, startSocket } from "./socket.js";

const safeTesting = {
  APP_ENVIRONMENT: "testing",
  RAILWAY_ENVIRONMENT_NAME: "testing",
  RAILWAY_GIT_COMMIT_SHA: "a".repeat(40),
  TETAMU_TESTING_OUTBOUND_MODE: "intercept",
  WHATSAPP_SEND_MODE: "mock",
};

test("Testing connector accepts only an explicit Git-source intercept profile", () => {
  assert.doesNotThrow(() => assertConnectorReleaseProfile(safeTesting));
  for (const changed of [
    { WHATSAPP_SEND_MODE: "live" },
    { TETAMU_TESTING_OUTBOUND_MODE: "" },
    { RAILWAY_GIT_COMMIT_SHA: "" },
    { APP_ENVIRONMENT: "production" },
  ]) {
    assert.throws(() => assertConnectorReleaseProfile({ ...safeTesting, ...changed }));
  }
});

test("Testing connector blocks direct provider sends and socket connections", () => {
  assert.throws(() => assertWhatsAppProviderAvailable(safeTesting), /blocked/i);
  assert.throws(() => assertWhatsAppProviderAvailable({ ...safeTesting, WHATSAPP_SEND_MODE: "live" }), /blocked/i);
  assert.doesNotThrow(() => assertWhatsAppProviderAvailable({ APP_ENVIRONMENT: "production", RAILWAY_ENVIRONMENT_NAME: "production", WHATSAPP_SEND_MODE: "live" }));
});

test("actual sender and recipient lookup reject Testing before socket access", async () => {
  const original = process.env.APP_ENVIRONMENT;
  process.env.APP_ENVIRONMENT = "testing";
  try {
    await assert.rejects(sendTextMessage("test-business", "+60123456789", "hello"), /blocked/i);
    await assert.rejects(validateWhatsAppRecipient("test-business", "+60123456789"), /blocked/i);
  } finally {
    if (original === undefined) delete process.env.APP_ENVIRONMENT;
    else process.env.APP_ENVIRONMENT = original;
  }
});

test("Production disabled rejects direct sends, lookup, and every socket entry before provider access", async () => {
  const keys = ["APP_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "WHATSAPP_SEND_MODE"] as const;
  const previous = keys.map((key) => process.env[key]);
  try {
    process.env.APP_ENVIRONMENT = "production";
    process.env.RAILWAY_ENVIRONMENT_NAME = "production";
    process.env.WHATSAPP_SEND_MODE = "disabled";
    assert.throws(() => assertWhatsAppProviderAvailable(), /disabled/i);
    await assert.rejects(sendTextMessage("test-business", "+60123456789", "hello"), /disabled/i);
    await assert.rejects(validateWhatsAppRecipient("test-business", "+60123456789"), /disabled/i);
    await assert.rejects(startSocket("test-business"), /disabled/i);
    await assert.rejects(reconnectSocket("test-business"), /disabled/i);
    await assert.rejects(logoutSession("test-business"), /disabled/i);
    assert.throws(() => getSocket("test-business"), /disabled/i);
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});

test("Production missing or ambiguous mode fails closed while explicit live is permitted", () => {
  const base = { APP_ENVIRONMENT: "production", RAILWAY_ENVIRONMENT_NAME: "production" };
  for (const mode of [undefined, "mock", "LIVE", "enabled", "disabled"]) {
    assert.throws(() => assertWhatsAppProviderAvailable({ ...base, WHATSAPP_SEND_MODE: mode }), /blocked|disabled/i);
  }
  assert.doesNotThrow(() => assertWhatsAppProviderAvailable({ ...base, WHATSAPP_SEND_MODE: "live" }));
  assert.throws(() => assertWhatsAppProviderAvailable({ WHATSAPP_SEND_MODE: "live" }), /blocked|disabled/i);
  assert.throws(() => assertWhatsAppProviderAvailable({ APP_ENVIRONMENT: "production", WHATSAPP_SEND_MODE: "live" }), /blocked|disabled/i);
});
