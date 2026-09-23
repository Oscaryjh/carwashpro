import assert from "node:assert/strict";
import test from "node:test";

import {
  assertConnectorReleaseProfile,
  assertWhatsAppProviderAvailable,
} from "./testing-boundary.js";
import { sendTextMessage, validateWhatsAppRecipient } from "./sender.js";

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
  assert.doesNotThrow(() => assertWhatsAppProviderAvailable({ APP_ENVIRONMENT: "production", RAILWAY_ENVIRONMENT_NAME: "production" }));
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
